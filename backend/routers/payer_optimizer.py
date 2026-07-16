"""Payer coding rules lookup and billing recommendations."""

from __future__ import annotations

import json
import traceback
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.dependencies.permissions import BILLING_READ_ROLES, assert_clinic_role
from app.db import supabase
from app.retry_utils import supabase_execute
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()

_VALID_VISIT_TYPES = frozenset({"initial", "followup"})


def _parse_cpt_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(c).strip().upper() for c in value if str(c).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(c).strip().upper() for c in parsed if str(c).strip()]
        except json.JSONDecodeError:
            pass
        return [c.strip().upper() for c in text.split(",") if c.strip()]
    return []


def _empty_payer_result(payer_name: str) -> dict[str, Any]:
    return {
        "payer_name": payer_name,
        "matched": False,
        "cpt_codes": [],
        "notes": "",
        "reimbursement_amount": None,
    }


def _shape_payer_result(payer_query: str, row: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not row or not isinstance(row, dict):
        return _empty_payer_result(payer_query)
    codes = _parse_cpt_codes(row.get("cpt_codes"))
    return {
        "payer_name": str(row.get("payer_name") or payer_query).strip() or payer_query,
        "matched": True,
        "cpt_codes": codes,
        "notes": str(row.get("notes") or "").strip(),
        "reimbursement_amount": row.get("reimbursement_amount"),
    }


def _payer_match_or_filter(query_name: str) -> str:
    ilike_val = query_name.replace("%", "\\%").replace(",", " ")
    alias_escaped = query_name.replace('"', '\\"')
    return (
        f"payer_name.ilike.{ilike_val},"
        f'payer_name_aliases.cs.{{"{alias_escaped}"}}'
    )


def _lookup_payer_rule(
    clinic_id: str,
    payer_name: str,
    visit_type: str,
) -> Optional[dict[str, Any]]:
    """Clinic-specific rule first, then global (clinic_id IS NULL)."""
    query_name = payer_name.strip()
    if not query_name:
        return None

    select_cols = (
        "payer_name, payer_category, cpt_codes, notes, "
        "reimbursement_amount, visit_type, clinic_id"
    )
    payer_or = _payer_match_or_filter(query_name)

    try:
        clinic_resp = supabase_execute(
            lambda: supabase.table("payer_coding_rules")
            .select(select_cols)
            .eq("clinic_id", clinic_id)
            .eq("visit_type", visit_type)
            .or_(payer_or)
            .limit(1)
            .execute()
        )
        rows = clinic_resp.data or []
        if rows and isinstance(rows[0], dict):
            return rows[0]
    except Exception:
        traceback.print_exc()

    try:
        global_resp = supabase_execute(
            lambda: supabase.table("payer_coding_rules")
            .select(select_cols)
            .is_("clinic_id", "null")
            .eq("visit_type", visit_type)
            .or_(payer_or)
            .limit(1)
            .execute()
        )
        rows = global_resp.data or []
        if rows and isinstance(rows[0], dict):
            return rows[0]
    except Exception:
        traceback.print_exc()

    return None


def _union_codes(*code_lists: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for codes in code_lists:
        for code in codes:
            if code and code not in seen:
                seen.add(code)
                out.append(code)
    return out


def _intersection_codes(primary: list[str], secondary: list[str]) -> list[str]:
    secondary_set = set(secondary)
    return [code for code in primary if code in secondary_set]


def _fetch_distinct_payers(clinic_id: Optional[str]) -> list[dict[str, str]]:
    try:
        resp = supabase_execute(
            lambda: supabase.table("payer_coding_rules")
            .select("payer_name, payer_category, clinic_id")
            .execute()
        )
        rows = resp.data or []
    except Exception:
        traceback.print_exc()
        return []

    cid = (clinic_id or "").strip()
    seen: set[str] = set()
    payers: list[dict[str, str]] = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        row_clinic = row.get("clinic_id")
        if cid:
            if row_clinic is not None and str(row_clinic).strip() != cid:
                continue
        elif row_clinic is not None:
            continue

        name = str(row.get("payer_name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        payers.append(
            {
                "payer_name": name,
                "payer_category": str(row.get("payer_category") or "").strip() or "other",
            }
        )

    payers.sort(key=lambda p: (p["payer_category"].lower(), p["payer_name"].lower()))
    return payers


@router.get("/clinics/{clinic_id}/billing-recommendation")
def billing_recommendation(
    clinic_id: str,
    payer_primary: str = Query(..., min_length=1),
    visit_type: str = Query(..., min_length=1),
    payer_secondary: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    cid = clinic_id.strip()
    assert_clinic_role(user_id, cid, BILLING_READ_ROLES)

    vt = visit_type.strip().lower()
    if vt not in _VALID_VISIT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="visit_type must be 'initial' or 'followup'",
        )

    primary_name = payer_primary.strip()
    secondary_name = (payer_secondary or "").strip()

    try:
        primary_row = _lookup_payer_rule(cid, primary_name, vt)
        primary = _shape_payer_result(primary_name, primary_row)

        secondary: Optional[dict[str, Any]] = None
        if secondary_name:
            secondary_row = _lookup_payer_rule(cid, secondary_name, vt)
            secondary = _shape_payer_result(secondary_name, secondary_row)

        primary_codes = primary["cpt_codes"]
        if secondary:
            secondary_codes = secondary["cpt_codes"]
            union_codes = _union_codes(primary_codes, secondary_codes)
            intersection_codes = _intersection_codes(primary_codes, secondary_codes)
        else:
            union_codes = list(primary_codes)
            intersection_codes = []

        result: dict[str, Any] = {
            "visit_type": vt,
            "primary": primary,
            "union_codes": union_codes,
            "intersection_codes": intersection_codes,
        }
        if secondary is not None:
            result["secondary"] = secondary
        return result
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        empty_primary = _empty_payer_result(primary_name)
        result = {
            "visit_type": vt,
            "primary": empty_primary,
            "union_codes": [],
            "intersection_codes": [],
        }
        if secondary_name:
            result["secondary"] = _empty_payer_result(secondary_name)
        return result


@router.get("/payers")
def list_payers(
    clinic_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    cid = (clinic_id or "").strip()
    if cid:
        assert_clinic_role(user_id, cid, BILLING_READ_ROLES)

    payers = _fetch_distinct_payers(cid or None)
    return {"payers": payers}
