"""Virtual visit audio upload → ElevenLabs Scribe REST → Claude Haiku SOAP."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import anthropic
import requests as req_lib
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from app.db import supabase
from app.retry_utils import supabase_execute
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header

router = APIRouter(prefix="/visits", tags=["virtual_visit_transcription"])
logger = logging.getLogger(__name__)

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
        supabase_execute(
            lambda vid=visit_id: supabase.table("virtual_visits")
            .update({"transcript_status": "failed"})
            .eq("id", vid)
            .execute()
        )
    except Exception:
        pass


def _resolve_transcribe_author_id(clinic_id: str, auth_user_id: str) -> Optional[str]:
    """Resolve clinical_notes.author_id (clinic_users.id) from JWT auth user."""
    cid = clinic_id.strip()
    auth_uid = (auth_user_id or "").strip()
    if not cid or not auth_uid:
        print(
            f"transcribe author_id lookup skipped clinic_id={cid!r} user_id={auth_uid!r}"
        )
        return None

    try:
        resp = supabase_execute(
            lambda: supabase.table("clinic_users")
            .select("id")
            .eq("clinic_id", cid)
            .eq("user_id", auth_uid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        author_id = str(rows[0].get("id") or "").strip() if rows else ""
        print(
            f"transcribe author_id lookup clinic_id={cid} user_id={auth_uid} result={author_id or None}"
        )
        return author_id or None
    except Exception:
        logger.exception(
            "author lookup failed clinic_id=%s user_id=%s",
            cid,
            auth_uid,
        )
        print(
            f"transcribe author_id lookup failed clinic_id={cid} user_id={auth_uid} result=None"
        )
        return None


@router.post("/{room_id}/transcribe-and-generate")
async def transcribe_and_generate(
    room_id: str,
    clinic_id: str = Form(...),
    audio: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    actor = enforce_clinic_role_from_auth_header(authorization, cid, *CLINICAL_ROLES)

    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    v: dict[str, Any] | None = None
    try:
        visit = supabase_execute(
            lambda: supabase.table("virtual_visits")
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

        supabase_execute(
            lambda vid=v["id"]: supabase.table("virtual_visits")
            .update({"transcript_status": "processing"})
            .eq("id", vid)
            .execute()
        )

        audio_bytes = await audio.read()
        logger.info(
            "Audio blob received: %s bytes, filename: %s, content_type: %s",
            len(audio_bytes),
            audio.filename,
            audio.content_type,
        )
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio upload")

        scribe_response = req_lib.post(
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
            timeout=120,
        )

        logger.info("Scribe response status: %s", scribe_response.status_code)
        logger.info("Scribe response body: %s", scribe_response.text[:500])

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

        supabase_execute(
            lambda vid=v["id"]: supabase.table("virtual_visits")
            .update(
                {
                    "transcript": transcript,
                    "transcript_status": "processing",
                }
            )
            .eq("id", vid)
            .execute()
        )

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

        supabase_execute(
            lambda vid=v["id"]: supabase.table("virtual_visits")
            .update(
                {
                    "soap_draft": soap,
                    "transcript_status": "complete",
                }
            )
            .eq("id", vid)
            .execute()
        )

        note_id = None
        appointment_id = v.get("appointment_id")
        if appointment_id:
            existing = supabase_execute(
                lambda: supabase.table("clinical_notes")
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
                    supabase_execute(
                        lambda eid=existing_row["id"], nd=note_data: supabase.table(
                            "clinical_notes"
                        )
                        .update(nd)
                        .eq("id", eid)
                        .execute()
                    )
            else:
                patient_id = str(v.get("patient_id") or "").strip()
                author_id = _resolve_transcribe_author_id(
                    str(v.get("clinic_id") or cid),
                    actor.user_id,
                )
                if patient_id and author_id:
                    new_note = supabase_execute(
                        lambda nd=note_data, appt_id=appointment_id, vc=v["clinic_id"], pt_id=patient_id, auth_id=author_id: supabase.table(
                            "clinical_notes"
                        )
                        .insert(
                            {
                                **nd,
                                "appointment_id": appt_id,
                                "clinic_id": vc,
                                "patient_id": pt_id,
                                "author_id": auth_id,
                                "note_type": "progress_note",
                                "status": "draft",
                            }
                        )
                        .execute()
                    )
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
        logger.error(
            "transcribe-and-generate error: %s: %s",
            type(exc).__name__,
            str(exc),
        )
        if v:
            _mark_visit_failed(str(v["id"]))
        raise HTTPException(
            status_code=500, detail="AI response could not be parsed"
        ) from exc
    except Exception as exc:
        logger.error(
            "transcribe-and-generate error: %s: %s",
            type(exc).__name__,
            str(exc),
        )
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
        visit = supabase_execute(
            lambda: supabase.table("virtual_visits")
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

        supabase_execute(
            lambda vid=v["id"]: supabase.table("virtual_visits")
            .update(
                {
                    "soap_draft": soap,
                    "transcript_status": "complete",
                }
            )
            .eq("id", vid)
            .execute()
        )

        return {"soap": soap, "appointment_id": v.get("appointment_id")}

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="AI response could not be parsed"
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
