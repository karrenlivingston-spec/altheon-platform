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
        supabase.table("virtual_visits").update(
            {"transcript_status": "failed"}
        ).eq("id", visit_id).execute()
    except Exception:
        pass


def _resolve_transcribe_author_id(
    clinic_id: str,
    visit_clinician_id: str,
    auth_user_id: str,
) -> Optional[str]:
    """Resolve clinical_notes.author_id (clinic_users.id) from visit clinician or auth user."""
    cid = clinic_id.strip()
    clin_id = (visit_clinician_id or "").strip()
    auth_uid = (auth_user_id or "").strip()
    allowed_roles = ["clinician", "clinic_admin"]

    if clin_id:
        try:
            by_clinician = (
                supabase.table("clinic_users")
                .select("id, user_id, role, clinician_id")
                .eq("clinic_id", cid)
                .eq("clinician_id", clin_id)
                .in_("role", allowed_roles)
                .limit(1)
                .execute()
            )
            rows = by_clinician.data or []
            if rows:
                author_id = str(rows[0].get("id") or "").strip()
                if author_id:
                    return author_id
        except Exception:
            logger.exception(
                "author lookup by clinic_users.clinician_id failed clinic_id=%s clinician_id=%s",
                cid,
                clin_id,
            )

        try:
            clin_resp = (
                supabase.table("clinicians")
                .select("email")
                .eq("id", clin_id)
                .eq("clinic_id", cid)
                .limit(1)
                .execute()
            )
            clin_rows = clin_resp.data or []
            clin_email = (
                str(clin_rows[0].get("email") or "").strip().lower()
                if clin_rows
                else ""
            )
            if clin_email:
                cu_resp = (
                    supabase.table("clinic_users")
                    .select("id, user_id, role")
                    .eq("clinic_id", cid)
                    .in_("role", allowed_roles)
                    .execute()
                )
                for row in cu_resp.data or []:
                    uid = str(row.get("user_id") or "").strip()
                    if not uid:
                        continue
                    try:
                        auth_resp = supabase.auth.admin.get_user_by_id(uid)
                    except Exception:
                        continue
                    user_obj = getattr(auth_resp, "user", None)
                    if user_obj is None and isinstance(auth_resp, dict):
                        user_obj = auth_resp.get("user")
                    email = ""
                    if user_obj is not None:
                        email = str(getattr(user_obj, "email", None) or "").strip()
                        if not email and isinstance(user_obj, dict):
                            email = str(user_obj.get("email") or "").strip()
                    if email.lower() == clin_email:
                        author_id = str(row.get("id") or "").strip()
                        if author_id:
                            return author_id
        except Exception:
            logger.exception(
                "author lookup via clinicians email failed clinic_id=%s clinician_id=%s",
                cid,
                clin_id,
            )

    if auth_uid:
        try:
            by_auth_user = (
                supabase.table("clinic_users")
                .select("id, user_id, role")
                .eq("clinic_id", cid)
                .eq("user_id", auth_uid)
                .in_("role", allowed_roles)
                .limit(1)
                .execute()
            )
            rows = by_auth_user.data or []
            if rows:
                author_id = str(rows[0].get("id") or "").strip()
                if author_id:
                    return author_id
        except Exception:
            logger.exception(
                "author lookup by auth user_id failed clinic_id=%s user_id=%s",
                cid,
                auth_uid,
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
                visit_clinician_id = str(v.get("clinician_id") or "").strip()
                author_id = _resolve_transcribe_author_id(
                    str(v.get("clinic_id") or cid),
                    visit_clinician_id,
                    actor.user_id,
                )
                print(f"transcribe author_id={author_id}")
                if patient_id and author_id:
                    new_note = supabase.table("clinical_notes").insert(
                        {
                            **note_data,
                            "appointment_id": appointment_id,
                            "clinic_id": v["clinic_id"],
                            "patient_id": patient_id,
                            "author_id": author_id,
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
