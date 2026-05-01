import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()
logger = logging.getLogger(__name__)

BillingCycle = Literal["monthly", "quarterly", "annual"]
ALLOWED_MEMBERSHIP_STATUS = frozenset({"active", "paused", "cancelled", "expired"})


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _next_period_start(period_start: date, billing_cycle: str) -> date:
    if billing_cycle == "monthly":
        return period_start + relativedelta(months=1)
    if billing_cycle == "quarterly":
        return period_start + relativedelta(months=3)
    if billing_cycle == "annual":
        return period_start + relativedelta(years=1)
    raise HTTPException(status_code=400, detail="Invalid billing_cycle on tier")


class TierCreate(BaseModel):
    clinic_id: str
    name: str
    description: Optional[str] = None
    price_cents: int
    billing_cycle: BillingCycle
    visits_included: int
    visits_roll_over: bool = False
    is_active: bool = True
    treatment_type_ids: list[str] = Field(default_factory=list)


class TierUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = None
    billing_cycle: Optional[BillingCycle] = None
    visits_included: Optional[int] = None
    visits_roll_over: Optional[bool] = None
    is_active: Optional[bool] = None
    treatment_type_ids: Optional[list[str]] = None


class EnrollmentCreate(BaseModel):
    patient_id: str
    clinic_id: str
    tier_id: str
    current_period_start: date
    auto_renew: bool = True


class StatusUpdate(BaseModel):
    status: str


class TierChangeRequest(BaseModel):
    new_tier_id: str


class LogVisitRequest(BaseModel):
    membership_id: str
    appointment_id: Optional[str] = None
    treatment_type_id: Optional[str] = None
    notes: Optional[str] = None


@router.get("/membership-tiers")
def list_membership_tiers(clinic_id: str = Query(...)):
    try:
        resp = (
            supabase.table("membership_tiers")
            .select("*, membership_tier_services(treatment_type_id)")
            .eq("clinic_id", clinic_id)
            .order("name")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_membership_tiers failed clinic_id=%s", clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.post("/membership-tiers")
def create_membership_tier(body: TierCreate):
    row = {
        "clinic_id": body.clinic_id,
        "name": body.name,
        "description": body.description,
        "price_cents": body.price_cents,
        "billing_cycle": body.billing_cycle,
        "visits_included": body.visits_included,
        "visits_roll_over": body.visits_roll_over,
        "is_active": body.is_active,
    }
    try:
        ins = supabase.table("membership_tiers").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_membership_tier failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    tier_rows = ins.data or []
    if not tier_rows:
        raise HTTPException(status_code=500, detail="Failed to create tier")
    tier_id = tier_rows[0]["id"]

    if body.treatment_type_ids:
        links = [
            {"tier_id": tier_id, "treatment_type_id": tid} for tid in body.treatment_type_ids
        ]
        try:
            link_ins = supabase.table("membership_tier_services").insert(links).execute()
            _handle_supabase_error(link_ins)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("create_membership_tier services failed tier_id=%s", tier_id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        out = (
            supabase.table("membership_tiers")
            .select("*, membership_tier_services(treatment_type_id)")
            .eq("id", tier_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(out)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_membership_tier refetch failed tier_id=%s", tier_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = out.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Tier created but not found")
    return rows[0]


@router.patch("/membership-tiers/{tier_id}")
def update_membership_tier(tier_id: str, body: TierUpdate):
    data = body.model_dump(exclude_unset=True)
    replace_services: Optional[list[str]] = None
    if "treatment_type_ids" in data:
        replace_services = data.pop("treatment_type_ids")

    if not data and replace_services is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        if data:
            upd = supabase.table("membership_tiers").update(data).eq("id", tier_id).execute()
            _handle_supabase_error(upd)
            if not (upd.data or []):
                raise HTTPException(status_code=404, detail="Tier not found")

        if replace_services is not None:
            delete_resp = (
                supabase.table("membership_tier_services").delete().eq("tier_id", tier_id).execute()
            )
            _handle_supabase_error(delete_resp)
            if replace_services:
                links = [
                    {"tier_id": tier_id, "treatment_type_id": tid} for tid in replace_services
                ]
                link_ins = supabase.table("membership_tier_services").insert(links).execute()
                _handle_supabase_error(link_ins)

        out = (
            supabase.table("membership_tiers")
            .select("*, membership_tier_services(treatment_type_id)")
            .eq("id", tier_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(out)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("update_membership_tier failed tier_id=%s", tier_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = out.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Tier not found")
    return rows[0]


@router.get("/patient-memberships")
def list_patient_memberships(
    clinic_id: str = Query(...),
    patient_id: str = Query(...),
):
    try:
        resp = (
            supabase.table("patient_memberships")
            .select(
                "*, membership_tiers(name, price_cents, billing_cycle, visits_included)"
            )
            .eq("clinic_id", clinic_id)
            .eq("patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "list_patient_memberships failed clinic_id=%s patient_id=%s",
            clinic_id,
            patient_id,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.post("/patient-memberships")
def create_patient_membership(body: EnrollmentCreate):
    try:
        existing = (
            supabase.table("patient_memberships")
            .select("id")
            .eq("patient_id", body.patient_id)
            .eq("clinic_id", body.clinic_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_patient_membership existing check failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="Patient already has an active membership at this clinic",
        )

    try:
        tier_r = (
            supabase.table("membership_tiers")
            .select("*")
            .eq("id", body.tier_id)
            .eq("clinic_id", body.clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(tier_r)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_patient_membership tier fetch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    tier_rows = tier_r.data or []
    if not tier_rows:
        raise HTTPException(status_code=404, detail="Tier not found")
    tier = tier_rows[0]

    billing_cycle = tier["billing_cycle"]
    next_start = _next_period_start(body.current_period_start, billing_cycle)
    period_end = next_start - timedelta(days=1)

    started_at = datetime.combine(
        body.current_period_start, time.min, tzinfo=timezone.utc
    ).isoformat()
    expires_at = datetime.combine(
        period_end, time(23, 59, 59, tzinfo=timezone.utc), tzinfo=timezone.utc
    ).isoformat()

    insert_row = {
        "patient_id": body.patient_id,
        "clinic_id": body.clinic_id,
        "tier_id": body.tier_id,
        "status": "active",
        "visits_included": tier["visits_included"],
        "visits_used": 0,
        "visits_remaining": tier["visits_included"],
        "started_at": started_at,
        "expires_at": expires_at,
        "next_billing_date": next_start.isoformat(),
        "auto_renew": body.auto_renew,
        "billing_cycle_count": 0,
    }

    try:
        ins = supabase.table("patient_memberships").insert(insert_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_patient_membership insert failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    inserted = ins.data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="Failed to create membership")
    return inserted[0]


@router.patch("/patient-memberships/{membership_id}/status")
def update_patient_membership_status(membership_id: str, body: StatusUpdate):
    if body.status not in ALLOWED_MEMBERSHIP_STATUS:
        raise HTTPException(status_code=400, detail="Invalid status")

    try:
        result = (
            supabase.table("patient_memberships")
            .update({"status": body.status})
            .eq("id", membership_id)
            .execute()
        )
        _handle_supabase_error(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("update_patient_membership_status failed membership_id=%s", membership_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Membership not found")
    return rows[0]


@router.patch("/patient-memberships/{membership_id}/tier")
def change_patient_membership_tier(membership_id: str, body: TierChangeRequest):
    try:
        mem_r = (
            supabase.table("patient_memberships")
            .select("*")
            .eq("id", membership_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(mem_r)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("change_patient_membership_tier fetch membership failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    mem_rows = mem_r.data or []
    if not mem_rows:
        raise HTTPException(status_code=404, detail="Membership not found")
    mem = mem_rows[0]

    try:
        new_tier_r = (
            supabase.table("membership_tiers")
            .select("*")
            .eq("id", body.new_tier_id)
            .eq("clinic_id", mem["clinic_id"])
            .limit(1)
            .execute()
        )
        _handle_supabase_error(new_tier_r)
        cur_tier_r = (
            supabase.table("membership_tiers")
            .select("price_cents, visits_included")
            .eq("id", mem["tier_id"])
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur_tier_r)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("change_patient_membership_tier fetch tiers failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    new_tier_rows = new_tier_r.data or []
    cur_tier_rows = cur_tier_r.data or []
    if not new_tier_rows:
        raise HTTPException(status_code=404, detail="New tier not found")
    if not cur_tier_rows:
        raise HTTPException(status_code=404, detail="Current tier not found")

    new_tier = new_tier_rows[0]
    cur_tier = cur_tier_rows[0]
    old_price = int(cur_tier["price_cents"])
    new_price = int(new_tier["price_cents"])

    try:
        if new_price < old_price:
            if int(mem.get("billing_cycle_count") or 0) < 3:
                raise HTTPException(
                    status_code=403,
                    detail="Downgrade requires at least 3 completed billing cycles",
                )
            result = (
                supabase.table("patient_memberships")
                .update({"pending_tier_change_id": body.new_tier_id})
                .eq("id", membership_id)
                .execute()
            )
        else:
            result = (
                supabase.table("patient_memberships")
                .update(
                    {
                        "tier_id": body.new_tier_id,
                        "pending_tier_change_id": None,
                        "visits_used": 0,
                        "visits_remaining": new_tier["visits_included"],
                    }
                )
                .eq("id", membership_id)
                .execute()
            )
        _handle_supabase_error(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("change_patient_membership_tier update failed membership_id=%s", membership_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Membership not found")
    return rows[0]


@router.post("/membership-visits")
def log_membership_visit(body: LogVisitRequest):
    try:
        mem_r = (
            supabase.table("patient_memberships")
            .select("id, visits_remaining, visits_used")
            .eq("id", body.membership_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(mem_r)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("log_membership_visit fetch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    mem_rows = mem_r.data or []
    if not mem_rows:
        raise HTTPException(status_code=404, detail="Membership not found")
    mem = mem_rows[0]

    if int(mem["visits_remaining"]) <= 0:
        raise HTTPException(status_code=400, detail="No visits remaining")

    log_row: dict[str, Any] = {"membership_id": body.membership_id}
    if body.appointment_id is not None:
        log_row["appointment_id"] = body.appointment_id
    if body.treatment_type_id is not None:
        log_row["treatment_type_id"] = body.treatment_type_id
    if body.notes is not None:
        log_row["notes"] = body.notes

    try:
        ins = supabase.table("membership_visit_log").insert(log_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("log_membership_visit insert log failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    new_used = int(mem["visits_used"]) + 1
    new_rem = int(mem["visits_remaining"]) - 1

    try:
        upd = (
            supabase.table("patient_memberships")
            .update({"visits_used": new_used, "visits_remaining": new_rem})
            .eq("id", body.membership_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("log_membership_visit decrement failed membership_id=%s", body.membership_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    log_rows = ins.data or []
    return {
        "visit_log": log_rows[0] if log_rows else None,
        "visits_used": new_used,
        "visits_remaining": new_rem,
    }
