from datetime import date, datetime, timedelta
from typing import Any, Optional
import uuid
import traceback

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.db import supabase
from app.retry_utils import supabase_execute
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _sb_execute(fn):
    """Run Supabase query with transient-failure retry (Render-safe)."""
    try:
        resp = supabase_execute(fn)
        _handle_supabase_error(resp)
        return resp
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    try:
        access = _sb_execute(
            lambda: supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
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
        resp = _sb_execute(
            lambda: supabase.table("clinicians")
            .select("id,clinic_id,is_active,first_name,last_name")
            .eq("id", clinician_id)
            .limit(1)
            .execute()
        )
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
    start_date: str
    end_date: Optional[str] = None
    start_time_of_day: Optional[str] = None
    end_time_of_day: Optional[str] = None
    reason: Optional[str] = None


class BlockedTimeCreateIn(BlockedTimeIn):
    clinician_id: str


def _parse_block_date(value: str) -> date:
    return datetime.strptime(value.strip(), "%Y-%m-%d").date()


def _parse_optional_time_of_day(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).strftime("%H:%M:%S")
        except ValueError:
            continue
    raise ValueError(f"Invalid time of day: {value}")


def _shape_blocked_row(row: dict[str, Any]) -> dict[str, Any]:
    start_tod = row.get("start_time_of_day")
    end_tod = row.get("end_time_of_day")
    return {
        "id": str(row.get("id") or ""),
        "clinician_id": str(row.get("clinician_id") or ""),
        "clinic_id": str(row.get("clinic_id") or ""),
        "start_time": str(row.get("start_time") or ""),
        "end_time": str(row.get("end_time") or ""),
        "start_time_of_day": str(start_tod)[:8] if start_tod else None,
        "end_time_of_day": str(end_tod)[:8] if end_tod else None,
        "reason": row.get("reason"),
    }


@router.get("/clinicians")
def list_clinicians(
    clinic_id: str = Query(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _require_auth_and_clinic(authorization, clinic_id)
    try:
        resp = _sb_execute(
            lambda: supabase.table("clinicians")
            .select("id,first_name,last_name,title,email,color,is_active,clinic_id")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .order("last_name")
            .order("first_name")
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.get("/treatment-types")
def list_treatment_types(
    clinic_id: str = Query(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        print("treatment-types hit")
        _require_auth_and_clinic(authorization, clinic_id)
        print("treatment-types query table=treatment_types")
        print("treatment-types selecting columns=id,name,duration_minutes,requires_evaluation")
        print("treatment-types filter=clinic_id only")
        resp = _sb_execute(
            lambda: supabase.table("treatment_types")
            .select("id,name,duration_minutes,requires_evaluation")
            .eq("clinic_id", clinic_id)
            .order("name")
            .execute()
        )
        print(
            "treatment-types raw response:",
            {
                "data": resp.data,
                "error": str(getattr(resp, "error", None)),
                "count": len(resp.data or []),
            },
        )
        return resp.data or []
    except Exception as e:
        print(f"treatment-types error: {e}")
        traceback.print_exc()
        raise


@router.get("/clinicians/{clinician_id}/availability")
def get_clinician_availability(
    clinician_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        clinician_uuid = str(uuid.UUID(clinician_id))
        clinician = _clinician_row(clinician_uuid)
        clinic_id = str(clinician.get("clinic_id") or "").strip()
        _require_auth_and_clinic(authorization, clinic_id)
        response = _sb_execute(
            lambda: supabase.table("availability_rules")
            .select("*")
            .eq("clinician_id", clinician_uuid)
            .order("day_of_week")
            .execute()
        )
        rows = response.data or []
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "id": str(row.get("id")) if row.get("id") is not None else None,
                    "clinician_id": str(row.get("clinician_id")) if row.get("clinician_id") is not None else None,
                    "clinic_id": str(row.get("clinic_id")) if row.get("clinic_id") is not None else None,
                    "day_of_week": row.get("day_of_week"),
                    "start_time": str(row.get("start_time")) if row.get("start_time") is not None else None,
                    "end_time": str(row.get("end_time")) if row.get("end_time") is not None else None,
                    "slot_duration_minutes": row.get("slot_duration_minutes"),
                    "buffer_minutes": row.get("buffer_minutes"),
                    "is_active": row.get("is_active"),
                }
            )
        return out
    except HTTPException:
        raise
    except Exception as e:
        print(f"GET availability error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/clinicians/{clinician_id}/availability")
def replace_clinician_availability(
    clinician_id: str,
    body: list[AvailabilityRuleIn],
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)
    rules = [rule.model_dump() for rule in body]
    print(f"Rules received: {rules}")

    insert_rows: list[dict[str, Any]] = []
    for rule in rules:
        is_active = bool(rule.get("is_active", False))
        insert_rows.append(
            {
                "clinic_id": clinic_id,
                "clinician_id": clinician_id,
                "day_of_week": int(rule["day_of_week"]),
                "start_time": str(rule["start_time"]),
                "end_time": str(rule["end_time"]),
                "slot_duration_minutes": int(rule["slot_duration_minutes"]),
                "buffer_minutes": int(rule["buffer_minutes"]),
                "is_active": is_active,
            }
        )

    try:
        del_resp = _sb_execute(
            lambda: supabase.table("availability_rules")
            .delete()
            .eq("clinician_id", clinician_id)
            .execute()
        )
        if insert_rows:
            print(f"Inserting rows: {insert_rows}")
            ins_resp = _sb_execute(
                lambda: supabase.table("availability_rules")
                .insert(insert_rows)
                .execute()
            )
        verify = _sb_execute(
            lambda: supabase.table("availability_rules")
            .select("day_of_week, is_active")
            .eq("clinician_id", clinician_id)
            .execute()
        )
        print(f"Verification after save: {verify.data}")
        return verify.data or []
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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

    try:
        query = (
            supabase.table("blocked_time")
            .select("*")
            .eq("clinician_id", clinician_id)
            .gte("end_time", from_date)
        )
        if to_date:
            query = query.lte("start_time", f"{to_date}T23:59:59")
        response = _sb_execute(lambda: query.order("start_time").execute())
        return [_shape_blocked_row(row) for row in (response.data or [])]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _insert_blocked_time(
    clinician_id: str,
    body: BlockedTimeIn,
    *,
    authorization: Optional[str],
) -> dict[str, Any]:
    clinician = _clinician_row(clinician_id)
    clinic_id = str(clinician.get("clinic_id") or "").strip()
    _require_auth_and_clinic(authorization, clinic_id)

    try:
        start_date = _parse_block_date(body.start_date)
        if body.end_date and str(body.end_date).strip():
            end_date = _parse_block_date(body.end_date)
        else:
            end_date = start_date
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="start_date and end_date must be YYYY-MM-DD",
        ) from exc
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

    try:
        start_time_of_day = _parse_optional_time_of_day(body.start_time_of_day)
        end_time_of_day = _parse_optional_time_of_day(body.end_time_of_day)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if bool(start_time_of_day) ^ bool(end_time_of_day):
        raise HTTPException(
            status_code=400,
            detail="start_time_of_day and end_time_of_day must both be set or both be omitted",
        )
    if start_time_of_day and end_time_of_day and end_time_of_day <= start_time_of_day:
        raise HTTPException(
            status_code=400,
            detail="end_time_of_day must be after start_time_of_day",
        )

    reason = (body.reason or "").strip() or None
    insert_rows: list[dict[str, Any]] = []
    current = start_date
    while current <= end_date:
        insert_rows.append(
            {
                "clinician_id": clinician_id,
                "clinic_id": clinic_id,
                "start_time": current.isoformat(),
                "end_time": current.isoformat(),
                "start_time_of_day": start_time_of_day,
                "end_time_of_day": end_time_of_day,
                "reason": reason,
            }
        )
        current += timedelta(days=1)

    n = len(insert_rows)
    print(
        f"schedule block {start_date.isoformat()} to {end_date.isoformat()} — {n} days created"
    )

    try:
        ins = _sb_execute(
            lambda: supabase.table("blocked_time").insert(insert_rows).execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create blocked time")
    if n == 1:
        return _shape_blocked_row(rows[0])
    return {
        "count": n,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "blocks": [_shape_blocked_row(row) for row in rows],
    }


@router.post("/availability/blocked-time")
def create_blocked_time_availability(
    body: BlockedTimeCreateIn,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = body.clinician_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinician_id is required")
    return _insert_blocked_time(cid, body, authorization=authorization)


@router.post("/clinicians/{clinician_id}/blocked-time")
def create_blocked_time(
    clinician_id: str,
    body: BlockedTimeIn,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    return _insert_blocked_time(clinician_id, body, authorization=authorization)


@router.delete("/blocked-time/{blocked_time_id}")
def delete_blocked_time(
    blocked_time_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        existing = _sb_execute(
            lambda: supabase.table("blocked_time")
            .select("id,clinic_id")
            .eq("id", blocked_time_id)
            .limit(1)
            .execute()
        )
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
        resp = _sb_execute(
            lambda: supabase.table("blocked_time")
            .delete()
            .eq("id", blocked_time_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"deleted": blocked_time_id}

