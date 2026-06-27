"""Role-based access control for clinic-scoped API routes."""

from __future__ import annotations

from typing import Annotated, Any, FrozenSet, Optional

from fastapi import Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel

from app.db import supabase
from routers.fee_schedule import _resolve_bearer_user_id

ADMIN_ROLES: list[str] = ["super_admin", "clinic_admin"]
BILLING_ROLES: list[str] = ["super_admin", "clinic_admin", "clinician"]
BILLER_ROLE = "biller"
BILLING_READ_ROLES: list[str] = [*BILLING_ROLES, BILLER_ROLE]
BILLING_CLAIM_SUBMIT_ROLES: list[str] = [*BILLING_ROLES, BILLER_ROLE]
CLINICAL_ROLES: list[str] = ["super_admin", "clinic_admin", "clinician"]
CLINICAL_READ_ROLES: list[str] = [*CLINICAL_ROLES, BILLER_ROLE]
ALL_ROLES: list[str] = ["super_admin", "clinic_admin", "clinician", "front_desk"]
READ_CONTEXT_ROLES: list[str] = [*ALL_ROLES, BILLER_ROLE]

STAFF_ASSIGNABLE_ROLES: frozenset[str] = frozenset(
    {"clinic_admin", "clinician", "front_desk", BILLER_ROLE}
)


def _handle_supabase_error(response) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


class AuthorizedClinicUser(BaseModel):
    user_id: str
    clinic_id: str
    role: str
    billing_only: bool = False


def _parse_billing_only(value: Any) -> bool:
    return bool(value) if value is not None else False


def get_clinic_user_access(clinic_id: str, user_id: str) -> dict[str, Any]:
    """Fetch role and billing_only from clinic_users for the given clinic."""
    cid = (clinic_id or "").strip()
    uid = (user_id or "").strip()
    if not cid or not uid:
        raise HTTPException(status_code=403, detail="No clinic access for user")

    try:
        resp = (
            supabase.table("clinic_users")
            .select("role,billing_only")
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

    row = rows[0]
    role = str(row.get("role") or "").strip()
    if not role:
        raise HTTPException(status_code=403, detail="No clinic access for user")
    return {
        "role": role,
        "billing_only": _parse_billing_only(row.get("billing_only")),
    }


def get_current_user_role(clinic_id: str, user_id: str) -> str:
    """Fetch the user's role from clinic_users for the given clinic."""
    return str(get_clinic_user_access(clinic_id, user_id)["role"])


def assert_can_read_clinical_notes(user_id: str, clinic_id: str, role: str) -> None:
    """Block billing-only billers from clinical note content."""
    if role != BILLER_ROLE:
        return
    access = get_clinic_user_access(clinic_id, user_id)
    if access.get("billing_only"):
        raise HTTPException(
            status_code=403,
            detail="Billing-only accounts cannot access clinical notes.",
        )


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
        access = get_clinic_user_access(clinic_id, user_id)
        return AuthorizedClinicUser(
            user_id=user_id,
            clinic_id=clinic_id,
            role=role,
            billing_only=_parse_billing_only(access.get("billing_only")),
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
    access = get_clinic_user_access(cid, user_id)
    return AuthorizedClinicUser(
        user_id=user_id,
        clinic_id=cid,
        role=role,
        billing_only=_parse_billing_only(access.get("billing_only")),
    )


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
    access = get_clinic_user_access(cid, user_id)
    return AuthorizedClinicUser(
        user_id=user_id,
        clinic_id=cid,
        role=role,
        billing_only=_parse_billing_only(access.get("billing_only")),
    )


def enforce_clinical_notes_read_from_auth_header(
    authorization: Optional[str],
    clinic_id: str,
) -> AuthorizedClinicUser:
    """Read access to clinical notes; blocks billing-only billers."""
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *CLINICAL_READ_ROLES,
    )
    assert_can_read_clinical_notes(auth.user_id, auth.clinic_id, auth.role)
    return auth


def require_clinical_notes_read():
    """Dependency: clinical note read roles + billing-only biller block when clinic_id is present."""

    def dependency(
        request: Request,
        authorization: Optional[str] = Header(default=None, alias="Authorization"),
    ) -> Optional[AuthorizedClinicUser]:
        auth = require_role(*CLINICAL_READ_ROLES)(request, authorization)
        if auth is not None:
            assert_can_read_clinical_notes(auth.user_id, auth.clinic_id, auth.role)
        return auth

    return dependency


RequireAdminRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*ADMIN_ROLES)),
]
RequireBillingRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*BILLING_READ_ROLES)),
]
RequireClinicalRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*CLINICAL_ROLES)),
]
RequireAllRoles = Annotated[
    Optional[AuthorizedClinicUser],
    Depends(require_role(*ALL_ROLES)),
]
