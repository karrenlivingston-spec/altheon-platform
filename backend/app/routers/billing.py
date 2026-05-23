"""Insurance billing claims and audit log."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()
logger = logging.getLogger(__name__)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date_only(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _days_remaining(filing_deadline: Any) -> Optional[int]:
    fd = _parse_date_only(filing_deadline)
    if fd is None:
        return None
    return (fd - date.today()).days


def _shape_claim(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["days_remaining"] = _days_remaining(row.get("filing_deadline"))
    return out


def _fetch_claim(claim_id: str) -> dict[str, Any]:
    try:
        resp = (
            supabase.table("claims")
            .select("*")
            .eq("id", claim_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("fetch claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Claim not found")
    return rows[0]


def _insert_audit_log(
    claim_id: str,
    action: str,
    *,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
) -> None:
    row: dict[str, Any] = {
        "claim_id": claim_id,
        "action": action,
    }
    if old_status is not None:
        row["old_status"] = old_status
    if new_status is not None:
        row["new_status"] = new_status
    ins = supabase.table("claim_audit_log").insert(row).execute()
    _handle_supabase_error(ins)


class CreateClaimBody(BaseModel):
    clinic_id: str
    patient_id: str
    clinician_id: str
    appointment_id: str
    first_treatment_date: date
    payer_name: str
    payer_id: str
    policy_number: str
    member_id: str
    diagnosis_codes: list[str] = Field(default_factory=list)
    cpt_codes: list[str] = Field(default_factory=list)
    total_amount: float
    notes: Optional[str] = None


class PatchClaimBody(BaseModel):
    patient_id: Optional[str] = None
    clinician_id: Optional[str] = None
    appointment_id: Optional[str] = None
    first_treatment_date: Optional[date] = None
    payer_name: Optional[str] = None
    payer_id: Optional[str] = None
    policy_number: Optional[str] = None
    member_id: Optional[str] = None
    diagnosis_codes: Optional[list[str]] = None
    cpt_codes: Optional[list[str]] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    filing_deadline: Optional[date] = None


def _claim_row_from_create(body: CreateClaimBody) -> dict[str, Any]:
    row: dict[str, Any] = {
        "clinic_id": body.clinic_id.strip(),
        "patient_id": body.patient_id.strip(),
        "clinician_id": body.clinician_id.strip(),
        "appointment_id": body.appointment_id.strip(),
        "first_treatment_date": body.first_treatment_date.isoformat(),
        "payer_name": body.payer_name.strip(),
        "payer_id": body.payer_id.strip(),
        "policy_number": body.policy_number.strip(),
        "member_id": body.member_id.strip(),
        "diagnosis_codes": body.diagnosis_codes,
        "cpt_codes": body.cpt_codes,
        "total_amount": body.total_amount,
        "status": "draft",
    }
    if body.notes is not None:
        row["notes"] = body.notes
    return row


@router.get("/claims")
def list_claims(clinic_id: str = Query(...)):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")
    try:
        resp = (
            supabase.table("claims")
            .select("*")
            .eq("clinic_id", cid)
            .order("filing_deadline")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_claims failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return [_shape_claim(r) for r in resp.data or [] if isinstance(r, dict)]


@router.post("/claims")
def create_claim(body: CreateClaimBody):
    row = _claim_row_from_create(body)
    try:
        ins = supabase.table("claims").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_claim failed clinic_id=%s", body.clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create claim")
    claim = rows[0]
    claim_id = str(claim["id"])
    try:
        _insert_audit_log(claim_id, "claim_created")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("claim audit log insert failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _shape_claim(claim)


@router.get("/claims/{claim_id}")
def get_claim(claim_id: str):
    claim = _fetch_claim(claim_id)
    try:
        audit_resp = (
            supabase.table("claim_audit_log")
            .select("*")
            .eq("claim_id", claim_id)
            .order("created_at")
            .execute()
        )
        _handle_supabase_error(audit_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_claim audit log failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    out = _shape_claim(claim)
    out["audit_log"] = audit_resp.data or []
    return out


@router.patch("/claims/{claim_id}")
def patch_claim(claim_id: str, body: PatchClaimBody):
    current = _fetch_claim(claim_id)
    old_status = str(current.get("status") or "").strip()

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "first_treatment_date" in data and data["first_treatment_date"] is not None:
        if isinstance(data["first_treatment_date"], date):
            data["first_treatment_date"] = data["first_treatment_date"].isoformat()
    if "filing_deadline" in data and data["filing_deadline"] is not None:
        if isinstance(data["filing_deadline"], date):
            data["filing_deadline"] = data["filing_deadline"].isoformat()

    for key in (
        "patient_id",
        "clinician_id",
        "appointment_id",
        "payer_name",
        "payer_id",
        "policy_number",
        "member_id",
    ):
        if key in data and data[key] is not None:
            data[key] = str(data[key]).strip()

    data["updated_at"] = _now_iso()

    try:
        upd = supabase.table("claims").update(data).eq("id", claim_id).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("patch_claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Claim not found")
    updated = rows[0]

    if "status" in data:
        new_status = str(data["status"] or "").strip()
        if new_status.lower() != old_status.lower():
            try:
                _insert_audit_log(
                    claim_id,
                    "status_changed",
                    old_status=old_status or None,
                    new_status=new_status,
                )
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("status audit log failed claim_id=%s", claim_id)
                raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _shape_claim(updated)


@router.delete("/claims/{claim_id}", status_code=204)
def delete_claim(claim_id: str):
    claim = _fetch_claim(claim_id)
    status = str(claim.get("status") or "").strip().lower()
    if status != "draft":
        raise HTTPException(
            status_code=400,
            detail="Only draft claims can be deleted",
        )
    try:
        dele = supabase.table("claims").delete().eq("id", claim_id).execute()
        _handle_supabase_error(dele)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("delete_claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=204)
