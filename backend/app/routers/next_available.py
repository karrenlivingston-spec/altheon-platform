from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from datetime import date, datetime, timedelta
import pytz

from app.db import supabase

router = APIRouter()

# Sun=0 .. Sat=6 — matches availability_rules.day_of_week and isoweekday() % 7
_WEEKDAY_TO_ISO: dict[str, int] = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}
_MIN_WEEKDAY_SCAN_DAYS = 8


def _parse_weekday_filter(weekday: Optional[str]) -> Optional[int]:
    if not weekday:
        return None
    try:
        return _WEEKDAY_TO_ISO.get(weekday.strip().lower())
    except (AttributeError, TypeError):
        return None


def _blocked_windows_for_date(clinician_id: str, target_date: date):
    start_iso = f"{target_date.isoformat()}T00:00:00"
    end_iso = f"{target_date.isoformat()}T23:59:59"
    resp = (
        supabase.table("blocked_time")
        .select("start_time,end_time")
        .eq("clinician_id", clinician_id)
        .lte("start_time", end_iso)
        .gte("end_time", start_iso)
        .order("start_time")
        .execute()
    )
    windows = []
    for row in resp.data or []:
        s = row.get("start_time")
        e = row.get("end_time")
        if not s or not e:
            continue
        try:
            sdt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            edt = datetime.fromisoformat(str(e).replace("Z", "+00:00"))
        except ValueError:
            continue
        windows.append((sdt, edt))
    return windows


def get_slots_for_date(
    clinic_id: str,
    clinician_id: Optional[str],
    target_date: date,
    duration_minutes: int,
):
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

    # Get availability rules for this day of week (Sun=0 .. Sat=6, matches DB)
    day_of_week = target_date.isoweekday() % 7
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
        .select("start_time, end_time, clinician_id")
        .eq("clinic_id", clinic_id)
        .in_("status", ["scheduled", "confirmed"])
        .gte("start_time", target_date.isoformat())
        .lt("start_time", (target_date + timedelta(days=1)).isoformat())
    )
    if clinician_id:
        appts_query = appts_query.eq("clinician_id", clinician_id)

    appts_resp = appts_query.execute()
    existing = appts_resp.data or []
    blocked_by_clinician: dict[str, list[tuple[datetime, datetime]]] = {}
    for rule in rules_resp.data:
        cid = str(rule.get("clinician_id") or "").strip()
        if cid and cid not in blocked_by_clinician:
            blocked_by_clinician[cid] = _blocked_windows_for_date(cid, target_date)

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

            if slot_start_local <= datetime.now(clinic_tz):
                current += timedelta(minutes=step)
                continue

            # Check overlap with existing appointments
            overlap = False
            cid = str(rule.get("clinician_id") or "").strip()
            blocked_windows = blocked_by_clinician.get(cid, [])
            for bs, be in blocked_windows:
                if slot_start_utc < be and slot_end_utc > bs:
                    overlap = True
                    break
            if overlap:
                current += timedelta(minutes=step)
                continue
            for appt in existing:
                appt_cid = str(appt.get("clinician_id") or "").strip()
                if cid and appt_cid and appt_cid != cid:
                    continue
                appt_start = datetime.fromisoformat(appt["start_time"].replace("Z", "+00:00"))
                appt_end = datetime.fromisoformat(appt["end_time"].replace("Z", "+00:00"))
                if slot_start_utc < appt_end and slot_end_utc > appt_start:
                    overlap = True
                    break

            if not overlap:
                minute = slot_start_local.strftime("%M")
                time_str = slot_start_local.strftime("%-I:%M %p") if minute != "00" else slot_start_local.strftime("%-I %p")
                label = f"{slot_start_local.strftime('%A, %B %-d')} at {time_str}"
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
    start_date: Optional[str] = Query(default=None),
    weekday: Optional[str] = Query(default=None),
):
    """
    Returns upcoming open appointment slots.

    Default (no weekday): slots from the first day with availability, up to `limit`.
    With weekday: up to `limit` slots on matching weekdays across the scan window.

    Scan anchor: max(Eastern today, start_date if provided, day after after_date if provided).
    """
    eastern = pytz.timezone("America/New_York")
    now_eastern = datetime.now(eastern)
    today = now_eastern.date()
    scan_start = today

    if start_date:
        try:
            parsed_start_date = datetime.strptime(start_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="start_date must be in YYYY-MM-DD format") from exc
        scan_start = max(today, parsed_start_date)

    if after_date:
        try:
            parsed_after_date = datetime.strptime(after_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="after_date must be in YYYY-MM-DD format") from exc
        scan_start = max(scan_start, parsed_after_date + timedelta(days=1))

    weekday_filter = _parse_weekday_filter(weekday)
    scan_days = max(days_ahead, _MIN_WEEKDAY_SCAN_DAYS) if weekday_filter is not None else days_ahead

    if weekday_filter is not None:
        collected: list[dict] = []
        for offset in range(scan_days):
            target_date = scan_start + timedelta(days=offset)
            if target_date.isoweekday() % 7 != weekday_filter:
                continue
            day_slots = get_slots_for_date(clinic_id, clinician_id, target_date, duration_minutes)
            if not day_slots:
                continue
            remaining = limit - len(collected)
            collected.extend(day_slots[:remaining])
            if len(collected) >= limit:
                break
        return collected

    for offset in range(scan_days):
        target_date = scan_start + timedelta(days=offset)
        day_slots = get_slots_for_date(clinic_id, clinician_id, target_date, duration_minutes)
        if day_slots:
            return day_slots[:limit]

    return []