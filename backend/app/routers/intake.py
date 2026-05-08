"""Public intake submissions from Aria / ElevenLabs webhook."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()

NY_TZ = ZoneInfo("America/New_York")


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


def _find_patient_by_phone(clinic_id: str, patient_phone: Optional[str]) -> Optional[dict[str, Any]]:
    if not patient_phone or not patient_phone.strip():
        return None
    want = _digits(patient_phone)
    if not want:
        return None
    resp = (
        supabase.table("patients")
        .select("id, phone, clinic_id")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    for row in resp.data or []:
        if _digits(row.get("phone")) == want:
            return row
    return None


def _appointment_today_or_tomorrow(
    clinic_id: str, patient_id: str
) -> Optional[str]:
    today = datetime.now(NY_TZ).date()
    tomorrow = today + timedelta(days=1)
    eligible = {today.isoformat(), tomorrow.isoformat()}
    resp = (
        supabase.table("appointments")
        .select("id, start_time")
        .eq("patient_id", patient_id)
        .eq("clinic_id", clinic_id)
        .in_("status", ["scheduled", "confirmed"])
        .order("start_time", desc=False)
        .execute()
    )
    for row in resp.data or []:
        st = row.get("start_time")
        if not st:
            continue
        try:
            dt = datetime.fromisoformat(str(st).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local_date = dt.astimezone(NY_TZ).date().isoformat()
            if local_date in eligible:
                return str(row.get("id"))
        except (ValueError, TypeError):
            continue
    return None


class IntakeSubmission(BaseModel):
    clinic_id: str
    patient_phone: Optional[str] = None
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    chief_complaint: str = ""
    pain_scale: int = Field(ge=1, le=10)
    symptom_duration: str = ""
    aggravating_factors: str = ""
    relieving_factors: str = ""
    medical_history_flags: dict[str, Any] = Field(default_factory=dict)
    allergies: str = ""
    other_conditions: str = ""
    hobbies: str = ""
    previous_activities: str = ""
    goals: str = ""
    raw_transcript: Optional[str] = None


@router.post("")
def submit_intake(body: IntakeSubmission):
    clinic_id = body.clinic_id.strip()
    if not clinic_id:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    patient_id: Optional[str] = None
    patient = _find_patient_by_phone(clinic_id, body.patient_phone)
    if patient:
        patient_id = str(patient.get("id") or "")

    appointment_id: Optional[str] = None
    if patient_id:
        appointment_id = _appointment_today_or_tomorrow(clinic_id, patient_id)

    insert_row = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "patient_phone": body.patient_phone,
        "patient_first_name": body.patient_first_name,
        "patient_last_name": body.patient_last_name,
        "chief_complaint": body.chief_complaint,
        "pain_scale": body.pain_scale,
        "symptom_duration": body.symptom_duration,
        "aggravating_factors": body.aggravating_factors,
        "relieving_factors": body.relieving_factors,
        "medical_history_flags": body.medical_history_flags,
        "allergies": body.allergies,
        "other_conditions": body.other_conditions,
        "hobbies": body.hobbies,
        "previous_activities": body.previous_activities,
        "goals": body.goals,
        "raw_transcript": body.raw_transcript,
    }

    # Omit null FKs so Supabase accepts missing links
    if insert_row["patient_id"] is None:
        insert_row.pop("patient_id", None)
    if insert_row["appointment_id"] is None:
        insert_row.pop("appointment_id", None)

    ins = supabase.table("intake_forms").insert(insert_row).execute()
    data = getattr(ins, "data", None) or []
    if not data:
        err = getattr(ins, "error", None)
        msg = getattr(err, "message", None) or str(err) if err else "Insert failed"
        raise HTTPException(status_code=500, detail=msg)

    intake_id = data[0].get("id")
    return {"success": True, "intake_id": str(intake_id)}


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
