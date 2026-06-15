"""Billing dashboard aggregates — MTD metrics, aging, payer summary, claims list."""

from __future__ import annotations

import traceback
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

NY = ZoneInfo("America/New_York")


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _int_cents(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _remaining_cents(row: dict[str, Any]) -> int:
    if row.get("amount_remaining_cents") is not None:
        return _int_cents(row.get("amount_remaining_cents"))
    billed = _int_cents(row.get("total_billed_cents"))
    paid = _int_cents(row.get("amount_paid_cents"))
    if row.get("total_paid_cents") is not None and paid == 0:
        paid = _int_cents(row.get("total_paid_cents"))
    return max(0, billed - paid)


def _paid_cents(row: dict[str, Any]) -> int:
    paid = _int_cents(row.get("amount_paid_cents"))
    if paid == 0 and row.get("total_paid_cents") is not None:
        return _int_cents(row.get("total_paid_cents"))
    return paid


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    last_day = monthrange(year, month)[1]
    return (
        f"{year:04d}-{month:02d}-01",
        f"{year:04d}-{month:02d}-{last_day:02d}",
    )


def _trend_pct(current: int, previous: int) -> int:
    if previous <= 0:
        return 100 if current > 0 else 0
    return round((current - previous) / previous * 100)


def _patient_name(row: dict[str, Any]) -> str:
    patients = row.get("patients") or {}
    if isinstance(patients, list):
        patients = patients[0] if patients else {}
    fn = str(patients.get("first_name") or "").strip()
    ln = str(patients.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "—"


def _dos_date(row: dict[str, Any]) -> Optional[date]:
    raw = str(
        row.get("date_of_service") or row.get("first_treatment_date") or ""
    )[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _amount_dollars_to_cents(value: Any) -> int:
    try:
        return round(float(value or 0) * 100)
    except (TypeError, ValueError):
        return 0


def _normalize_insurance_claim(row: dict[str, Any]) -> dict[str, Any]:
    """Map insurance_claims row to the dashboard record shape."""
    status = str(row.get("status") or "draft").strip().lower()
    total_billed = _amount_dollars_to_cents(row.get("total_amount"))
    if status == "paid":
        paid = total_billed
        remaining = 0
    else:
        paid = 0
        remaining = total_billed
    dos = str(row.get("first_treatment_date") or "")[:10] or None
    return {
        "id": row.get("id"),
        "clinic_id": row.get("clinic_id"),
        "patient_id": row.get("patient_id"),
        "appointment_id": row.get("appointment_id"),
        "claim_number": row.get("claim_number"),
        "insurance_carrier": str(row.get("payer_name") or "").strip() or None,
        "date_of_service": dos,
        "status": status,
        "total_billed_cents": total_billed,
        "amount_paid_cents": paid,
        "amount_remaining_cents": remaining,
        "total_paid_cents": paid,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "patients": row.get("patients"),
    }


def _claim_dos(row: dict[str, Any]) -> str:
    return str(row.get("date_of_service") or row.get("first_treatment_date") or "")[
        :10
    ]


def _shape_claim_row(row: dict[str, Any], *, index: int) -> dict[str, Any]:
    claim_number = str(row.get("claim_number") or "").strip()
    dos = str(row.get("date_of_service") or "")[:10]
    if not claim_number:
        claim_number = f"CLM-{dos.replace('-', '')}-{index + 1:03d}" if dos else f"CLM-{index + 1:03d}"
    return {
        "id": str(row.get("id") or ""),
        "claim_number": claim_number,
        "patient_name": _patient_name(row),
        "insurance_carrier": str(row.get("insurance_carrier") or "—").strip() or "—",
        "date_of_service": dos or None,
        "total_billed_cents": _int_cents(row.get("total_billed_cents")),
        "amount_paid_cents": _paid_cents(row),
        "amount_remaining_cents": _remaining_cents(row),
        "status": str(row.get("status") or "draft").strip().lower(),
        "created_at": row.get("created_at"),
    }


@router.get("/billing/dashboard")
def billing_dashboard(
    clinic: ClinicUserDep,
    page: int = Query(0, ge=0),
    page_size: int = Query(10, ge=1, le=50),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    try:
        cid = clinic.clinic_id
        today = datetime.now(NY).date()
        month_start, month_end = _month_bounds(today.year, today.month)

        if today.month == 1:
            lm_start, lm_end = _month_bounds(today.year - 1, 12)
        else:
            lm_start, lm_end = _month_bounds(today.year, today.month - 1)

        records_resp = (
            supabase.table("insurance_claims")
            .select(
                "id, clinic_id, patient_id, appointment_id, "
                "payer_name, first_treatment_date, status, total_amount, "
                "created_at, updated_at, "
                "patients(first_name, last_name)"
            )
            .eq("clinic_id", cid)
            .order("first_treatment_date", desc=True)
            .execute()
        )
        _handle_supabase_error(records_resp)
        all_records = [
            _normalize_insurance_claim(r)
            for r in (records_resp.data or [])
            if isinstance(r, dict)
        ]

        def in_month(row: dict[str, Any], start: str, end: str) -> bool:
            dos = _claim_dos(row)
            return bool(dos and start <= dos <= end)

        mtd_records = [r for r in all_records if in_month(r, month_start, month_end)]
        lm_records = [r for r in all_records if in_month(r, lm_start, lm_end)]

        total_billed_mtd = sum(_int_cents(r.get("total_billed_cents")) for r in mtd_records)
        collected_mtd = sum(_paid_cents(r) for r in mtd_records)
        last_month_billed = sum(_int_cents(r.get("total_billed_cents")) for r in lm_records)
        last_month_collected = sum(_paid_cents(r) for r in lm_records)

        outstanding_cents = sum(
            _remaining_cents(r)
            for r in all_records
            if str(r.get("status") or "").lower() != "paid"
        )

        claims_submitted = len(mtd_records)
        claims_denied = sum(
            1 for r in all_records if str(r.get("status") or "").lower() == "denied"
        )
        avg_collection_cents = (
            round(collected_mtd / claims_submitted) if claims_submitted > 0 else 0
        )

        denied_rows = [
            r for r in all_records if str(r.get("status") or "").lower() == "denied"
        ]
        pending_rows = [
            r
            for r in all_records
            if str(r.get("status") or "").lower() in ("submitted", "partial", "pending")
        ]
        ready_rows = [
            r for r in all_records if str(r.get("status") or "").lower() == "draft"
        ]

        billed_appt_ids = {
            str(r.get("appointment_id") or "")
            for r in all_records
            if r.get("appointment_id")
        }
        unbilled_count = 0
        try:
            now_utc = datetime.now(timezone.utc)
            appt_resp = (
                supabase.table("appointments")
                .select("id")
                .eq("clinic_id", cid)
                .eq("status", "completed")
                .gte("start_time", (now_utc - timedelta(days=90)).isoformat())
                .execute()
            )
            _handle_supabase_error(appt_resp)
            for row in appt_resp.data or []:
                aid = str(row.get("id") or "")
                if aid and aid not in billed_appt_ids:
                    unbilled_count += 1
        except Exception:
            traceback.print_exc()

        aging_open = [
            r for r in all_records if str(r.get("status") or "").lower() != "paid"
        ]
        bucket_0_30 = 0
        bucket_31_60 = 0
        bucket_61_90 = 0
        bucket_90_plus = 0
        for row in aging_open:
            dos = _dos_date(row)
            if not dos:
                continue
            age_days = (today - dos).days
            rem = _remaining_cents(row)
            if age_days <= 30:
                bucket_0_30 += rem
            elif age_days <= 60:
                bucket_31_60 += rem
            elif age_days <= 90:
                bucket_61_90 += rem
            else:
                bucket_90_plus += rem
        aging_total = bucket_0_30 + bucket_31_60 + bucket_61_90 + bucket_90_plus

        payer_map: dict[str, dict[str, int]] = {}
        for row in all_records:
            carrier = str(row.get("insurance_carrier") or "").strip()
            if not carrier:
                patients = row.get("patients") or {}
                if isinstance(patients, list):
                    patients = patients[0] if patients else {}
                carrier = str(patients.get("insurance_carrier") or "").strip()
            carrier = carrier or "Self Pay / Cash"
            entry = payer_map.setdefault(
                carrier, {"billed_cents": 0, "collected_cents": 0}
            )
            entry["billed_cents"] += _int_cents(row.get("total_billed_cents"))
            entry["collected_cents"] += _paid_cents(row)

        payer_summary = []
        for carrier, vals in payer_map.items():
            billed = vals["billed_cents"]
            collected = vals["collected_cents"]
            rate = round(collected / billed * 100) if billed > 0 else 0
            payer_summary.append(
                {
                    "carrier": carrier,
                    "billed_cents": billed,
                    "collected_cents": collected,
                    "collection_rate": rate,
                }
            )
        payer_summary.sort(key=lambda x: x["billed_cents"], reverse=True)
        payer_summary = payer_summary[:5]

        # Claims list filters
        df = (date_from or month_start).strip()[:10]
        dt = (date_to or month_end).strip()[:10]
        filtered = [
            r
            for r in all_records
            if _claim_dos(r) and df <= _claim_dos(r) <= dt
        ]
        if status and status.lower() != "all":
            st = status.lower()
            if st == "pending" or st == "pended":
                filtered = [
                    r
                    for r in filtered
                    if str(r.get("status") or "").lower() in ("submitted", "partial", "pending")
                ]
            else:
                filtered = [
                    r for r in filtered if str(r.get("status") or "").lower() == st
                ]

        claims_total = len(filtered)
        start_idx = page * page_size
        page_rows = filtered[start_idx : start_idx + page_size]
        claims = [_shape_claim_row(r, index=start_idx + i) for i, r in enumerate(page_rows)]

        status_counts = {
            "all": len(
                [
                    r
                    for r in all_records
                    if _claim_dos(r) and df <= _claim_dos(r) <= dt
                ]
            ),
            "submitted": 0,
            "pending": 0,
            "denied": 0,
            "paid": 0,
            "draft": 0,
        }
        for r in all_records:
            dos = _claim_dos(r)
            if not dos or not (df <= dos <= dt):
                continue
            st = str(r.get("status") or "draft").lower()
            if st == "submitted":
                status_counts["submitted"] += 1
            elif st in ("partial", "pending"):
                status_counts["pending"] += 1
            elif st == "denied":
                status_counts["denied"] += 1
            elif st == "paid":
                status_counts["paid"] += 1
            elif st == "draft":
                status_counts["draft"] += 1

        recent_payments: list[dict[str, Any]] = []
        record_by_id = {str(r.get("id") or ""): r for r in all_records if r.get("id")}
        try:
            pay_resp = (
                supabase.table("billing_payments")
                .select(
                    "amount_cents, payment_date, payment_method, note, billing_record_id"
                )
                .order("payment_date", desc=True)
                .limit(50)
                .execute()
            )
            _handle_supabase_error(pay_resp)
            for p in pay_resp.data or []:
                rid = str(p.get("billing_record_id") or "")
                rec = record_by_id.get(rid)
                if not rec:
                    continue
                carrier = str(rec.get("insurance_carrier") or "").strip() or "Payer"
                recent_payments.append(
                    {
                        "amount_cents": _int_cents(p.get("amount_cents")),
                        "payment_date": str(p.get("payment_date") or ""),
                        "payment_method": str(p.get("payment_method") or "").strip() or None,
                        "note": str(p.get("note") or "").strip() or None,
                        "carrier": carrier,
                        "patient_name": _patient_name(rec),
                    }
                )
                if len(recent_payments) >= 5:
                    break
        except Exception:
            traceback.print_exc()

        return {
            "metrics": {
                "total_billed_mtd_cents": total_billed_mtd,
                "collected_mtd_cents": collected_mtd,
                "outstanding_cents": outstanding_cents,
                "claims_submitted": claims_submitted,
                "claims_denied": claims_denied,
                "avg_collection_cents": avg_collection_cents,
                "billed_trend_pct": _trend_pct(total_billed_mtd, last_month_billed),
                "collected_trend_pct": _trend_pct(collected_mtd, last_month_collected),
            },
            "claims_action": {
                "denied": {
                    "count": len(denied_rows),
                    "amount_cents": sum(_remaining_cents(r) for r in denied_rows),
                },
                "pending": {
                    "count": len(pending_rows),
                    "amount_cents": sum(_remaining_cents(r) for r in pending_rows),
                },
                "ready_to_send": {
                    "count": len(ready_rows),
                    "amount_cents": sum(_remaining_cents(r) for r in ready_rows),
                },
                "unbilled": {"count": unbilled_count},
            },
            "aging": {
                "bucket_0_30": bucket_0_30,
                "bucket_31_60": bucket_31_60,
                "bucket_61_90": bucket_61_90,
                "bucket_90_plus": bucket_90_plus,
                "total": aging_total,
            },
            "payer_summary": payer_summary,
            "claims": claims,
            "claims_total": claims_total,
            "claims_status_counts": status_counts,
            "recent_payments": recent_payments,
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Billing dashboard failed: {exc}",
        ) from exc
