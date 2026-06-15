"""Resolve blocked_time rows into UTC overlap windows for slot filtering."""

from __future__ import annotations

import traceback
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

import pytz

from app.db import supabase


def _parse_block_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _parse_time_of_day(value: Any) -> Optional[time]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return time.fromisoformat(raw[:8])
    except ValueError:
        pass
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def blocked_windows_for_clinician_date(
    clinician_id: str,
    target_date: date,
    clinic_tz: pytz.BaseTzInfo,
) -> list[tuple[datetime, datetime]]:
    """
    Return UTC (start, end) intervals that block slots on target_date for a clinician.

    Full-day block (start_time_of_day and end_time_of_day both null): entire
    target_date in clinic timezone.

    Partial-day block (both times set): only that window on target_date.
    """
    cid = (clinician_id or "").strip()
    if not cid:
        return []

    date_iso = target_date.isoformat()
    try:
        resp = (
            supabase.table("blocked_time")
            .select("start_time,end_time,start_time_of_day,end_time_of_day")
            .eq("clinician_id", cid)
            .lte("start_time", date_iso)
            .gte("end_time", date_iso)
            .execute()
        )
        rows = resp.data or []
    except Exception:
        traceback.print_exc()
        return []

    windows: list[tuple[datetime, datetime]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            block_start = _parse_block_date(row.get("start_time"))
            block_end = _parse_block_date(row.get("end_time"))
            if not block_start or not block_end:
                continue
            if not (block_start <= target_date <= block_end):
                continue

            start_tod = _parse_time_of_day(row.get("start_time_of_day"))
            end_tod = _parse_time_of_day(row.get("end_time_of_day"))

            if start_tod and end_tod:
                block_start_local = clinic_tz.localize(
                    datetime.combine(target_date, start_tod)
                )
                block_end_local = clinic_tz.localize(
                    datetime.combine(target_date, end_tod)
                )
            elif not start_tod and not end_tod:
                block_start_local = clinic_tz.localize(
                    datetime.combine(target_date, time.min)
                )
                block_end_local = clinic_tz.localize(
                    datetime.combine(target_date + timedelta(days=1), time.min)
                )
            else:
                continue

            windows.append(
                (
                    block_start_local.astimezone(timezone.utc),
                    block_end_local.astimezone(timezone.utc),
                )
            )
        except Exception:
            traceback.print_exc()
            continue

    return windows


def slot_overlaps_blocked_window(
    slot_start_utc: datetime,
    slot_end_utc: datetime,
    blocked_windows: list[tuple[datetime, datetime]],
) -> bool:
    for block_start, block_end in blocked_windows:
        if slot_start_utc < block_end and slot_end_utc > block_start:
            return True
    return False
