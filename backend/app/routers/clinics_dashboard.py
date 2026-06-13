"""Multi-clinic management dashboard API (mounted under /api/clinics)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query

from app.db import supabase

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_LIVE_DATA_CLINICS = frozenset(
    {
        "804e2fd2-1c5e-49ec-a036-3feedd1bad50",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    }
)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _require_super_admin(authorization: Optional[str]) -> None:
    from routers.fee_schedule import _resolve_bearer_user_id

    user_id = _resolve_bearer_user_id(authorization)
    try:
        sa_resp = (
            supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("role", "super_admin")
            .limit(1)
            .execute()
        )
        _handle_supabase_error(sa_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not sa_resp.data:
        raise HTTPException(status_code=403, detail="Super admin only")


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _prev_month_start(d: date) -> date:
    if d.month == 1:
        return date(d.year - 1, 12, 1)
    return date(d.year, d.month - 1, 1)


def _pct_change(this: int, last: int) -> int:
    if last <= 0:
        return 100 if this > 0 else 0
    return round((this - last) / last * 100)


def _pct_change_float(this: float, last: float) -> int:
    if last <= 0:
        return 100 if this > 0 else 0
    return round((this - last) / last * 100)


def _int_cents(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _format_short_date(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}"


def _empty_clinic_stats() -> dict[str, Any]:
    today = datetime.now(_CLINIC_TZ).date()
    month_start = _month_start(today)
    trend = []
    cursor = month_start
    while cursor <= today:
        trend.append({"date": _format_short_date(cursor), "amount": 0})
        cursor += timedelta(days=1)
    return {
        "patient_count": 0,
        "appointments_mtd": 0,
        "collected_mtd": 0.0,
        "collection_rate_pct": 0,
        "no_show_rate_pct": 0,
        "agent_success_rate_pct": 0,
        "collections_trend": trend,
    }


def _billing_model_for_clinic(
    clinic_row: dict[str, Any], settings_map: dict[str, Any]
) -> str:
    cid = str(clinic_row.get("id") or "")
    bm = clinic_row.get("billing_model") or settings_map.get(cid)
    return str(bm or "hybrid").strip().lower()


def _clinic_address(row: dict[str, Any]) -> str:
    city = str(row.get("location_city") or "").strip()
    state = str(row.get("location_state") or "").strip()
    if city and state:
        return f"{city}, {state}"
    addr = str(row.get("address") or "").strip()
    return addr or "—"


def _record_ids_for_clinic(clinic_id: str) -> list[str]:
    try:
        res = (
            supabase.table("billing_records")
            .select("id")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        return [
            str(r["id"])
            for r in (res.data or [])
            if isinstance(r, dict) and r.get("id")
        ]
    except Exception as e:
        print(f"[clinics_dashboard] billing_records lookup error {clinic_id}: {e}")
        return []


def _sum_billing_payments(
    clinic_id: str,
    month_start: date,
    today: date,
    *,
    record_ids: Optional[list[str]] = None,
    range_start: Optional[date] = None,
    range_end: Optional[date] = None,
) -> tuple[float, dict[str, float]]:
    """Sum payment amounts in dollars for a clinic; returns (total, daily_map).

    billing_payments has no clinic_id column — it is scoped to a clinic via
    billing_record_id -> billing_records.id (clinic_id). record_ids must be
    pre-populated by the caller from billing_records for this clinic_id.
    """
    start = range_start or month_start
    end = range_end or today
    daily: dict[str, float] = {}
    collected = 0.0

    record_set = set(record_ids or [])
    if not record_set:
        return 0.0, daily

    try:
        res = (
            supabase.table("billing_payments")
            .select("amount_cents, payment_date, billing_record_id, created_at")
            .gte("payment_date", start.isoformat())
            .lte("payment_date", end.isoformat())
            .execute()
        )
        for p in res.data or []:
            if not isinstance(p, dict):
                continue
            if str(p.get("billing_record_id") or "") not in record_set:
                continue
            cents = _int_cents(p.get("amount_cents"))
            val = cents / 100.0
            collected += val
            pd = p.get("payment_date")
            if pd:
                key = str(pd)[:10]
                daily[key] = daily.get(key, 0.0) + val
    except Exception as e:
        print(f"[clinics_dashboard] billing_payments fallback error {clinic_id}: {e}")

    return round(collected, 2), daily


def _clinic_live_stats(clinic_id: str) -> dict[str, Any]:
    if clinic_id not in _LIVE_DATA_CLINICS:
        return _empty_clinic_stats()

    today = datetime.now(_CLINIC_TZ).date()
    month_start = _month_start(today)
    prev_start = _prev_month_start(today)
    prev_end = month_start - timedelta(days=1)
    month_start_iso = f"{month_start.isoformat()}T00:00:00"
    month_end_iso = (
        datetime.combine(today + timedelta(days=1), time(0, 0), tzinfo=_CLINIC_TZ)
        .astimezone(timezone.utc)
        .isoformat()
    )

    stats = _empty_clinic_stats()
    try:
        p_resp = (
            supabase.table("patients")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        stats["patient_count"] = int(getattr(p_resp, "count", None) or 0)
        if stats["patient_count"] == 0 and p_resp.data:
            stats["patient_count"] = len(p_resp.data)
    except Exception as e:
        print(f"[clinics_dashboard] patient_count error {clinic_id}: {e}")

    try:
        a_resp = (
            supabase.table("appointments")
            .select("id, status, start_time")
            .eq("clinic_id", clinic_id)
            .gte("start_time", month_start_iso)
            .lt("start_time", month_end_iso)
            .execute()
        )
        appts = a_resp.data or []
        stats["appointments_mtd"] = len(appts)
        total_appts = len(appts)
        no_shows = sum(
            1 for a in appts if str(a.get("status") or "").lower() == "no_show"
        )
        stats["no_show_rate_pct"] = (
            round(no_shows / total_appts * 100) if total_appts > 0 else 0
        )
    except Exception as e:
        print(f"[clinics_dashboard] appointments error {clinic_id}: {e}")

    record_ids: list[str] = []
    billed_cents = 0
    paid_cents = 0
    try:
        br_resp = (
            supabase.table("billing_records")
            .select("id, total_billed_cents, amount_paid_cents, date_of_service")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        for r in br_resp.data or []:
            if not isinstance(r, dict):
                continue
            dos = _parse_date(r.get("date_of_service"))
            if dos and month_start <= dos <= today:
                billed_cents += _int_cents(r.get("total_billed_cents"))
                paid_cents += _int_cents(r.get("amount_paid_cents"))
            rid = str(r.get("id") or "")
            if rid:
                record_ids.append(rid)
        stats["collection_rate_pct"] = (
            round(paid_cents / billed_cents * 100) if billed_cents > 0 else 0
        )
    except Exception as e:
        print(f"[clinics_dashboard] billing_records error {clinic_id}: {e}")

    daily: dict[str, float] = {}
    try:
        collected, daily = _sum_billing_payments(
            clinic_id, month_start, today, record_ids=record_ids
        )
        stats["collected_mtd"] = collected
    except Exception as e:
        print(f"[clinics_dashboard] billing_payments error {clinic_id}: {e}")

    trend = []
    cursor = month_start
    while cursor <= today:
        trend.append(
            {
                "date": _format_short_date(cursor),
                "amount": round(daily.get(cursor.isoformat(), 0), 2),
            }
        )
        cursor += timedelta(days=1)
    stats["collections_trend"] = trend

    try:
        v_resp = (
            supabase.table("voice_interaction_logs")
            .select("success_flag")
            .eq("clinic_id", clinic_id)
            .gte("created_at", month_start_iso)
            .execute()
        )
        voice = v_resp.data or []
        if voice:
            successes = sum(1 for v in voice if v.get("success_flag") is True)
            stats["agent_success_rate_pct"] = round(successes / len(voice) * 100)
    except Exception as e:
        print(f"[clinics_dashboard] voice stats error {clinic_id}: {e}")

    return stats


def _aggregate_dashboard_stats() -> dict[str, Any]:
    today = datetime.now(_CLINIC_TZ).date()
    month_start = _month_start(today)
    prev_start = _prev_month_start(today)
    prev_end = month_start - timedelta(days=1)
    month_start_iso = f"{month_start.isoformat()}T00:00:00"
    month_end_iso = (
        datetime.combine(today + timedelta(days=1), time(0, 0), tzinfo=_CLINIC_TZ)
        .astimezone(timezone.utc)
        .isoformat()
    )
    prev_start_iso = f"{prev_start.isoformat()}T00:00:00"
    prev_end_iso = f"{month_start.isoformat()}T00:00:00"

    total_clinics = 0
    active_clinics = 0
    inactive_clinics = 0
    all_clinic_ids: list[str] = []
    try:
        c_resp = supabase.table("clinics").select("*").execute()
        clinics = [c for c in (c_resp.data or []) if isinstance(c, dict)]
        total_clinics = len(clinics)
        for c in clinics:
            cid = str(c.get("id") or "")
            if cid:
                all_clinic_ids.append(cid)
            st = str(c.get("status") or "active").lower()
            if st == "inactive":
                inactive_clinics += 1
            else:
                active_clinics += 1
    except Exception as e:
        print(f"[clinics_dashboard] clinics count error: {e}")

    total_patients = 0
    patients_last_month = 0
    try:
        p_resp = supabase.table("patients").select("id, created_at").execute()
        for p in p_resp.data or []:
            if not isinstance(p, dict):
                continue
            total_patients += 1
            created = _parse_date(str(p.get("created_at") or "")[:10])
            if created and prev_start <= created <= prev_end:
                patients_last_month += 1
        patients_this_month_new = 0
        for p in p_resp.data or []:
            if not isinstance(p, dict):
                continue
            created = _parse_date(str(p.get("created_at") or "")[:10])
            if created and month_start <= created <= today:
                patients_this_month_new += 1
        patients_vs = _pct_change(patients_this_month_new, patients_last_month)
    except Exception as e:
        print(f"[clinics_dashboard] patients aggregate error: {e}")
        patients_vs = 0

    appointments_mtd = 0
    appointments_last_month = 0
    try:
        a_resp = (
            supabase.table("appointments")
            .select("id, start_time")
            .execute()
        )
        for a in a_resp.data or []:
            if not isinstance(a, dict):
                continue
            st = _parse_date(str(a.get("start_time") or "")[:10])
            if st and month_start <= st <= today:
                appointments_mtd += 1
            elif st and prev_start <= st <= prev_end:
                appointments_last_month += 1
        appointments_vs = _pct_change(appointments_mtd, appointments_last_month)
    except Exception as e:
        print(f"[clinics_dashboard] appointments aggregate error: {e}")
        appointments_vs = 0

    collected_mtd = 0.0
    collected_last_month = 0.0
    collection_rates: list[int] = []
    try:
        for cid in all_clinic_ids:
            live = _clinic_live_stats(cid)
            collected_mtd += live["collected_mtd"]
            if live["collection_rate_pct"] > 0:
                collection_rates.append(live["collection_rate_pct"])

        for cid in all_clinic_ids:
            record_ids = _record_ids_for_clinic(cid)
            prev_collected, _ = _sum_billing_payments(
                cid,
                month_start,
                today,
                record_ids=record_ids,
                range_start=prev_start,
                range_end=prev_end,
            )
            collected_last_month += prev_collected
        collected_vs = _pct_change_float(collected_mtd, collected_last_month)
    except Exception as e:
        print(f"[clinics_dashboard] collections aggregate error: {e}")
        collected_vs = 0

    avg_collection = (
        round(sum(collection_rates) / len(collection_rates))
        if collection_rates
        else 0
    )

    return {
        "total_clinics": total_clinics,
        "active_clinics": active_clinics,
        "inactive_clinics": inactive_clinics,
        "total_patients": total_patients,
        "patients_vs_last_month": patients_vs,
        "appointments_mtd": appointments_mtd,
        "appointments_vs_last_month": appointments_vs,
        "collected_mtd": round(collected_mtd, 2),
        "collected_vs_last_month": collected_vs,
        "avg_collection_rate_pct": avg_collection,
    }


def _matches_search(row: dict[str, Any], search: str) -> bool:
    q = search.strip().lower()
    if not q:
        return True
    hay = " ".join(
        [
            str(row.get("name") or ""),
            str(row.get("brand_name") or ""),
            str(row.get("location_city") or ""),
            str(row.get("location_state") or ""),
            str(row.get("address") or ""),
        ]
    ).lower()
    return q in hay


@router.get("/clinics/dashboard-stats")
def get_clinics_dashboard_stats(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    super_admin_clinic_id: Optional[str] = Query(default=None),
):
    _require_super_admin(authorization)
    _ = super_admin_clinic_id
    try:
        return _aggregate_dashboard_stats()
    except Exception as e:
        print(f"[clinics_dashboard] dashboard-stats error: {e}")
        return {
            "total_clinics": 0,
            "active_clinics": 0,
            "inactive_clinics": 0,
            "total_patients": 0,
            "patients_vs_last_month": 0,
            "appointments_mtd": 0,
            "appointments_vs_last_month": 0,
            "collected_mtd": 0,
            "collected_vs_last_month": 0,
            "avg_collection_rate_pct": 0,
        }


@router.get("/clinics/cards")
def get_clinic_cards(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    clinic_ids: Optional[list[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    billing_model: Optional[str] = Query(default=None),
):
    _require_super_admin(authorization)
    try:
        resp = supabase.table("clinics").select("*").execute()
        clinics = resp.data or []
        st_resp = (
            supabase.table("clinic_settings")
            .select("clinic_id, billing_model")
            .execute()
        )
        settings_map: dict[str, Any] = {}
        for r in st_resp.data or []:
            if isinstance(r, dict) and r.get("clinic_id"):
                settings_map[str(r["clinic_id"])] = r.get("billing_model")
    except Exception as e:
        print(f"[clinics_dashboard] cards fetch error: {e}")
        return []

    id_filter = {x.strip() for x in (clinic_ids or []) if x and x.strip()}
    status_f = (status or "").strip().lower()
    billing_f = (billing_model or "").strip().lower()

    out: list[dict[str, Any]] = []
    for row in clinics:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("id") or "")
        if id_filter and cid not in id_filter:
            continue
        if not _matches_search(row, search or ""):
            continue
        st = str(row.get("status") or "active").lower()
        if status_f and status_f != "all" and st != status_f:
            continue
        bm = _billing_model_for_clinic(row, settings_map)
        if billing_f and billing_f != "all" and bm != billing_f:
            continue

        live = _clinic_live_stats(cid)
        display_name = (
            str(row.get("name") or "").strip()
            or str(row.get("brand_name") or "").strip()
            or "Clinic"
        )
        out.append(
            {
                "id": cid,
                "name": display_name,
                "brand_name": row.get("brand_name"),
                "slug": row.get("slug"),
                "address": _clinic_address(row),
                "location_city": row.get("location_city"),
                "location_state": row.get("location_state"),
                "status": st,
                "billing_model": bm,
                "agent_name": str(row.get("agent_name") or "Aria"),
                "agent_status": str(row.get("agent_status") or "online").lower(),
                "elevenlabs_agent_id": row.get("elevenlabs_agent_id"),
                "logo_url": row.get("logo_url"),
                "primary_color": row.get("primary_color") or "#16a34a",
                "patient_count": live["patient_count"],
                "appointments_mtd": live["appointments_mtd"],
                "collected_mtd": live["collected_mtd"],
                "collection_rate_pct": live["collection_rate_pct"],
                "no_show_rate_pct": live["no_show_rate_pct"],
                "agent_success_rate_pct": live["agent_success_rate_pct"],
                "collections_trend": live["collections_trend"],
            }
        )
    return out
