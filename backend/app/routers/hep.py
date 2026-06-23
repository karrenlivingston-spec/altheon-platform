"""Home exercise programs (HEP) — create, list, and public patient view."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header
from app.sms import send_sms

router = APIRouter(prefix="/hep", tags=["hep"])
logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.altheon.app")
_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

LIBRARY_SELECT = (
    "id, name, category, body_region, description, instructions, "
    "default_sets, default_reps, default_hold_seconds, default_frequency, "
    "notes_template, contraindications, video_url"
)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _to_e164_us(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "1" + digits
    return f"+{digits}"


class Exercise(BaseModel):
    name: str
    sets: Optional[int] = None
    reps: Optional[int] = None
    hold_seconds: Optional[int] = None
    frequency: Optional[str] = None
    notes: Optional[str] = None
    video_url: Optional[str] = None


class HEPCreate(BaseModel):
    clinic_id: str = Field(..., min_length=1)
    patient_id: str
    clinician_id: str
    title: str
    exercises: list[Exercise]
    send_sms: bool = True


class AISuggestBody(BaseModel):
    clinic_id: str = Field(..., min_length=1)
    soap_text: str


def _parse_ai_json_array(raw: str) -> list[dict[str, Any]]:
    text = (raw or "").strip()
    if not text:
        raise json.JSONDecodeError("empty response", text, 0)
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            raise
        data = json.loads(match.group(0))
    if not isinstance(data, list):
        raise json.JSONDecodeError("expected JSON array", text, 0)
    return [item for item in data if isinstance(item, dict)]


@router.post("")
def create_hep(
    payload: HEPCreate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        auth = enforce_clinic_role_from_auth_header(
            authorization,
            payload.clinic_id,
            *CLINICAL_ROLES,
        )
        clinic_id = auth.clinic_id

        result = (
            supabase.table("hep_programs")
            .insert(
                {
                    "clinic_id": clinic_id,
                    "patient_id": payload.patient_id,
                    "clinician_id": payload.clinician_id,
                    "title": payload.title,
                    "exercises": [e.model_dump() for e in payload.exercises],
                }
            )
            .execute()
        )
        _handle_supabase_error(result)

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create HEP")

        hep = result.data[0]
        token = hep["token"]
        hep_url = f"{FRONTEND_URL}/hep/{token}"

        if payload.send_sms:
            patient = (
                supabase.table("patients")
                .select("first_name, phone")
                .eq("id", payload.patient_id)
                .eq("clinic_id", clinic_id)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(patient)
            pt_row = (patient.data or [None])[0]
            if isinstance(pt_row, dict) and pt_row.get("phone"):
                first_name = (pt_row.get("first_name") or "").strip() or "there"
                phone = str(pt_row["phone"])
                sms_body = (
                    f"Hi {first_name}! Your home exercise program '{payload.title}' "
                    f"from your care team is ready. View your exercises here: {hep_url}"
                )
                send_sms(
                    clinic_id,
                    _to_e164_us(phone),
                    sms_body,
                    patient_id=payload.patient_id,
                    message_type="hep",
                )

                sent_at = datetime.now(timezone.utc).isoformat()
                upd = (
                    supabase.table("hep_programs")
                    .update({"sent_at": sent_at})
                    .eq("id", hep["id"])
                    .execute()
                )
                _handle_supabase_error(upd)
                hep["sent_at"] = sent_at

        hep["url"] = hep_url
        return hep

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_hep failed clinic_id=%s patient_id=%s", payload.clinic_id, payload.patient_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("")
def list_hep(
    patient_id: str = Query(..., min_length=1),
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)

        result = (
            supabase.table("hep_programs")
            .select("*")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(result)
        programs = result.data or []

        for program in programs:
            program["url"] = f"{FRONTEND_URL}/hep/{program['token']}"

        return programs

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_hep failed clinic_id=%s patient_id=%s", clinic_id, patient_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/library")
def get_exercise_library(
    clinic_id: str = Query(..., min_length=1),
    category: Optional[str] = Query(default=None),
    body_region: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)

        query = (
            supabase.table("exercise_library")
            .select(LIBRARY_SELECT)
            .eq("is_active", True)
            .order("category")
            .order("name")
        )

        if category and category.strip():
            query = query.eq("category", category.strip())
        if body_region and body_region.strip():
            query = query.eq("body_region", body_region.strip())

        result = query.execute()
        _handle_supabase_error(result)
        exercises = result.data or []

        if search and search.strip():
            search_lower = search.strip().lower()
            exercises = [
                exercise
                for exercise in exercises
                if search_lower in str(exercise.get("name") or "").lower()
                or search_lower in str(exercise.get("description") or "").lower()
                or search_lower in str(exercise.get("category") or "").lower()
                or search_lower in str(exercise.get("body_region") or "").lower()
            ]

        return exercises

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_exercise_library failed clinic_id=%s", clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai-suggest")
def ai_suggest_exercises(
    payload: AISuggestBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """
    Accepts { soap_text, clinic_id }.
    Sends SOAP assessment/plan to Claude Haiku with the full exercise library.
    Returns suggested exercises hydrated with library fields and ai_reason.
    """
    try:
        enforce_clinic_role_from_auth_header(
            authorization,
            payload.clinic_id,
            *CLINICAL_ROLES,
        )

        soap_text = payload.soap_text.strip()
        if not soap_text:
            raise HTTPException(status_code=400, detail="soap_text is required")

        api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY is not configured")

        library_result = (
            supabase.table("exercise_library")
            .select(LIBRARY_SELECT)
            .eq("is_active", True)
            .order("category")
            .order("name")
            .execute()
        )
        _handle_supabase_error(library_result)
        library = library_result.data or []

        library_for_prompt = [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "category": row.get("category"),
                "body_region": row.get("body_region"),
                "description": row.get("description"),
                "contraindications": row.get("contraindications"),
            }
            for row in library
        ]

        library_text = "\n".join(
            [
                (
                    f"ID: {exercise['id']} | {exercise['name']} | {exercise['category']} | "
                    f"{exercise['body_region']} | {exercise['description']} | "
                    f"Contraindications: {exercise.get('contraindications') or 'None'}"
                )
                for exercise in library_for_prompt
            ]
        )

        prompt = f"""You are a physical therapy clinical assistant. Based on the SOAP note below, recommend 4-6 home exercises from the provided exercise library that are most appropriate for this patient.

SOAP NOTE:
{soap_text}

EXERCISE LIBRARY:
{library_text}

Return ONLY a JSON array (no markdown, no explanation) with objects in this format:
[
  {{"id": "<uuid>", "name": "<name>", "reason": "<one sentence clinical rationale>"}},
  ...
]

Only recommend exercises that are clinically appropriate. Do not recommend exercises if contraindications match the patient presentation."""

        try:
            import anthropic
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="anthropic package is not installed",
            ) from exc

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        blocks = getattr(message, "content", None) or []
        raw_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                raw_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                raw_parts.append(str(block["text"]))
        raw = "".join(raw_parts).strip()
        suggestions = _parse_ai_json_array(raw)

        hydrated = {str(row.get("id")): row for row in library if row.get("id")}

        result_list: list[dict[str, Any]] = []
        for suggestion in suggestions:
            exercise_id = str(suggestion.get("id") or "").strip()
            exercise = hydrated.get(exercise_id)
            if not exercise:
                continue
            row = dict(exercise)
            row["ai_reason"] = str(suggestion.get("reason") or "").strip()
            result_list.append(row)

        return result_list

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="AI response could not be parsed") from exc
    except Exception as exc:
        logger.exception("ai_suggest_exercises failed clinic_id=%s", payload.clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/public/{token}")
def get_hep_public(token: str):
    """Public endpoint — no auth required. Used by the patient-facing page."""
    try:
        result = (
            supabase.table("hep_programs")
            .select(
                "id, title, exercises, created_at, clinician_id, clinic_id, "
                "clinics(name, brand_name)"
            )
            .eq("token", token)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(result)

        if not result.data:
            raise HTTPException(status_code=404, detail="Program not found")

        return result.data[0]

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_hep_public failed token=%s", token)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
