"""Patient groups and group memberships per clinic."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.db import supabase
from app.retry_utils import supabase_execute

router = APIRouter()
patients_groups_router = APIRouter()
logger = logging.getLogger(__name__)

_GROUP_COLUMNS = (
    "id, clinic_id, name, description, color, priority_flag, is_active, created_at"
)


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


def _shape_group(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "clinic_id": row.get("clinic_id"),
        "name": row.get("name"),
        "description": row.get("description"),
        "color": row.get("color"),
        "priority_flag": row.get("priority_flag"),
        "is_active": row.get("is_active"),
        "created_at": row.get("created_at"),
    }


def _nested_row(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, dict) else {}


def _shape_member(row: dict[str, Any]) -> dict[str, Any]:
    patient = _nested_row(row.get("patients"))
    return {
        "id": row.get("id"),
        "patient_id": row.get("patient_id"),
        "first_name": patient.get("first_name"),
        "last_name": patient.get("last_name"),
        "created_at": row.get("created_at"),
    }


def _shape_patient_group(row: dict[str, Any]) -> dict[str, Any]:
    group = _nested_row(row.get("groups"))
    return {
        "id": group.get("id"),
        "name": group.get("name"),
        "color": group.get("color"),
        "priority_flag": group.get("priority_flag"),
    }


def _fetch_group(group_id: str) -> dict[str, Any]:
    try:
        resp = _sb_execute(
            lambda: supabase.table("groups")
            .select(_GROUP_COLUMNS)
            .eq("id", group_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("fetch group failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")
    return rows[0]


class GroupCreate(BaseModel):
    clinic_id: str
    name: str
    description: Optional[str] = None
    color: str = "gray"
    priority_flag: bool = False


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    priority_flag: Optional[bool] = None
    is_active: Optional[bool] = None


class AddMemberBody(BaseModel):
    patient_id: str
    clinic_id: str


@router.get("")
def list_groups(clinic_id: str = Query(...)):
    try:
        resp = _sb_execute(
            lambda: supabase.table("groups")
            .select(_GROUP_COLUMNS)
            .eq("clinic_id", clinic_id)
            .order("name")
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_groups failed clinic_id=%s", clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return [_shape_group(r) for r in resp.data or [] if isinstance(r, dict)]


@router.post("")
def create_group(body: GroupCreate):
    row = {
        "clinic_id": body.clinic_id.strip(),
        "name": body.name.strip(),
        "description": body.description,
        "color": (body.color or "gray").strip() or "gray",
        "priority_flag": body.priority_flag,
        "is_active": True,
    }
    try:
        ins = _sb_execute(lambda: supabase.table("groups").insert(row).execute())
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_group failed clinic_id=%s", body.clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create group")
    return _shape_group(rows[0])


@router.patch("/{group_id}")
def update_group(group_id: str, body: GroupUpdate):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        upd = _sb_execute(
            lambda: supabase.table("groups").update(data).eq("id", group_id).execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("update_group failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")
    return _shape_group(rows[0])


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str):
    try:
        dele = _sb_execute(
            lambda: supabase.table("groups").delete().eq("id", group_id).execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("delete_group failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/{group_id}/members")
def list_group_members(group_id: str):
    _fetch_group(group_id)
    try:
        resp = _sb_execute(
            lambda: supabase.table("patient_group_memberships")
            .select("id, patient_id, created_at, patients(first_name, last_name)")
            .eq("group_id", group_id)
            .order("created_at")
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_group_members failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return [_shape_member(r) for r in resp.data or [] if isinstance(r, dict)]


@router.post("/{group_id}/members")
def add_group_member(group_id: str, body: AddMemberBody):
    group = _fetch_group(group_id)
    clinic_id = body.clinic_id.strip()
    patient_id = body.patient_id.strip()
    if str(group.get("clinic_id") or "") != clinic_id:
        raise HTTPException(
            status_code=400,
            detail="clinic_id does not match the group's clinic",
        )

    try:
        existing = _sb_execute(
            lambda: supabase.table("patient_group_memberships")
            .select("id, patient_id, group_id, clinic_id, created_at")
            .eq("group_id", group_id)
            .eq("patient_id", patient_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("add_group_member existing check failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if existing.data:
        return existing.data[0]

    row = {
        "group_id": group_id,
        "patient_id": patient_id,
        "clinic_id": clinic_id,
    }
    try:
        ins = _sb_execute(
            lambda: supabase.table("patient_group_memberships").insert(row).execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        err = str(exc).lower()
        if "duplicate" in err or "unique" in err or "23505" in err:
            dup = _sb_execute(
                lambda: supabase.table("patient_group_memberships")
                .select("id, patient_id, group_id, clinic_id, created_at")
                .eq("group_id", group_id)
                .eq("patient_id", patient_id)
                .limit(1)
                .execute()
            )
            if dup.data:
                return dup.data[0]
        logger.exception("add_group_member insert failed group_id=%s", group_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to add group member")
    return rows[0]


@router.delete("/{group_id}/members/{patient_id}", status_code=204)
def remove_group_member(group_id: str, patient_id: str):
    try:
        dele = _sb_execute(
            lambda: supabase.table("patient_group_memberships")
            .delete()
            .eq("group_id", group_id)
            .eq("patient_id", patient_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "remove_group_member failed group_id=%s patient_id=%s",
            group_id,
            patient_id,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=204)


@patients_groups_router.get("/patients/{patient_id}/groups")
def list_patient_groups(
    patient_id: str,
    clinic_id: str = Query(...),
):
    try:
        resp = _sb_execute(
            lambda: supabase.table("patient_group_memberships")
            .select("groups(id, name, color, priority_flag)")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "list_patient_groups failed patient_id=%s clinic_id=%s",
            patient_id,
            clinic_id,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        shaped = _shape_patient_group(row)
        if shaped.get("id"):
            out.append(shaped)
    out.sort(key=lambda g: (str(g.get("name") or "")).lower())
    return out
