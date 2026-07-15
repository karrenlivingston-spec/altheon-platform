"""Platform super-admin clinic onboarding (KJL internal)."""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.db import supabase
from app.retry_utils import supabase_execute

logger = logging.getLogger(__name__)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def require_superadmin_secret(
    x_superadmin_secret: Optional[str] = Header(None, alias="X-Superadmin-Secret"),
) -> None:
    expected = os.environ.get("SUPERADMIN_SECRET")
    if not expected or x_superadmin_secret != expected:
        raise HTTPException(status_code=403, detail="Forbidden")


router = APIRouter(dependencies=[Depends(require_superadmin_secret)])


def _rollback(clinic_id: Optional[str], admin_user_id: Optional[str]) -> None:
    if clinic_id:
        try:
            supabase.table("clinics").delete().eq("id", clinic_id).execute()
        except Exception:
            pass
    if admin_user_id:
        try:
            supabase_execute(lambda: supabase.auth.admin.delete_user(admin_user_id))
        except Exception:
            pass


def _admin_create_user_id(
    email: str, password: str, clinic_id: str
) -> str:
    try:
        auth_res = supabase_execute(
            lambda: supabase.auth.admin.create_user(
                {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {
                        "clinic_id": clinic_id,
                        "role": "admin",
                    },
                }
            )
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to create admin user: {exc}",
        ) from exc
    user_obj = getattr(auth_res, "user", None)
    if user_obj is None and isinstance(auth_res, dict):
        user_obj = auth_res.get("user")
    uid = str(getattr(user_obj, "id", None) or "").strip()
    if not uid and isinstance(user_obj, dict):
        uid = str(user_obj.get("id") or "").strip()
    if not uid:
        raise HTTPException(
            status_code=500,
            detail="Admin user was created but no user id was returned",
        )
    return uid


class OnboardClinicFields(BaseModel):
    name: str
    slug: str
    phone: str
    email: str
    address: str
    logo_url: Optional[str] = None
    brand_color: Optional[str] = None

    @field_validator("slug")
    @classmethod
    def slug_url_safe(cls, v: str) -> str:
        s = v.strip().lower()
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", s):
            raise ValueError(
                "slug must be URL-safe (lowercase letters, numbers, hyphens only)"
            )
        return s

    @field_validator("email")
    @classmethod
    def email_normalized(cls, v: str) -> str:
        return v.strip().lower()


class OnboardLocationFields(BaseModel):
    name: str
    address: str
    phone: str
    timezone: str


class OnboardClinicianFields(BaseModel):
    first_name: str
    last_name: str
    title: str
    email: str
    phone: Optional[str] = None
    bio: Optional[str] = None

    @field_validator("email")
    @classmethod
    def email_normalized(cls, v: str) -> str:
        return v.strip().lower()


class OnboardTreatmentTypeFields(BaseModel):
    name: str
    description: Optional[str] = None
    duration_minutes: int = Field(..., gt=0)
    requires_evaluation: bool = False


class OnboardRoutingRuleFields(BaseModel):
    treatment_type_name: str
    clinician_email: str
    condition_keywords: list[str] = Field(default_factory=list)
    priority_order: int = 0

    @field_validator("clinician_email")
    @classmethod
    def email_normalized(cls, v: str) -> str:
        return v.strip().lower()


class SuperadminOnboardBody(BaseModel):
    clinic: OnboardClinicFields
    location: OnboardLocationFields
    clinicians: list[OnboardClinicianFields]
    treatment_types: list[OnboardTreatmentTypeFields]
    routing_rules: list[OnboardRoutingRuleFields] = Field(default_factory=list)
    admin_email: str
    admin_password: str = Field(..., min_length=8)

    @field_validator("admin_email")
    @classmethod
    def admin_email_normalized(cls, v: str) -> str:
        return v.strip().lower()


@router.post("/onboard")
def superadmin_onboard(body: SuperadminOnboardBody):
    slug = body.clinic.slug
    clinic_id: Optional[str] = None
    admin_user_id: Optional[str] = None
    clinic_user_id: Optional[str] = None
    location_id = ""
    clinician_ids: list[str] = []
    treatment_type_ids: list[str] = []

    try:
        dup = (
            supabase.table("clinics")
            .select("id")
            .eq("slug", slug)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(dup)
        if dup.data:
            raise HTTPException(status_code=400, detail="Slug is already in use")

        clinic_row: dict[str, Any] = {
            "name": body.clinic.name.strip(),
            "slug": slug,
            "phone": body.clinic.phone.strip(),
            "email": body.clinic.email.strip(),
            "address": body.clinic.address.strip(),
        }
        if body.clinic.logo_url and body.clinic.logo_url.strip():
            clinic_row["logo_url"] = body.clinic.logo_url.strip()
        if body.clinic.brand_color and body.clinic.brand_color.strip():
            clinic_row["brand_color"] = body.clinic.brand_color.strip()

        clinic_ins = supabase.table("clinics").insert(clinic_row).execute()
        _handle_supabase_error(clinic_ins)
        if not clinic_ins.data:
            raise HTTPException(status_code=500, detail="Clinic insert returned no row")
        clinic_id = str(clinic_ins.data[0]["id"])

        loc_ins = (
            supabase.table("locations")
            .insert(
                {
                    "clinic_id": clinic_id,
                    "name": body.location.name.strip(),
                    "address": body.location.address.strip(),
                    "phone": body.location.phone.strip(),
                    "timezone": body.location.timezone.strip(),
                    "is_active": True,
                }
            )
            .execute()
        )
        _handle_supabase_error(loc_ins)
        lrows = loc_ins.data or []
        if not lrows:
            raise HTTPException(status_code=500, detail="Location insert returned no row")
        location_id = str(lrows[0]["id"])

        clinician_email_to_id: dict[str, str] = {}
        for c in body.clinicians:
            clin_payload: dict[str, Any] = {
                "clinic_id": clinic_id,
                "location_id": location_id,
                "first_name": c.first_name.strip(),
                "last_name": c.last_name.strip(),
                "title": c.title.strip() or None,
                "email": c.email.strip(),
            }
            if c.phone and c.phone.strip():
                clin_payload["phone"] = c.phone.strip()
            if c.bio and c.bio.strip():
                clin_payload["bio"] = c.bio.strip()
            cin = supabase.table("clinicians").insert(clin_payload).execute()
            _handle_supabase_error(cin)
            if not cin.data:
                raise HTTPException(
                    status_code=500, detail="Clinician insert returned no row"
                )
            cid = str(cin.data[0]["id"])
            clinician_ids.append(cid)
            if c.email:
                clinician_email_to_id[c.email.strip().lower()] = cid

        treatment_name_to_id: dict[str, str] = {}
        for tt in body.treatment_types:
            tt_row: dict[str, Any] = {
                "clinic_id": clinic_id,
                "name": tt.name.strip(),
                "duration_minutes": tt.duration_minutes,
                "requires_evaluation": tt.requires_evaluation,
            }
            if tt.description and tt.description.strip():
                tt_row["description"] = tt.description.strip()
            tins = supabase.table("treatment_types").insert(tt_row).execute()
            _handle_supabase_error(tins)
            if not tins.data:
                raise HTTPException(
                    status_code=500, detail="Treatment type insert returned no row"
                )
            tid = str(tins.data[0]["id"])
            treatment_type_ids.append(tid)
            treatment_name_to_id[tt.name.strip()] = tid

        for rule in body.routing_rules:
            tt_name = rule.treatment_type_name.strip()
            clin_email = rule.clinician_email.strip().lower()
            treatment_type_id = treatment_name_to_id.get(tt_name)
            if not treatment_type_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown treatment type: {tt_name}",
                )
            clinician_id = clinician_email_to_id.get(clin_email)
            if not clinician_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown clinician email: {clin_email}",
                )
            keywords = [k.strip() for k in rule.condition_keywords if k and k.strip()]
            rr = (
                supabase.table("provider_routing_rules")
                .insert(
                    {
                        "clinic_id": clinic_id,
                        "treatment_type_id": treatment_type_id,
                        "clinician_id": clinician_id,
                        "condition_keywords": keywords,
                        "priority_order": rule.priority_order,
                    }
                )
                .execute()
            )
            _handle_supabase_error(rr)

        admin_user_id = _admin_create_user_id(
            body.admin_email,
            body.admin_password,
            clinic_id,
        )

        cui = (
            supabase.table("clinic_users")
            .insert(
                {
                    "user_id": admin_user_id,
                    "clinic_id": clinic_id,
                    "role": "clinic_admin",
                }
            )
            .execute()
        )
        _handle_supabase_error(cui)
        if not cui.data:
            raise HTTPException(
                status_code=500, detail="clinic_users insert returned no row"
            )
        clinic_user_id = str(cui.data[0]["id"])

    except HTTPException:
        _rollback(clinic_id, admin_user_id)
        raise
    except Exception as exc:
        _rollback(clinic_id, admin_user_id)
        logger.exception("superadmin_onboard failed slug=%s", slug)
        raise HTTPException(
            status_code=500,
            detail=f"Clinic onboarding failed: {exc}",
        ) from exc

    return {
        "clinic_id": clinic_id,
        "location_id": location_id,
        "clinician_ids": clinician_ids,
        "treatment_type_ids": treatment_type_ids,
        "admin_user_id": admin_user_id,
        "clinic_user_id": clinic_user_id,
        "slug": slug,
    }
