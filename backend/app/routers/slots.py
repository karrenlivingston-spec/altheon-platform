from datetime import datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
import pytz

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
    return f"{slot_start.strftime('%A, %B')} {day} at {hour_12}:{minute:02d} {am_pm}"


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
    slot_duration = timedelta(minutes=duration_minutes)
    day_of_week = target_date.isoweekday() % 7

    try:
        location_response = (
            supabase.table("locations")
            .select("timezone")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(location_response)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    locations = location_response.data or []
    clinic_timezone_name = locations[0].get("timezone") if locations else None
    if not clinic_timezone_name:
        clinic_timezone_name = "UTC"

    try:
        clinic_timezone = pytz.timezone(clinic_timezone_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Invalid clinic timezone: {clinic_timezone_name}") from exc

    try:
        availability_response = (
            supabase.table("availability_rules")
            .select("start_time,end_time,buffer_minutes")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .eq("is_active", True)
            .eq("day_of_week", day_of_week)
            .execute()
        )
        _handle_supabase_error(availability_response)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rules = availability_response.data or []
    if not rules:
        return []

    try:
        appointments_response = (
            supabase.table("appointments")
            .select("start_time,end_time")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .in_("status", ["scheduled", "confirmed"])
            .gte("start_time", day_start.isoformat())
            .lt("start_time", day_end.isoformat())
            .execute()
        )
        _handle_supabase_error(appointments_response)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    booked_ranges = []
    for row in appointments_response.data or []:
        start_raw = row.get("start_time")
        end_raw = row.get("end_time")
        if not start_raw or not end_raw:
            continue
        start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        booked_ranges.append((start_dt, end_dt))

    available_slots = []
    for rule in rules:
        start_raw = rule.get("start_time")
        end_raw = rule.get("end_time")
        if not start_raw or not end_raw:
            continue

        try:
            rule_start_time = time.fromisoformat(start_raw)
            rule_end_time = time.fromisoformat(end_raw)
        except ValueError:
            continue

        buffer_minutes = rule.get("buffer_minutes") or 0
        slot_step = timedelta(minutes=duration_minutes + buffer_minutes)
        if slot_step.total_seconds() <= 0:
            continue

        window_start_local = clinic_timezone.localize(datetime.combine(target_date, rule_start_time))
        window_end_local = clinic_timezone.localize(datetime.combine(target_date, rule_end_time))
        if window_start_local + slot_duration > window_end_local:
            continue

        current_start_local = window_start_local
        while current_start_local + slot_duration <= window_end_local:
            current_end_local = current_start_local + slot_duration
            current_start_utc = current_start_local.astimezone(timezone.utc)
            current_end_utc = current_end_local.astimezone(timezone.utc)

            overlaps = any(
                current_start_utc < booked_end and current_end_utc > booked_start
                for booked_start, booked_end in booked_ranges
            )
            if not overlaps:
                available_slots.append(
                    {
                        "start_time": current_start_utc.isoformat(),
                        "end_time": current_end_utc.isoformat(),
                        "label": _format_slot_label(current_start_local),
                    }
                )
            current_start_local += slot_step

    return available_slots
