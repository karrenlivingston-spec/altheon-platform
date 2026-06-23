"""Real-time virtual visit transcription (ElevenLabs Scribe) and SOAP generation."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import anthropic
import websockets as ws_lib
from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, assert_clinic_role, enforce_clinic_role_from_auth_header

router = APIRouter(prefix="/visits", tags=["virtual_visit_transcription"])

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
EL_STREAM_URL = "wss://api.elevenlabs.io/v1/speech-to-text/stream"


def _user_id_from_token(token: str) -> str:
    t = (token or "").strip()
    if not t:
        raise ValueError("Missing token")
    try:
        auth_response = supabase.auth.get_user(t)
    except Exception as exc:
        raise ValueError("Invalid or expired token") from exc

    user_obj = getattr(auth_response, "user", None)
    if user_obj is None and isinstance(auth_response, dict):
        user_obj = auth_response.get("user")
    uid = getattr(user_obj, "id", None) if user_obj is not None else None
    if uid is None and isinstance(user_obj, dict):
        uid = user_obj.get("id")
    if not uid:
        raise ValueError("Invalid or expired token")
    return str(uid)


@router.websocket("/{room_id}/transcribe")
async def transcribe_visit(
    websocket: WebSocket,
    room_id: str,
    token: str = Query(...),
):
    """
    WebSocket endpoint. Clinician browser connects here after starting recording.
    Receives binary audio chunks, forwards to ElevenLabs Scribe streaming API,
    accumulates transcript, saves chunks to virtual_visits.transcript in real time.
    """
    await websocket.accept()

    try:
        user_id = _user_id_from_token(token)
    except ValueError:
        await websocket.close(code=4001)
        return

    visit_resp = (
        supabase.table("virtual_visits")
        .select("id, clinic_id, appointment_id, transcript_status")
        .eq("room_id", room_id)
        .limit(1)
        .execute()
    )

    if not visit_resp.data:
        await websocket.close(code=4004)
        return

    visit_row = visit_resp.data[0]
    visit_id = visit_row["id"]
    clinic_id = str(visit_row.get("clinic_id") or "").strip()

    try:
        assert_clinic_role(user_id, clinic_id, CLINICAL_ROLES)
    except HTTPException:
        await websocket.close(code=4003)
        return

    if not ELEVENLABS_API_KEY:
        await websocket.close(code=1011)
        return

    full_transcript = ""
    chunk_count = 0

    supabase.table("virtual_visits").update(
        {
            "transcript_status": "recording",
            "recording_started_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", visit_id).execute()

    try:
        el_headers = {"xi-api-key": ELEVENLABS_API_KEY}
        async with ws_lib.connect(EL_STREAM_URL, extra_headers=el_headers) as el_ws:
            await el_ws.send(
                json.dumps(
                    {
                        "model_id": "scribe_v1",
                        "language_code": "en",
                        "output_format": "text",
                    }
                )
            )

            async def forward_audio() -> None:
                while True:
                    try:
                        data = await websocket.receive_bytes()
                        await el_ws.send(data)
                    except WebSocketDisconnect:
                        await el_ws.send(json.dumps({"type": "end_of_stream"}))
                        break
                    except Exception:
                        break

            async def receive_transcript() -> None:
                nonlocal full_transcript, chunk_count
                async for message in el_ws:
                    try:
                        data = json.loads(message)
                        chunk = data.get("text", "")
                        if not chunk:
                            continue
                        full_transcript += " " + chunk
                        chunk_count += 1
                        await websocket.send_json(
                            {
                                "type": "transcript_chunk",
                                "text": chunk,
                                "full": full_transcript.strip(),
                            }
                        )
                        if chunk_count % 10 == 0:
                            supabase.table("virtual_visits").update(
                                {"transcript": full_transcript.strip()}
                            ).eq("id", visit_id).execute()
                    except Exception:
                        continue

            await asyncio.gather(forward_audio(), receive_transcript())

    except Exception:
        supabase.table("virtual_visits").update(
            {"transcript_status": "failed"}
        ).eq("id", visit_id).execute()
        await websocket.close(code=1011)
        return

    supabase.table("virtual_visits").update(
        {
            "transcript": full_transcript.strip(),
            "transcript_status": "processing",
        }
    ).eq("id", visit_id).execute()

    await websocket.close()


def _parse_soap_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _upsert_clinical_note_from_soap(visit: dict[str, Any], soap: dict[str, Any]) -> None:
    appointment_id = visit.get("appointment_id")
    if not appointment_id:
        return

    soap_fields = {
        "subjective": soap.get("subjective", ""),
        "objective": soap.get("objective", ""),
        "assessment": soap.get("assessment", ""),
        "plan": soap.get("plan", ""),
        "soap_source": "virtual_visit_transcript",
    }

    existing_note = (
        supabase.table("clinical_notes")
        .select("id, status")
        .eq("appointment_id", appointment_id)
        .limit(1)
        .execute()
    )

    if existing_note.data:
        note = existing_note.data[0]
        if str(note.get("status") or "") == "signed":
            return
        supabase.table("clinical_notes").update(soap_fields).eq("id", note["id"]).execute()
        return

    patient_id = str(visit.get("patient_id") or "").strip()
    clinician_id = str(visit.get("clinician_id") or "").strip()
    clinic_id = str(visit.get("clinic_id") or "").strip()
    if not patient_id or not clinician_id or not clinic_id:
        return

    supabase.table("clinical_notes").insert(
        {
            "appointment_id": appointment_id,
            "clinic_id": clinic_id,
            "patient_id": patient_id,
            "author_id": clinician_id,
            "status": "draft",
            "note_type": "daily_note",
            **soap_fields,
        }
    ).execute()


@router.post("/{room_id}/generate-soap")
async def generate_soap_from_transcript(
    room_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """
    Called after visit ends. Reads transcript from virtual_visits,
    sends to Claude Haiku, saves SOAP draft, returns it.
    """
    try:
        visit_resp = (
            supabase.table("virtual_visits")
            .select(
                "id, transcript, appointment_id, clinic_id, patient_id, clinician_id"
            )
            .eq("room_id", room_id)
            .limit(1)
            .execute()
        )

        if not visit_resp.data:
            raise HTTPException(status_code=404, detail="Visit not found")

        v = visit_resp.data[0]
        clinic_id = str(v.get("clinic_id") or "").strip()
        enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)

        transcript = str(v.get("transcript") or "").strip()
        if not transcript:
            raise HTTPException(status_code=400, detail="No transcript available")

        if not ANTHROPIC_API_KEY:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

        prompt = f"""You are a physical therapy clinical documentation assistant.
Based on the following visit transcript between a clinician and patient, generate a complete SOAP note.

TRANSCRIPT:
{transcript}

Return ONLY a JSON object (no markdown, no explanation):
{{
  "subjective": "Patient's reported symptoms, history, complaints, functional limitations...",
  "objective": "Clinician's objective findings, measurements, observations, tests performed...",
  "assessment": "Clinical assessment, diagnosis impression, progress toward goals...",
  "plan": "Treatment plan, interventions performed, home program, follow-up..."
}}

Be specific and clinical. Use professional PT/chiropractic documentation language.
If information for a section is not present in the transcript, write what can be reasonably inferred and note it."""

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        soap = _parse_soap_json(message.content[0].text)

        supabase.table("virtual_visits").update(
            {
                "soap_draft": soap,
                "transcript_status": "complete",
            }
        ).eq("id", v["id"]).execute()

        _upsert_clinical_note_from_soap(v, soap)

        return {
            "soap": soap,
            "appointment_id": v.get("appointment_id"),
            "transcript": transcript,
        }

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="AI response could not be parsed"
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
