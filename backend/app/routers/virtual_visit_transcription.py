"""Virtual visit audio upload → ElevenLabs Scribe REST → Claude Haiku SOAP."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import anthropic
import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header

router = APIRouter(prefix="/visits", tags=["virtual_visit_transcription"])

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")


def _parse_soap_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _mark_visit_failed(visit_id: str) -> None:
    try:
        supabase.table("virtual_visits").update(
            {"transcript_status": "failed"}
        ).eq("id", visit_id).execute()
    except Exception:
        pass


@router.post("/{room_id}/transcribe-and-generate")
async def transcribe_and_generate(
    room_id: str,
    clinic_id: str = Form(...),
    audio: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    enforce_clinic_role_from_auth_header(authorization, cid, *CLINICAL_ROLES)

    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    v: dict[str, Any] | None = None
    try:
        visit = (
            supabase.table("virtual_visits")
            .select("id, appointment_id, clinic_id, patient_id, clinician_id")
            .eq("room_id", room_id)
            .limit(1)
            .execute()
        )

        if not visit.data:
            raise HTTPException(status_code=404, detail="Visit not found")

        v = visit.data[0]
        visit_clinic = str(v.get("clinic_id") or "").strip()
        if visit_clinic and visit_clinic != cid:
            raise HTTPException(status_code=403, detail="Visit does not belong to this clinic")

        supabase.table("virtual_visits").update(
            {"transcript_status": "processing"}
        ).eq("id", v["id"]).execute()

        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio upload")

        async with httpx.AsyncClient(timeout=120.0) as client:
            scribe_response = await client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                files={
                    "file": (
                        audio.filename or "recording.webm",
                        audio_bytes,
                        "audio/webm",
                    )
                },
                data={"model_id": "scribe_v1"},
            )

        if scribe_response.status_code != 200:
            _mark_visit_failed(str(v["id"]))
            raise HTTPException(
                status_code=502,
                detail=f"ElevenLabs Scribe error: {scribe_response.text}",
            )

        transcript = scribe_response.json().get("text", "").strip()
        if not transcript:
            _mark_visit_failed(str(v["id"]))
            raise HTTPException(status_code=400, detail="No transcript returned from Scribe")

        supabase.table("virtual_visits").update(
            {
                "transcript": transcript,
                "transcript_status": "processing",
            }
        ).eq("id", v["id"]).execute()

        ai_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        prompt = f"""You are a physical therapy clinical documentation assistant.
Based on the following visit transcript between a clinician and patient, generate a complete SOAP note.

TRANSCRIPT:
{transcript}

Return ONLY a JSON object (no markdown, no explanation):
{{
  "subjective": "Patient reported symptoms, history, complaints, functional limitations...",
  "objective": "Clinician objective findings, measurements, observations, tests performed...",
  "assessment": "Clinical assessment, diagnosis impression, progress toward goals...",
  "plan": "Treatment plan, interventions performed, home program, follow-up..."
}}

Be specific and clinical. Use professional PT/chiropractic documentation language.
Write in professional third person (e.g. Patient reports..., Clinician noted...).
If a section has limited information from the transcript, document what is available."""

        message = ai_client.messages.create(
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

        note_id = None
        appointment_id = v.get("appointment_id")
        if appointment_id:
            existing = (
                supabase.table("clinical_notes")
                .select("id, status")
                .eq("appointment_id", appointment_id)
                .limit(1)
                .execute()
            )

            note_data = {
                "subjective": soap.get("subjective", ""),
                "objective": soap.get("objective", ""),
                "assessment": soap.get("assessment", ""),
                "plan": soap.get("plan", ""),
                "soap_source": "virtual_visit_transcript",
            }

            if existing.data:
                existing_row = existing.data[0]
                note_id = existing_row.get("id")
                if str(existing_row.get("status") or "") != "signed":
                    supabase.table("clinical_notes").update(note_data).eq(
                        "id", existing_row["id"]
                    ).execute()
            else:
                patient_id = str(v.get("patient_id") or "").strip()
                clinician_id = str(v.get("clinician_id") or "").strip()
                if patient_id and clinician_id:
                    new_note = supabase.table("clinical_notes").insert(
                        {
                            **note_data,
                            "appointment_id": appointment_id,
                            "clinic_id": v["clinic_id"],
                            "patient_id": patient_id,
                            "author_id": clinician_id,
                            "note_type": "progress_note",
                            "status": "draft",
                        }
                    ).execute()
                    if new_note.data:
                        note_id = new_note.data[0]["id"]

        return {
            "transcript": transcript,
            "soap": soap,
            "appointment_id": appointment_id,
            "note_id": note_id,
        }

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        if v:
            _mark_visit_failed(str(v["id"]))
        raise HTTPException(
            status_code=500, detail="AI response could not be parsed"
        ) from exc
    except Exception as exc:
        if v:
            _mark_visit_failed(str(v["id"]))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{room_id}/generate-soap")
async def generate_soap_from_transcript(
    room_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """Fallback: regenerate SOAP from existing transcript without re-uploading audio."""
    try:
        visit = (
            supabase.table("virtual_visits")
            .select(
                "id, transcript, appointment_id, clinic_id, patient_id, clinician_id"
            )
            .eq("room_id", room_id)
            .limit(1)
            .execute()
        )

        if not visit.data:
            raise HTTPException(status_code=404, detail="Visit not found")

        v = visit.data[0]
        clinic_id = str(v.get("clinic_id") or "").strip()
        enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)

        transcript = (v.get("transcript") or "").strip()
        if not transcript:
            raise HTTPException(
                status_code=400, detail="No transcript available for this visit"
            )

        if not ANTHROPIC_API_KEY:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

        ai_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = ai_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": f"""Generate a SOAP note from this transcript. Return ONLY JSON:
{{
  "subjective": "...",
  "objective": "...",
  "assessment": "...",
  "plan": "..."
}}

TRANSCRIPT:
{transcript}""",
                }
            ],
        )

        soap = _parse_soap_json(message.content[0].text)

        supabase.table("virtual_visits").update(
            {
                "soap_draft": soap,
                "transcript_status": "complete",
            }
        ).eq("id", v["id"]).execute()

        return {"soap": soap, "appointment_id": v.get("appointment_id")}

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="AI response could not be parsed"
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
