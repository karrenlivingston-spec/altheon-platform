"""Public intake submissions from Aria / ElevenLabs webhook."""

from __future__ import annotations

import re
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()


def _digits(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\D", "", str(s))


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _require_authenticated_user(authorization: Optional[str]) -> str:
    token = _extract_bearer_token(authorization)
    try:
        auth_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    user_obj = getattr(auth_response, "user", None)
    if user_obj is None and isinstance(auth_response, dict):
        user_obj = auth_response.get("user")

    user_id = str(getattr(user_obj, "id", None) or "").strip()
    if not user_id and isinstance(user_obj, dict):
        user_id = str(user_obj.get("id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user_id


def _require_intake_secret(x_intake_secret: Optional[str]) -> Optional[JSONResponse]:
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    incoming = (x_intake_secret or "").strip()
    if not expected or not incoming or not secrets.compare_digest(incoming, expected):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return None


class IntakeSubmission(BaseModel):
    phone_number: str
    chief_complaint: str = ""
    pain_scale: int = Field(ge=1, le=10)
    symptom_duration: str = ""
    aggravating_factors: str = ""
    relieving_factors: str = ""
    medical_history_flags: list[Any] = Field(default_factory=list)
    allergies: str = ""
    other_conditions: str = ""
    goals: str = ""


@router.post("")
def submit_intake(
    body: IntakeSubmission,
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    unauthorized = _require_intake_secret(x_intake_secret)
    if unauthorized is not None:
        return unauthorized

    clean_phone = _digits(body.phone_number)
    if not clean_phone:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    try:
        patients_resp = supabase.table("patients").select("id, phone").execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patient_row = next(
        (
            row
            for row in (patients_resp.data or [])
            if _digits(row.get("phone")) == clean_phone
        ),
        None,
    )
    if not patient_row:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    patient_id = str(patient_row.get("id") or "").strip()
    if not patient_id:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        appt_resp = (
            supabase.table("appointments")
            .select("id, patient_id, clinic_id, start_time")
            .eq("patient_id", patient_id)
            .in_("status", ["scheduled", "confirmed"])
            .gte("start_time", now_iso)
            .order("start_time", desc=False)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    appt_rows = appt_resp.data or []
    if not appt_rows:
        return JSONResponse(
            status_code=404,
            content={"error": "No upcoming appointment found for this patient"},
        )
    appt = appt_rows[0]
    appointment_id = str(appt.get("id") or "").strip()
    clinic_id = str(appt.get("clinic_id") or "").strip()
    if not appointment_id or not clinic_id:
        return JSONResponse(
            status_code=404,
            content={"error": "No upcoming appointment found for this patient"},
        )

    insert_row = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "chief_complaint": body.chief_complaint,
        "pain_scale": body.pain_scale,
        "symptom_duration": body.symptom_duration,
        "aggravating_factors": body.aggravating_factors,
        "relieving_factors": body.relieving_factors,
        "medical_history_flags": body.medical_history_flags,
        "allergies": body.allergies,
        "other_conditions": body.other_conditions,
        "goals": body.goals,
    }

    ins = supabase.table("intake_forms").insert(insert_row).execute()
    data = getattr(ins, "data", None) or []
    if not data:
        err = getattr(ins, "error", None)
        msg = getattr(err, "message", None) or str(err) if err else "Insert failed"
        raise HTTPException(status_code=500, detail=msg)

    intake_id = data[0].get("id")
    return {
        "success": True,
        "intake_id": str(intake_id),
        "appointment_id": appointment_id,
    }


@router.get("/{appointment_id}")
def get_intake_for_appointment(
    appointment_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_authenticated_user(authorization)

    try:
        resp = (
            supabase.table("intake_forms")
            .select(
                "id,appointment_id,patient_id,chief_complaint,pain_scale,"
                "symptom_duration,aggravating_factors,relieving_factors,"
                "medical_history_flags,allergies,other_conditions,goals,created_at"
            )
            .eq("appointment_id", appointment_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = getattr(resp, "data", None) or []
    if not rows:
        return {"intake": None}
    return {"intake": rows[0]}
