import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from app.constants import STTPDN_CLINIC_ID
from app.db import supabase
from app.retry_utils import supabase_execute
from app.dependencies.permissions import (
    ALL_ROLES,
    READ_CONTEXT_ROLES,
    enforce_clinic_role_from_auth_header,
    require_role,
)
from routers.fee_schedule import ClinicUserDep

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

_PATIENT_PUBLIC_KEYS = (
    "id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "date_of_birth",
    "gender",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "zip",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relationship",
    "insurance_carrier",
    "insurance_policy_number",
    "insurance_group_number",
    "primary_complaint",
    "referring_provider",
    "referral_source",
    "notes",
    "created_at",
    "lawyer_name",
    "law_firm",
    "lawyer_phone",
    "lawyer_email",
)

_PATCHABLE_PATIENT_FIELDS = frozenset(_PATIENT_PUBLIC_KEYS) - frozenset(
    {"id", "created_at"}
)

_VALID_REFERRAL_SOURCES = frozenset(
    {
        "google",
        "facebook",
        "instagram",
        "attorney",
        "existing_patient",
        "doctor_referral",
        "website",
        "walk_in",
        "other",
    }
)

_REFERRAL_SOURCE_LABELS: dict[Optional[str], str] = {
    "google": "Google",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "attorney": "Attorney",
    "existing_patient": "Existing Patient",
    "doctor_referral": "Doctor Referral",
    "website": "Website",
    "walk_in": "Walk In",
    "other": "Other",
    None: "Unknown",
}


def _normalize_phone_digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or "").strip())


def _format_dob_for_match(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:10] if len(s) >= 10 else s


def _shape_duplicate_match(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "first_name": str(row.get("first_name") or "").strip(),
        "last_name": str(row.get("last_name") or "").strip(),
        "date_of_birth": _format_dob_for_match(row.get("date_of_birth")),
    }


def _find_clinic_phone_matches(
    clinic_id: str, normalized_phone: str
) -> list[dict[str, Any]]:
    if not normalized_phone:
        return []
    try:
        resp = (
            supabase.table("patients")
            .select("id, first_name, last_name, date_of_birth, phone")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    matches: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        if _normalize_phone_digits(row.get("phone")) != normalized_phone:
            continue
        matches.append(_shape_duplicate_match(row))
    matches.sort(
        key=lambda m: (
            str(m.get("last_name") or "").lower(),
            str(m.get("first_name") or "").lower(),
        )
    )
    return matches


def _normalize_referral_source(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s not in _VALID_REFERRAL_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid referral_source")
    return s


def _referral_source_label(value: Optional[str]) -> str:
    if value is None or not str(value).strip():
        return _REFERRAL_SOURCE_LABELS[None]
    return _REFERRAL_SOURCE_LABELS.get(str(value).strip(), "Unknown")


def _user_has_platform_role(user_id: str) -> bool:
    try:
        resp = (
            supabase.table("clinic_users")
            .select("role")
            .eq("user_id", user_id)
            .execute()
        )
        roles = {row.get("role") for row in resp.data or []}
        return bool(roles & {"super_admin", "platform_admin"})
    except Exception:
        return False


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _normalize_patient_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in _PATIENT_PUBLIC_KEYS:
        val = row.get(key)
        if key == "date_of_birth" and val is not None:
            out[key] = str(val)[:10] if not isinstance(val, str) else str(val)[:10]
        else:
            out[key] = val
    return out


def _has_clinic_access(clinic_id: str, patient_id: str) -> bool:
    try:
        resp = (
            supabase.table("patient_clinic_access")
            .select("id")
            .eq("clinic_id", clinic_id)
            .eq("patient_id", patient_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return bool(resp.data)


def _fetch_patient_row(
    patient_id: str, *, restrict_clinic_id: Optional[str] = None
) -> Optional[dict[str, Any]]:
    try:
        q = supabase.table("patients").select("*").eq("id", patient_id)
        if restrict_clinic_id is not None:
            q = q.eq("clinic_id", restrict_clinic_id)
        resp = q.limit(1).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        return None
    return dict(rows[0])


def _clinician_name(c: Any) -> str:
    if isinstance(c, list):
        c = c[0] if c else None
    if not isinstance(c, dict):
        return "—"
    fn = (c.get("first_name") or "").strip()
    ln = (c.get("last_name") or "").strip()
    s = f"{fn} {ln}".strip()
    return s or "—"


def _treatment_name(t: Any) -> str:
    if isinstance(t, list):
        t = t[0] if t else None
    if not isinstance(t, dict):
        return "—"
    n = (t.get("name") or "").strip()
    return n or "—"


def _eastern_date_ymd_from_iso(iso_val: Any) -> str:
    if not iso_val:
        return ""
    from zoneinfo import ZoneInfo

    s = str(iso_val).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


def _related_appointments(patient_id: str, clinic_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            supabase.table("appointments")
            .select(
                "start_time,status,clinicians(first_name,last_name),treatment_types(name)"
            )
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("start_time", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        out.append(
            {
                "date": _eastern_date_ymd_from_iso(row.get("start_time")),
                "clinician_name": _clinician_name(row.get("clinicians")),
                "service_type": _treatment_name(row.get("treatment_types")),
                "status": str(row.get("status") or ""),
            }
        )
    return out


def _related_billing(patient_id: str, clinic_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            supabase.table("billing_records")
            .select("date_of_service,total_billed_cents,amount_paid_cents,status")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("date_of_service", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        dos = row.get("date_of_service")
        dos_s = str(dos).strip()[:10] if dos is not None else ""
        out.append(
            {
                "date": dos_s,
                "total_billed_cents": int(row.get("total_billed_cents") or 0),
                "status": str(row.get("status") or ""),
            }
        )
    return out


def _related_membership(patient_id: str, clinic_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            supabase.table("patient_memberships")
            .select(
                "status,visits_remaining,"
                "membership_tiers!patient_memberships_tier_id_fkey(name)"
            )
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
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
        return None
    row = rows[0]
    tier = row.get("membership_tiers")
    if isinstance(tier, list):
        tier = tier[0] if tier else None
    tier_name = "—"
    if isinstance(tier, dict):
        tier_name = (tier.get("name") or "").strip() or "—"
    return {
        "tier_name": tier_name,
        "visits_remaining": int(row.get("visits_remaining") or 0),
        "status": str(row.get("status") or ""),
    }


def _related_pi_cases(patient_id: str, clinic_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            supabase.table("pi_cases")
            .select(
                "claim_number,date_of_accident,status,attorney_name"
            )
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        claim = row.get("claim_number")
        out.append(
            {
                "case_number": str(claim).strip() if claim is not None else "",
                "date_of_accident": row.get("date_of_accident"),
                "status": str(row.get("status") or ""),
                "attorney_name": row.get("attorney_name"),
            }
        )
    return out


@router.get("/referral-source/summary", dependencies=[Depends(require_role(*READ_CONTEXT_ROLES))])
def referral_source_summary(
    clinic: ClinicUserDep,
    platform_wide: bool = Query(False),
):
    """Patient counts grouped by referral_source (clinic or platform-wide for admins)."""
    try:
        q = supabase.table("patients").select("referral_source")
        if not (platform_wide and _user_has_platform_role(clinic.user_id)):
            q = q.eq("clinic_id", clinic.clinic_id)
        resp = q.execute()
        _handle_supabase_error(resp)

        counts: dict[Optional[str], int] = defaultdict(int)
        for row in resp.data or []:
            src = row.get("referral_source")
            if src is not None:
                src = str(src).strip() or None
            counts[src] += 1

        out: list[dict[str, Any]] = []
        for src, count in sorted(
            counts.items(),
            key=lambda item: (-item[1], _referral_source_label(item[0])),
        ):
            out.append(
                {
                    "referral_source": src,
                    "count": count,
                    "label": _referral_source_label(src),
                }
            )
        return out
    except Exception:
        return []


@router.get("/{patient_id}/insurance", dependencies=[Depends(require_role(*READ_CONTEXT_ROLES))])
def get_patient_insurance(patient_id: str, clinic_id: str = Query(...)):
    """Primary insurance carrier for appointment popup / scheduling context."""
    if not _has_clinic_access(clinic_id, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    row = _fetch_patient_row(patient_id, restrict_clinic_id=clinic_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {
        "insurance_carrier": row.get("insurance_carrier"),
        "insurance_policy_number": row.get("insurance_policy_number"),
        "insurance_group_number": row.get("insurance_group_number"),
    }


@router.get("/{patient_id}/surveys", dependencies=[Depends(require_role(*READ_CONTEXT_ROLES))])
def list_patient_surveys(patient_id: str, clinic_id: str = Query(...)):
    """Return survey_responses for a patient (newest first)."""
    if not _has_clinic_access(clinic_id, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    try:
        resp = (
            supabase.table("survey_responses")
            .select("*")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []


@router.get("", dependencies=[Depends(require_role(*READ_CONTEXT_ROLES))])
def list_patients(clinic_id: str = Query(...), search: Optional[str] = Query(default=None)):
    """Return patients for the requested clinic (clinic_id on patient row)."""
    try:
        q = supabase.table("patients").select("*").eq("clinic_id", clinic_id)
        search_s = (search or "").strip()
        if search_s:
            esc = search_s.replace("%", "\\%").replace(",", " ")
            like = f"%{esc}%"
            q = q.or_(
                f"first_name.ilike.{like},last_name.ilike.{like},phone.ilike.{like}"
            )
        resp = q.execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return resp.data or []


@router.post("", dependencies=[Depends(require_role(*ALL_ROLES))])
def create_patient(
    body: dict = Body(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """Create a patient row for the requested clinic (defaults to STTPDN if omitted)."""
    first_name = (body.get("first_name") or "").strip()
    last_name = (body.get("last_name") or "").strip()
    if not first_name or not last_name:
        raise HTTPException(
            status_code=400, detail="first_name and last_name are required"
        )

    clinic_id = (body.get("clinic_id") or "").strip() or STTPDN_CLINIC_ID
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *ALL_ROLES)
    confirm_duplicate = bool(body.get("confirm_duplicate"))

    normalized_phone = _normalize_phone_digits(body.get("phone"))
    if normalized_phone and not confirm_duplicate:
        matches = _find_clinic_phone_matches(clinic_id, normalized_phone)
        if matches:
            return JSONResponse(
                status_code=200,
                content={"status": "possible_duplicate", "matches": matches},
            )

    insert_data: dict[str, Any] = {
        "first_name": first_name,
        "last_name": last_name,
        "clinic_id": clinic_id,
    }
    for key in _PATCHABLE_PATIENT_FIELDS:
        if key in ("first_name", "last_name"):
            continue
        if key not in body:
            continue
        if key == "referral_source":
            insert_data[key] = _normalize_referral_source(body[key])
        elif key == "phone":
            if normalized_phone:
                insert_data[key] = normalized_phone
        elif body[key] is not None:
            insert_data[key] = body[key]

    try:
        ins = supabase.table("patients").insert(insert_data).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create patient")
    new_row = dict(rows[0])
    patient_id = str(new_row["id"])

    try:
        access_ins = (
            supabase.table("patient_clinic_access")
            .insert(
                {"patient_id": patient_id, "clinic_id": clinic_id}
            )
            .execute()
        )
        _handle_supabase_error(access_ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JSONResponse(status_code=201, content=_normalize_patient_row(new_row))


@router.get("/{patient_id}", dependencies=[Depends(require_role(*READ_CONTEXT_ROLES))])
def get_patient(patient_id: str, clinic_id: str = Query(...)):
    if not _has_clinic_access(clinic_id, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    try:
        resp = supabase_execute(
            lambda: (
                supabase.table("patients")
                .select("*")
                .eq("id", patient_id)
                .eq("clinic_id", clinic_id)
                .single()
                .execute()
            )
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as e:
        print(f"GET patient error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    row = resp.data
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _normalize_patient_row(dict(row))


@router.patch("/{patient_id}", dependencies=[Depends(require_role(*ALL_ROLES))])
def patch_patient(patient_id: str, clinic_id: str = Query(...), body: dict = Body(...)):
    if not _has_clinic_access(clinic_id, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    existing = _fetch_patient_row(patient_id, restrict_clinic_id=clinic_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")

    update_data: dict[str, Any] = {}
    for key, val in body.items():
        if key == "clinic_id":
            continue
        if key not in _PATCHABLE_PATIENT_FIELDS:
            continue
        if key == "referral_source":
            update_data[key] = _normalize_referral_source(val)
        else:
            update_data[key] = val

    if update_data:
        update_data["updated_at"] = _now_iso()
        try:
            upd = (
                supabase.table("patients")
                .update(update_data)
                .eq("id", patient_id)
                .eq("clinic_id", clinic_id)
                .execute()
            )
            _handle_supabase_error(upd)
        except HTTPException:
            raise
        except Exception as exc:
            print(f"PATCH patient error: {exc}")
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        rows = upd.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Update failed")
        patient = _normalize_patient_row(dict(rows[0]))
    else:
        patient = _normalize_patient_row(existing)

    return {
        **patient,
        "appointments": _related_appointments(patient_id, clinic_id),
        "billing_records": _related_billing(patient_id, clinic_id),
        "memberships": _related_membership(patient_id, clinic_id),
        "pi_cases": _related_pi_cases(patient_id, clinic_id),
    }
