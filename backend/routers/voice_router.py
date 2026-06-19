"""ElevenLabs Aria call logs — webhook ingestion and clinic reporting."""

from __future__ import annotations

import os
import traceback
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.db import supabase
from routers.fee_schedule import _resolve_bearer_user_id

try:
    from elevenlabs.client import ElevenLabs

    _elevenlabs_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
except Exception:
    ElevenLabs = None  # type: ignore[misc, assignment]
    _elevenlabs_client = None

router = APIRouter()

_NY = ZoneInfo("America/New_York")
_PLATFORM_ADMIN_ROLES = frozenset({"super_admin", "platform_admin"})


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _round1(value: float) -> float:
    return round(value, 1)


def _int_or_zero(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "y")
    return bool(value)


def _collection_value(data: dict[str, Any], key: str) -> Any:
    val = data.get(key)
    if isinstance(val, dict):
        for nested_key in ("value", "result", "data", "collected_value"):
            if nested_key in val and val[nested_key] is not None:
                return val[nested_key]
    return val


def _format_elevenlabs_transcript(transcript_array: Any) -> Optional[str]:
    if not isinstance(transcript_array, list):
        return None
    parts: list[str] = []
    for turn in transcript_array:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "").strip().lower()
        message = str(turn.get("message") or "").strip()
        if not message:
            continue
        label = "Agent" if role in ("agent", "assistant", "ai") else "Patient"
        parts.append(f"{label}: {message}")
    combined = "\n".join(parts).strip()
    return combined or None


def _appointment_booked_from_data_collection(
    data_collection: dict[str, Any],
) -> bool:
    for key in data_collection:
        raw = _collection_value(data_collection, key)
        if raw is None:
            continue
        lowered = str(raw).lower()
        if "book" in lowered or "appointment" in lowered:
            return True
    return False


def _normalize_sentiment(value: Any) -> str:
    if value is None:
        return "neutral"
    s = str(value).strip().lower()
    if s in ("positive", "neutral", "negative"):
        return s
    if "positive" in s or s in ("good", "happy", "satisfied"):
        return "positive"
    if "negative" in s or s in ("bad", "angry", "frustrated", "unsatisfied"):
        return "negative"
    return "neutral"


def _require_platform_voice_admin(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> None:
    user_id = _resolve_bearer_user_id(authorization)
    try:
        resp = (
            supabase.table("clinic_users")
            .select("role")
            .eq("user_id", user_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    roles = {
        str(row.get("role") or "").strip()
        for row in (resp.data or [])
        if isinstance(row, dict)
    }
    if not roles.intersection(_PLATFORM_ADMIN_ROLES):
        raise HTTPException(
            status_code=403,
            detail="Voice reports require super_admin or platform_admin",
        )


def _clinic_id_for_agent(agent_id: Optional[str]) -> Optional[str]:
    agent = str(agent_id or "").strip()
    if agent:
        try:
            resp = (
                supabase.table("clinics")
                .select("id")
                .eq("elevenlabs_agent_id", agent)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if rows and isinstance(rows[0], dict) and rows[0].get("id"):
                return str(rows[0]["id"])
        except Exception as exc:
            print(f"[voice_router] clinic lookup failed for agent_id={agent}: {exc}")

    fallback = (os.getenv("DEFAULT_CLINIC_ID") or "").strip()
    if fallback:
        return fallback

    print(f"[voice_router] warning: no clinic found for agent_id={agent or '(empty)'}")
    return None


def _build_call_log_row(event: dict[str, Any]) -> dict[str, Any]:
    data = _as_dict(event.get("data"))
    metadata = _as_dict(data.get("metadata"))
    analysis = _as_dict(data.get("analysis"))
    data_collection = _as_dict(analysis.get("data_collection_results"))
    initiation = _as_dict(data.get("conversation_initiation_client_data"))
    dynamic_vars = _as_dict(initiation.get("dynamic_variables"))
    transcript_array = data.get("transcript") or []

    conversation_id = str(data.get("conversation_id") or "").strip()
    if not conversation_id:
        raise ValueError("conversation_id is required")

    agent_id = str(data.get("agent_id") or "").strip() or None
    duration_seconds = _int_or_zero(metadata.get("call_duration_secs", 0))
    call_summary = analysis.get("transcript_summary")
    call_successful = str(analysis.get("call_successful") or "").strip().lower()
    outcome = "completed" if call_successful == "success" else "incomplete"
    appointment_booked = _appointment_booked_from_data_collection(data_collection)
    intake_completed = _as_bool(_collection_value(data_collection, "intake_completed"))
    call_reason = _collection_value(data_collection, "call_reason") or _collection_value(
        data_collection, "reason"
    )
    sentiment = _normalize_sentiment(_collection_value(data_collection, "sentiment"))
    transcript = _format_elevenlabs_transcript(transcript_array)

    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    start_unix = metadata.get("start_time_unix_secs")
    if start_unix is not None:
        try:
            started_dt = datetime.utcfromtimestamp(int(float(start_unix))).replace(
                tzinfo=timezone.utc
            )
            started_at = started_dt.isoformat()
            if duration_seconds > 0:
                ended_at = (
                    started_dt + timedelta(seconds=duration_seconds)
                ).isoformat()
        except (TypeError, ValueError):
            pass

    caller_phone = dynamic_vars.get("caller_phone") or metadata.get("from_number")

    row: dict[str, Any] = {
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "clinic_id": _clinic_id_for_agent(agent_id),
        "caller_phone": str(caller_phone).strip() if caller_phone else None,
        "duration_seconds": duration_seconds,
        "transcript": transcript,
        "call_summary": str(call_summary).strip() if call_summary else None,
        "sentiment": sentiment,
        "outcome": outcome,
        "appointment_booked": appointment_booked,
        "intake_completed": intake_completed,
        "call_reason": str(call_reason).strip() if call_reason else None,
        "started_at": started_at,
        "ended_at": ended_at,
    }
    return row


def _shape_call_list_item(row: dict[str, Any]) -> dict[str, Any]:
    transcript = row.get("transcript")
    has_transcript = bool(
        transcript is not None and str(transcript).strip()
    )
    return {
        "id": row.get("id"),
        "conversation_id": row.get("conversation_id"),
        "caller_phone": row.get("caller_phone"),
        "caller_name": row.get("caller_name"),
        "duration_seconds": row.get("duration_seconds"),
        "outcome": row.get("outcome"),
        "appointment_booked": row.get("appointment_booked"),
        "intake_completed": row.get("intake_completed"),
        "call_summary": row.get("call_summary"),
        "call_reason": row.get("call_reason"),
        "sentiment": row.get("sentiment"),
        "started_at": row.get("started_at"),
        "ended_at": row.get("ended_at"),
        "recording_url": row.get("recording_url"),
        "has_transcript": has_transcript,
    }


def _eastern_ymd(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        s = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_NY).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_date_param(value: Optional[str]) -> Optional[date]:
    if not value or not str(value).strip():
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def _date_range_bounds(
    date_from: Optional[date],
    date_to: Optional[date],
) -> tuple[date, date, str, str]:
    today = datetime.now(timezone.utc).astimezone(_NY).date()
    end = date_to or today
    start = date_from or (end - timedelta(days=29))
    if start > end:
        start, end = end, start

    start_iso = (
        datetime.combine(start, time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    end_iso = (
        datetime.combine(end + timedelta(days=1), time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    return start, end, start_iso, end_iso


def _empty_outcomes_report(
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict[str, Any]:
    today = datetime.now(timezone.utc).astimezone(_NY).date()
    end = _parse_date_param(date_to) or today
    start = _parse_date_param(date_from) or (end - timedelta(days=29))
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "total_calls": 0,
        "outcomes": [],
        "booking_rate": 0.0,
        "intake_completion_rate": 0.0,
        "avg_duration_seconds": 0.0,
        "daily_trend": [],
    }


@router.post("/webhook/elevenlabs")
async def elevenlabs_post_call_webhook(request: Request):
    """Receive ElevenLabs post-call webhook; always returns HTTP 200."""
    try:
        body = await request.body()
        sig_header = request.headers.get("ElevenLabs-Signature")

        if _elevenlabs_client is None:
            print("[webhook] ElevenLabs SDK not available")
            return JSONResponse(status_code=200, content={"status": "ok"})

        try:
            event = _elevenlabs_client.webhooks.construct_event(
                rawBody=body.decode("utf-8"),
                sig_header=sig_header,
                secret=os.getenv("ELEVENLABS_WEBHOOK_SECRET"),
            )
        except Exception as exc:
            print(f"[webhook] Invalid signature: {exc}")
            return JSONResponse(status_code=200, content={"status": "ok"})

        if not isinstance(event, dict):
            event = dict(event) if hasattr(event, "__dict__") else {}

        event_type = event.get("type")
        if event_type != "post_call_transcription":
            print(f"[webhook] Ignoring event type: {event_type}")
            return JSONResponse(status_code=200, content={"status": "ok"})

        row = _build_call_log_row(event)
        resp = (
            supabase.table("call_logs")
            .upsert(row, on_conflict="conversation_id")
            .execute()
        )
        error = getattr(resp, "error", None)
        if error:
            detail = getattr(error, "message", None) or str(error)
            raise RuntimeError(detail)
        return JSONResponse(status_code=200, content={"status": "ok"})
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=200,
            content={"status": "error", "detail": str(exc)},
        )


@router.get("/clinic/{clinic_id}/calls")
def list_clinic_calls(
    clinic_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    outcome: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_voice_admin(authorization)
    cid = clinic_id.strip()
    size = min(max(page_size, 1), 100)
    pg = max(page, 1)
    offset = (pg - 1) * size

    try:
        count_q = (
            supabase.table("call_logs")
            .select("id", count="exact")
            .eq("clinic_id", cid)
        )
        data_q = (
            supabase.table("call_logs")
            .select(
                "id, conversation_id, caller_phone, caller_name, duration_seconds, "
                "outcome, appointment_booked, intake_completed, call_summary, "
                "call_reason, sentiment, started_at, ended_at, recording_url, transcript"
            )
            .eq("clinic_id", cid)
        )

        if outcome and outcome.strip():
            count_q = count_q.eq("outcome", outcome.strip())
            data_q = data_q.eq("outcome", outcome.strip())

        parsed_from = _parse_date_param(date_from)
        parsed_to = _parse_date_param(date_to)
        if parsed_from or parsed_to:
            _, _, start_iso, end_iso = _date_range_bounds(parsed_from, parsed_to)
            count_q = count_q.gte("started_at", start_iso).lt("started_at", end_iso)
            data_q = data_q.gte("started_at", start_iso).lt("started_at", end_iso)

        count_resp = count_q.limit(1).execute()
        total = int(getattr(count_resp, "count", None) or 0)

        data_resp = (
            data_q.order("started_at", desc=True)
            .range(offset, offset + size - 1)
            .execute()
        )
        rows = [r for r in (data_resp.data or []) if isinstance(r, dict)]
        calls = [_shape_call_list_item(row) for row in rows]

        return {
            "total": total,
            "page": pg,
            "page_size": size,
            "calls": calls,
        }
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return {
            "total": 0,
            "page": pg,
            "page_size": size,
            "calls": [],
        }


@router.get("/clinic/{clinic_id}/calls/{call_id}/transcript")
def get_call_transcript(
    clinic_id: str,
    call_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_voice_admin(authorization)
    cid = clinic_id.strip()
    call_pk = call_id.strip()

    try:
        resp = (
            supabase.table("call_logs")
            .select("conversation_id, transcript")
            .eq("id", call_pk)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows or not isinstance(rows[0], dict):
            raise HTTPException(status_code=404, detail="Call not found")
        row = rows[0]
        return {
            "conversation_id": row.get("conversation_id"),
            "transcript": row.get("transcript"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=404, detail="Call not found") from exc


@router.get("/clinic/{clinic_id}/reports/outcomes")
def clinic_outcomes_report(
    clinic_id: str,
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_voice_admin(authorization)
    cid = clinic_id.strip()

    try:
        start, end, start_iso, end_iso = _date_range_bounds(
            _parse_date_param(date_from),
            _parse_date_param(date_to),
        )

        resp = (
            supabase.table("call_logs")
            .select(
                "outcome, appointment_booked, intake_completed, "
                "duration_seconds, started_at"
            )
            .eq("clinic_id", cid)
            .gte("started_at", start_iso)
            .lt("started_at", end_iso)
            .execute()
        )
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
        total_calls = len(rows)

        outcome_counts: dict[str, int] = defaultdict(int)
        booked_count = 0
        intake_count = 0
        durations: list[int] = []
        daily_total: dict[str, int] = defaultdict(int)
        daily_booked: dict[str, int] = defaultdict(int)

        for row in rows:
            outcome_key = str(row.get("outcome") or "unknown").strip() or "unknown"
            outcome_counts[outcome_key] += 1
            if _as_bool(row.get("appointment_booked")):
                booked_count += 1
            if _as_bool(row.get("intake_completed")):
                intake_count += 1
            durations.append(_int_or_zero(row.get("duration_seconds")))

            ymd = _eastern_ymd(row.get("started_at"))
            if ymd:
                daily_total[ymd] += 1
                if _as_bool(row.get("appointment_booked")):
                    daily_booked[ymd] += 1

        outcomes = [
            {
                "outcome": name,
                "count": count,
                "percentage": _round1(count / total_calls * 100) if total_calls else 0.0,
            }
            for name, count in sorted(
                outcome_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )
        ]

        booking_rate = (
            _round1(booked_count / total_calls * 100) if total_calls else 0.0
        )
        intake_completion_rate = (
            _round1(intake_count / total_calls * 100) if total_calls else 0.0
        )
        avg_duration_seconds = (
            _round1(sum(durations) / len(durations)) if durations else 0.0
        )

        daily_trend: list[dict[str, Any]] = []
        cursor = start
        while cursor <= end:
            key = cursor.isoformat()
            daily_trend.append(
                {
                    "date": key,
                    "total": daily_total.get(key, 0),
                    "booked": daily_booked.get(key, 0),
                }
            )
            cursor += timedelta(days=1)

        return {
            "period": {"from": start.isoformat(), "to": end.isoformat()},
            "total_calls": total_calls,
            "outcomes": outcomes,
            "booking_rate": booking_rate,
            "intake_completion_rate": intake_completion_rate,
            "avg_duration_seconds": avg_duration_seconds,
            "daily_trend": daily_trend,
        }
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return _empty_outcomes_report(date_from=date_from, date_to=date_to)
