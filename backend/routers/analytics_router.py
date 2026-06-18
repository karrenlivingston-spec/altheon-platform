"""Multi-clinic analytics API — platform_admin and super_admin only."""

from __future__ import annotations

import traceback
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

import fitz  # PyMuPDF
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.db import supabase
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()

_NY = ZoneInfo("America/New_York")
_PLATFORM_ADMIN_ROLES = frozenset({"super_admin", "platform_admin"})

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 42.0
CONTENT_W = PAGE_W - 2 * MARGIN
TEAL = (13 / 255, 148 / 255, 136 / 255)
DARK = (0.13, 0.16, 0.18)
GRAY = (0.45, 0.5, 0.53)
LIGHT_ROW = (0.96, 0.97, 0.97)
LINE = (0.8, 0.84, 0.85)
FONT = "helv"
FONT_B = "hebo"


def _eastern_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(_NY)


def _eastern_today() -> date:
    return _eastern_now().date()


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip().replace("Z", "+00:00")
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_NY)


def _eastern_ymd(value: Any) -> Optional[str]:
    dt = _parse_dt(value)
    return dt.strftime("%Y-%m-%d") if dt else None


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _prev_month_start(d: date) -> date:
    if d.month == 1:
        return date(d.year - 1, 12, 1)
    return date(d.year, d.month - 1, 1)


def _quarter_start(d: date) -> date:
    q_month = ((d.month - 1) // 3) * 3 + 1
    return date(d.year, q_month, 1)


def _year_start(d: date) -> date:
    return date(d.year, 1, 1)


def _in_month(value: Any, month_start: date) -> bool:
    ymd = _eastern_ymd(value)
    if not ymd:
        return False
    try:
        d = date.fromisoformat(ymd)
    except ValueError:
        return False
    return d.year == month_start.year and d.month == month_start.month


def _float_amount(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _round1(value: float) -> float:
    return round(value, 1)


def _business_days_elapsed(month_start: date, today: date) -> int:
    count = 0
    cursor = month_start
    while cursor <= today:
        if cursor.weekday() < 5:
            count += 1
        cursor += timedelta(days=1)
    return max(count, 1)


def _pct_change(this: float | int, last: float | int) -> float:
    if last <= 0:
        return 100.0 if this > 0 else 0.0
    return round((float(this) - float(last)) / float(last) * 100, 1)


def _require_platform_analytics_admin(
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
            detail="Platform analytics requires super_admin or platform_admin",
        )


def _empty_totals() -> dict[str, Any]:
    return {
        "total_patients": 0,
        "appointments_this_month": 0,
        "appointments_last_month": 0,
        "revenue_this_month": 0.0,
        "revenue_last_month": 0.0,
        "collection_rate": 0.0,
        "active_clinicians": 0,
    }


def _sum_totals(clinics: list[dict[str, Any]]) -> dict[str, Any]:
    totals = _empty_totals()
    paid_total = 0
    claims_total = 0
    for c in clinics:
        totals["total_patients"] += int(c.get("total_patients") or 0)
        totals["appointments_this_month"] += int(c.get("appointments_this_month") or 0)
        totals["appointments_last_month"] += int(c.get("appointments_last_month") or 0)
        totals["revenue_this_month"] += _float_amount(c.get("revenue_this_month"))
        totals["revenue_last_month"] += _float_amount(c.get("revenue_last_month"))
        totals["active_clinicians"] += int(c.get("active_clinicians") or 0)
        paid_total += int(c.get("_claims_paid") or 0)
        claims_total += int(c.get("_total_claims") or 0)

    totals["revenue_this_month"] = round(totals["revenue_this_month"], 2)
    totals["revenue_last_month"] = round(totals["revenue_last_month"], 2)
    totals["collection_rate"] = (
        _round1(paid_total / claims_total * 100) if claims_total > 0 else 0.0
    )
    return totals


def _clinic_is_active(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or row.get("is_active") or "active").strip().lower()
    if status in ("inactive", "false", "0", "disabled"):
        return False
    if status in ("active", "true", "1"):
        return True
    return bool(row.get("is_active", True))


def _clinic_display_name(row: dict[str, Any]) -> str:
    for key in ("name", "brand_name"):
        val = str(row.get(key) or "").strip()
        if val:
            return val
    return "Clinic"


def _aggregate_clinic_metrics(
    clinic_row: dict[str, Any],
    *,
    patients_by_clinic: dict[str, set[str]],
    appts_by_clinic: dict[str, list[str]],
    claims_by_clinic: dict[str, list[dict[str, Any]]],
    active_clinicians_by_clinic: dict[str, int],
    this_month: date,
    last_month: date,
) -> dict[str, Any]:
    cid = str(clinic_row.get("id") or "").strip()
    patients = patients_by_clinic.get(cid, set())
    appt_dates = appts_by_clinic.get(cid, [])
    claims = claims_by_clinic.get(cid, [])

    appts_this = sum(1 for ymd in appt_dates if _in_month(ymd, this_month))
    appts_last = sum(1 for ymd in appt_dates if _in_month(ymd, last_month))

    rev_this = 0.0
    rev_last = 0.0
    total_claims = 0
    claims_paid = 0
    for claim in claims:
        status = str(claim.get("status") or "").strip().lower()
        if status == "void":
            continue
        total_claims += 1
        if status == "paid":
            claims_paid += 1
        created = claim.get("created_at")
        amount = _float_amount(claim.get("total_amount"))
        if _in_month(created, this_month):
            rev_this += amount
        elif _in_month(created, last_month):
            rev_last += amount

    collection_rate = (
        _round1(claims_paid / total_claims * 100) if total_claims > 0 else 0.0
    )

    return {
        "id": cid,
        "name": _clinic_display_name(clinic_row),
        "is_active": _clinic_is_active(clinic_row),
        "total_patients": len(patients),
        "appointments_this_month": appts_this,
        "appointments_last_month": appts_last,
        "revenue_this_month": round(rev_this, 2),
        "revenue_last_month": round(rev_last, 2),
        "collection_rate": collection_rate,
        "active_clinicians": int(active_clinicians_by_clinic.get(cid, 0)),
        "_claims_paid": claims_paid,
        "_total_claims": total_claims,
    }


def _load_source_maps() -> tuple[
    date,
    date,
    list[dict[str, Any]],
    dict[str, set[str]],
    dict[str, list[str]],
    dict[str, list[dict[str, Any]]],
    dict[str, int],
]:
    today = _eastern_today()
    this_month = _month_start(today)
    last_month = _prev_month_start(today)

    clinics_resp = (
        supabase.table("clinics")
        .select("id,name,brand_name,status")
        .order("name")
        .execute()
    )
    clinic_rows = [
        r for r in (clinics_resp.data or []) if isinstance(r, dict) and r.get("id")
    ]

    patients_by_clinic: dict[str, set[str]] = {}
    try:
        p_resp = supabase.table("patients").select("id,clinic_id").execute()
        for row in p_resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("clinic_id") or "").strip()
            pid = str(row.get("id") or "").strip()
            if cid and pid:
                patients_by_clinic.setdefault(cid, set()).add(pid)
    except Exception:
        traceback.print_exc()

    appts_by_clinic: dict[str, list[str]] = {}
    try:
        a_resp = (
            supabase.table("appointments")
            .select("clinic_id,start_time")
            .execute()
        )
        for row in a_resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("clinic_id") or "").strip()
            ymd = _eastern_ymd(row.get("start_time"))
            if cid and ymd:
                appts_by_clinic.setdefault(cid, []).append(ymd)
    except Exception:
        traceback.print_exc()

    claims_by_clinic: dict[str, list[dict[str, Any]]] = {}
    try:
        c_resp = (
            supabase.table("insurance_claims")
            .select("clinic_id,total_amount,status,created_at")
            .execute()
        )
        for row in c_resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("clinic_id") or "").strip()
            if cid:
                claims_by_clinic.setdefault(cid, []).append(row)
    except Exception:
        traceback.print_exc()

    active_clinicians_by_clinic: dict[str, int] = {}
    try:
        cl_resp = (
            supabase.table("clinicians")
            .select("clinic_id,is_active")
            .eq("is_active", True)
            .execute()
        )
        for row in cl_resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("clinic_id") or "").strip()
            if cid:
                active_clinicians_by_clinic[cid] = (
                    active_clinicians_by_clinic.get(cid, 0) + 1
                )
    except Exception:
        traceback.print_exc()

    return (
        this_month,
        last_month,
        clinic_rows,
        patients_by_clinic,
        appts_by_clinic,
        claims_by_clinic,
        active_clinicians_by_clinic,
    )


def _build_clinic_metrics(
    clinic_rows: list[dict[str, Any]],
    *,
    patients_by_clinic: dict[str, set[str]],
    appts_by_clinic: dict[str, list[str]],
    claims_by_clinic: dict[str, list[dict[str, Any]]],
    active_clinicians_by_clinic: dict[str, int],
    this_month: date,
    last_month: date,
) -> list[dict[str, Any]]:
    return [
        _aggregate_clinic_metrics(
            row,
            patients_by_clinic=patients_by_clinic,
            appts_by_clinic=appts_by_clinic,
            claims_by_clinic=claims_by_clinic,
            active_clinicians_by_clinic=active_clinicians_by_clinic,
            this_month=this_month,
            last_month=last_month,
        )
        for row in clinic_rows
    ]


def _public_clinic_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out.pop("_claims_paid", None)
    out.pop("_total_claims", None)
    return out


def _load_overview_data() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    (
        this_month,
        last_month,
        clinic_rows,
        patients_by_clinic,
        appts_by_clinic,
        claims_by_clinic,
        active_clinicians_by_clinic,
    ) = _load_source_maps()
    metrics = _build_clinic_metrics(
        clinic_rows,
        patients_by_clinic=patients_by_clinic,
        appts_by_clinic=appts_by_clinic,
        claims_by_clinic=claims_by_clinic,
        active_clinicians_by_clinic=active_clinicians_by_clinic,
        this_month=this_month,
        last_month=last_month,
    )
    clinics_out = [_public_clinic_row(row) for row in metrics]
    totals = _sum_totals(metrics)
    return clinics_out, totals


def _period_range(period: str) -> tuple[date, date]:
    today = _eastern_today()
    p = (period or "month").strip().lower()
    if p == "week":
        start = today - timedelta(days=6)
    elif p == "quarter":
        start = _quarter_start(today)
    elif p == "year":
        start = _year_start(today)
    else:
        start = _month_start(today)
    return start, today


def _period_label(period: str) -> str:
    start, end = _period_range(period)
    return f"{start.strftime('%b %d, %Y')} – {end.strftime('%b %d, %Y')}"


def _load_clinic_trend(clinic_id: str, period: str) -> list[dict[str, Any]]:
    start, end = _period_range(period)
    appt_counts: dict[str, int] = {}
    revenue_by_day: dict[str, float] = {}

    try:
        appt_resp = (
            supabase.table("appointments")
            .select("start_time")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        for row in appt_resp.data or []:
            if not isinstance(row, dict):
                continue
            ymd = _eastern_ymd(row.get("start_time"))
            if not ymd:
                continue
            try:
                d = date.fromisoformat(ymd)
            except ValueError:
                continue
            if start <= d <= end:
                appt_counts[ymd] = appt_counts.get(ymd, 0) + 1
    except Exception:
        traceback.print_exc()

    try:
        claim_resp = (
            supabase.table("insurance_claims")
            .select("total_amount,status,created_at")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        for row in claim_resp.data or []:
            if not isinstance(row, dict):
                continue
            if str(row.get("status") or "").strip().lower() == "void":
                continue
            ymd = _eastern_ymd(row.get("created_at"))
            if not ymd:
                continue
            try:
                d = date.fromisoformat(ymd)
            except ValueError:
                continue
            if start <= d <= end:
                revenue_by_day[ymd] = revenue_by_day.get(ymd, 0.0) + _float_amount(
                    row.get("total_amount")
                )
    except Exception:
        traceback.print_exc()

    out: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        out.append(
            {
                "date": key,
                "appointments": int(appt_counts.get(key, 0)),
                "revenue": round(revenue_by_day.get(key, 0.0), 2),
            }
        )
        cursor += timedelta(days=1)
    return out


def _clinician_name(row: dict[str, Any]) -> str:
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    name = f"{fn} {ln}".strip()
    return name or "Unknown"


def _clinician_display_name(row: dict[str, Any]) -> str:
    name = _clinician_name(row)
    if name == "Unknown":
        return name
    title = str(row.get("title") or "").strip().upper()
    if title in ("DC", "MD", "DO", "DPT", "PT"):
        return f"Dr. {name}"
    return name


def _next_month_start(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _current_month_utc_bounds() -> tuple[str, str]:
    today = _eastern_today()
    month_start = _month_start(today)
    next_month = _next_month_start(today)
    start_utc = (
        datetime.combine(month_start, time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    end_utc = (
        datetime.combine(next_month, time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    return start_utc, end_utc


def _days_elapsed_this_month() -> int:
    today = _eastern_today()
    return max((today - _month_start(today)).days + 1, 1)


def _period_utc_bounds(start: date, end: date) -> tuple[str, str]:
    start_utc = (
        datetime.combine(start, time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    end_utc = (
        datetime.combine(end + timedelta(days=1), time(0, 0), tzinfo=_NY)
        .astimezone(timezone.utc)
        .isoformat()
    )
    return start_utc, end_utc


def _clinicians_trend_period_range(period: str) -> tuple[date, date]:
    today = _eastern_today()
    p = (period or "month").strip().lower()
    if p == "week":
        start = today - timedelta(days=6)
    elif p == "quarter":
        start = today - timedelta(days=89)
    elif p == "year":
        start = today - timedelta(days=364)
    else:
        start = _month_start(today)
    return start, today


def _safe_supabase_count(build_query) -> int:
    try:
        resp = build_query().limit(1).execute()
        return int(getattr(resp, "count", None) or 0)
    except Exception:
        traceback.print_exc()
        return 0


def _clinician_productivity_row(
    clinic_id: str,
    row: dict[str, Any],
    *,
    month_start_iso: str,
    month_end_iso: str,
    days_elapsed: int,
) -> dict[str, Any]:
    clinician_id = str(row.get("id") or "").strip()
    appointments_this_month = 0
    completed_this_month = 0
    notes_this_month = 0
    notes_signed_this_month = 0

    if clinician_id:
        appointments_this_month = _safe_supabase_count(
            lambda: supabase.table("appointments")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .gte("start_time", month_start_iso)
            .lt("start_time", month_end_iso)
        )
        completed_this_month = _safe_supabase_count(
            lambda: supabase.table("appointments")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .eq("status", "completed")
            .gte("start_time", month_start_iso)
            .lt("start_time", month_end_iso)
        )
        notes_this_month = _safe_supabase_count(
            lambda: supabase.table("clinical_notes")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .gte("created_at", month_start_iso)
        )
        notes_signed_this_month = _safe_supabase_count(
            lambda: supabase.table("clinical_notes")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .eq("clinician_id", clinician_id)
            .gte("created_at", month_start_iso)
            .not_.is_("signed_at", "null")
        )

    completion_rate = (
        _round1(completed_this_month / appointments_this_month * 100)
        if appointments_this_month > 0
        else 0.0
    )
    notes_signed_pct = (
        _round1(notes_signed_this_month / notes_this_month * 100)
        if notes_this_month > 0
        else 0.0
    )
    avg_appts_per_day = _round1(appointments_this_month / days_elapsed)

    return {
        "clinician_id": clinician_id,
        "first_name": str(row.get("first_name") or "").strip(),
        "last_name": str(row.get("last_name") or "").strip(),
        "title": str(row.get("title") or "").strip() or None,
        "appointments_this_month": appointments_this_month,
        "completed_this_month": completed_this_month,
        "completion_rate": completion_rate,
        "notes_this_month": notes_this_month,
        "notes_signed_this_month": notes_signed_this_month,
        "notes_signed_pct": notes_signed_pct,
        "avg_appts_per_day": avg_appts_per_day,
    }


def _load_clinic_clinicians(clinic_id: str) -> list[dict[str, Any]]:
    try:
        month_start_iso, month_end_iso = _current_month_utc_bounds()
        days_elapsed = _days_elapsed_this_month()

        cl_resp = (
            supabase.table("clinicians")
            .select("id,first_name,last_name,title")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .execute()
        )
        clinicians = [r for r in (cl_resp.data or []) if isinstance(r, dict)]

        out: list[dict[str, Any]] = []
        for row in clinicians:
            if not str(row.get("id") or "").strip():
                continue
            out.append(
                _clinician_productivity_row(
                    clinic_id,
                    row,
                    month_start_iso=month_start_iso,
                    month_end_iso=month_end_iso,
                    days_elapsed=days_elapsed,
                )
            )

        out.sort(
            key=lambda r: (
                -int(r.get("appointments_this_month") or 0),
                str(r.get("last_name") or ""),
                str(r.get("first_name") or ""),
            )
        )
        return out
    except Exception:
        traceback.print_exc()
        return []


def _load_clinic_clinicians_trend(clinic_id: str, period: str) -> dict[str, Any]:
    p = (period or "month").strip().lower()
    if p not in ("week", "month", "quarter", "year"):
        p = "month"
    try:
        start, end = _clinicians_trend_period_range(p)
        start_utc, end_utc = _period_utc_bounds(start, end)

        cl_resp = (
            supabase.table("clinicians")
            .select("id,first_name,last_name,title")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .execute()
        )
        clinicians = [r for r in (cl_resp.data or []) if isinstance(r, dict)]

        appt_resp = (
            supabase.table("appointments")
            .select("clinician_id,start_time")
            .eq("clinic_id", clinic_id)
            .gte("start_time", start_utc)
            .lt("start_time", end_utc)
            .execute()
        )

        counts: dict[tuple[str, str], int] = {}
        for row in appt_resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("clinician_id") or "").strip()
            ymd = _eastern_ymd(row.get("start_time"))
            if not cid or not ymd:
                continue
            try:
                d = date.fromisoformat(ymd)
            except ValueError:
                continue
            if start <= d <= end:
                key = (cid, ymd)
                counts[key] = counts.get(key, 0) + 1

        clinicians_out: list[dict[str, Any]] = []
        for row in clinicians:
            cid = str(row.get("id") or "").strip()
            if not cid:
                continue
            daily: list[dict[str, Any]] = []
            cursor = start
            while cursor <= end:
                key = cursor.isoformat()
                daily.append(
                    {
                        "date": key,
                        "count": counts.get((cid, key), 0),
                    }
                )
                cursor += timedelta(days=1)
            clinicians_out.append(
                {
                    "clinician_id": cid,
                    "name": _clinician_display_name(row),
                    "daily": daily,
                }
            )

        clinicians_out.sort(key=lambda r: str(r.get("name") or ""))
        return {"period": p, "clinicians": clinicians_out}
    except Exception:
        traceback.print_exc()
        return {"period": p, "clinicians": []}


def _fmt_money(value: Any) -> str:
    return f"${_float_amount(value):,.2f}"


def _draw_header_band(page: fitz.Page, title: str, subtitle: str = "") -> float:
    page.draw_rect(fitz.Rect(0, 0, PAGE_W, 96), color=TEAL, fill=TEAL)
    page.insert_text(
        fitz.Point(MARGIN, 42),
        title,
        fontsize=20,
        fontname=FONT_B,
        color=(1, 1, 1),
    )
    if subtitle:
        page.insert_text(
            fitz.Point(MARGIN, 68),
            subtitle,
            fontsize=11,
            fontname=FONT,
            color=(1, 1, 1),
        )
    return 112.0


def _draw_table(
    page: fitz.Page,
    y: float,
    headers: list[str],
    rows: list[list[str]],
    *,
    col_widths: Optional[list[float]] = None,
) -> float:
    n_cols = len(headers)
    if col_widths is None:
        col_widths = [CONTENT_W / n_cols] * n_cols

    row_h = 22.0
    x0 = MARGIN

    page.draw_rect(
        fitz.Rect(x0, y, x0 + CONTENT_W, y + row_h),
        color=TEAL,
        fill=TEAL,
    )
    x = x0
    for i, header in enumerate(headers):
        page.insert_text(
            fitz.Point(x + 4, y + 15),
            header,
            fontsize=9,
            fontname=FONT_B,
            color=(1, 1, 1),
        )
        x += col_widths[i]

    y += row_h
    for row_idx, row in enumerate(rows):
        fill = LIGHT_ROW if row_idx % 2 == 0 else (1, 1, 1)
        page.draw_rect(
            fitz.Rect(x0, y, x0 + CONTENT_W, y + row_h),
            color=LINE,
            fill=fill,
        )
        x = x0
        for i, cell in enumerate(row):
            page.insert_text(
                fitz.Point(x + 4, y + 15),
                str(cell),
                fontsize=9,
                fontname=FONT,
                color=DARK,
            )
            x += col_widths[i]
        y += row_h
    return y + 12


def _build_analytics_pdf(
    clinics: list[dict[str, Any]],
    totals: dict[str, Any],
    *,
    period: str,
) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    generated = _eastern_now().strftime("%B %d, %Y")
    y = _draw_header_band(
        page,
        "Altheon Platform Analytics Report",
        _period_label(period),
    )
    page.insert_text(
        fitz.Point(MARGIN, y),
        f"Generated {generated}",
        fontsize=10,
        fontname=FONT,
        color=GRAY,
    )
    page.insert_text(
        fitz.Point(MARGIN, y + 18),
        "Altheon",
        fontsize=10,
        fontname=FONT_B,
        color=DARK,
    )

    headers = [
        "Patients",
        "Appts Mo",
        "Appts Last",
        "MoM %",
        "Rev Mo",
        "Rev Last",
        "Coll %",
        "Clinicians",
    ]
    col_widths = [
        CONTENT_W * 0.11,
        CONTENT_W * 0.11,
        CONTENT_W * 0.12,
        CONTENT_W * 0.09,
        CONTENT_W * 0.14,
        CONTENT_W * 0.14,
        CONTENT_W * 0.10,
        CONTENT_W * 0.19,
    ]

    for clinic in clinics:
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        y = _draw_header_band(page, str(clinic.get("name") or "Clinic"))
        mom = _pct_change(
            int(clinic.get("appointments_this_month") or 0),
            int(clinic.get("appointments_last_month") or 0),
        )
        row = [
            str(clinic.get("total_patients") or 0),
            str(clinic.get("appointments_this_month") or 0),
            str(clinic.get("appointments_last_month") or 0),
            f"{mom:+.1f}%",
            _fmt_money(clinic.get("revenue_this_month")),
            _fmt_money(clinic.get("revenue_last_month")),
            f"{_float_amount(clinic.get('collection_rate')):.1f}%",
            str(clinic.get("active_clinicians") or 0),
        ]
        y = _draw_table(page, y, headers, [row], col_widths=col_widths)
        page.insert_text(
            fitz.Point(MARGIN, y + 8),
            f"Appointment MoM change: {mom:+.1f}%",
            fontsize=9,
            fontname=FONT,
            color=GRAY,
        )

    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    y = _draw_header_band(page, "Platform Totals")
    totals_mom = _pct_change(
        int(totals.get("appointments_this_month") or 0),
        int(totals.get("appointments_last_month") or 0),
    )
    totals_row = [
        str(totals.get("total_patients") or 0),
        str(totals.get("appointments_this_month") or 0),
        str(totals.get("appointments_last_month") or 0),
        f"{totals_mom:+.1f}%",
        _fmt_money(totals.get("revenue_this_month")),
        _fmt_money(totals.get("revenue_last_month")),
        f"{_float_amount(totals.get('collection_rate')):.1f}%",
        str(totals.get("active_clinicians") or 0),
    ]
    _draw_table(page, y, headers, [totals_row], col_widths=col_widths)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


class AnalyticsPdfRequest(BaseModel):
    clinic_ids: list[str] = Field(default_factory=list)
    period: str = "month"


@router.get("/overview")
def analytics_overview(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_analytics_admin(authorization)
    try:
        clinics, totals = _load_overview_data()
        return {"clinics": clinics, "totals": totals}
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return {"clinics": [], "totals": _empty_totals()}


@router.get("/clinic/{clinic_id}/trend")
def analytics_clinic_trend(
    clinic_id: str,
    period: Literal["week", "month", "quarter", "year"] = Query(default="month"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_analytics_admin(authorization)
    try:
        return _load_clinic_trend(clinic_id, period)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []


@router.get("/clinic/{clinic_id}/clinicians/trend")
def analytics_clinic_clinicians_trend(
    clinic_id: str,
    period: Literal["week", "month", "quarter", "year"] = Query(default="month"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_analytics_admin(authorization)
    try:
        return _load_clinic_clinicians_trend(clinic_id, period)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return {"period": period, "clinicians": []}


@router.get("/clinic/{clinic_id}/clinicians")
def analytics_clinic_clinicians(
    clinic_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_analytics_admin(authorization)
    try:
        return _load_clinic_clinicians(clinic_id)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []


@router.post("/report/pdf")
def analytics_report_pdf(
    body: AnalyticsPdfRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_platform_analytics_admin(authorization)
    try:
        (
            this_month,
            last_month,
            clinic_rows,
            patients_by_clinic,
            appts_by_clinic,
            claims_by_clinic,
            active_clinicians_by_clinic,
        ) = _load_source_maps()
        metrics = _build_clinic_metrics(
            clinic_rows,
            patients_by_clinic=patients_by_clinic,
            appts_by_clinic=appts_by_clinic,
            claims_by_clinic=claims_by_clinic,
            active_clinicians_by_clinic=active_clinicians_by_clinic,
            this_month=this_month,
            last_month=last_month,
        )

        selected_ids = {cid.strip() for cid in body.clinic_ids if cid and cid.strip()}
        if selected_ids:
            metrics = [m for m in metrics if str(m.get("id") or "") in selected_ids]

        clinics = [_public_clinic_row(row) for row in metrics]
        totals = _sum_totals(metrics)
        pdf_bytes = _build_analytics_pdf(clinics, totals, period=body.period or "month")
        filename = f"altheon_analytics_{_eastern_today().isoformat()}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate analytics PDF", "detail": str(exc)},
        )
