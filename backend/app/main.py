from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import re

from app.db import supabase
from app.routers import (
    slots,
    appointments,
    next_available,
    patients,
    legal_requests,
    memberships,
)
from app.routes.legal import router as legal_router

load_dotenv()

app = FastAPI(title="Altheon API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://altheon-platform.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(slots.router, prefix="/slots", tags=["slots"])
app.include_router(appointments.router, prefix="/appointments", tags=["appointments"])
app.include_router(patients.router, prefix="/patients", tags=["patients"])
app.include_router(
    legal_requests.router, prefix="/legal-requests", tags=["legal-requests"]
)
app.include_router(next_available.router, prefix="/next-available", tags=["next-available"])
app.include_router(memberships.router, tags=["Memberships"])
app.include_router(legal_router)


@app.get("/")
def root():
    return {"status": "Altheon API is running"}


@app.get("/health")
def health():
    supabase.table("clinics").select("id").limit(1).execute()
    return {"status": "ok", "supabase": "connected"}


@app.get("/patient-lookup")
def patient_lookup(phone: str, clinic_id: str):
    try:
        normalized_phone = re.sub(r"\D", "", phone)

        patient_resp = (
            supabase.table("patients")
            .select("id, first_name, last_name, phone")
            .execute()
        )
        patients = patient_resp.data or []
        patient = next(
            (
                row
                for row in patients
                if re.sub(r"\D", "", str(row.get("phone") or "")) == normalized_phone
            ),
            None,
        )
        if not patient:
            return {"found": False}

        access_resp = (
            supabase.table("patient_clinic_access")
            .select("patient_id")
            .eq("patient_id", patient["id"])
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        access_rows = access_resp.data or []
        if not access_rows:
            return {"found": False}
        appt_resp = (
            supabase.table("appointments")
            .select("start_time")
            .eq("patient_id", patient["id"])
            .eq("clinic_id", clinic_id)
            .in_("status", ["scheduled", "confirmed"])
            .order("start_time", desc=True)
            .limit(1)
            .execute()
        )
        appointments = appt_resp.data or []
        last_visit = None
        if appointments:
            start_time = appointments[0].get("start_time")
            if start_time:
                last_visit = start_time[:10]

        return {
            "found": True,
            "first_name": patient.get("first_name"),
            "last_name": patient.get("last_name"),
            "last_visit": last_visit,
        }
    except Exception:
        return {"found": False}


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _recalculate_billing_record_total(billing_record_id: str) -> None:
    items = (
        supabase.table("billing_line_items")
        .select("total_cents")
        .eq("billing_record_id", billing_record_id)
        .execute()
    )
    _handle_supabase_error(items)
    rows = items.data or []
    total = sum(int(row.get("total_cents") or 0) for row in rows)
    upd = (
        supabase.table("billing_records")
        .update({"total_billed_cents": total, "updated_at": _now_iso()})
        .eq("id", billing_record_id)
        .execute()
    )
    _handle_supabase_error(upd)


ALLOWED_BILLING_STATUSES = frozenset(
    {"draft", "submitted", "paid", "denied", "partial"}
)


@app.post("/billing-records")
def create_billing_record(body: dict = Body(...)):
    clinic_id = body.get("clinic_id")
    patient_id = body.get("patient_id")
    date_of_service = body.get("date_of_service")
    if not clinic_id or not patient_id or not date_of_service:
        raise HTTPException(
            status_code=400,
            detail="clinic_id, patient_id, and date_of_service are required",
        )
    row = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "date_of_service": date_of_service,
        "status": "draft",
        "billing_type": body.get("billing_type") or "cash",
    }
    if body.get("appointment_id") is not None:
        row["appointment_id"] = body["appointment_id"]
    if body.get("pi_case_id") is not None:
        row["pi_case_id"] = body["pi_case_id"]
    if body.get("provider_id") is not None:
        row["provider_id"] = body["provider_id"]
    if body.get("insurance_carrier") is not None:
        row["insurance_carrier"] = body["insurance_carrier"]
    if body.get("claim_number") is not None:
        row["claim_number"] = body["claim_number"]
    if body.get("notes") is not None:
        row["notes"] = body["notes"]
    try:
        ins = supabase.table("billing_records").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create billing record")
    return rows[0]


@app.get("/billing-records")
def list_billing_records(
    clinic_id: str = Query(...),
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    try:
        q = supabase.table("billing_records").select("*").eq("clinic_id", clinic_id)
        if patient_id:
            q = q.eq("patient_id", patient_id)
        if status:
            q = q.eq("status", status)
        if date_from:
            q = q.gte("date_of_service", date_from)
        if date_to:
            q = q.lte("date_of_service", date_to)
        resp = q.order("date_of_service", desc=True).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@app.get("/billing-records/{record_id}")
def get_billing_record(record_id: str):
    try:
        rec = (
            supabase.table("billing_records")
            .select("*")
            .eq("id", record_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(rec)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rec_rows = rec.data or []
    if not rec_rows:
        raise HTTPException(status_code=404, detail="Billing record not found")
    record = dict(rec_rows[0])
    try:
        items = (
            supabase.table("billing_line_items")
            .select("*")
            .eq("billing_record_id", record_id)
            .execute()
        )
        _handle_supabase_error(items)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    record["line_items"] = items.data or []
    return record


@app.patch("/billing-records/{record_id}/status")
def patch_billing_record_status(record_id: str, body: dict = Body(...)):
    new_status = body.get("status")
    if new_status not in ALLOWED_BILLING_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {', '.join(sorted(ALLOWED_BILLING_STATUSES))}",
        )
    try:
        upd = (
            supabase.table("billing_records")
            .update({"status": new_status, "updated_at": _now_iso()})
            .eq("id", record_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Billing record not found")
    return rows[0]


@app.post("/billing-records/{record_id}/line-items")
def create_billing_line_item(record_id: str, body: dict = Body(...)):
    try:
        parent = (
            supabase.table("billing_records")
            .select("id, clinic_id")
            .eq("id", record_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(parent)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    prow = parent.data or []
    if not prow:
        raise HTTPException(status_code=404, detail="Billing record not found")
    clinic_id = prow[0]["clinic_id"]
    row = {
        "billing_record_id": record_id,
        "clinic_id": clinic_id,
        "cpt_code": body.get("cpt_code"),
        "description": body.get("description"),
        "units": body.get("units") if body.get("units") is not None else 1,
        "rate_cents": body.get("rate_cents") if body.get("rate_cents") is not None else 0,
        "is_timed": body.get("is_timed") if body.get("is_timed") is not None else False,
        "is_em_code": body.get("is_em_code") if body.get("is_em_code") is not None else False,
        "payment_type": body.get("payment_type") or "cash",
        "modifiers": body.get("modifiers") if body.get("modifiers") is not None else [],
    }
    if row["cpt_code"] is None:
        raise HTTPException(status_code=400, detail="cpt_code is required")
    try:
        ins = supabase.table("billing_line_items").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    ins_rows = ins.data or []
    if not ins_rows:
        raise HTTPException(status_code=500, detail="Failed to create line item")
    try:
        _recalculate_billing_record_total(record_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return ins_rows[0]


@app.patch("/billing-line-items/{item_id}")
def patch_billing_line_item(item_id: str, body: dict = Body(...)):
    allowed = {"units", "rate_cents", "modifiers", "payment_type", "description"}
    data = {k: body[k] for k in allowed if k in body}
    if not data:
        raise HTTPException(
            status_code=400,
            detail="At least one of: units, rate_cents, modifiers, payment_type, description",
        )
    try:
        existing = (
            supabase.table("billing_line_items")
            .select("billing_record_id")
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    erows = existing.data or []
    if not erows:
        raise HTTPException(status_code=404, detail="Line item not found")
    record_id = erows[0]["billing_record_id"]
    try:
        upd = (
            supabase.table("billing_line_items")
            .update(data)
            .eq("id", item_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Line item not found")
    try:
        _recalculate_billing_record_total(record_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return urows[0]


@app.delete("/billing-line-items/{item_id}")
def delete_billing_line_item(item_id: str):
    try:
        existing = (
            supabase.table("billing_line_items")
            .select("billing_record_id")
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    erows = existing.data or []
    if not erows:
        raise HTTPException(status_code=404, detail="Line item not found")
    record_id = erows[0]["billing_record_id"]
    try:
        del_resp = supabase.table("billing_line_items").delete().eq("id", item_id).execute()
        _handle_supabase_error(del_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    try:
        _recalculate_billing_record_total(record_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"deleted": item_id}


@app.post("/pi-cases")
def create_pi_case(body: dict = Body(...)):
    clinic_id = body.get("clinic_id")
    patient_id = body.get("patient_id")
    if not clinic_id or not patient_id:
        raise HTTPException(
            status_code=400, detail="clinic_id and patient_id are required"
        )
    row: dict[str, Any] = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "status": "open",
    }
    optional_keys = (
        "date_of_accident",
        "claim_number",
        "attorney_name",
        "attorney_email",
        "attorney_phone",
        "insurance_carrier",
        "notes",
    )
    for key in optional_keys:
        if key in body and body[key] is not None:
            row[key] = body[key]
    try:
        ins = supabase.table("pi_cases").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create PI case")
    return rows[0]


@app.get("/pi-cases")
def list_pi_cases(
    clinic_id: str = Query(...),
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
):
    try:
        q = supabase.table("pi_cases").select("*").eq("clinic_id", clinic_id)
        if patient_id:
            q = q.eq("patient_id", patient_id)
        if status:
            q = q.eq("status", status)
        resp = q.order("created_at", desc=True).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@app.patch("/pi-cases/{case_id}")
def patch_pi_case(case_id: str, body: dict = Body(...)):
    allowed = {
        "status",
        "claim_number",
        "attorney_name",
        "attorney_email",
        "attorney_phone",
        "insurance_carrier",
        "date_of_accident",
        "notes",
    }
    data = {k: body[k] for k in allowed if k in body}
    if not data:
        raise HTTPException(
            status_code=400,
            detail="No valid fields to update",
        )
    data["updated_at"] = _now_iso()
    try:
        upd = supabase.table("pi_cases").update(data).eq("id", case_id).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="PI case not found")
    return rows[0]
