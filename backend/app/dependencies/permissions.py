"""Role-based access control for clinic-scoped API routes."""

from __future__ import annotations

from typing import Annotated, FrozenSet, Optional

from fastapi import Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel

from app.db import supabase
from routers.fee_schedule import _resolve_bearer_user_id

ADMIN_ROLES: list[str] = ["super_admin", "clinic_admin"]
BILLING_ROLES: list[str] = ["super_admin", "clinic_admin"]
CLINICAL_ROLES: list[str] = ["super_admin", "clinic_admin", "clinician"]
ALL_ROLES: list[str] = ["super_admin", "clinic_admin", "clinician", "front_desk"]

STAFF_ASSIGNABLE_ROLES: frozenset[str] = frozenset(
    {"clinic_admin", "clinician", "front_desk"}
)


class AuthorizedClinicUser(BaseModel):
    user_id: str
    clinic_id: str
    role: str


def _handle_supabase_error(response) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def get_current_user_role(clinic_id: str, user_id: str) -> str:
    """Fetch the user's role from clinic_users for the given clinic."""
    cid = (clinic_id or "").strip()
    uid = (user_id or "").strip()
    if not cid or not uid:
        raise HTTPException(status_code=403, detail="No clinic access for user")

    try:
        resp = (
            supabase.table("clinic_users")
            .select("role")
            .eq("user_id", uid)
            .eq("clinic_id", cid)
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
        raise HTTPException(status_code=403, detail="No clinic access for user")

    role = str(rows[0].get("role") or "").strip()
    if not role:
        raise HTTPException(status_code=403, detail="No clinic access for user")
    return role


def assert_clinic_role(
    user_id: str,
    clinic_id: str,
    allowed_roles: FrozenSet[str] | list[str],
) -> str:
    """Verify the user has one of the allowed roles; return the role."""
    allowed = frozenset(allowed_roles)
    role = get_current_user_role(clinic_id, user_id)
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return role


def _clinic_id_from_request(request: Request) -> str:
    return (
        (request.query_params.get("clinic_id") or "").strip()
        or (request.path_params.get("clinic_id") or "").strip()
    )


def require_role(*allowed_roles: str):
    """Dependency factory: JWT auth + role check when clinic_id is on the request."""

    allowed = frozenset(allowed_roles)

    def dependency(
        request: Request,
        authorization: Optional[str] = Header(default=None, alias="Authorization"),
    ) -> Optional[AuthorizedClinicUser]:
        user_id = _resolve_bearer_user_id(authorization)
        clinic_id = _clinic_id_from_request(request)
        if not clinic_id:
            request.state.auth_user_id = user_id
            request.state.allowed_roles = allowed
            return None

        role = assert_clinic_role(user_id, clinic_id, allowed)
        return AuthorizedClinicUser(
            user_id=user_id,
            clinic_id=clinic_id,
            role=role,
        )

    return dependency


def require_role_with_clinic_id(
    *allowed_roles: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> AuthorizedClinicUser:
    """Explicit clinic_id query dependency for routes that cannot use router-level RBAC."""
    user_id = _resolve_bearer_user_id(authorization)
    cid = clinic_id.strip()
    role = assert_clinic_role(user_id, cid, allowed_roles)
    return AuthorizedClinicUser(user_id=user_id, clinic_id=cid, role=role)


def enforce_clinic_role_from_auth_header(
    authorization: Optional[str],
    clinic_id: str,
    *allowed_roles: str,
) -> AuthorizedClinicUser:
    """Inline RBAC for routes where clinic_id comes from the body or form."""
    user_id = _resolve_bearer_user_id(authorization)
    cid = (clinic_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")
    role = assert_clinic_role(user_id, cid, allowed_roles)
    return AuthorizedClinicUser(user_id=user_id, clinic_id=cid, role=role)


RequireAdminRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*ADMIN_ROLES)),
]
RequireBillingRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*BILLING_ROLES)),
]
RequireClinicalRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*CLINICAL_ROLES)),
]
RequireAllRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*ALL_ROLES)),
]
