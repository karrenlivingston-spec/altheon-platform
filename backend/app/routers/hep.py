"""Home exercise programs (HEP) — create, list, and public patient view."""

from __future__ import annotations

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
