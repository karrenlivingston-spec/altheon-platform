"""Waitlist auto-notify when appointment slots are freed."""

from __future__ import annotations

import traceback
from datetime import datetime, time, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from app.sms import send_sms

_DEFAULT_CLINIC_TZ = "America/New_York"


def _parse_iso_utc(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_time_value(value: Any) -> Optional[time]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return time.fromisoformat(raw)
    except ValueError:
        pass
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def _clinic_timezone(supabase: Any, clinic_id: str) -> ZoneInfo:
    try:
        resp = (
            supabase.table("locations")
            .select("timezone")
            .eq("clinic_id", clinic_id.strip())
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            tz_name = str(rows[0].get("timezone") or "").strip()
            if tz_name:
                return ZoneInfo(tz_name)
    except Exception:
        traceback.print_exc()
    return ZoneInfo(_DEFAULT_CLINIC_TZ)


def _format_sms_date(local_dt: datetime) -> str:
    return f"{local_dt.strftime('%a')}, {local_dt.strftime('%B')} {local_dt.day}"


def _format_sms_time(local_dt: datetime) -> str:
    minute = local_dt.strftime("%M")
    hour = local_dt.hour % 12 or 12
    am_pm = "AM" if local_dt.hour < 12 else "PM"
    if minute == "00":
        return f"{hour} {am_pm}"
    return f"{hour}:{minute} {am_pm}"


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _time_in_window(requested: time, window_start: time, window_end: time) -> bool:
    return window_start <= requested <= window_end


def _row_matches_freed_slot(
    row: dict[str, Any],
    clinician_id: str,
    window_start: time,
    window_end: time,
) -> bool:
    row_provider = str(row.get("provider_id") or "").strip() or None
    if row_provider and row_provider != clinician_id.strip():
        return False
    requested = _parse_time_value(row.get("requested_time"))
    if requested is None:
        return True
    return _time_in_window(requested, window_start, window_end)


async def check_waitlist_matches(
    supabase: Any,
    clinic_id: str,
    freed_date: str,
    freed_start_time: str,
    freed_end_time: str,
    clinician_id: str,
    limit: int = 3,
) -> list[dict]:
    """
    Find waiting waitlist entries matching a freed appointment slot.
    """
    try:
        clinic_tz = _clinic_timezone(supabase, clinic_id)
        start_local = _parse_iso_utc(freed_start_time).astimezone(clinic_tz)
        end_local = _parse_iso_utc(freed_end_time).astimezone(clinic_tz)
        window_start = start_local.time()
        window_end = end_local.time()

        resp = (
            supabase.table("appointment_waitlist")
            .select(
                "id, patient_id, requested_time, provider_id, notes, created_at"
            )
            .eq("clinic_id", clinic_id.strip())
            .eq("status", "waiting")
            .eq("requested_date", freed_date.strip())
            .order("created_at")
            .execute()
        )
        rows = resp.data or []
        matched: list[dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if not _row_matches_freed_slot(row, clinician_id, window_start, window_end):
                continue
            matched.append(
                {
                    "id": row.get("id"),
                    "patient_id": row.get("patient_id"),
                    "requested_time": row.get("requested_time"),
                    "provider_id": row.get("provider_id"),
                    "notes": row.get("notes"),
                }
            )
            if len(matched) >= limit:
                break
        return matched
    except Exception:
        traceback.print_exc()
        return []


async def notify_waitlist_matches(
    supabase: Any,
    clinic_id: str,
    matches: list[dict],
    freed_date: str,
    freed_start_time: str,
    clinician_name: str,
) -> None:
    """SMS each matched waitlist patient and mark rows as notified."""
    if not matches:
        return

    clinic_phone = ""
    try:
        clinic_resp = (
            supabase.table("clinics")
            .select("phone")
            .eq("id", clinic_id.strip())
            .limit(1)
            .execute()
        )
        clinic_rows = clinic_resp.data or []
        if clinic_rows:
            clinic_phone = str(clinic_rows[0].get("phone") or "").strip()
    except Exception:
        traceback.print_exc()

    clinic_tz = _clinic_timezone(supabase, clinic_id)
    try:
        slot_local = _parse_iso_utc(freed_start_time).astimezone(clinic_tz)
    except Exception:
        traceback.print_exc()
        return

    date_label = _format_sms_date(slot_local)
    time_label = _format_sms_time(slot_local)
    clinician_part = ""
    if (clinician_name or "").strip():
        clinician_part = f", with {clinician_name.strip()}"
    phone_part = clinic_phone or "our office"

    for match in matches:
        entry_id = str(match.get("id") or "").strip()
        patient_id = str(match.get("patient_id") or "").strip()
        if not entry_id or not patient_id:
            continue
        try:
            patient_resp = (
                supabase.table("patients")
                .select("phone")
                .eq("id", patient_id)
                .limit(1)
                .execute()
            )
            patient_rows = patient_resp.data or []
            if not patient_rows:
                continue
            phone_raw = str(patient_rows[0].get("phone") or "").strip()
            if not phone_raw:
                continue

            message = (
                f"A spot opened up on {date_label} at {time_label}{clinician_part}. "
                f"Call us at {phone_part} if you'd like to grab it!"
            )
            sid = send_sms(
                clinic_id.strip(),
                _to_e164_us(phone_raw),
                message,
                patient_id=patient_id,
                message_type="waitlist_notify",
            )
            if not sid:
                continue

            now_iso = datetime.now(timezone.utc).isoformat()
            supabase.table("appointment_waitlist").update(
                {"status": "notified", "notified_at": now_iso, "updated_at": now_iso}
            ).eq("id", entry_id).execute()
        except Exception:
            traceback.print_exc()


async def resolve_clinician_name(supabase: Any, clinician_id: str) -> str:
    cid = (clinician_id or "").strip()
    if not cid:
        return ""
    try:
        resp = (
            supabase.table("clinicians")
            .select("first_name, last_name")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return ""
        row = rows[0]
        fn = str(row.get("first_name") or "").strip()
        ln = str(row.get("last_name") or "").strip()
        return f"{fn} {ln}".strip()
    except Exception:
        traceback.print_exc()
        return ""


async def process_freed_appointment_slot(
    supabase: Any,
    clinic_id: str,
    clinician_id: str,
    start_time_iso: str,
    end_time_iso: str,
    *,
    limit: int = 3,
) -> None:
    """
    Best-effort waitlist match + notify for a freed slot. Never raises.
    """
    try:
        clinic_tz = _clinic_timezone(supabase, clinic_id)
        start_local = _parse_iso_utc(start_time_iso).astimezone(clinic_tz)
        freed_date = start_local.date().isoformat()
        clinician_name = await resolve_clinician_name(supabase, clinician_id)
        matches = await check_waitlist_matches(
            supabase,
            clinic_id,
            freed_date,
            start_time_iso,
            end_time_iso,
            clinician_id,
            limit=limit,
        )
        if matches:
            await notify_waitlist_matches(
                supabase,
                clinic_id,
                matches,
                freed_date,
                start_time_iso,
                clinician_name,
            )
    except Exception:
        traceback.print_exc()


def run_waitlist_notify_for_freed_slot(
    supabase: Any,
    clinic_id: str,
    clinician_id: str,
    start_time_iso: str,
    end_time_iso: str,
) -> None:
    """Sync entry point for appointment routers. Never raises."""
    import asyncio

    try:
        asyncio.run(
            process_freed_appointment_slot(
                supabase,
                clinic_id,
                clinician_id,
                start_time_iso,
                end_time_iso,
            )
        )
    except Exception:
        traceback.print_exc()
