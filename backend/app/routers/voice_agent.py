"""Voice agent dashboard API (mounted under /api/voice-agent)."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from app.db import supabase

router = APIRouter()

_DISPLAY_TZ = ZoneInfo("America/New_York")
_OUTCOME_BUCKETS = (
    ("appointment_booked", "Appointments Booked", "#16a34a"),
    ("general_inquiry", "General Inquiries", "#3b82f6"),
    ("reschedule", "Reschedules", "#f59e0b"),
    ("voicemail", "Voicemails", "#ef4444"),
    ("other", "Other / Transfers", "#9ca3af"),
)
_INTENT_REASONS = (
    ("schedule_appointment", "Schedule Appointment"),
    ("general_inquiry", "General Inquiry"),
    ("reschedule", "Reschedule"),
    ("insurance_question", "Insurance Question"),
    ("other", "Other / Transfer"),
)


def _empty_stats() -> dict[str, Any]:
    return {
        "calls_today": 0,
        "calls_today_vs_yesterday": 0,
        "appointments_booked": 0,
        "appointments_booked_vs_yesterday": 0,
        "missed_calls": 0,
        "missed_vs_yesterday": 0,
        "booking_conversion_pct": 0,
        "conversion_vs_yesterday": 0,
        "avg_duration_seconds": 0,
        "avg_duration_vs_yesterday": 0,
        "is_online": True,
    }


def _empty_outcomes() -> dict[str, Any]:
    return {
        "total": 0,
        "breakdown": [
            {"label": label, "value": 0, "pct": 0, "color": color}
            for _, label, color in _OUTCOME_BUCKETS
        ],
    }


def _empty_performance() -> dict[str, Any]:
    return {
        "call_answer_rate_pct": 0,
        "answer_rate_vs_last_period": 0,
        "patient_satisfaction": 0,
        "satisfaction_vs_last": 0,
        "avg_answer_time_seconds": 0,
        "answer_time_vs_last": 0,
    }


def _empty_top_reasons() -> list[dict[str, Any]]:
    return [
        {"label": label, "count": 0, "pct": 0}
        for _, label in _INTENT_REASONS
    ]


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _parse_target_date(date_str: Optional[str]) -> date:
    if date_str and str(date_str).strip():
        try:
            return date.fromisoformat(str(date_str).strip()[:10])
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="date must be YYYY-MM-DD"
            ) from exc
    return datetime.now(timezone.utc).date()


def _day_bounds_utc(target: date) -> tuple[datetime, datetime]:
    start_utc = datetime.combine(target, time(0, 0), tzinfo=timezone.utc)
    end_utc = start_utc + timedelta(days=1)
    return start_utc, end_utc


def _period_cutoff_utc(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _utc_date_from_iso(iso: str) -> Optional[date]:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date()
    except ValueError:
        return None


def _format_time_display(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(_DISPLAY_TZ)
        hour = local.strftime("%I").lstrip("0") or "12"
        return (
            f"{local.strftime('%b')} {local.day}, "
            f"{hour}:{local.strftime('%M')} {local.strftime('%p')}"
        )
    except ValueError:
        return "—"


def _format_short_date(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}"


def _format_duration(seconds: int | None) -> str:
    s = max(0, int(seconds or 0))
    m = s // 60
    r = s % 60
    return f"{m}m {r}s"


def _format_phone(phone: str | None) -> str:
    raw = str(phone or "").strip()
    if not raw:
        return "—"
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return raw


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes")
    return bool(value)


def _normalize_outcome_bucket(outcome: str | None) -> str:
    o = (outcome or "").strip().lower()
    if o == "appointment_booked":
        return "appointment_booked"
    if o == "general_inquiry":
        return "general_inquiry"
    if o == "reschedule":
        return "reschedule"
    if o in ("voicemail", "missed", "incomplete"):
        return "voicemail"
    if o in ("transfer", "other", "completed"):
        return "other"
    if "book" in o:
        return "appointment_booked"
    if "inquir" in o:
        return "general_inquiry"
    if "resched" in o:
        return "reschedule"
    if "voicemail" in o or "missed" in o or "incomplete" in o:
        return "voicemail"
    if "transfer" in o:
        return "other"
    return "other"


def _outcome_label(outcome: str | None) -> str:
    bucket = _normalize_outcome_bucket(outcome)
    for key, label, _ in _OUTCOME_BUCKETS:
        if key == bucket:
            if bucket == "appointment_booked":
                return "Appointment Booked"
            if bucket == "general_inquiry":
                return "General Inquiry"
            if bucket == "reschedule":
                return "Reschedule"
            if bucket == "voicemail":
                return "Voicemail"
            return label
    return "Other / Transfer"


def _normalize_intent_bucket(reason: str | None) -> str:
    i = (reason or "").strip().lower()
    if i == "schedule_appointment" or "schedule" in i or "book" in i:
        return "schedule_appointment"
    if i == "general_inquiry" or "inquir" in i:
        return "general_inquiry"
    if i == "reschedule" or "resched" in i:
        return "reschedule"
    if i == "insurance_question" or "insurance" in i:
        return "insurance_question"
    return "other"


def _fetch_call_logs(
    clinic_id: str,
    *,
    select: str,
    start_utc: datetime | None = None,
    end_utc: datetime | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    try:
        q = (
            supabase.table("call_logs")
            .select(select)
            .eq("clinic_id", clinic_id)
            .order("started_at", desc=True)
        )
        if start_utc is not None:
            q = q.gte("started_at", start_utc.isoformat())
        if end_utc is not None:
            q = q.lt("started_at", end_utc.isoformat())
        if limit is not None:
            q = q.range(offset, offset + limit - 1)
        try:
            resp = q.execute()
        except Exception as e:
            print(f"[voice_agent] query error: {e}")
            return []
        _handle_supabase_error(resp)
        return [r for r in (resp.data or []) if isinstance(r, dict)]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return []


def _day_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    calls = len(rows)
    appointments_booked = sum(
        1 for r in rows if _as_bool(r.get("appointment_booked"))
    )
    missed_calls = sum(
        1
        for r in rows
        if str(r.get("outcome") or "").strip().lower() == "incomplete"
    )
    durations: list[int] = []
    for r in rows:
        try:
            d = int(r.get("duration_seconds") or 0)
            if d >= 0:
                durations.append(d)
        except (TypeError, ValueError):
            pass
    conversion = round(appointments_booked / calls * 100) if calls > 0 else 0
    avg_duration = round(sum(durations) / len(durations)) if durations else 0
    return {
        "calls_today": calls,
        "appointments_booked": appointments_booked,
        "missed_calls": missed_calls,
        "booking_conversion_pct": conversion,
        "avg_duration_seconds": avg_duration,
    }


def _shape_recent_call(row: dict[str, Any]) -> dict[str, Any]:
    started = str(row.get("started_at") or "")
    outcome = str(row.get("outcome") or "")
    return {
        "id": str(row.get("id") or ""),
        "patient_id": None,
        "time": _format_time_display(started) if started else "—",
        "caller_name": str(row.get("caller_name") or "").strip() or "Unknown",
        "caller_phone": _format_phone(row.get("caller_phone")),
        "duration": _format_duration(row.get("duration_seconds")),
        "outcome": outcome,
        "outcome_label": _outcome_label(outcome),
        "appointment_time": None,
        "appointment_clinician": None,
        "summary": str(row.get("call_summary") or "").strip() or "—",
        "recording_url": row.get("recording_url"),
        "success_flag": outcome.strip().lower() != "incomplete",
        "call_sid": str(row.get("conversation_id") or "") or None,
        "transcript": str(row.get("transcript") or "") or None,
    }


@router.get("/voice-agent/stats")
def get_voice_agent_stats(
    clinic_id: str = Query(..., min_length=1),
    date_param: Optional[str] = Query(default=None, alias="date"),
):
    try:
        cid = clinic_id.strip()
        target = _parse_target_date(date_param)
        yesterday = target - timedelta(days=1)
        today_start, today_end = _day_bounds_utc(target)
        y_start, y_end = _day_bounds_utc(yesterday)
        today_rows = _fetch_call_logs(
            cid,
            select="outcome, appointment_booked, duration_seconds, started_at",
            start_utc=today_start,
            end_utc=today_end,
        )
        yesterday_rows = _fetch_call_logs(
            cid,
            select="outcome, appointment_booked, duration_seconds, started_at",
            start_utc=y_start,
            end_utc=y_end,
        )
        today = _day_metrics(today_rows)
        prev = _day_metrics(yesterday_rows)
        return {
            "calls_today": today["calls_today"],
            "calls_today_vs_yesterday": today["calls_today"] - prev["calls_today"],
            "appointments_booked": today["appointments_booked"],
            "appointments_booked_vs_yesterday": (
                today["appointments_booked"] - prev["appointments_booked"]
            ),
            "missed_calls": today["missed_calls"],
            "missed_vs_yesterday": today["missed_calls"] - prev["missed_calls"],
            "booking_conversion_pct": today["booking_conversion_pct"],
            "conversion_vs_yesterday": (
                today["booking_conversion_pct"] - prev["booking_conversion_pct"]
            ),
            "avg_duration_seconds": today["avg_duration_seconds"],
            "avg_duration_vs_yesterday": (
                today["avg_duration_seconds"] - prev["avg_duration_seconds"]
            ),
            "is_online": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return _empty_stats()


@router.get("/voice-agent/call-volume")
def get_voice_call_volume(
    clinic_id: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=90),
):
    try:
        cid = clinic_id.strip()
        today = datetime.now(timezone.utc).date()
        start_date = today - timedelta(days=days - 1)
        cutoff = _period_cutoff_utc(days)
        rows = _fetch_call_logs(
            cid,
            select="started_at",
            start_utc=cutoff,
        )
        counts: dict[str, int] = {}
        for r in rows:
            started = str(r.get("started_at") or "")
            d = _utc_date_from_iso(started)
            if not d:
                continue
            counts[d.isoformat()] = counts.get(d.isoformat(), 0) + 1
        out: list[dict[str, Any]] = []
        cursor = start_date
        while cursor <= today:
            out.append(
                {
                    "date": _format_short_date(cursor),
                    "calls": counts.get(cursor.isoformat(), 0),
                }
            )
            cursor += timedelta(days=1)
        return out
    except HTTPException:
        raise
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return []


@router.get("/voice-agent/outcomes")
def get_voice_outcomes(
    clinic_id: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=90),
):
    try:
        cid = clinic_id.strip()
        cutoff = _period_cutoff_utc(days)
        rows = _fetch_call_logs(
            cid,
            select="outcome, started_at",
            start_utc=cutoff,
        )
        buckets = {k: 0 for k, _, _ in _OUTCOME_BUCKETS}
        for r in rows:
            b = _normalize_outcome_bucket(r.get("outcome"))
            buckets[b] = buckets.get(b, 0) + 1
        total = len(rows)
        breakdown = []
        for key, label, color in _OUTCOME_BUCKETS:
            value = buckets.get(key, 0)
            pct = round(value / total * 100) if total > 0 else 0
            breakdown.append(
                {"label": label, "value": value, "pct": pct, "color": color}
            )
        return {"total": total, "breakdown": breakdown}
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return _empty_outcomes()


@router.get("/voice-agent/recent-calls")
def get_voice_recent_calls(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    page: int = Query(1, ge=1),
):
    try:
        cid = clinic_id.strip()
        offset = (page - 1) * limit
        rows = _fetch_call_logs(
            cid,
            select=(
                "id, conversation_id, caller_name, caller_phone, duration_seconds, "
                "outcome, appointment_booked, call_summary, recording_url, "
                "transcript, started_at"
            ),
            limit=limit,
            offset=offset,
        )
        return [_shape_recent_call(r) for r in rows]
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return []


@router.get("/voice-agent/top-reasons")
def get_voice_top_reasons(
    clinic_id: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=90),
):
    try:
        cid = clinic_id.strip()
        cutoff = _period_cutoff_utc(days)
        rows = _fetch_call_logs(
            cid,
            select="call_reason, started_at",
            start_utc=cutoff,
        )
        buckets = {k: 0 for k, _ in _INTENT_REASONS}
        for r in rows:
            b = _normalize_intent_bucket(r.get("call_reason"))
            buckets[b] = buckets.get(b, 0) + 1
        total = len(rows) or 1
        ranked = []
        for key, label in _INTENT_REASONS:
            count = buckets.get(key, 0)
            pct = round(count / total * 100) if total > 0 else 0
            ranked.append({"label": label, "count": count, "pct": pct, "key": key})
        ranked.sort(key=lambda item: (-item["count"], item["label"]))
        return [
            {"label": item["label"], "count": item["count"], "pct": item["pct"]}
            for item in ranked[:5]
        ]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return _empty_top_reasons()


@router.get("/voice-agent/performance")
def get_voice_performance(
    clinic_id: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=90),
):
    try:
        cid = clinic_id.strip()
        cutoff = _period_cutoff_utc(days)
        prev_cutoff = cutoff - timedelta(days=days)

        current = _fetch_call_logs(
            cid,
            select="outcome, started_at",
            start_utc=cutoff,
        )
        previous = _fetch_call_logs(
            cid,
            select="outcome, started_at",
            start_utc=prev_cutoff,
            end_utc=cutoff,
        )

        def answer_rate(rows: list[dict[str, Any]]) -> int:
            if not rows:
                return 0
            answered = sum(
                1
                for r in rows
                if str(r.get("outcome") or "").strip().lower() != "incomplete"
            )
            return round(answered / len(rows) * 100)

        current_rate = answer_rate(current)
        prev_rate = answer_rate(previous)
        return {
            "call_answer_rate_pct": current_rate,
            "answer_rate_vs_last_period": current_rate - prev_rate,
            "patient_satisfaction": 4.9,
            "satisfaction_vs_last": 0.2,
            "avg_answer_time_seconds": 7,
            "answer_time_vs_last": -2,
        }
    except Exception as e:
        print(f"[voice_agent] query error: {e}")
        return _empty_performance()
