"""Voice agent analytics API (mounted under /voice)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.db import supabase
from app.retry_utils import supabase_execute
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_VALID_PERIODS = frozenset({"week", "month", "quarter", "year"})


def _empty_analytics() -> dict[str, Any]:
    return {
        "total_calls": 0,
        "answered_calls": 0,
        "missed_calls": 0,
        "appointments_booked": 0,
        "intakes_completed": 0,
        "avg_duration_seconds": 0,
        "conversion_rate": 0.0,
        "answer_rate": 0.0,
        "daily_trend": [],
        "intent_breakdown": [],
        "recent_calls": [],
    }


def _eastern_today() -> date:
    return datetime.now(timezone.utc).astimezone(_CLINIC_TZ).date()


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _quarter_start(d: date) -> date:
    q_month = ((d.month - 1) // 3) * 3 + 1
    return date(d.year, q_month, 1)


def _year_start(d: date) -> date:
    return date(d.year, 1, 1)


def _period_range(period: str) -> tuple[date, date]:
    today = _eastern_today()
    p = (period or "month").strip().lower()
    if p not in _VALID_PERIODS:
        p = "month"
    if p == "week":
        start = today - timedelta(days=6)
    elif p == "quarter":
        start = _quarter_start(today)
    elif p == "year":
        start = _year_start(today)
    else:
        start = _month_start(today)
    return start, today


def _utc_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(start, time(0, 0), tzinfo=_CLINIC_TZ)
    end_local = datetime.combine(end + timedelta(days=1), time(0, 0), tzinfo=_CLINIC_TZ)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _local_date_from_iso(iso: Any) -> Optional[date]:
    if iso is None:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_CLINIC_TZ).date()
    except ValueError:
        return None


def _has_appointment_id(row: dict[str, Any]) -> bool:
    appt_id = row.get("appointment_id")
    return appt_id is not None and bool(str(appt_id).strip())


def _fetch_period_logs(
    clinic_id: str,
    *,
    start_utc: datetime,
    end_utc: datetime,
) -> list[dict[str, Any]]:
    try:
        resp = supabase_execute(
            lambda: supabase.table("voice_interaction_logs")
            .select(
                "id, caller_name, caller_phone, outcome, duration_seconds, "
                "success_flag, intent_detected, created_at, appointment_id"
            )
            .eq("clinic_id", clinic_id)
            .gte("created_at", start_utc.isoformat())
            .lt("created_at", end_utc.isoformat())
            .order("created_at", desc=True)
            .execute()
        )
        error = getattr(resp, "error", None)
        if error:
            return []
        return [r for r in (resp.data or []) if isinstance(r, dict)]
    except Exception:
        return []


def _compute_analytics(
    rows: list[dict[str, Any]],
    *,
    start: date,
    end: date,
) -> dict[str, Any]:
    total_calls = len(rows)
    answered_calls = sum(1 for r in rows if r.get("success_flag") is True)
    missed_calls = sum(1 for r in rows if r.get("success_flag") is False)
    appointments_booked = sum(1 for r in rows if _has_appointment_id(r))
    intakes_completed = sum(
        1
        for r in rows
        if str(r.get("intent_detected") or "") == "intake"
        and r.get("success_flag") is True
    )

    durations: list[int] = []
    for row in rows:
        try:
            val = row.get("duration_seconds")
            if val is not None:
                durations.append(int(val))
        except (TypeError, ValueError):
            pass
    avg_duration_seconds = round(sum(durations) / len(durations)) if durations else 0

    conversion_rate = (
        round(appointments_booked / answered_calls * 100, 1)
        if answered_calls > 0
        else 0.0
    )
    answer_rate = (
        round(answered_calls / total_calls * 100, 1) if total_calls > 0 else 0.0
    )

    daily_calls: dict[str, int] = defaultdict(int)
    daily_appts: dict[str, int] = defaultdict(int)
    for row in rows:
        day = _local_date_from_iso(row.get("created_at"))
        if not day:
            continue
        key = day.isoformat()
        daily_calls[key] += 1
        if _has_appointment_id(row):
            daily_appts[key] += 1

    daily_trend: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        daily_trend.append(
            {
                "date": key,
                "calls": daily_calls.get(key, 0),
                "appointments_booked": daily_appts.get(key, 0),
            }
        )
        cursor += timedelta(days=1)

    intent_counts: dict[Optional[str], int] = defaultdict(int)
    for row in rows:
        intent = row.get("intent_detected")
        if intent is not None:
            intent = str(intent).strip() or None
        intent_counts[intent] += 1
    intent_breakdown = [
        {"intent": intent, "count": count}
        for intent, count in sorted(
            intent_counts.items(),
            key=lambda item: (-item[1], str(item[0])),
        )
    ]

    recent_calls = [
        {
            "id": str(row.get("id") or ""),
            "caller_name": row.get("caller_name"),
            "caller_phone": row.get("caller_phone"),
            "outcome": row.get("outcome"),
            "duration_seconds": row.get("duration_seconds"),
            "success_flag": row.get("success_flag"),
            "intent_detected": row.get("intent_detected"),
            "created_at": row.get("created_at"),
            "appointment_id": row.get("appointment_id"),
        }
        for row in rows[:10]
    ]

    return {
        "total_calls": total_calls,
        "answered_calls": answered_calls,
        "missed_calls": missed_calls,
        "appointments_booked": appointments_booked,
        "intakes_completed": intakes_completed,
        "avg_duration_seconds": avg_duration_seconds,
        "conversion_rate": conversion_rate,
        "answer_rate": answer_rate,
        "daily_trend": daily_trend,
        "intent_breakdown": intent_breakdown,
        "recent_calls": recent_calls,
    }


@router.get("/analytics")
def voice_analytics(
    clinic: ClinicUserDep,
    period: Literal["week", "month", "quarter", "year"] = Query(default="month"),
):
    """Voice interaction metrics for the authenticated clinic."""
    try:
        start, end = _period_range(period)
        start_utc, end_utc = _utc_bounds(start, end)
        rows = _fetch_period_logs(
            clinic.clinic_id,
            start_utc=start_utc,
            end_utc=end_utc,
        )
        return _compute_analytics(rows, start=start, end=end)
    except Exception:
        return _empty_analytics()
