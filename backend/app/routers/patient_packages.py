import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_PACKAGE_STATUS = frozenset({"active", "completed", "cancelled"})


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


class PackageCreate(BaseModel):
    patient_id: str
    clinic_id: str
    package_name: str
    total_visits: int = Field(..., gt=0)
    price_cents: int = Field(..., ge=0)
    purchase_date: date
    notes: Optional[str] = None


class PackageUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/patient-packages")
def list_patient_packages(
    clinic_id: str = Query(...),
    patient_id: str = Query(...),
):
    try:
        resp = (
            supabase.table("patient_packages")
            .select("*")
            .eq("clinic_id", clinic_id)
            .eq("patient_id", patient_id)
            .order("purchase_date", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "list_patient_packages failed clinic_id=%s patient_id=%s",
            clinic_id,
            patient_id,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.post("/patient-packages")
def create_patient_package(body: PackageCreate):
    insert_row = {
        "patient_id": body.patient_id,
        "clinic_id": body.clinic_id,
        "package_name": body.package_name,
        "total_visits": body.total_visits,
        "visits_used": 0,
        "price_cents": body.price_cents,
        "purchase_date": body.purchase_date.isoformat(),
        "status": "active",
        "notes": body.notes,
    }
    try:
        ins = supabase.table("patient_packages").insert(insert_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_patient_package failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create package")
    return rows[0]


@router.patch("/patient-packages/{package_id}")
def update_patient_package(package_id: str, body: PackageUpdate):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "status" in data and data["status"] not in ALLOWED_PACKAGE_STATUS:
        raise HTTPException(status_code=400, detail="Invalid status")

    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase.table("patient_packages")
            .update(data)
            .eq("id", package_id)
            .execute()
        )
        _handle_supabase_error(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "update_patient_package failed package_id=%s",
            package_id,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Package not found")
    return rows[0]
