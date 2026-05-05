import calendar
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import Body, FastAPI, Header, HTTPException, Query
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
    billing as billing_router,
    surveys,
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
app.include_router(
    billing_router.router, prefix="/billing-records", tags=["billing-payments"]
)
app.include_router(legal_router)
app.include_router(surveys.router)


@app.get("/")
def root():
    return {"status": "Altheon API is running"}


@app.get("/health")
def health():
    supabase.table("clinics").select("id").limit(1).execute()
    return {"status": "ok", "supabase": "connected"}


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _clinic_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "brand_name": row.get("brand_name"),
        "logo_url": row.get("logo_url"),
        "primary_color": row.get("primary_color"),
        "agent_name": row.get("agent_name"),
    }


@app.get("/me")
def me(authorization: Optional[str] = Header(default=None, alias="Authorization")):
    token = _extract_bearer_token(authorization)
    try:
        auth_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    user_obj = getattr(auth_response, "user", None)
    if user_obj is None and isinstance(auth_response, dict):
        user_obj = auth_response.get("user")

    user_id = str(getattr(user_obj, "id", None) or "").strip()
    if not user_id and isinstance(user_obj, dict):
        user_id = str(user_obj.get("id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        cu_resp = (
            supabase.table("clinic_users")
            .select(
                "user_id,role,clinic_id,"
                "clinics:clinic_id(id,slug,brand_name,logo_url,primary_color,agent_name)"
            )
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cu_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = cu_resp.data or []
    if not rows:
        raise HTTPException(status_code=403, detail="No clinic access for user")

    row = rows[0]
    role = str(row.get("role") or "").strip() or "member"
    clinic_raw = row.get("clinics")
    if isinstance(clinic_raw, list):
        clinic_raw = clinic_raw[0] if clinic_raw else None
    if not isinstance(clinic_raw, dict):
        raise HTTPException(status_code=500, detail="Clinic join returned no clinic data")

    out: dict[str, Any] = {
        "user_id": user_id,
        "role": role,
        "clinic": _clinic_shape(clinic_raw),
    }

    if role == "super_admin":
        try:
            clinics_resp = (
                supabase.table("clinics")
                .select("id,slug,brand_name,logo_url,primary_color,agent_name")
                .order("brand_name")
                .execute()
            )
            _handle_supabase_error(clinics_resp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        all_rows = clinics_resp.data or []
        out["all_clinics"] = [
            _clinic_shape(r) for r in all_rows if isinstance(r, dict)
        ]

    return out


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


_NY_TZ = ZoneInfo("America/New_York")

_ASK_ALTHEON_FALLBACK = (
    "I couldn't retrieve that data right now. Please try again."
)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _eastern_ymd_from_utc_dt(dt: datetime) -> str:
    return dt.astimezone(_NY_TZ).strftime("%Y-%m-%d")


def _eastern_now_parts() -> tuple[str, str, str]:
    """Return (today_ymd, month_start_ymd, month_end_ymd) in America/New_York."""
    ny = datetime.now(timezone.utc).astimezone(_NY_TZ)
    y, m = ny.year, ny.month
    _, last = calendar.monthrange(y, m)
    today = ny.strftime("%Y-%m-%d")
    start = f"{y:04d}-{m:02d}-01"
    end = f"{y:04d}-{m:02d}-{last:02d}"
    return today, start, end


def _eastern_week_mon_sun_ymd() -> tuple[str, str]:
    ny = datetime.now(timezone.utc).astimezone(_NY_TZ)
    d = ny.date()
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def _fmt_usd_from_cents(cents: int) -> str:
    return f"${cents / 100:.2f}"


def _ask_altheon_build_clinic_context(clinic_id: str) -> str:
    """Aggregate clinic rows from Supabase for the Ask Altheon assistant."""
    today_ymd, month_start, month_end = _eastern_now_parts()
    week_mon, week_sun = _eastern_week_mon_sun_ymd()

    ap_resp = (
        supabase.table("appointments")
        .select("start_time")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    _handle_supabase_error(ap_resp)
    ap_rows = ap_resp.data or []
    ap_today = ap_week = ap_month = 0
    for row in ap_rows:
        st = row.get("start_time")
        dt = _parse_iso_datetime(st)
        if dt is None:
            continue
        ymd = _eastern_ymd_from_utc_dt(dt)
        if ymd == today_ymd:
            ap_today += 1
        if week_mon <= ymd <= week_sun:
            ap_week += 1
        if month_start <= ymd <= month_end:
            ap_month += 1

    br_resp = (
        supabase.table("billing_records")
        .select(
            "date_of_service,total_billed_cents,total_paid_cents,amount_paid_cents,status"
        )
        .eq("clinic_id", clinic_id)
        .execute()
    )
    _handle_supabase_error(br_resp)
    br_rows = br_resp.data or []
    bill_month_billed = bill_month_paid = 0
    bill_draft = bill_submitted = bill_paid = bill_denied = bill_partial = 0
    bill_other = 0
    for row in br_rows:
        dos = row.get("date_of_service")
        dos_s = (str(dos).strip()[:10] if dos is not None else "") or ""
        if dos_s and month_start <= dos_s <= month_end:
            bill_month_billed += int(row.get("total_billed_cents") or 0)
            bill_month_paid += int(
                row.get("amount_paid_cents")
                if row.get("amount_paid_cents") is not None
                else row.get("total_paid_cents")
                or 0
            )
        st = (str(row.get("status") or "")).lower() or "draft"
        if st == "draft":
            bill_draft += 1
        elif st == "submitted":
            bill_submitted += 1
        elif st == "paid":
            bill_paid += 1
        elif st == "denied":
            bill_denied += 1
        elif st == "partial":
            bill_partial += 1
        else:
            bill_other += 1

    pca_resp = (
        supabase.table("patient_clinic_access")
        .select("patient_id", count="exact")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    _handle_supabase_error(pca_resp)
    patient_total = int(getattr(pca_resp, "count", None) or len(pca_resp.data or []))

    pi_resp = (
        supabase.table("pi_cases")
        .select("status")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    _handle_supabase_error(pi_resp)
    pi_rows = pi_resp.data or []
    pi_counts: dict[str, int] = {}
    for row in pi_rows:
        st = (str(row.get("status") or "open")).lower()
        pi_counts[st] = pi_counts.get(st, 0) + 1

    mt_resp = (
        supabase.table("membership_tiers")
        .select("id", count="exact")
        .eq("clinic_id", clinic_id)
        .eq("is_active", True)
        .execute()
    )
    _handle_supabase_error(mt_resp)
    active_tier_count = int(
        getattr(mt_resp, "count", None) or len(mt_resp.data or [])
    )

    pm_resp = (
        supabase.table("patient_memberships")
        .select("id", count="exact")
        .eq("clinic_id", clinic_id)
        .eq("status", "active")
        .execute()
    )
    _handle_supabase_error(pm_resp)
    active_memberships = int(
        getattr(pm_resp, "count", None) or len(pm_resp.data or [])
    )

    as_of = datetime.now(timezone.utc).astimezone(_NY_TZ).strftime("%Y-%m-%d %H:%M %Z")
    pi_open = pi_counts.get("open", 0)
    pi_in_treatment = pi_counts.get("in_treatment", 0)
    pi_settled = pi_counts.get("settled", 0)
    pi_pending_settlement = pi_counts.get("pending_settlement", 0)
    pi_closed = pi_counts.get("closed", 0)
    other_pi = sum(
        v for k, v in pi_counts.items() if k not in frozenset(
            {"open", "in_treatment", "settled", "pending_settlement", "closed"}
        )
    )

    lines = [
        f"Clinic data as of {as_of}:",
        f"Appointments: {ap_today} today, {ap_week} this week, {ap_month} this month",
        f"Patients: {patient_total} total",
        (
            f"Billing: {_fmt_usd_from_cents(bill_month_billed)} billed this month, "
            f"{_fmt_usd_from_cents(bill_month_paid)} paid (amounts); "
            f"{bill_draft} draft, {bill_submitted} submitted, "
            f"{bill_paid} invoices marked paid, {bill_denied} denied"
            + (f", {bill_partial} partial" if bill_partial else "")
            + (f", {bill_other} other status" if bill_other else "")
        ),
        (
            f"PI cases: {pi_open} open, {pi_in_treatment} in treatment, "
            f"{pi_settled} settled, {pi_pending_settlement} pending settlement, "
            f"{pi_closed} closed"
            + (f", {other_pi} other status" if other_pi else "")
        ),
        (
            f"Membership: {active_tier_count} active tier(s), "
            f"{active_memberships} active patient enrollment(s)"
        ),
    ]
    return "\n".join(lines)


def _ask_altheon_call_anthropic(question: str, context: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is not set")
    system = (
        "You are Altheon, an AI assistant for a physical therapy "
        "and chiropractic clinic. You have access to live clinic data "
        "provided in the user message. Answer questions about the clinic's "
        "appointments, billing, patients, and cases concisely and clearly. "
        "Never mention Supabase, Anthropic, Claude, or any technical "
        "infrastructure. Keep answers under 3 sentences unless a list "
        "is specifically needed. Be warm and professional."
    )
    payload: dict[str, Any] = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 300,
        "system": system,
        "messages": [
            {
                "role": "user",
                "content": f"{context}\n\nQuestion: {question}",
            }
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    data = json.loads(raw)
    parts: list[str] = []
    for block in data.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text")
            if isinstance(t, str) and t.strip():
                parts.append(t.strip())
    if not parts:
        raise ValueError("empty Anthropic response")
    return " ".join(parts)


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
    try:
        billing_router.recalculate_amount_paid_and_status(billing_record_id)
    except HTTPException:
        raise
    except Exception:
        pass


ALLOWED_BILLING_STATUSES = frozenset(
    {"draft", "submitted", "paid", "denied", "partial"}
)

CLINIC_SETTINGS_PATCHABLE = frozenset(
    {
        "clinic_name",
        "phone",
        "email",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "zip",
        "timezone",
        "billing_model",
        "business_hours",
        "providers",
        "logo_url",
    }
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


@app.get("/clinic-settings/{clinic_id}")
def get_clinic_settings(clinic_id: str):
    try:
        resp = (
            supabase.table("clinic_settings")
            .select("*")
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinic settings not found")
    return rows[0]


@app.patch("/clinic-settings/{clinic_id}")
def patch_clinic_settings(clinic_id: str, body: dict = Body(...)):
    data = {k: body[k] for k in CLINIC_SETTINGS_PATCHABLE if k in body}
    if not data:
        raise HTTPException(
            status_code=400,
            detail="No valid fields to update",
        )
    data["updated_at"] = _now_iso()
    try:
        upd = (
            supabase.table("clinic_settings")
            .update(data)
            .eq("clinic_id", clinic_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinic settings not found")
    return rows[0]


_VOICE_AGENT_DISPLAY_NAME = "Aria"
_VOICE_UPSTREAM_BASE = "https://api.elevenlabs.io/v1/convai"


def _voice_upstream_headers() -> dict[str, str]:
    key = os.environ.get("ELEVENLABS_API_KEY") or ""
    return {"xi-api-key": key, "Accept": "application/json"}


def _voice_upstream_get_json(url: str, timeout: int = 30) -> Any | None:
    try:
        req = urllib.request.Request(url, headers=_voice_upstream_headers(), method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        ValueError,
    ):
        return None


@app.post("/ask-altheon")
def ask_altheon(body: dict = Body(...)):
    # Set ANTHROPIC_API_KEY in Render dashboard → Environment (same as other secrets).
    question = (body.get("question") or "").strip()
    clinic_id = (body.get("clinic_id") or "").strip()
    if not question or not clinic_id:
        return {"answer": _ASK_ALTHEON_FALLBACK}
    try:
        context = _ask_altheon_build_clinic_context(clinic_id)
        answer = _ask_altheon_call_anthropic(question, context)
        return {"answer": answer}
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        ValueError,
        KeyError,
        TypeError,
        HTTPException,
    ):
        return {"answer": _ASK_ALTHEON_FALLBACK}
    except Exception:
        return {"answer": _ASK_ALTHEON_FALLBACK}


@app.get("/voice-agent/status")
def voice_agent_status(
    _clinic_id: Optional[str] = Query(None, alias="clinic_id"),
):
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not agent_id or not api_key:
        return {"status": "offline", "agent_name": _VOICE_AGENT_DISPLAY_NAME}
    safe_id = urllib.parse.quote(agent_id, safe="")
    url = f"{_VOICE_UPSTREAM_BASE}/agents/{safe_id}"
    data = _voice_upstream_get_json(url, timeout=15)
    if data is not None:
        return {"status": "online", "agent_name": _VOICE_AGENT_DISPLAY_NAME}
    return {"status": "offline", "agent_name": _VOICE_AGENT_DISPLAY_NAME}


@app.get("/voice-agent/conversations")
def voice_agent_conversations(
    _clinic_id: Optional[str] = Query(None, alias="clinic_id"),
    page_size: int = Query(20, ge=1, le=50),
):
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not agent_id or not api_key:
        return {"conversations": []}
    qs = urllib.parse.urlencode(
        {"agent_id": agent_id, "page_size": str(page_size)},
        doseq=True,
    )
    url = f"{_VOICE_UPSTREAM_BASE}/conversations?{qs}"
    data = _voice_upstream_get_json(url, timeout=30)
    if not isinstance(data, dict):
        return {"conversations": []}
    convs = data.get("conversations")
    if not isinstance(convs, list):
        return {"conversations": []}
    out: list[dict[str, Any]] = []
    for c in convs:
        if not isinstance(c, dict):
            continue
        direction = c.get("direction")
        if direction is not None and not isinstance(direction, str):
            direction = str(direction)
        out.append(
            {
                "conversation_id": c.get("conversation_id"),
                "start_time_unix_secs": c.get("start_time_unix_secs"),
                "call_duration_secs": c.get("call_duration_secs"),
                "message_count": c.get("message_count"),
                "call_successful": c.get("call_successful"),
                "transcript_summary": c.get("transcript_summary"),
                "direction": direction,
            }
        )
    return {"conversations": out}
