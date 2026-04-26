from datetime import datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.db import supabase

router = APIRouter()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _format_slot_label(slot_start: datetime) -> str:
    day = slot_start.day
    hour_24 = slot_start.hour
    minute = slot_start.minute
    hour_12 = hour_24 % 12
    if hour_12 == 0:
        hour_12 = 12
    am_pm = "AM" if hour_24 < 12 else "PM"
    return f"{slot_start.strftime('%A, %b')} {day} at {hour_12}:{minute:02d} {am_pm}"


@router.get("")
def get_slots(
    clinic_id: str = Query(...),
    clinician_id: str = Query(...),
    date: str = Query(...),
    duration_minutes: int = Query(60, ge=1),
):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format") from exc

    day_start = datetime.combine(target_date, time(0, 0), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    window_start = datetime.combine(target_date, time(9, 0), tzinfo=timezone.utc)
    window_end = datetime.combine(target_date, time(17, 0), tzinfo=timezone.utc)
    slot_duration = timedelta(minutes=duration_minutes)

    if window_start + slot_duration > window_end:
        return []

    try:
        response = (
            supabase.table("appointments")
            .select("start_time,end_time")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .in_("status", ["scheduled", "confirmed"])
            .gte("start_time", day_start.isoformat())
            .lt("start_time", day_end.isoformat())
            .execute()
        )
        _handle_supabase_error(response)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    booked_ranges = []
    for row in response.data or []:
        start_raw = row.get("start_time")
        end_raw = row.get("end_time")
        if not start_raw or not end_raw:
            continue
        start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        booked_ranges.append((start_dt, end_dt))

    available_slots = []
    current_start = window_start
    while current_start + slot_duration <= window_end:
        current_end = current_start + slot_duration
        overlaps = any(
            current_start < booked_end and current_end > booked_start
            for booked_start, booked_end in booked_ranges
        )
        if not overlaps:
            available_slots.append(
                {
                    "start_time": current_start.isoformat(),
                    "end_time": current_end.isoformat(),
                    "label": _format_slot_label(current_start),
                }
            )
        current_start += slot_duration

    return available_slots
