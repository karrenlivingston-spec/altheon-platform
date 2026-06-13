"""Patient groups dashboard API (mounted under /api/groups)."""

from __future__ import annotations

import traceback
from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.db import supabase

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_COLOR_MAP = {
    "gray": "#9CA3AF",
    "green": "#16A34A",
    "blue": "#3B82F6",
    "purple": "#8B5CF6",
    "amber": "#F59E0B",
    "red": "#EF4444",
}


def _int_cents(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _month_start_iso() -> tuple[date, str]:
    today = datetime.now(_CLINIC_TZ).date()
    month_start = today.replace(day=1)
    return month_start, f"{month_start.isoformat()}T00:00:00"


def _count_exact(resp: Any) -> int:
    count = int(getattr(resp, "count", None) or 0)
    if count == 0 and resp.data is not None:
        count = len(resp.data)
    return count


def _sum_revenue_mtd_cents(
    clinic_id: str, patient_ids: list[str], month_start: str
) -> int:
    if not patient_ids:
        return 0
    try:
        br_resp = (
            supabase.table("billing_records")
            .select("id")
            .eq("clinic_id", clinic_id)
            .in_("patient_id", patient_ids)
            .execute()
        )
        record_ids = [
            str(r["id"]) for r in (br_resp.data or []) if isinstance(r, dict) and r.get("id")
        ]
        if not record_ids:
            return 0
        pay_resp = (
            supabase.table("billing_payments")
            .select("amount_cents")
            .in_("billing_record_id", record_ids)
            .gte("payment_date", month_start)
            .execute()
        )
        return sum(
            _int_cents(r.get("amount_cents"))
            for r in (pay_resp.data or [])
            if isinstance(r, dict)
        )
    except Exception:
        return 0


def _count_appts_mtd(
    clinic_id: str, patient_ids: list[str], month_start_iso: str
) -> int:
    if not patient_ids:
        return 0
    try:
        appts_res = (
            supabase.table("appointments")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .in_("patient_id", patient_ids)
            .gte("start_time", month_start_iso)
            .limit(1)
            .execute()
        )
        return _count_exact(appts_res)
    except Exception:
        return 0


def _empty_stats() -> dict[str, Any]:
    return {
        "total_patients": 0,
        "active_groups": 0,
        "total_groups": 0,
        "appointments_mtd": 0,
        "revenue_mtd_cents": 0,
    }


async def _fetch_group_cards(clinic_id: str) -> list[dict[str, Any]]:
    month_start, month_start_iso = _month_start_iso()

    groups_res = (
        supabase.table("groups")
        .select("id, name, description, color, priority_flag, is_active")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    groups = groups_res.data or []

    result = []
    for g in groups:
        if not isinstance(g, dict):
            continue
        members_res = (
            supabase.table("patient_group_memberships")
            .select("patient_id")
            .eq("group_id", g["id"])
            .execute()
        )
        patient_ids = [
            str(r["patient_id"])
            for r in (members_res.data or [])
            if isinstance(r, dict) and r.get("patient_id")
        ]
        patient_count = len(patient_ids)

        revenue_mtd_cents = _sum_revenue_mtd_cents(
            clinic_id, patient_ids, month_start.isoformat()
        )
        appts_mtd = _count_appts_mtd(clinic_id, patient_ids, month_start_iso)

        result.append({
            "id": g["id"],
            "name": g["name"],
            "description": g.get("description") or "",
            "color": g.get("color") or "gray",
            "priority_flag": bool(g.get("priority_flag")),
            "is_active": g.get("is_active") is not False,
            "patient_count": patient_count,
            "revenue_mtd_cents": revenue_mtd_cents,
            "appointments_mtd": appts_mtd,
        })

    return result


@router.get("/groups/stats")
async def groups_stats(clinic_id: str = Query(...)):
    try:
        groups_res = (
            supabase.table("groups")
            .select("id, is_active")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        groups = [g for g in (groups_res.data or []) if isinstance(g, dict)]
        group_ids = [g["id"] for g in groups]
        active_groups = sum(1 for g in groups if g.get("is_active") is not False)

        unique_patients: set[str] = set()
        if group_ids:
            members_res = (
                supabase.table("patient_group_memberships")
                .select("patient_id")
                .in_("group_id", group_ids)
                .execute()
            )
            unique_patients = {
                str(r["patient_id"])
                for r in (members_res.data or [])
                if isinstance(r, dict) and r.get("patient_id")
            }

        total_patients = len(unique_patients)
        month_start, month_start_iso = _month_start_iso()

        appts_mtd = 0
        revenue_mtd_cents = 0
        if group_ids and total_patients > 0:
            patient_ids = list(unique_patients)
            appts_mtd = _count_appts_mtd(clinic_id, patient_ids, month_start_iso)
            revenue_mtd_cents = _sum_revenue_mtd_cents(
                clinic_id, patient_ids, month_start.isoformat()
            )

        return {
            "total_patients": total_patients,
            "active_groups": active_groups,
            "total_groups": len(groups),
            "appointments_mtd": appts_mtd,
            "revenue_mtd_cents": revenue_mtd_cents,
        }
    except Exception:
        traceback.print_exc()
        return _empty_stats()


@router.get("/groups/cards")
async def groups_cards(clinic_id: str = Query(...)):
    try:
        return await _fetch_group_cards(clinic_id)
    except Exception:
        traceback.print_exc()
        return []


@router.get("/groups/insights")
async def groups_insights(clinic_id: str = Query(...)):
    try:
        cards = await _fetch_group_cards(clinic_id)
        if not cards:
            return {
                "top_patients": None,
                "top_appointments": None,
                "top_revenue": None,
            }

        top_patients = max(cards, key=lambda c: c["patient_count"])
        top_appointments = max(cards, key=lambda c: c["appointments_mtd"])
        top_revenue = max(cards, key=lambda c: c["revenue_mtd_cents"])

        def shape(c: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
            if not c:
                return None
            return {"name": c["name"], "value": c}

        return {
            "top_patients": shape(top_patients),
            "top_appointments": shape(top_appointments),
            "top_revenue": shape(top_revenue),
        }
    except Exception:
        traceback.print_exc()
        return {"top_patients": None, "top_appointments": None, "top_revenue": None}


@router.get("/groups/distribution")
async def groups_distribution(clinic_id: str = Query(...)):
    try:
        cards = await _fetch_group_cards(clinic_id)
        total = sum(c["patient_count"] for c in cards)
        if total == 0:
            return {"total": 0, "segments": []}

        sorted_cards = sorted(cards, key=lambda c: c["patient_count"], reverse=True)
        top = sorted_cards[:5]
        rest = sorted_cards[5:]

        segments = []
        for c in top:
            if c["patient_count"] == 0:
                continue
            segments.append({
                "name": c["name"],
                "count": c["patient_count"],
                "pct": round(c["patient_count"] / total * 100),
                "color": _COLOR_MAP.get(c.get("color", "gray"), "#9CA3AF"),
            })

        rest_count = sum(c["patient_count"] for c in rest)
        if rest_count > 0:
            segments.append({
                "name": "Other",
                "count": rest_count,
                "pct": round(rest_count / total * 100),
                "color": "#D1D5DB",
            })

        return {"total": total, "segments": segments}
    except Exception:
        traceback.print_exc()
        return {"total": 0, "segments": []}


@router.get("/groups/activity")
async def groups_activity(clinic_id: str = Query(...)):
    try:
        groups_res = (
            supabase.table("groups")
            .select("id, name, color")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        groups = {
            g["id"]: g
            for g in (groups_res.data or [])
            if isinstance(g, dict) and g.get("id")
        }
        group_ids = list(groups.keys())

        if not group_ids:
            return []

        members_res = (
            supabase.table("patient_group_memberships")
            .select(
                "group_id, patient_id, created_at, patients(first_name, last_name)"
            )
            .in_("group_id", group_ids)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )

        result = []
        for r in members_res.data or []:
            if not isinstance(r, dict):
                continue
            g = groups.get(r.get("group_id"), {})
            patient = r.get("patients") or {}
            if isinstance(patient, list):
                patient = patient[0] if patient else {}
            if not isinstance(patient, dict):
                patient = {}
            first = patient.get("first_name", "")
            last = patient.get("last_name", "")
            patient_name = f"{first} {last}".strip() or "Unknown"

            result.append({
                "group_name": g.get("name", "Unknown"),
                "group_color": g.get("color") or "gray",
                "activity": f"New patient added: {patient_name}",
                "patients_affected": 1,
                "timestamp": r.get("created_at", ""),
                "performed_by": "—",
            })

        return result
    except Exception:
        traceback.print_exc()
        return []
