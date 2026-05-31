"""Appointment measurements (ROM, strength, functional outcomes)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()
logger = logging.getLogger(__name__)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _resolve_bearer_user_id(authorization: Optional[str]) -> str:
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


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    try:
        access = (
            supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(access)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not access.data:
        raise HTTPException(status_code=403, detail="No clinic access for user")


def _resolve_clinic_user_id(user_id: str, clinic_id: str) -> Optional[str]:
    try:
        resp = (
            supabase.table("clinic_users")
            .select("id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = resp.data or []
        if not rows:
            return None
        return str(rows[0].get("id") or "").strip() or None
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "clinic_user lookup failed user_id=%s clinic_id=%s", user_id, clinic_id
        )
        return None


def _fetch_appointment(appointment_id: str) -> dict[str, Any]:
    aid = appointment_id.strip()
    if not aid:
        raise HTTPException(status_code=400, detail="appointment_id is required")
    try:
        resp = (
            supabase.table("appointments")
            .select("id, clinic_id, patient_id")
            .eq("id", aid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("appointment fetch failed appointment_id=%s", aid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return rows[0]


def _fetch_measurement_by_appointment(appointment_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            supabase.table("measurements")
            .select("*")
            .eq("appointment_id", appointment_id.strip())
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "measurements fetch failed appointment_id=%s", appointment_id
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    return rows[0] if rows else None


class RomEntry(BaseModel):
    label: str
    left_active: Optional[float] = None
    left_passive: Optional[float] = None
    right_active: Optional[float] = None
    right_passive: Optional[float] = None


class StrengthEntry(BaseModel):
    label: str
    left: Optional[str] = None
    right: Optional[str] = None


class FunctionalOutcomeEntry(BaseModel):
    label: str
    score: Optional[str] = None


class UpsertMeasurementsBody(BaseModel):
    body_part: str
    rom: list[RomEntry] = Field(default_factory=list)
    strength: list[StrengthEntry] = Field(default_factory=list)
    functional_outcomes: list[FunctionalOutcomeEntry] = Field(default_factory=list)
    pain_nrs: Optional[int] = Field(default=None, ge=0, le=10)
    notes: Optional[str] = None


def _measurement_payload(
    body: UpsertMeasurementsBody,
    *,
    appointment_id: str,
    clinic_id: str,
    patient_id: str,
    recorded_by: Optional[str],
) -> dict[str, Any]:
    body_part = body.body_part.strip()
    if not body_part:
        raise HTTPException(status_code=400, detail="body_part is required")

    row: dict[str, Any] = {
        "appointment_id": appointment_id,
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "body_part": body_part,
        "rom": [e.model_dump() for e in body.rom],
        "strength": [e.model_dump() for e in body.strength],
        "functional_outcomes": [e.model_dump() for e in body.functional_outcomes],
        "pain_nrs": body.pain_nrs,
        "notes": body.notes.strip() if body.notes and body.notes.strip() else None,
        "recorded_by": recorded_by,
        "updated_at": _now_iso(),
    }
    return row


@router.post("/appointments/{appointment_id}/measurements")
def upsert_appointment_measurements(
    appointment_id: str,
    body: UpsertMeasurementsBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    appt = _fetch_appointment(appointment_id)
    clinic_id = str(appt.get("clinic_id") or "").strip()
    patient_id = str(appt.get("patient_id") or "").strip()
    if not clinic_id or not patient_id:
        raise HTTPException(status_code=500, detail="Appointment missing clinic or patient")

    _assert_user_has_clinic_access(user_id, clinic_id)
    recorded_by = _resolve_clinic_user_id(user_id, clinic_id)
    payload = _measurement_payload(
        body,
        appointment_id=appointment_id.strip(),
        clinic_id=clinic_id,
        patient_id=patient_id,
        recorded_by=recorded_by,
    )

    existing = _fetch_measurement_by_appointment(appointment_id)
    try:
        if existing:
            upd = (
                supabase.table("measurements")
                .update(payload)
                .eq("id", existing["id"])
                .execute()
            )
            _handle_supabase_error(upd)
            rows = upd.data or []
            if not rows:
                raise HTTPException(status_code=500, detail="Failed to update measurements")
            return rows[0]

        payload["created_at"] = _now_iso()
        ins = supabase.table("measurements").insert(payload).execute()
        _handle_supabase_error(ins)
        rows = ins.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create measurements")
        return rows[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("upsert measurements failed appointment_id=%s", appointment_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/appointments/{appointment_id}/measurements")
def get_appointment_measurements(
    appointment_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    appt = _fetch_appointment(appointment_id)
    clinic_id = str(appt.get("clinic_id") or "").strip()
    if not clinic_id:
        raise HTTPException(status_code=500, detail="Appointment missing clinic")

    _assert_user_has_clinic_access(user_id, clinic_id)

    row = _fetch_measurement_by_appointment(appointment_id)
    if row is None:
        return {"data": None}
    return row
