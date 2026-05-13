"""
DME (Durable Medical Equipment) tracking for patients.

-- dme_records
-- id uuid primary key default gen_random_uuid()
-- clinic_id uuid references clinics(id)
-- patient_id uuid references patients(id)
-- item_name text not null
-- l_code text
-- date_issued date not null
-- quantity integer default 1
-- unit_cost numeric(10,2)
-- billing_status text default 'unbilled'
--   (values: unbilled, billed, paid, written_off)
-- pi_case_id uuid references pi_cases(id) nullable
-- patient_signature_url text nullable
-- notes text
-- created_at timestamptz default now()
-- updated_at timestamptz default now()
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()

DME_BILLING_STATUSES = frozenset({"unbilled", "billed", "paid", "written_off"})


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CreateDmeBody(BaseModel):
    clinic_id: str
    patient_id: str
    item_name: str
    l_code: Optional[str] = None
    date_issued: date
    quantity: int = Field(default=1, ge=1)
    unit_cost: Optional[Decimal] = None
    billing_status: Literal["unbilled", "billed", "paid", "written_off"] = "unbilled"
    pi_case_id: Optional[str] = None
    notes: Optional[str] = None


class PatchDmeBody(BaseModel):
    item_name: Optional[str] = None
    l_code: Optional[str] = None
    date_issued: Optional[date] = None
    quantity: Optional[int] = Field(default=None, ge=1)
    unit_cost: Optional[Decimal] = None
    billing_status: Optional[Literal["unbilled", "billed", "paid", "written_off"]] = None
    pi_case_id: Optional[str] = None
    notes: Optional[str] = None
    patient_signature_url: Optional[str] = None


def _row_for_insert(body: CreateDmeBody) -> dict[str, Any]:
    row: dict[str, Any] = {
        "clinic_id": body.clinic_id.strip(),
        "patient_id": body.patient_id.strip(),
        "item_name": body.item_name.strip(),
        "date_issued": body.date_issued.isoformat(),
        "quantity": body.quantity,
        "billing_status": body.billing_status,
    }
    if body.l_code is not None:
        row["l_code"] = body.l_code.strip() or None
    if body.unit_cost is not None:
        row["unit_cost"] = float(body.unit_cost)
    if body.pi_case_id is not None:
        row["pi_case_id"] = body.pi_case_id.strip() or None
    if body.notes is not None:
        row["notes"] = body.notes
    return row


@router.post("/dme")
def create_dme_record(body: CreateDmeBody):
    if not body.clinic_id.strip() or not body.patient_id.strip() or not body.item_name.strip():
        raise HTTPException(
            status_code=400,
            detail="clinic_id, patient_id, and item_name are required",
        )
    row = _row_for_insert(body)
    try:
        ins = supabase.table("dme_records").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create DME record")
    return rows[0]


@router.get("/dme")
def list_dme_records(
    clinic_id: str = Query(...),
    patient_id: Optional[str] = None,
):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")
    try:
        q = supabase.table("dme_records").select("*").eq("clinic_id", cid)
        if patient_id is not None and patient_id.strip():
            q = q.eq("patient_id", patient_id.strip())
        resp = q.order("date_issued", desc=True).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.patch("/dme/{record_id}")
def patch_dme_record(record_id: str, body: PatchDmeBody):
    payload = body.model_dump(exclude_unset=True)
    allowed_keys = {
        "item_name",
        "l_code",
        "date_issued",
        "quantity",
        "unit_cost",
        "billing_status",
        "pi_case_id",
        "notes",
        "patient_signature_url",
    }
    data: dict[str, Any] = {k: v for k, v in payload.items() if k in allowed_keys}
    if "item_name" in data and data["item_name"] is not None:
        data["item_name"] = str(data["item_name"]).strip()
        if not data["item_name"]:
            raise HTTPException(status_code=400, detail="item_name cannot be empty")
    if "l_code" in data and data["l_code"] is not None:
        s = str(data["l_code"]).strip()
        data["l_code"] = s or None
    if "date_issued" in data and data["date_issued"] is not None:
        if isinstance(data["date_issued"], date):
            data["date_issued"] = data["date_issued"].isoformat()
    if "pi_case_id" in data and data["pi_case_id"] is not None:
        s = str(data["pi_case_id"]).strip()
        data["pi_case_id"] = s or None
    if "unit_cost" in data and data["unit_cost"] is not None:
        data["unit_cost"] = float(data["unit_cost"])
    if "billing_status" in data and data["billing_status"] is not None:
        if data["billing_status"] not in DME_BILLING_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"billing_status must be one of: {', '.join(sorted(DME_BILLING_STATUSES))}",
            )
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    data["updated_at"] = _now_iso()
    try:
        upd = supabase.table("dme_records").update(data).eq("id", record_id).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="DME record not found")
    return urows[0]


@router.delete("/dme/{record_id}")
def delete_dme_record(record_id: str):
    try:
        existing = (
            supabase.table("dme_records")
            .select("id")
            .eq("id", record_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not (existing.data or []):
        raise HTTPException(status_code=404, detail="DME record not found")
    try:
        del_resp = supabase.table("dme_records").delete().eq("id", record_id).execute()
        _handle_supabase_error(del_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"message": "DME record deleted successfully"}
