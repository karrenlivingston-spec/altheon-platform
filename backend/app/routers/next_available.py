from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from datetime import date, datetime, timedelta
import pytz

from app.db import supabase

router = APIRouter()


def get_slots_for_date(clinic_id: str, clinician_id: Optional[str], target_date: date, duration_minutes: int):
    """
    Shared slot generation logic — same as /slots but callable internally.
    Returns a list of slot dicts: {start_time, end_time, label}
    """
    # Get clinic timezone from locations table
    loc_resp = (
        supabase.table("locations")
        .select("timezone")
        .eq("clinic_id", clinic_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not loc_resp.data:
        return []

    tz_name = loc_resp.data[0].get("timezone", "America/New_York")
    clinic_tz = pytz.timezone(tz_name)

    # Get availability rules for this day of week
    day_of_week = target_date.weekday()  # 0=Monday .. 6=Sunday
    rules_query = (
        supabase.table("availability_rules")
        .select("*")
        .eq("clinic_id", clinic_id)
        .eq("day_of_week", day_of_week)
        .eq("is_active", True)
    )
    if clinician_id:
        rules_query = rules_query.eq("clinician_id", clinician_id)

    rules_resp = rules_query.execute()
    if not rules_resp.data:
        return []

    # Get existing appointments to check overlap
    appts_query = (
        supabase.table("appointments")
        .select("start_time, end_time")
        .eq("clinic_id", clinic_id)
        .in_("status", ["scheduled", "confirmed"])
        .gte("start_time", target_date.isoformat())
        .lt("start_time", (target_date + timedelta(days=1)).isoformat())
    )
    if clinician_id:
        appts_query = appts_query.eq("clinician_id", clinician_id)

    appts_resp = appts_query.execute()
    existing = appts_resp.data or []

    slots = []
    for rule in rules_resp.data:
        rule_start = datetime.strptime(rule["start_time"], "%H:%M:%S").time()
        rule_end = datetime.strptime(rule["end_time"], "%H:%M:%S").time()
        buffer = rule.get("buffer_minutes", 0)
        step = duration_minutes + buffer

        # Generate slots within rule window
        current = datetime.combine(target_date, rule_start)
        end_boundary = datetime.combine(target_date, rule_end)

        while current + timedelta(minutes=duration_minutes) <= end_boundary:
            slot_start_local = clinic_tz.localize(current)
            slot_end_local = slot_start_local + timedelta(minutes=duration_minutes)

            slot_start_utc = slot_start_local.astimezone(pytz.utc)
            slot_end_utc = slot_end_local.astimezone(pytz.utc)

            # Check overlap with existing appointments
            overlap = False
            for appt in existing:
                appt_start = datetime.fromisoformat(appt["start_time"].replace("Z", "+00:00"))
                appt_end = datetime.fromisoformat(appt["end_time"].replace("Z", "+00:00"))
                if slot_start_utc < appt_end and slot_end_utc > appt_start:
                    overlap = True
                    break

            if not overlap:
                label = slot_start_local.strftime("%A, %B %-d at %-I:%M %p")
                slots.append({
                    "start_time": slot_start_utc.isoformat(),
                    "end_time": slot_end_utc.isoformat(),
                    "label": label,
                })

            current += timedelta(minutes=step)

    return slots


@router.get("")
def get_next_available(
    clinic_id: str = Query(...),
    clinician_id: Optional[str] = Query(default=None),
    duration_minutes: int = Query(default=60),
    limit: int = Query(default=8),
    days_ahead: int = Query(default=14),
    after_date: Optional[str] = Query(default=None),
):
    """
    Returns slots for the next single available day.
    Starts from today, scans up to `days_ahead` days, and returns up to `limit` slots
    from the first day that has any availability.
    The agent never needs to ask the patient for a date — it just reads what this returns.
    """
    today = datetime.utcnow().date()
    scan_start = today

    if after_date:
        try:
            parsed_after_date = datetime.strptime(after_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="after_date must be in YYYY-MM-DD format") from exc
        scan_start = max(today, parsed_after_date + timedelta(days=1))

    for offset in range(days_ahead):
        target_date = scan_start + timedelta(days=offset)
        day_slots = get_slots_for_date(clinic_id, clinician_id, target_date, duration_minutes)
        if day_slots:
            return day_slots[:limit]

    return []