"""Clinic staff management and invitations."""

from __future__ import annotations

import logging
import secrets
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from app.db import supabase
from app.retry_utils import supabase_execute
from app.utils.auth_users import get_user_email_by_id
from app.dependencies.permissions import (
    ADMIN_ROLES,
    STAFF_ASSIGNABLE_ROLES,
    AuthorizedClinicUser,
    enforce_clinic_role_from_auth_header,
    require_role,
)

router = APIRouter()
logger = logging.getLogger(__name__)

INVITE_TTL_DAYS = 7


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StaffInviteBody(BaseModel):
    clinic_id: str = Field(..., min_length=1)
    email: EmailStr
    role: str = Field(..., min_length=1)
    invited_by: str = Field(..., min_length=1)
    billing_only: bool = False


class StaffRolePatchBody(BaseModel):
    role: str


class AcceptInviteBody(BaseModel):
    token: str = Field(..., min_length=1)
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


def _require_uuid(value: str, field: str) -> str:
    raw = (value or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    try:
        uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be a valid UUID",
        ) from exc
    return raw


def _safe_auth_user_email(user_id: str) -> str:
    if not user_id:
        return ""
    try:
        return get_user_email_by_id(user_id).lower()
    except Exception:
        logger.exception("auth email lookup failed user_id=%s", user_id)
        return ""


@router.get("/staff")
def list_staff(
    clinic_id: str = Query(..., min_length=1),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    cid = clinic_id.strip()
    try:
        resp = _sb_execute(
            lambda: supabase.table("clinic_users")
            .select("id, user_id, role, created_at")
            .eq("clinic_id", cid)
            .order("role")
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_staff failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        user_id = str(row.get("user_id") or "").strip()
        out.append(
            {
                "id": row.get("id"),
                "user_id": user_id,
                "email": _safe_auth_user_email(user_id),
                "role": row.get("role"),
                "created_at": row.get("created_at"),
            }
        )
    return out


@router.post("/staff/invite")
def invite_staff(
    body: StaffInviteBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _auth: Optional[AuthorizedClinicUser] = Depends(require_role(*ADMIN_ROLES)),
):
    enforce_clinic_role_from_auth_header(authorization, body.clinic_id, *ADMIN_ROLES)
    cid = _require_uuid(body.clinic_id, "clinic_id")
    invited_by = _require_uuid(body.invited_by, "invited_by")
    email = str(body.email).strip().lower()
    role = (body.role or "").strip().lower()

    if role not in STAFF_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="role must be one of: clinic_admin, clinician, front_desk, biller",
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
        "invited_by": invited_by,
        "expires_at": expires_at,
        "billing_only": bool(body.billing_only),
    }
    logger.info(
        "invite_staff insert clinic_id=%s invited_by=%s role=%s email=%s",
        cid,
        invited_by,
        role,
        email,
    )
    print(f"invite_staff insert_row={insert_row}")
    try:
        ins = _sb_execute(
            lambda: supabase.table("staff_invitations").insert(insert_row).execute()
        )
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
        target_resp = _sb_execute(
            lambda: supabase.table("clinic_users")
            .select("id, role")
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .limit(1)
            .execute()
        )
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
        delete_resp = _sb_execute(
            lambda: supabase.table("clinic_users")
            .delete()
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .execute()
        )
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
            detail="role must be one of: clinic_admin, clinician, front_desk, biller",
        )

    try:
        target_resp = _sb_execute(
            lambda: supabase.table("clinic_users")
            .select("id, role")
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .limit(1)
            .execute()
        )
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
        upd = _sb_execute(
            lambda: supabase.table("clinic_users")
            .update({"role": new_role})
            .eq("clinic_id", cid)
            .eq("user_id", target_uid)
            .execute()
        )
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
def accept_staff_invite(body: AcceptInviteBody):
    token = body.token.strip()
    first_name = body.first_name.strip()
    last_name = body.last_name.strip()
    password = body.password

    print(f"accept_staff_invite start token_prefix={token[:8] if token else ''}")

    try:
        now_iso = _now_iso()
        invite_resp = _sb_execute(
            lambda: supabase.table("staff_invitations")
            .select("*")
            .eq("token", token)
            .is_("accepted_at", "null")
            .gt("expires_at", now_iso)
            .limit(1)
            .execute()
        )

        invite_rows = invite_resp.data or []
        if not invite_rows:
            print("accept_staff_invite invite not found or expired")
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired invite token",
            )

        invite = invite_rows[0]
        email = str(invite.get("email") or "").strip().lower()
        clinic_id = str(invite.get("clinic_id") or "").strip()
        role = str(invite.get("role") or "").strip().lower()
        billing_only = bool(invite.get("billing_only"))

        if not email or not clinic_id or role not in STAFF_ASSIGNABLE_ROLES:
            print(
                "accept_staff_invite invalid invite record "
                f"email={email!r} clinic_id={clinic_id!r} role={role!r}"
            )
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired invite token",
            )

        print(
            "accept_staff_invite invite ok "
            f"email={email} clinic_id={clinic_id} role={role}"
        )

        loc_resp = _sb_execute(
            lambda: supabase.table("locations")
            .select("id")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        loc_rows = loc_resp.data or []
        if not loc_rows:
            raise HTTPException(
                status_code=500,
                detail="No active location found for clinic",
            )
        location_id = str(loc_rows[0].get("id") or "").strip()
        if not location_id:
            raise HTTPException(
                status_code=500,
                detail="No active location found for clinic",
            )

        print(f"accept_staff_invite creating auth user email={email}")
        auth_res = supabase_execute(
            lambda: supabase.auth.admin.create_user(
                {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                }
            )
        )
        user_obj = getattr(auth_res, "user", None)
        if user_obj is None and isinstance(auth_res, dict):
            user_obj = auth_res.get("user")
        new_user_id = str(getattr(user_obj, "id", None) or "").strip()
        if not new_user_id and isinstance(user_obj, dict):
            new_user_id = str(user_obj.get("id") or "").strip()
        if not new_user_id:
            raise HTTPException(
                status_code=500,
                detail="Auth user was created but no user id was returned",
            )

        print(f"accept_staff_invite auth user created user_id={new_user_id}")

        if role != "biller":
            clinician_row = {
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
                "clinic_id": clinic_id,
                "location_id": location_id,
            }
            print(f"accept_staff_invite clinician_row={clinician_row}")
            clin_ins = _sb_execute(
                lambda: supabase.table("clinicians").insert(clinician_row).execute()
            )
            if not (clin_ins.data or []):
                raise HTTPException(status_code=500, detail="Failed to create clinician")

        clinic_user_row = {
            "user_id": new_user_id,
            "clinic_id": clinic_id,
            "role": role,
        }
        if role == "biller":
            clinic_user_row["billing_only"] = billing_only
        print(f"accept_staff_invite clinic_user_row={clinic_user_row}")
        cu_ins = _sb_execute(
            lambda: supabase.table("clinic_users").insert(clinic_user_row).execute()
        )
        if not (cu_ins.data or []):
            raise HTTPException(
                status_code=500,
                detail="Failed to create clinic user access",
            )

        upd = _sb_execute(
            lambda: supabase.table("staff_invitations")
            .update({"accepted_at": _now_iso()})
            .eq("token", token)
            .execute()
        )

        print(f"accept_staff_invite success email={email} role={role}")
        return {"success": True, "email": email, "role": role}
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        print(f"accept_staff_invite failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
