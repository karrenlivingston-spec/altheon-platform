from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.db import supabase

router = APIRouter()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _resolve_bearer_user_id(authorization: Optional[str]) -> str:
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
    return user_id


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    try:
        access = (
            supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(access)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not access.data:
        raise HTTPException(status_code=403, detail="No clinic access for user")


def _require_auth_and_clinic(authorization: Optional[str], clinic_id: str) -> str:
    user_id = _resolve_bearer_user_id(authorization)
    _assert_user_has_clinic_access(user_id, clinic_id)
    return user_id


def _clinician_row(clinician_id: str) -> dict[str, Any]:
    try:
        resp = (
            supabase.table("clinicians")
            .select("id,clinic_id,is_active,first_name,last_name")
            .eq("id", clinician_id)
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
        raise HTTPException(status_code=404, detail="Clinician not found")
    return rows[0]


class AvailabilityRuleIn(BaseModel):
    day_of_week: int
    start_time: str
    end_time: str
    slot_duration_minutes: int
    buffer_minutes: int
    is_active: bool


class BlockedTimeIn(BaseModel):
    start_time: str
    end_time: str
    reason: Optional[str] = None


@router.get("/clinicians")
def list_clinicians(
    clinic_id: str = Query(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_auth_and_clinic(authorization, clinic_id)
    try:
        resp = (
            supabase.table("clinicians")
            .select("id,first_name,last_name,title,email,color,is_active,clinic_id")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .order("last_name")
            .order("first_name")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.get("/clinicians/{clinician_id}/availability")
def get_clinician_availability(
    clinician_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)
    try:
        resp = (
            supabase.table("availability_rules")
            .select("*")
            .eq("clinician_id", clinician_id)
            .order("day_of_week")
            .order("start_time")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.put("/clinicians/{clinician_id}/availability")
def replace_clinician_availability(
    clinician_id: str,
    body: list[AvailabilityRuleIn],
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)

    try:
        del_resp = (
            supabase.table("availability_rules")
            .delete()
            .eq("clinician_id", clinician_id)
            .execute()
        )
        _handle_supabase_error(del_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    insert_rows: list[dict[str, Any]] = []
    for row in body:
        insert_rows.append(
            {
                "clinician_id": clinician_id,
                "clinic_id": clinic_id,
                "day_of_week": row.day_of_week,
                "start_time": row.start_time,
                "end_time": row.end_time,
                "slot_duration_minutes": row.slot_duration_minutes,
                "buffer_minutes": row.buffer_minutes,
                "is_active": row.is_active,
            }
        )

    if insert_rows:
        try:
            ins_resp = supabase.table("availability_rules").insert(insert_rows).execute()
            _handle_supabase_error(ins_resp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        out = (
            supabase.table("availability_rules")
            .select("*")
            .eq("clinician_id", clinician_id)
            .order("day_of_week")
            .order("start_time")
            .execute()
        )
        _handle_supabase_error(out)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return out.data or []


@router.get("/clinicians/{clinician_id}/blocked-time")
def get_blocked_time(
    clinician_id: str,
    from_date: str = Query(...),
    to_date: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)

    try:
        datetime.strptime(from_date, "%Y-%m-%d")
        if to_date:
            datetime.strptime(to_date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="from_date/to_date must be YYYY-MM-DD") from exc

    query = (
        supabase.table("blocked_time")
        .select("*")
        .eq("clinician_id", clinician_id)
        .gte("end_time", f"{from_date}T00:00:00")
    )
    if to_date:
        query = query.lte("start_time", f"{to_date}T23:59:59")

    try:
        resp = query.order("start_time").execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.post("/clinicians/{clinician_id}/blocked-time")
def create_blocked_time(
    clinician_id: str,
    body: BlockedTimeIn,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)

    row = {
        "clinician_id": clinician_id,
        "clinic_id": clinic_id,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "reason": (body.reason or "").strip() or None,
    }
    try:
        ins = supabase.table("blocked_time").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create blocked time")
    return rows[0]


@router.delete("/blocked-time/{blocked_time_id}")
def delete_blocked_time(
    blocked_time_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        existing = (
            supabase.table("blocked_time")
            .select("id,clinic_id")
            .eq("id", blocked_time_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = existing.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Blocked time not found")
    clinic_id = str(rows[0].get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)

    try:
        resp = supabase.table("blocked_time").delete().eq("id", blocked_time_id).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"deleted": blocked_time_id}

