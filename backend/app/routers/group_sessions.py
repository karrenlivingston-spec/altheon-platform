"""Group sessions API (mounted under /api/group-sessions)."""

from __future__ import annotations

import traceback
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_SESSION_STATUSES = frozenset({"scheduled", "completed", "cancelled"})

_LIST_SELECT = (
    "id, clinic_id, clinician_id, location_id, treatment_type_id, "
    "title, start_time, end_time, capacity, status, notes, created_at, updated_at, "
    "clinicians(first_name, last_name), "
    "treatment_types(name), "
    "group_session_attendees(id, patient_id, status)"
)

_DETAIL_SELECT = (
    "id, clinic_id, clinician_id, location_id, treatment_type_id, "
    "title, start_time, end_time, capacity, status, notes, created_at, updated_at, "
    "clinicians(first_name, last_name), "
    "treatment_types(name), "
    "group_session_attendees(id, patient_id, status, patients(first_name, last_name, phone))"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _nested_row(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, dict) else {}


def _count_exact(resp: Any) -> int:
    count = int(getattr(resp, "count", None) or 0)
    if count == 0 and resp.data is not None:
        count = len(resp.data)
    return count


def _active_attendee_count(attendees: Any) -> int:
    if not isinstance(attendees, list):
        return 0
    return sum(
        1
        for a in attendees
        if isinstance(a, dict) and str(a.get("status") or "") != "cancelled"
    )


def _shape_session_row(row: dict[str, Any], *, include_attendees: bool = False) -> dict[str, Any]:
    shaped = dict(row)
    attendees = shaped.pop("group_session_attendees", None)
    shaped["attendee_count"] = _active_attendee_count(attendees)
    clinician = _nested_row(shaped.pop("clinicians", None))
    treatment = _nested_row(shaped.pop("treatment_types", None))
    shaped["clinician_first_name"] = clinician.get("first_name")
    shaped["clinician_last_name"] = clinician.get("last_name")
    shaped["treatment_type_name"] = treatment.get("name")
    if include_attendees and isinstance(attendees, list):
        shaped["attendees"] = attendees
    return shaped


def _day_bounds_iso(day_ymd: str) -> tuple[str, str]:
    d = date.fromisoformat(day_ymd.strip())
    start = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=_CLINIC_TZ).isoformat()
    end = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=_CLINIC_TZ).isoformat()
    return start, end


class GroupSessionCreate(BaseModel):
    clinic_id: str
    clinician_id: str
    location_id: str
    treatment_type_id: str
    start_time: str
    end_time: str
    title: Optional[str] = None
    capacity: int = Field(default=6, ge=1)
    notes: Optional[str] = None
    patient_ids: list[str] = Field(default_factory=list)


class GroupSessionUpdate(BaseModel):
    title: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=1)
    status: Optional[str] = None
    notes: Optional[str] = None
    clinician_id: Optional[str] = None
    location_id: Optional[str] = None
    treatment_type_id: Optional[str] = None


class AddAttendeeBody(BaseModel):
    patient_id: str


@router.get("/group-sessions")
async def list_group_sessions(
    clinic_id: str = Query(...),
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
):
    try:
        query = (
            supabase.table("group_sessions")
            .select(_LIST_SELECT)
            .eq("clinic_id", clinic_id.strip())
        )
        if date and date.strip():
            start_of_day, end_of_day = _day_bounds_iso(date)
            query = query.gte("start_time", start_of_day).lte("start_time", end_of_day)
        res = query.order("start_time").execute()
        rows = res.data or []
        return [
            _shape_session_row(r)
            for r in rows
            if isinstance(r, dict)
        ]
    except Exception:
        traceback.print_exc()
        return []


@router.get("/group-sessions/{session_id}")
async def get_group_session(session_id: str):
    try:
        res = (
            supabase.table("group_sessions")
            .select(_DETAIL_SELECT)
            .eq("id", session_id.strip())
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Group session not found.")
        return _shape_session_row(rows[0], include_attendees=True)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/group-sessions", status_code=201)
async def create_group_session(body: GroupSessionCreate):
    try:
        patient_ids = [
            pid.strip()
            for pid in body.patient_ids
            if isinstance(pid, str) and pid.strip()
        ]
        if len(patient_ids) > body.capacity:
            raise HTTPException(
                status_code=400,
                detail="Initial attendees exceed session capacity.",
            )

        payload: dict[str, Any] = {
            "clinic_id": body.clinic_id.strip(),
            "clinician_id": body.clinician_id.strip(),
            "location_id": body.location_id.strip(),
            "treatment_type_id": body.treatment_type_id.strip(),
            "title": (body.title or "").strip() or None,
            "start_time": body.start_time.strip(),
            "end_time": body.end_time.strip(),
            "capacity": body.capacity,
            "notes": (body.notes or "").strip() or None,
            "status": "scheduled",
        }
        res = supabase.table("group_sessions").insert(payload).execute()
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=400, detail="Failed to create group session.")
        session = rows[0]

        if patient_ids:
            attendee_rows = [
                {"group_session_id": session["id"], "patient_id": pid}
                for pid in patient_ids
            ]
            supabase.table("group_session_attendees").insert(attendee_rows).execute()

        return session
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch("/group-sessions/{session_id}")
async def update_group_session(session_id: str, body: GroupSessionUpdate):
    try:
        data = body.model_dump(exclude_unset=True)
        if "status" in data and data["status"] not in _SESSION_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if not data:
            raise HTTPException(status_code=400, detail="No fields to update")
        data["updated_at"] = _now_iso()
        res = (
            supabase.table("group_sessions")
            .update(data)
            .eq("id", session_id.strip())
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Group session not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/group-sessions/{session_id}/attendees", status_code=201)
async def add_attendee(session_id: str, body: AddAttendeeBody):
    try:
        patient_id = body.patient_id.strip()
        if not patient_id:
            raise HTTPException(status_code=400, detail="patient_id is required")

        session_res = (
            supabase.table("group_sessions")
            .select("capacity")
            .eq("id", session_id.strip())
            .limit(1)
            .execute()
        )
        session_rows = session_res.data or []
        if not session_rows:
            raise HTTPException(status_code=404, detail="Group session not found.")
        capacity = int(session_rows[0].get("capacity") or 6)

        count_res = (
            supabase.table("group_session_attendees")
            .select("id", count="exact")
            .eq("group_session_id", session_id.strip())
            .neq("status", "cancelled")
            .execute()
        )
        if _count_exact(count_res) >= capacity:
            raise HTTPException(status_code=400, detail="Group session is at capacity.")

        res = (
            supabase.table("group_session_attendees")
            .insert({"group_session_id": session_id.strip(), "patient_id": patient_id})
            .execute()
        )
        rows = res.data or []
        if not rows:
            raise HTTPException(status_code=400, detail="Failed to add attendee.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/group-sessions/{session_id}/attendees/{patient_id}")
async def remove_attendee(session_id: str, patient_id: str):
    try:
        supabase.table("group_session_attendees").delete().eq(
            "group_session_id", session_id.strip()
        ).eq("patient_id", patient_id.strip()).execute()
        return {"deleted": True}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e
