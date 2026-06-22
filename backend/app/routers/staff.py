"""Clinic staff management and invitations."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from app.db import supabase
from app.dependencies.permissions import (
    ADMIN_ROLES,
    STAFF_ASSIGNABLE_ROLES,
    AuthorizedClinicUser,
    enforce_clinic_role_from_auth_header,
    require_role,
)
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()
logger = logging.getLogger(__name__)

INVITE_TTL_DAYS = 7


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _auth_user_email(user_id: str) -> str:
    try:
        resp = supabase.auth.admin.get_user_by_id(user_id)
    except Exception as exc:
        logger.exception("auth.admin.get_user_by_id failed user_id=%s", user_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_obj = getattr(resp, "user", None)
    if user_obj is None and isinstance(resp, dict):
        user_obj = resp.get("user")
    email = ""
    if user_obj is not None:
        email = str(getattr(user_obj, "email", None) or "").strip()
        if not email and isinstance(user_obj, dict):
            email = str(user_obj.get("email") or "").strip()
    return email.lower()


class StaffInviteBody(BaseModel):
    clinic_id: str
    email: EmailStr
    role: str


class StaffRolePatchBody(BaseModel):
    role: str


class AcceptInviteBody(BaseModel):
    token: str = Field(..., min_length=1)


def _safe_auth_user_email(user_id: str) -> str:
    if not user_id:
        return ""
    try:
        return _auth_user_email(user_id)
    except HTTPException:
        return ""
    except Exception:
        logger.exception("auth email lookup failed user_id=%s", user_id)
        return ""


def _display_from_clinician(
    clinician: dict[str, Any] | None,
    auth_email: str,
) -> dict[str, str]:
    first_name = str((clinician or {}).get("first_name") or "").strip()
    last_name = str((clinician or {}).get("last_name") or "").strip()
    name = f"{first_name} {last_name}".strip()
    email = str((clinician or {}).get("email") or "").strip() or auth_email
    return {"name": name or email or "—", "email": email or auth_email}


def _clinicians_by_id(
    clinic_user_rows: list[dict[str, Any]],
    cid: str,
) -> dict[str, dict[str, Any]]:
    clinician_ids = list(
        {
            str(row.get("clinician_id") or "").strip()
            for row in clinic_user_rows
            if str(row.get("clinician_id") or "").strip()
        }
    )
    if not clinician_ids:
        return {}

    try:
        clin_resp = (
            supabase.table("clinicians")
            .select("id, first_name, last_name, email")
            .eq("clinic_id", cid)
            .in_("id", clinician_ids)
            .execute()
        )
        _handle_supabase_error(clin_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("clinicians lookup failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    lookup: dict[str, dict[str, Any]] = {}
    for row in clin_resp.data or []:
        if not isinstance(row, dict):
            continue
        clin_id = str(row.get("id") or "").strip()
        if clin_id:
            lookup[clin_id] = row
    return lookup


@router.get("/staff")
def list_staff(
    clinic_id: str = Query(..., min_length=1),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    cid = clinic_id.strip()
    try:
        resp = (
            supabase.table("clinic_users")
            .select("id, user_id, clinic_id, role, created_at, clinician_id")
            .eq("clinic_id", cid)
            .order("role")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_staff failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    clinic_user_rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    clinician_by_id = _clinicians_by_id(clinic_user_rows, cid)

    out: list[dict[str, Any]] = []
    for row in clinic_user_rows:
        user_id = str(row.get("user_id") or "").strip()
        clinician_id = str(row.get("clinician_id") or "").strip()
        clinician = clinician_by_id.get(clinician_id) if clinician_id else None
        auth_email = _safe_auth_user_email(user_id) if not clinician else ""
        display = _display_from_clinician(clinician, auth_email)
        out.append(
            {
                "id": row.get("id"),
                "user_id": user_id,
                "clinic_id": row.get("clinic_id"),
                "role": row.get("role"),
                "clinician_id": row.get("clinician_id"),
                "name": display["name"],
                "email": display["email"],
                "joined_at": row.get("created_at"),
            }
        )
    return out


@router.post("/staff/invite")
def invite_staff(
    body: StaffInviteBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    actor = enforce_clinic_role_from_auth_header(authorization, body.clinic_id, *ADMIN_ROLES)
    cid = body.clinic_id.strip()
    email = str(body.email).strip().lower()
    role = (body.role or "").strip().lower()

    if role not in STAFF_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="role must be one of: clinic_admin, clinician, front_desk",
        )

    token = secrets.token_urlsafe(32)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    ).isoformat()

    insert_row = {
        "clinic_id": cid,
        "email": email,
        "role": role,
        "token": token,
        "invited_by": actor.user_id,
        "expires_at": expires_at,
    }
    try:
        ins = supabase.table("staff_invitations").insert(insert_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("invite_staff failed clinic_id=%s email=%s", cid, email)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create invitation")
    return {"token": token, "invitation": rows[0]}


@router.delete("/staff/{user_id}")
def remove_staff_member(
    user_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    actor = enforce_clinic_role_from_auth_header(authorization, clinic_id, *ADMIN_ROLES)
    cid = clinic_id.strip()
    target_uid = user_id.strip()

    if target_uid == actor.user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    try:
        target_resp = (
            supabase.table("clinic_users")
            .select("id, role")
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(target_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "remove_staff_member lookup failed clinic_id=%s user_id=%s",
            cid,
            target_uid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    target_rows = target_resp.data or []
    if not target_rows:
        raise HTTPException(status_code=404, detail="Staff member not found")

    target_role = str(target_rows[0].get("role") or "").strip()
    if target_role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot remove a super_admin")

    try:
        delete_resp = (
            supabase.table("clinic_users")
            .delete()
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .execute()
        )
        _handle_supabase_error(delete_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "remove_staff_member delete failed clinic_id=%s user_id=%s",
            cid,
            target_uid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"ok": True}


@router.patch("/staff/{user_id}/role")
def update_staff_role(
    user_id: str,
    body: StaffRolePatchBody,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *ADMIN_ROLES)
    cid = clinic_id.strip()
    target_uid = user_id.strip()
    new_role = (body.role or "").strip().lower()

    if new_role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot promote to super_admin")
    if new_role not in STAFF_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="role must be one of: clinic_admin, clinician, front_desk",
        )

    try:
        target_resp = (
            supabase.table("clinic_users")
            .select("id, role")
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(target_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "update_staff_role lookup failed clinic_id=%s user_id=%s",
            cid,
            target_uid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    target_rows = target_resp.data or []
    if not target_rows:
        raise HTTPException(status_code=404, detail="Staff member not found")

    current_role = str(target_rows[0].get("role") or "").strip()
    if current_role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot change super_admin role")

    try:
        upd = (
            supabase.table("clinic_users")
            .update({"role": new_role})
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "update_staff_role failed clinic_id=%s user_id=%s",
            cid,
            target_uid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return rows[0]


@router.post("/staff/accept-invite")
def accept_staff_invite(
    body: AcceptInviteBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    token = body.token.strip()

    try:
        invite_resp = (
            supabase.table("staff_invitations")
            .select("*")
            .eq("token", token)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(invite_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("accept_staff_invite lookup failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    invite_rows = invite_resp.data or []
    if not invite_rows:
        raise HTTPException(status_code=404, detail="Invalid invitation token")

    invite = invite_rows[0]
    if invite.get("accepted_at"):
        raise HTTPException(status_code=400, detail="Invitation already accepted")

    expires_at_raw = invite.get("expires_at")
    if expires_at_raw:
        try:
            expires_at = datetime.fromisoformat(
                str(expires_at_raw).replace("Z", "+00:00")
            )
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires_at:
                raise HTTPException(status_code=400, detail="Invitation expired")
        except HTTPException:
            raise
        except Exception:
            pass

    invite_email = str(invite.get("email") or "").strip().lower()
    user_email = _auth_user_email(user_id)
    if not user_email or user_email != invite_email:
        raise HTTPException(
            status_code=403,
            detail="Signed-in user email does not match invitation",
        )

    clinic_id = str(invite.get("clinic_id") or "").strip()
    role = str(invite.get("role") or "").strip()
    if not clinic_id or role not in STAFF_ASSIGNABLE_ROLES:
        raise HTTPException(status_code=500, detail="Invalid invitation record")

    try:
        existing = (
            supabase.table("clinic_users")
            .select("id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("accept_staff_invite existing check failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="User already has access to this clinic",
        )

    try:
        ins = (
            supabase.table("clinic_users")
            .insert(
                {
                    "user_id": user_id,
                    "clinic_id": clinic_id,
                    "role": role,
                }
            )
            .execute()
        )
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("accept_staff_invite clinic_users insert failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    inserted = ins.data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="Failed to create clinic access")

    try:
        upd = (
            supabase.table("staff_invitations")
            .update({"accepted_at": _now_iso()})
            .eq("token", token)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("accept_staff_invite mark accepted failed token=%s", token)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"ok": True, "clinic_user": inserted[0]}
