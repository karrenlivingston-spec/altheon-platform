"""Appointment waitlist API (mounted under /api/waitlist)."""

from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()

_WAITLIST_STATUSES = frozenset({"waiting", "contacted", "booked", "cancelled"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _nested_patient(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, dict) else {}


class WaitlistCreate(BaseModel):
    clinic_id: str
    patient_id: str
    requested_date: str
    requested_time: Optional[str] = None
    provider_id: Optional[str] = None
    clinician_id: Optional[str] = None
    reason: Optional[str] = None
    notes: Optional[str] = None


class WaitlistUpdate(BaseModel):
    status: Optional[str] = None
    requested_date: Optional[str] = None
    requested_time: Optional[str] = None
    provider_id: Optional[str] = None
    clinician_id: Optional[str] = None
    reason: Optional[str] = None
    notes: Optional[str] = None


@router.get("/waitlist")
async def list_waitlist(
    clinic_id: str = Query(...),
    status: Optional[str] = Query(default="waiting"),
):
    try:
        query = (
            supabase.table("appointment_waitlist")
            .select(
                "id, clinic_id, patient_id, requested_date, requested_time, "
                "clinician_id, reason, notes, status, created_at, updated_at, "
                "patients(first_name, last_name, phone)"
            )
            .eq("clinic_id", clinic_id.strip())
        )
        if status and status.strip():
            query = query.eq("status", status.strip())
        res = query.order("requested_date").order("created_at").execute()
        rows = res.data or []
        out = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            shaped = dict(row)
            patient = _nested_patient(shaped.pop("patients", None))
            shaped["patient_first_name"] = patient.get("first_name")
            shaped["patient_last_name"] = patient.get("last_name")
            shaped["patient_phone"] = patient.get("phone")
            out.append(shaped)
        return out
    except Exception:
        traceback.print_exc()
        return []


@router.post("/waitlist", status_code=201)
async def create_waitlist_entry(body: WaitlistCreate):
    try:
        clinician_id = (body.clinician_id or body.provider_id or "").strip() or None
        payload: dict[str, Any] = {
            "clinic_id": body.clinic_id.strip(),
            "patient_id": body.patient_id.strip(),
            "requested_date": body.requested_date.strip(),
            "requested_time": (body.requested_time or "").strip() or None,
            "clinician_id": clinician_id,
            "reason": (body.reason or "").strip() or None,
            "notes": (body.notes or "").strip() or None,
            "status": "waiting",
        }
        res = supabase.table("appointment_waitlist").insert(payload).execute()
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=400, detail="Failed to create waitlist entry.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch("/waitlist/{entry_id}")
async def update_waitlist_entry(entry_id: str, body: WaitlistUpdate):
    try:
        data = body.model_dump(exclude_unset=True)
        if "provider_id" in data:
            data["clinician_id"] = data.pop("provider_id")
        if "status" in data and data["status"] not in _WAITLIST_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if not data:
            raise HTTPException(status_code=400, detail="No fields to update")
        data["updated_at"] = _now_iso()
        res = (
            supabase.table("appointment_waitlist")
            .update(data)
            .eq("id", entry_id.strip())
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Waitlist entry not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/waitlist/{entry_id}")
async def delete_waitlist_entry(entry_id: str):
    try:
        supabase.table("appointment_waitlist").delete().eq(
            "id", entry_id.strip()
        ).execute()
        return {"deleted": True}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e
