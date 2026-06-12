"""Insurance benefits ledger per patient and carrier."""

from __future__ import annotations

import traceback
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

MEDICARE_THRESHOLD_CENTS = 248_000


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


def _paid_cents(row: dict[str, Any]) -> int:
    if row.get("total_paid_cents") is not None:
        return _int_cents(row.get("total_paid_cents"))
    return _int_cents(row.get("amount_paid_cents"))


def _aggregate_cpt_breakdown(
    line_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    for item in line_items:
        code = str(item.get("cpt_code") or "").strip()
        if not code:
            continue
        entry = by_code.get(code)
        if not entry:
            entry = {
                "cpt_code": code,
                "description": str(item.get("description") or "").strip() or code,
                "total_units": 0,
                "total_cents": 0,
            }
            by_code[code] = entry
        entry["total_units"] += _int_cents(item.get("units"))
        entry["total_cents"] += _int_cents(item.get("total_cents"))
    return sorted(by_code.values(), key=lambda x: x["cpt_code"])


@router.get("/patients/{patient_id}/benefits-ledger")
def get_benefits_ledger(patient_id: str, clinic: ClinicUserDep):
    try:
        pid = patient_id.strip()
        cid = clinic.clinic_id
        if not pid:
            raise HTTPException(status_code=400, detail="Invalid patient_id")

        patient_resp = (
            supabase.table("patients")
            .select(
                "id,clinic_id,insurance_carrier,insurance_policy_number,insurance_group_number"
            )
            .eq("id", pid)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(patient_resp)
        patient_rows = patient_resp.data or []
        if not patient_rows:
            raise HTTPException(status_code=404, detail="Patient not found")

        patient = patient_rows[0]
        carrier_name = str(patient.get("insurance_carrier") or "").strip()
        policy_number = str(patient.get("insurance_policy_number") or "").strip()
        group_number = str(patient.get("insurance_group_number") or "").strip()

        if not carrier_name:
            return {"plans": [], "no_insurance": True}

        billing_resp = (
            supabase.table("billing_records")
            .select(
                "id,date_of_service,insurance_carrier,total_billed_cents,"
                "total_paid_cents,amount_paid_cents,status"
            )
            .eq("patient_id", pid)
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(billing_resp)
        billing_records = [
            r for r in (billing_resp.data or []) if isinstance(r, dict)
        ]

        record_ids = [str(r.get("id")) for r in billing_records if r.get("id")]
        line_items_by_record: dict[str, list[dict[str, Any]]] = defaultdict(list)
        if record_ids:
            items_resp = (
                supabase.table("billing_line_items")
                .select(
                    "billing_record_id,cpt_code,description,units,total_cents,modifiers"
                )
                .in_("billing_record_id", record_ids)
                .execute()
            )
            _handle_supabase_error(items_resp)
            for item in items_resp.data or []:
                if not isinstance(item, dict):
                    continue
                rid = str(item.get("billing_record_id") or "")
                if rid:
                    line_items_by_record[rid].append(item)

        claims_resp = (
            supabase.table("insurance_claims")
            .select(
                "payer_name,policy_number,cpt_codes,total_amount,status,submission_date"
            )
            .eq("patient_id", pid)
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(claims_resp)
        _ = claims_resp.data or []

        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for rec in billing_records:
            rec_carrier = str(rec.get("insurance_carrier") or "").strip()
            key = rec_carrier or carrier_name or "Unknown"
            groups[key].append(rec)

        calendar_year = datetime.now(timezone.utc).year
        plans: list[dict[str, Any]] = []

        if not groups:
            plans.append(
                {
                    "carrier_name": carrier_name,
                    "policy_number": policy_number,
                    "group_number": group_number,
                    "total_visits": 0,
                    "total_billed_cents": 0,
                    "total_paid_cents": 0,
                    "is_medicare": "medicare" in carrier_name.lower(),
                    "calendar_year": calendar_year,
                    "medicare_threshold_cents": MEDICARE_THRESHOLD_CENTS,
                    "cpt_breakdown": [],
                }
            )
        else:
            for group_carrier, records in sorted(groups.items()):
                all_line_items: list[dict[str, Any]] = []
                total_billed = 0
                total_paid = 0
                for rec in records:
                    rid = str(rec.get("id") or "")
                    total_billed += _int_cents(rec.get("total_billed_cents"))
                    total_paid += _paid_cents(rec)
                    all_line_items.extend(line_items_by_record.get(rid, []))

                plans.append(
                    {
                        "carrier_name": group_carrier,
                        "policy_number": policy_number,
                        "group_number": group_number,
                        "total_visits": len(records),
                        "total_billed_cents": total_billed,
                        "total_paid_cents": total_paid,
                        "is_medicare": "medicare" in group_carrier.lower(),
                        "calendar_year": calendar_year,
                        "medicare_threshold_cents": MEDICARE_THRESHOLD_CENTS,
                        "cpt_breakdown": _aggregate_cpt_breakdown(all_line_items),
                    }
                )

        return {"plans": plans, "no_insurance": False}
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
