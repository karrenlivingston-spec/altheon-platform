"""CPT code library, modifier rules, and per-clinic fee schedules."""

from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

import jwt as pyjwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.retry_utils import supabase_execute

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _handle_supabase_error(response: Any, *, table: str) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        print(f"[fee_schedule] Supabase error table={table} detail={detail} raw={response}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=detail)


def _supabase_execute(fn, *, table: str):
    try:
        response = supabase_execute(fn)
        _handle_supabase_error(response, table=table)
        return response
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[fee_schedule] Supabase exception table={table}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _resolve_bearer_user_id(authorization: Optional[str]) -> str:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        payload = pyjwt.decode(token, options={"verify_signature": False})
        user_id = str(payload.get("sub") or "").strip()
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return user_id
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    def _run():
        return (
            supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )

    access = _supabase_execute(_run, table="clinic_users")
    if not access.data:
        raise HTTPException(status_code=403, detail="No clinic access for user")


class ClinicUserContext(BaseModel):
    user_id: str
    clinic_id: str


def get_current_clinic_user(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    clinic_id: str = Query(..., min_length=1),
) -> ClinicUserContext:
    user_id = _resolve_bearer_user_id(authorization)
    cid = clinic_id.strip()
    _assert_user_has_clinic_access(user_id, cid)
    return ClinicUserContext(user_id=user_id, clinic_id=cid)


ClinicUserDep = Annotated[ClinicUserContext, Depends(get_current_clinic_user)]


def _fetch_cpt_code_row(code: str) -> Optional[dict[str, Any]]:
    c = (code or "").strip().upper()
    if not c:
        return None

    def _run():
        return (
            supabase.table("cpt_codes")
            .select("code, description, category, default_units")
            .eq("code", c)
            .limit(1)
            .execute()
        )

    resp = _supabase_execute(_run, table="cpt_codes")
    rows = resp.data or []
    return rows[0] if rows else None


def _shape_fee_schedule_row(
    row: dict[str, Any],
    cpt: Optional[dict[str, Any]],
) -> dict[str, Any]:
    cpt = cpt or {}
    return {
        "id": row.get("id"),
        "cpt_code": row.get("cpt_code"),
        "description": cpt.get("description"),
        "category": cpt.get("category"),
        "charge": row.get("charge"),
        "pi_charge": row.get("pi_charge"),
        "modifiers": row.get("modifiers") or [],
        "is_active": row.get("is_active"),
    }


def _shape_pi_rate_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "cpt_code": row.get("cpt_code"),
        "pi_charge": row.get("pi_charge"),
    }


def _load_cpt_map(codes: list[str]) -> dict[str, dict[str, Any]]:
    unique = sorted({(c or "").strip().upper() for c in codes if (c or "").strip()})
    if not unique:
        return {}

    def _run():
        return (
            supabase.table("cpt_codes")
            .select("code, description, category, default_units")
            .in_("code", unique)
            .execute()
        )

    resp = _supabase_execute(_run, table="cpt_codes")
    return {str(r["code"]): r for r in (resp.data or []) if r.get("code")}


def _fetch_fee_schedule_by_id(
    schedule_id: str,
    clinic_id: str,
) -> dict[str, Any]:
    def _run():
        return (
            supabase.table("clinic_fee_schedules")
            .select("*")
            .eq("id", schedule_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )

    resp = _supabase_execute(_run, table="clinic_fee_schedules")
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Fee schedule entry not found")
    return rows[0]


def _ensure_cpt_code(code: str, description: Optional[str] = None) -> dict[str, Any]:
    """Return CPT library row, creating or updating description when needed."""
    c = (code or "").strip().upper()
    if not c:
        raise HTTPException(status_code=400, detail="CPT code is required")

    existing = _fetch_cpt_code_row(c)
    desc = (description or "").strip()

    if existing:
        if desc and desc != str(existing.get("description") or "").strip():
            def _update_desc():
                return (
                    supabase.table("cpt_codes")
                    .update({"description": desc, "updated_at": _now_iso()})
                    .eq("code", c)
                    .execute()
                )

            _supabase_execute(_update_desc, table="cpt_codes")
            existing["description"] = desc
        return existing

    if not desc:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown CPT code: {c}. Provide a description to add it.",
        )

    payload = {
        "code": c,
        "description": desc,
        "category": "Custom",
        "default_units": 1,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    def _insert():
        return supabase.table("cpt_codes").insert(payload).execute()

    ins = _supabase_execute(_insert, table="cpt_codes")
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to create CPT code")
    return ins.data[0]


def _upsert_fee_schedule(
    *,
    clinic_id: str,
    cpt_code: str,
    charge: float,
    modifiers: list[str],
    description: Optional[str] = None,
    pi_charge: Optional[float] = None,
    update_pi_charge: bool = False,
) -> dict[str, Any]:
    code = cpt_code.strip().upper()
    _ensure_cpt_code(code, description)

    payload: dict[str, Any] = {
        "clinic_id": clinic_id,
        "cpt_code": code,
        "charge": charge,
        "modifiers": modifiers,
        "is_active": True,
        "updated_at": _now_iso(),
    }

    def _find():
        return (
            supabase.table("clinic_fee_schedules")
            .select("id")
            .eq("clinic_id", clinic_id)
            .eq("cpt_code", code)
            .limit(1)
            .execute()
        )

    existing = _supabase_execute(_find, table="clinic_fee_schedules")
    rows = existing.data or []

    if rows:
        row_id = str(rows[0]["id"])
        if update_pi_charge:
            payload["pi_charge"] = pi_charge

        def _update():
            return (
                supabase.table("clinic_fee_schedules")
                .update(payload)
                .eq("id", row_id)
                .execute()
            )

        upd = _supabase_execute(_update, table="clinic_fee_schedules")
        if not upd.data:
            raise HTTPException(status_code=500, detail="Failed to update fee schedule")
        saved = upd.data[0]
    else:
        payload["created_at"] = _now_iso()
        payload["pi_charge"] = pi_charge if update_pi_charge else None

        def _insert():
            return supabase.table("clinic_fee_schedules").insert(payload).execute()

        ins = _supabase_execute(_insert, table="clinic_fee_schedules")
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create fee schedule")
        saved = ins.data[0]

    cpt = _fetch_cpt_code_row(code)
    return _shape_fee_schedule_row(saved, cpt)


class FeeScheduleUpsertBody(BaseModel):
    cpt_code: str = Field(min_length=1, max_length=10)
    charge: float = Field(gt=0)
    pi_charge: Optional[float] = Field(default=None, gt=0)
    description: Optional[str] = None
    modifiers: list[str] = Field(default_factory=list)


class FeeScheduleBulkItem(BaseModel):
    cpt_code: str = Field(min_length=1, max_length=10)
    charge: float = Field(gt=0)
    pi_charge: Optional[float] = Field(default=None, gt=0)
    modifiers: list[str] = Field(default_factory=list)


class FeeScheduleBulkBody(BaseModel):
    items: list[FeeScheduleBulkItem] = Field(min_length=1)


class FeeSchedulePatchBody(BaseModel):
    charge: Optional[float] = Field(default=None, gt=0)
    pi_charge: Optional[float] = Field(default=None, gt=0)
    description: Optional[str] = None
    modifiers: Optional[list[str]] = None
    is_active: Optional[bool] = None


@router.get("/cpt-codes")
def list_cpt_codes(
    category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    def _run():
        q = supabase.table("cpt_codes").select(
            "id, code, description, category, default_units"
        )
        if category and category.strip():
            q = q.eq("category", category.strip())
        if search and search.strip():
            esc = search.strip().replace("%", "\\%").replace(",", " ")
            like = f"%{esc}%"
            q = q.or_(f"code.ilike.{like},description.ilike.{like}")
        return q.order("category").order("code").execute()

    resp = _supabase_execute(_run, table="cpt_codes")
    return resp.data or []


@router.get("/modifier-rules")
def list_modifier_rules():
    def _run():
        return (
            supabase.table("modifier_rules")
            .select("modifier_code, description, trigger_condition, applies_to_cpt")
            .order("modifier_code")
            .execute()
        )

    resp = _supabase_execute(_run, table="modifier_rules")
    return resp.data or []


@router.get("/fee-schedule/pi")
def list_clinic_pi_fee_schedule(clinic: ClinicUserDep):
    """Minimal PI rate lookup for billing modals — active rows with pi_charge set."""

    def _run():
        return (
            supabase.table("clinic_fee_schedules")
            .select("cpt_code, pi_charge")
            .eq("clinic_id", clinic.clinic_id)
            .eq("is_active", True)
            .not_.is_("pi_charge", "null")
            .execute()
        )

    resp = _supabase_execute(_run, table="clinic_fee_schedules")
    rows = resp.data or []
    shaped = [_shape_pi_rate_row(r) for r in rows if isinstance(r, dict)]
    shaped.sort(key=lambda x: str(x.get("cpt_code") or ""))
    return shaped


@router.get("/fee-schedule")
def list_clinic_fee_schedule(clinic: ClinicUserDep):
    def _run():
        return (
            supabase.table("clinic_fee_schedules")
            .select("id, cpt_code, charge, pi_charge, modifiers, is_active")
            .eq("clinic_id", clinic.clinic_id)
            .eq("is_active", True)
            .execute()
        )

    resp = _supabase_execute(_run, table="clinic_fee_schedules")
    rows = resp.data or []
    cpt_map = _load_cpt_map([str(r.get("cpt_code") or "") for r in rows])
    shaped = [_shape_fee_schedule_row(r, cpt_map.get(str(r.get("cpt_code") or ""))) for r in rows]
    shaped.sort(key=lambda x: str(x.get("cpt_code") or ""))
    return shaped


@router.post("/fee-schedule")
def upsert_fee_schedule(body: FeeScheduleUpsertBody, clinic: ClinicUserDep):
    fields_set = body.model_fields_set
    return _upsert_fee_schedule(
        clinic_id=clinic.clinic_id,
        cpt_code=body.cpt_code,
        charge=body.charge,
        modifiers=body.modifiers,
        description=body.description,
        pi_charge=body.pi_charge,
        update_pi_charge="pi_charge" in fields_set,
    )


@router.post("/fee-schedule/bulk")
def bulk_upsert_fee_schedule(body: FeeScheduleBulkBody, clinic: ClinicUserDep):
    saved = 0
    errors: list[str] = []
    for idx, item in enumerate(body.items):
        try:
            item_fields = item.model_fields_set
            _upsert_fee_schedule(
                clinic_id=clinic.clinic_id,
                cpt_code=item.cpt_code,
                charge=item.charge,
                modifiers=item.modifiers,
                pi_charge=item.pi_charge,
                update_pi_charge="pi_charge" in item_fields,
            )
            saved += 1
        except HTTPException as exc:
            errors.append(f"row {idx + 1} ({item.cpt_code}): {exc.detail}")
        except Exception as exc:
            traceback.print_exc()
            errors.append(f"row {idx + 1} ({item.cpt_code}): {exc}")
    return {"saved": saved, "errors": errors}


@router.patch("/fee-schedule/{schedule_id}")
def patch_fee_schedule(
    schedule_id: str,
    body: FeeSchedulePatchBody,
    clinic: ClinicUserDep,
):
    existing = _fetch_fee_schedule_by_id(schedule_id, clinic.clinic_id)
    cpt_code = str(existing.get("cpt_code") or "")

    if body.description is not None:
        _ensure_cpt_code(cpt_code, body.description)

    patch_fields = body.model_dump(exclude_unset=True)
    update_data: dict[str, Any] = {"updated_at": _now_iso()}
    if "charge" in patch_fields:
        update_data["charge"] = body.charge
    if "pi_charge" in patch_fields:
        update_data["pi_charge"] = body.pi_charge
    if body.modifiers is not None:
        update_data["modifiers"] = body.modifiers
    if body.is_active is not None:
        update_data["is_active"] = body.is_active

    if len(update_data) == 1:
        cpt = _fetch_cpt_code_row(cpt_code)
        return _shape_fee_schedule_row(existing, cpt)

    def _run():
        return (
            supabase.table("clinic_fee_schedules")
            .update(update_data)
            .eq("id", schedule_id)
            .eq("clinic_id", clinic.clinic_id)
            .execute()
        )

    resp = _supabase_execute(_run, table="clinic_fee_schedules")
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to update fee schedule")
    row = resp.data[0]
    cpt = _fetch_cpt_code_row(str(row.get("cpt_code") or ""))
    return _shape_fee_schedule_row(row, cpt)


@router.delete("/fee-schedule/{schedule_id}")
def delete_fee_schedule(schedule_id: str, clinic: ClinicUserDep):
    _fetch_fee_schedule_by_id(schedule_id, clinic.clinic_id)

    def _run():
        return (
            supabase.table("clinic_fee_schedules")
            .update({"is_active": False, "updated_at": _now_iso()})
            .eq("id", schedule_id)
            .eq("clinic_id", clinic.clinic_id)
            .execute()
        )

    _supabase_execute(_run, table="clinic_fee_schedules")
    return {"success": True}
