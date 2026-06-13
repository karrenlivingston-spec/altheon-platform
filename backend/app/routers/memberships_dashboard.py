"""Memberships dashboard API (mounted under /api/memberships)."""

from __future__ import annotations

import calendar
import traceback
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query

from app.db import supabase

router = APIRouter()


def _empty_stats() -> dict[str, Any]:
    return {
        "active_members": 0,
        "monthly_revenue_cents": 0,
        "renewal_rate": 0,
        "visits_remaining": 0,
        "mrr_annualized_cents": 0,
    }


@router.get("/memberships/stats")
async def memberships_stats(clinic_id: str = Query(...)):
    try:
        active = (
            supabase.table("patient_memberships")
            .select("id", count="exact")
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        active_count = int(getattr(active, "count", None) or 0)
        if active_count == 0 and active.data:
            active_count = len(active.data)

        enrollments = (
            supabase.table("patient_memberships")
            .select(
                "membership_tiers!patient_memberships_tier_id_fkey(price_cents)"
            )
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )
        monthly_revenue_cents = sum(
            (r.get("membership_tiers") or {}).get("price_cents", 0)
            for r in (enrollments.data or [])
        )

        renew = (
            supabase.table("patient_memberships")
            .select("auto_renew")
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )
        renew_data = renew.data or []
        renewal_rate = round(
            (sum(1 for r in renew_data if r.get("auto_renew")) / len(renew_data) * 100)
            if renew_data
            else 0
        )

        visits = (
            supabase.table("patient_memberships")
            .select("visits_remaining")
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )
        visits_remaining = sum(
            r.get("visits_remaining", 0) for r in (visits.data or [])
        )

        mrr_annualized_cents = monthly_revenue_cents * 12

        return {
            "active_members": active_count,
            "monthly_revenue_cents": monthly_revenue_cents,
            "renewal_rate": renewal_rate,
            "visits_remaining": visits_remaining,
            "mrr_annualized_cents": mrr_annualized_cents,
        }
    except Exception:
        traceback.print_exc()
        return _empty_stats()


@router.get("/memberships/revenue-chart")
async def memberships_revenue_chart(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "created_at, membership_tiers!patient_memberships_tier_id_fkey(price_cents)"
            )
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )

        today = date.today()
        months = []
        for i in range(5, -1, -1):
            d = today.replace(day=1) - timedelta(days=i * 28)
            months.append(d.replace(day=1))

        result = []
        for m in months:
            last_day = calendar.monthrange(m.year, m.month)[1]
            month_end = m.replace(day=last_day).isoformat()
            total_cents = sum(
                (r.get("membership_tiers") or {}).get("price_cents", 0)
                for r in (rows.data or [])
                if r.get("created_at", "") <= month_end + "T23:59:59"
            )
            result.append({
                "month": m.strftime("%b '%y"),
                "revenue_cents": total_cents,
            })

        return result
    except Exception:
        traceback.print_exc()
        return [{"month": "—", "revenue_cents": 0}]


@router.get("/memberships/utilization")
async def memberships_utilization(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "visits_used, visits_remaining, "
                "membership_tiers!patient_memberships_tier_id_fkey(visits_included)"
            )
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )

        data = rows.data or []
        buckets = {"above_80": 0, "50_79": 0, "25_49": 0, "below_25": 0}
        utilizations = []

        for r in data:
            tier = r.get("membership_tiers") or {}
            included = tier.get("visits_included", 0) or 0
            used = r.get("visits_used", 0) or 0
            if included > 0:
                pct = used / included * 100
                utilizations.append(pct)
                if pct >= 80:
                    buckets["above_80"] += 1
                elif pct >= 50:
                    buckets["50_79"] += 1
                elif pct >= 25:
                    buckets["25_49"] += 1
                else:
                    buckets["below_25"] += 1

        avg = round(sum(utilizations) / len(utilizations)) if utilizations else 0
        total = len(data)

        return {
            "avg_utilization": avg,
            "total": total,
            "buckets": [
                {"label": "80% or more", "count": buckets["above_80"], "color": "#16A34A"},
                {"label": "50% - 79%", "count": buckets["50_79"], "color": "#4ADE80"},
                {"label": "25% - 49%", "count": buckets["25_49"], "color": "#F59E0B"},
                {"label": "Below 25%", "count": buckets["below_25"], "color": "#EF4444"},
            ],
        }
    except Exception:
        traceback.print_exc()
        return {"avg_utilization": 0, "total": 0, "buckets": []}


@router.get("/memberships/tier-stats")
async def memberships_tier_stats(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "tier_id, visits_used, "
                "membership_tiers!patient_memberships_tier_id_fkey(name, price_cents, visits_included)"
            )
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )

        tier_map: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "name": "",
                "price_cents": 0,
                "visits_included": 0,
                "count": 0,
                "visits_used_total": 0,
            }
        )

        for r in rows.data or []:
            tid = r.get("tier_id")
            t = r.get("membership_tiers") or {}
            tier_map[tid]["name"] = t.get("name", "Unknown")
            tier_map[tid]["price_cents"] = t.get("price_cents", 0)
            tier_map[tid]["visits_included"] = t.get("visits_included", 0)
            tier_map[tid]["count"] += 1
            tier_map[tid]["visits_used_total"] += r.get("visits_used", 0)

        result = []
        for tid, v in tier_map.items():
            total_included = v["visits_included"] * v["count"]
            utilization = (
                round(v["visits_used_total"] / total_included * 100)
                if total_included > 0
                else 0
            )
            result.append({
                "tier_id": tid,
                "name": v["name"],
                "members": v["count"],
                "revenue_mtd_cents": v["price_cents"] * v["count"],
                "utilization": utilization,
            })

        return result
    except Exception:
        traceback.print_exc()
        return []


@router.get("/memberships/recent-enrollments")
async def memberships_recent_enrollments(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "id, created_at, "
                "membership_tiers!patient_memberships_tier_id_fkey(name, price_cents), "
                "patients(first_name, last_name)"
            )
            .eq("clinic_id", clinic_id)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )

        result = []
        for r in rows.data or []:
            t = r.get("membership_tiers") or {}
            p = r.get("patients") or {}
            first = p.get("first_name", "")
            last = p.get("last_name", "")
            full_name = f"{first} {last}".strip() or "Unknown"
            initials = ((first[:1] + last[:1]) if first or last else "?").upper()
            result.append({
                "initials": initials,
                "name": full_name,
                "tier": t.get("name", "—"),
                "enrolled_at": r.get("created_at", ""),
                "amount_cents": t.get("price_cents", 0),
            })

        return result
    except Exception:
        traceback.print_exc()
        return []


@router.get("/memberships/activity-feed")
async def memberships_activity_feed(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "id, status, created_at, updated_at, "
                "membership_tiers!patient_memberships_tier_id_fkey(name), "
                "patients(first_name, last_name)"
            )
            .eq("clinic_id", clinic_id)
            .order("updated_at", desc=True)
            .limit(8)
            .execute()
        )

        result = []
        for r in rows.data or []:
            t = r.get("membership_tiers") or {}
            p = r.get("patients") or {}
            first = p.get("first_name", "")
            last = p.get("last_name", "")
            name = f"{first} {last}".strip() or "Unknown"
            status = r.get("status", "")
            tier_name = t.get("name", "")

            if status == "active":
                event = f"{name} enrolled in {tier_name} membership"
                icon = "enroll"
            elif status == "cancelled":
                event = f"{name} cancelled {tier_name} membership"
                icon = "cancel"
            elif status == "paused":
                event = f"{name} paused {tier_name} membership"
                icon = "pause"
            else:
                event = f"{name} — {tier_name} ({status})"
                icon = "update"

            result.append({
                "event": event,
                "timestamp": r.get("updated_at", r.get("created_at", "")),
                "icon": icon,
            })

        return result
    except Exception:
        traceback.print_exc()
        return []


@router.get("/memberships/visits-overview")
async def memberships_visits_overview(clinic_id: str = Query(...)):
    try:
        rows = (
            supabase.table("patient_memberships")
            .select(
                "visits_used, visits_remaining, "
                "membership_tiers!patient_memberships_tier_id_fkey(name, visits_included)"
            )
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .execute()
        )

        tier_map: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"name": "", "used": 0, "included": 0}
        )

        for r in rows.data or []:
            t = r.get("membership_tiers") or {}
            name = t.get("name", "Unknown")
            included = t.get("visits_included", 0) or 0
            tier_map[name]["name"] = name
            tier_map[name]["used"] += r.get("visits_used", 0)
            tier_map[name]["included"] += included

        tier_colors = {
            "Bronze": "#F97316",
            "Silver": "#94A3B8",
            "Gold": "#EAB308",
            "Platinum": "#8B5CF6",
        }
        tier_order = ["Bronze", "Silver", "Gold", "Platinum"]

        result = []
        for name, v in tier_map.items():
            result.append({
                "name": name,
                "used": v["used"],
                "included": v["included"],
                "color": tier_colors.get(name, "#16A34A"),
            })

        return sorted(
            result,
            key=lambda x: tier_order.index(x["name"]) if x["name"] in tier_order else 99,
        )
    except Exception:
        traceback.print_exc()
        return []
