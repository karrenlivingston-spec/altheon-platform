"""Insurance billing claims and audit log."""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()
logger = logging.getLogger(__name__)

STEDI_SUBMIT_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/professionalclaims/v3/submission"
)
STEDI_STATUS_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/claimstatus/v3"
)

BILLING_PROVIDER_NPI = "1234567890"
BILLING_PROVIDER_TAX_ID = "123456789"
BILLING_PROVIDER_ORG_NAME = "Straight To The Point Dry Needling"
BILLING_PROVIDER_CITY = "Port St Lucie"
BILLING_PROVIDER_STATE = "FL"
BILLING_PROVIDER_POSTAL = "34953"


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date_only(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _days_remaining(filing_deadline: Any) -> Optional[int]:
    fd = _parse_date_only(filing_deadline)
    if fd is None:
        return None
    return (fd - date.today()).days


def _shape_claim(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["days_remaining"] = _days_remaining(row.get("filing_deadline"))
    return out


def _fetch_claim(claim_id: str) -> dict[str, Any]:
    try:
        resp = (
            supabase.table("insurance_claims")
            .select("*")
            .eq("id", claim_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("fetch claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Claim not found")
    return rows[0]


def _insert_audit_log(
    claim_id: str,
    action: str,
    *,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
    reference_number: Optional[str] = None,
    details: Optional[str] = None,
    payer_response: Optional[Any] = None,
) -> None:
    row: dict[str, Any] = {
        "claim_id": claim_id,
        "action": action,
    }
    if old_status is not None:
        row["old_status"] = old_status
    if new_status is not None:
        row["new_status"] = new_status
    if reference_number is not None:
        row["reference_number"] = reference_number
    if details is not None:
        row["details"] = details
    if payer_response is not None:
        row["payer_response"] = payer_response
    ins = supabase.table("claim_audit_log").insert(row).execute()
    _handle_supabase_error(ins)


def _stedi_api_key() -> str:
    return os.getenv("STEDI_API_KEY", "").strip()


def _stedi_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": api_key,
        "Content-Type": "application/json",
    }


def _format_stedi_date(value: Any) -> str:
    d = _parse_date_only(value)
    if d is None:
        return ""
    return d.strftime("%Y%m%d")


def _stedi_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            for key in ("message", "detail", "error"):
                if data.get(key):
                    return str(data[key])[:2000]
            return json.dumps(data)[:2000]
    except Exception:
        pass
    text = (response.text or "").strip()
    return text[:2000] if text else f"Stedi API error (HTTP {response.status_code})"


def _extract_claim_reference(response_data: dict[str, Any]) -> Optional[str]:
    ref = response_data.get("claimReference")
    if isinstance(ref, dict):
        for key in (
            "correlationId",
            "rhclaimNumber",
            "rhClaimNumber",
            "customerClaimNumber",
        ):
            val = ref.get(key)
            if val:
                return str(val).strip()
    if isinstance(ref, str) and ref.strip():
        return ref.strip()
    return None


def _normalize_diagnosis_code(code: str) -> str:
    return str(code).strip().upper().replace(".", "")


def _normalize_procedure_code(code: str) -> str:
    return str(code).strip().upper().replace(".", "")


def _patient_gender_code(patient: Optional[dict[str, Any]]) -> str:
    if not patient:
        return "U"
    raw = str(patient.get("gender") or "").strip().upper()
    if raw in ("M", "MALE"):
        return "M"
    if raw in ("F", "FEMALE"):
        return "F"
    return "U"


def _build_stedi_837p_payload(
    claim: dict[str, Any],
    patient: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    diagnosis_codes = [
        _normalize_diagnosis_code(c)
        for c in (claim.get("diagnosis_codes") or [])
        if str(c).strip()
    ]
    cpt_codes = [
        _normalize_procedure_code(c)
        for c in (claim.get("cpt_codes") or [])
        if str(c).strip()
    ]
    if not cpt_codes:
        cpt_codes = ["99213"]

    total_amount = float(claim.get("total_amount") or 0)
    charge_str = f"{total_amount:.2f}"
    service_date = _format_stedi_date(claim.get("first_treatment_date")) or datetime.now(
        timezone.utc
    ).strftime("%Y%m%d")

    health_care_codes: list[dict[str, str]] = []
    for idx, code in enumerate(diagnosis_codes):
        health_care_codes.append(
            {
                "diagnosisCode": code,
                "diagnosisTypeCode": "ABK" if idx == 0 else "ABF",
            }
        )
    if not health_care_codes:
        health_care_codes = [{"diagnosisCode": "Z0000", "diagnosisTypeCode": "ABK"}]

    per_line = round(total_amount / len(cpt_codes), 2) if cpt_codes else total_amount
    claim_id = str(claim.get("id") or "")
    service_lines: list[dict[str, Any]] = []
    for idx, procedure_code in enumerate(cpt_codes):
        service_lines.append(
            {
                "professionalService": {
                    "compositeDiagnosisCodePointers": {
                        "diagnosisCodePointers": ["1"],
                    },
                    "lineItemChargeAmount": f"{per_line:.2f}",
                    "measurementUnit": "UN",
                    "procedureCode": procedure_code,
                    "procedureIdentifier": "HC",
                    "serviceUnitCount": "1",
                },
                "providerControlNumber": f"{claim_id}-{idx + 1}"[:50],
                "serviceDate": service_date,
            }
        )

    subscriber: dict[str, Any] = {
        "memberId": str(claim.get("member_id") or "").strip(),
        "paymentResponsibilityLevelCode": "P",
        "firstName": (patient or {}).get("first_name") or "Unknown",
        "lastName": (patient or {}).get("last_name") or "Patient",
        "dateOfBirth": _format_stedi_date((patient or {}).get("date_of_birth"))
        or "20000101",
        "gender": _patient_gender_code(patient),
        "address": {
            "address1": "Unknown",
            "city": BILLING_PROVIDER_CITY,
            "state": BILLING_PROVIDER_STATE,
            "postalCode": BILLING_PROVIDER_POSTAL,
        },
    }
    policy_number = str(claim.get("policy_number") or "").strip()
    if policy_number:
        subscriber["policyNumber"] = policy_number

    provider_address = {
        "address1": BILLING_PROVIDER_CITY,
        "city": BILLING_PROVIDER_CITY,
        "state": BILLING_PROVIDER_STATE,
        "postalCode": BILLING_PROVIDER_POSTAL,
    }

    return {
        "usageIndicator": "T",
        "tradingPartnerName": str(claim.get("payer_name") or "").strip(),
        "tradingPartnerServiceId": str(claim.get("payer_id") or "").strip(),
        "billing": {
            "providerType": "BillingProvider",
            "npi": BILLING_PROVIDER_NPI,
            "employerId": BILLING_PROVIDER_TAX_ID,
            "organizationName": BILLING_PROVIDER_ORG_NAME,
            "taxonomyCode": "2084P0800X",
            "address": provider_address,
            "contactInformation": {
                "name": BILLING_PROVIDER_ORG_NAME,
                "phoneNumber": "5555555555",
            },
        },
        "claimInformation": {
            "benefitsAssignmentCertificationIndicator": "Y",
            "claimChargeAmount": charge_str,
            "claimFilingCode": "CI",
            "claimFrequencyCode": "1",
            "healthCareCodeInformation": health_care_codes,
            "patientControlNumber": claim_id[:20] if claim_id else "CLAIM",
            "placeOfServiceCode": "11",
            "planParticipationCode": "A",
            "releaseInformationCode": "Y",
            "serviceLines": service_lines,
            "signatureIndicator": "Y",
        },
        "subscriber": subscriber,
        "receiver": {
            "organizationName": str(claim.get("payer_name") or "Payer").strip(),
        },
        "submitter": {
            "organizationName": BILLING_PROVIDER_ORG_NAME,
            "contactInformation": {
                "name": BILLING_PROVIDER_ORG_NAME,
                "phoneNumber": "5555555555",
            },
            "submitterIdentification": BILLING_PROVIDER_TAX_ID,
        },
    }


def _claim_status_from_stedi_response(data: dict[str, Any]) -> str:
    claims = data.get("claims")
    if not isinstance(claims, list) or not claims:
        return "submitted"

    claim_status = claims[0].get("claimStatus") if isinstance(claims[0], dict) else {}
    if not isinstance(claim_status, dict):
        return "submitted"

    category = str(claim_status.get("statusCategoryCode") or "").upper()
    category_value = str(claim_status.get("statusCategoryCodeValue") or "").lower()

    if category.startswith("F") or (
        "final" in category_value and "payment" in category_value
    ):
        return "approved"
    if "denied" in category_value or "reject" in category_value:
        return "denied"
    if "resubmit" in category_value:
        return "resubmitted"
    return "submitted"


def _fetch_patient_for_claim(patient_id: Any) -> Optional[dict[str, Any]]:
    if not patient_id:
        return None
    try:
        resp = (
            supabase.table("patients")
            .select("first_name,last_name,date_of_birth,gender")
            .eq("id", str(patient_id))
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        logger.exception("patient fetch failed patient_id=%s", patient_id)
        return None


class CreateClaimBody(BaseModel):
    clinic_id: str
    patient_id: str
    clinician_id: Optional[str] = None
    appointment_id: Optional[str] = None
    first_treatment_date: date
    payer_name: str
    payer_id: str
    policy_number: str
    member_id: str
    diagnosis_codes: list[str] = Field(default_factory=list)
    cpt_codes: list[str] = Field(default_factory=list)
    total_amount: float
    notes: Optional[str] = None


class PatchClaimBody(BaseModel):
    patient_id: Optional[str] = None
    clinician_id: Optional[str] = None
    appointment_id: Optional[str] = None
    first_treatment_date: Optional[date] = None
    payer_name: Optional[str] = None
    payer_id: Optional[str] = None
    policy_number: Optional[str] = None
    member_id: Optional[str] = None
    diagnosis_codes: Optional[list[str]] = None
    cpt_codes: Optional[list[str]] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    filing_deadline: Optional[date] = None


def _optional_fk_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _claim_row_from_create(body: CreateClaimBody) -> dict[str, Any]:
    row: dict[str, Any] = {
        "clinic_id": body.clinic_id.strip(),
        "patient_id": body.patient_id.strip(),
        "clinician_id": _optional_fk_id(body.clinician_id),
        "appointment_id": _optional_fk_id(body.appointment_id),
        "first_treatment_date": body.first_treatment_date.isoformat(),
        "payer_name": body.payer_name.strip(),
        "payer_id": body.payer_id.strip(),
        "policy_number": body.policy_number.strip(),
        "member_id": body.member_id.strip(),
        "diagnosis_codes": body.diagnosis_codes,
        "cpt_codes": body.cpt_codes,
        "total_amount": body.total_amount,
        "status": "draft",
    }
    if body.notes is not None:
        row["notes"] = body.notes
    return row


@router.get("/claims")
def list_claims(clinic_id: str = Query(...)):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")
    try:
        resp = (
            supabase.table("insurance_claims")
            .select("*")
            .eq("clinic_id", cid)
            .order("filing_deadline")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_claims failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return [_shape_claim(r) for r in resp.data or [] if isinstance(r, dict)]


@router.post("/claims")
def create_claim(body: CreateClaimBody):
    row = _claim_row_from_create(body)
    try:
        ins = supabase.table("insurance_claims").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("create_claim failed clinic_id=%s", body.clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create claim")
    claim = rows[0]
    claim_id = str(claim["id"])
    try:
        _insert_audit_log(claim_id, "claim_created")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("claim audit log insert failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _shape_claim(claim)


@router.get("/claims/{claim_id}")
def get_claim(claim_id: str):
    claim = _fetch_claim(claim_id)
    try:
        audit_resp = (
            supabase.table("claim_audit_log")
            .select("*")
            .eq("claim_id", claim_id)
            .order("created_at")
            .execute()
        )
        _handle_supabase_error(audit_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_claim audit log failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    out = _shape_claim(claim)
    out["audit_log"] = audit_resp.data or []
    return out


@router.patch("/claims/{claim_id}")
def patch_claim(claim_id: str, body: PatchClaimBody):
    current = _fetch_claim(claim_id)
    old_status = str(current.get("status") or "").strip()

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "first_treatment_date" in data and data["first_treatment_date"] is not None:
        if isinstance(data["first_treatment_date"], date):
            data["first_treatment_date"] = data["first_treatment_date"].isoformat()
    if "filing_deadline" in data and data["filing_deadline"] is not None:
        if isinstance(data["filing_deadline"], date):
            data["filing_deadline"] = data["filing_deadline"].isoformat()

    for key in (
        "patient_id",
        "clinician_id",
        "appointment_id",
        "payer_name",
        "payer_id",
        "policy_number",
        "member_id",
    ):
        if key in data and data[key] is not None:
            data[key] = str(data[key]).strip()

    data["updated_at"] = _now_iso()

    try:
        upd = supabase.table("insurance_claims").update(data).eq("id", claim_id).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("patch_claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Claim not found")
    updated = rows[0]

    if "status" in data:
        new_status = str(data["status"] or "").strip()
        if new_status.lower() != old_status.lower():
            try:
                _insert_audit_log(
                    claim_id,
                    "status_changed",
                    old_status=old_status or None,
                    new_status=new_status,
                )
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("status audit log failed claim_id=%s", claim_id)
                raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _shape_claim(updated)


@router.post("/claims/{claim_id}/submit")
async def submit_claim(claim_id: str):
    api_key = _stedi_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Stedi API key not configured")

    claim = _fetch_claim(claim_id)
    if str(claim.get("status") or "").strip().lower() != "draft":
        raise HTTPException(
            status_code=400,
            detail="Only draft claims can be submitted",
        )

    patient = _fetch_patient_for_claim(claim.get("patient_id"))
    payload = _build_stedi_837p_payload(claim, patient)
    headers = _stedi_headers(api_key)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                STEDI_SUBMIT_URL,
                json=payload,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        msg = str(exc)
        try:
            _insert_audit_log(claim_id, "submission_failed", details=msg)
        except HTTPException:
            raise
        except Exception:
            logger.exception("submission_failed audit log claim_id=%s", claim_id)
        raise HTTPException(status_code=502, detail=msg) from exc

    if response.status_code >= 400:
        detail = _stedi_error_detail(response)
        try:
            _insert_audit_log(claim_id, "submission_failed", details=detail)
        except HTTPException:
            raise
        except Exception:
            logger.exception("submission_failed audit log claim_id=%s", claim_id)
        raise HTTPException(status_code=502, detail=detail)

    try:
        data = response.json()
    except Exception as exc:
        detail = "Invalid JSON response from Stedi"
        _insert_audit_log(claim_id, "submission_failed", details=detail)
        raise HTTPException(status_code=502, detail=detail) from exc

    stedi_status = str(data.get("status") or "").upper()
    if stedi_status and stedi_status not in ("SUCCESS", "ACCEPTED"):
        detail = _stedi_error_detail(response)
        try:
            _insert_audit_log(claim_id, "submission_failed", details=detail)
        except HTTPException:
            raise
        raise HTTPException(status_code=502, detail=detail)

    reference = _extract_claim_reference(data)
    now = _now_iso()
    upd_data: dict[str, Any] = {
        "status": "submitted",
        "submission_date": now,
        "updated_at": now,
    }
    if reference:
        upd_data["reference_number"] = reference

    try:
        upd = (
            supabase.table("insurance_claims")
            .update(upd_data)
            .eq("id", claim_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("submit_claim update failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        _insert_audit_log(
            claim_id,
            "claim_submitted",
            reference_number=reference,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("claim_submitted audit log claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    return _shape_claim(rows[0] if rows else {**claim, **upd_data})


@router.get("/claims/{claim_id}/status")
async def check_claim_status(claim_id: str):
    api_key = _stedi_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Stedi API key not configured")

    claim = _fetch_claim(claim_id)
    reference_number = str(claim.get("reference_number") or "").strip()
    if not reference_number:
        raise HTTPException(
            status_code=400,
            detail="Claim has not been submitted yet",
        )

    headers = _stedi_headers(api_key)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                STEDI_STATUS_URL,
                params={"claimReference": reference_number},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=_stedi_error_detail(response))

    try:
        data = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Invalid JSON response from Stedi",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Unexpected Stedi response format")

    new_status = _claim_status_from_stedi_response(data)
    now = _now_iso()
    try:
        upd = (
            supabase.table("insurance_claims")
            .update({"status": new_status, "updated_at": now})
            .eq("id", claim_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("check_claim_status update failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        _insert_audit_log(
            claim_id,
            "status_checked",
            payer_response=data,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("status_checked audit log claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    out = _shape_claim(rows[0] if rows else {**claim, "status": new_status})
    out["payer_status_response"] = data
    return out


@router.delete("/claims/{claim_id}", status_code=204)
def delete_claim(claim_id: str):
    claim = _fetch_claim(claim_id)
    status = str(claim.get("status") or "").strip().lower()
    if status != "draft":
        raise HTTPException(
            status_code=400,
            detail="Only draft claims can be deleted",
        )
    try:
        dele = supabase.table("insurance_claims").delete().eq("id", claim_id).execute()
        _handle_supabase_error(dele)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("delete_claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=204)


NY = ZoneInfo("America/New_York")
_UNBILLED_LOOKBACK_DAYS = 365


def _nested_name(row: Any, *keys: str) -> str:
    cur = row
    for key in keys:
        if cur is None:
            return ""
        if isinstance(cur, list):
            cur = cur[0] if cur else {}
        elif isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return ""
    if isinstance(cur, dict):
        fn = str(cur.get("first_name") or "").strip()
        ln = str(cur.get("last_name") or "").strip()
        title = str(cur.get("title") or "").strip()
        name = f"{fn} {ln}".strip()
        if title and name:
            return f"{name}, {title}"
        return name or ""
    return str(cur or "").strip()


def _treatment_type_name(row: dict[str, Any]) -> str:
    tt = row.get("treatment_types")
    if isinstance(tt, list):
        tt = tt[0] if tt else {}
    if isinstance(tt, dict):
        return str(tt.get("name") or "").strip()
    return ""


def _suggest_cpt_codes(treatment_name: str, fee_codes: set[str]) -> list[str]:
    if not treatment_name:
        return []
    n = treatment_name.lower()
    candidates: list[str] = []
    if "dry needling" in n or "dry needle" in n or "needling" in n:
        candidates = ["20560", "20561"]
    elif "re-eval" in n or "reeval" in n or "re-evaluation" in n:
        candidates = ["97164"]
    elif "evaluation" in n or n.startswith("eval") or " initial" in n:
        candidates = ["97161", "97162", "97163"]
    elif "manual" in n:
        candidates = ["97140"]
    elif "exercise" in n or "therapeutic ex" in n:
        candidates = ["97110"]
    elif "activities" in n:
        candidates = ["97530"]
    elif "neuromuscular" in n:
        candidates = ["97112"]

    if fee_codes:
        matched = [c for c in candidates if c in fee_codes]
        return matched[:3]
    return candidates[:1] if candidates else []


def _shape_unbilled_appointment(
    row: dict[str, Any],
    *,
    fee_by_code: dict[str, float],
) -> dict[str, Any]:
    start_raw = str(row.get("start_time") or "")
    dos = start_raw[:10] if start_raw else None
    treatment_name = _treatment_type_name(row)
    fee_codes = set(fee_by_code.keys())
    suggested_cpt = _suggest_cpt_codes(treatment_name, fee_codes)
    suggested_total = round(
        sum(float(fee_by_code.get(c, 0) or 0) for c in suggested_cpt),
        2,
    )
    if suggested_total <= 0:
        suggested_total = None

    patient_name = _nested_name(row, "patients") or "—"
    name_parts = patient_name.split(" ", 1) if patient_name != "—" else ["", ""]

    return {
        "appointment_id": str(row.get("id") or ""),
        "patient_id": str(row.get("patient_id") or ""),
        "patient_name": patient_name,
        "patient_first_name": name_parts[0] or None,
        "patient_last_name": name_parts[1] if len(name_parts) > 1 else None,
        "clinician_id": str(row.get("clinician_id") or "") or None,
        "clinician_name": _nested_name(row, "clinicians") or "—",
        "date_of_service": dos,
        "appointment_type": treatment_name or None,
        "suggested_cpt_codes": suggested_cpt,
        "suggested_total_amount": suggested_total,
    }


@router.get("/unbilled-appointments")
def list_unbilled_appointments(clinic_id: str = Query(...)):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    today = datetime.now(NY).date()
    end_of_today = datetime.combine(today, time(23, 59, 59), tzinfo=NY).astimezone(
        timezone.utc
    )
    lookback_start = datetime.combine(
        today - timedelta(days=_UNBILLED_LOOKBACK_DAYS),
        time.min,
        tzinfo=NY,
    ).astimezone(timezone.utc)

    try:
        claims_resp = (
            supabase.table("insurance_claims")
            .select("appointment_id")
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(claims_resp)
        claimed_appt_ids = {
            str(r.get("appointment_id") or "")
            for r in (claims_resp.data or [])
            if r.get("appointment_id")
        }

        fee_resp = (
            supabase.table("clinic_fee_schedules")
            .select("cpt_code, charge")
            .eq("clinic_id", cid)
            .eq("is_active", True)
            .execute()
        )
        _handle_supabase_error(fee_resp)
        fee_by_code: dict[str, float] = {}
        for row in fee_resp.data or []:
            code = str(row.get("cpt_code") or "").strip().upper()
            if not code:
                continue
            try:
                fee_by_code[code] = float(row.get("charge") or 0)
            except (TypeError, ValueError):
                fee_by_code[code] = 0.0

        appt_resp = (
            supabase.table("appointments")
            .select(
                "id, patient_id, clinician_id, start_time, status, "
                "patients(first_name, last_name), "
                "clinicians(first_name, last_name, title), "
                "treatment_types(name)"
            )
            .eq("clinic_id", cid)
            .eq("status", "completed")
            .gte("start_time", lookback_start.isoformat())
            .lte("start_time", end_of_today.isoformat())
            .order("start_time", desc=True)
            .execute()
        )
        _handle_supabase_error(appt_resp)

        unbilled: list[dict[str, Any]] = []
        for row in appt_resp.data or []:
            if not isinstance(row, dict):
                continue
            aid = str(row.get("id") or "")
            if not aid or aid in claimed_appt_ids:
                continue
            unbilled.append(
                _shape_unbilled_appointment(row, fee_by_code=fee_by_code)
            )

        return {"total": len(unbilled), "appointments": unbilled}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("list_unbilled_appointments failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


_AGING_BUCKET_LABELS = {
    "0_30": "0–30 days",
    "31_60": "31–60 days",
    "61_90": "61–90 days",
    "90_plus": "90+ days",
}


def _parse_claim_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _aging_bucket_key(age_days: int) -> str:
    if age_days <= 30:
        return "0_30"
    if age_days <= 60:
        return "31_60"
    if age_days <= 90:
        return "61_90"
    return "90_plus"


def _amount_to_cents(value: Any) -> int:
    try:
        return round(float(value or 0) * 100)
    except (TypeError, ValueError):
        return 0


def _claim_number_from_row(row: dict[str, Any], index: int) -> str:
    dos = str(row.get("first_treatment_date") or "")[:10]
    if dos:
        return f"CLM-{dos.replace('-', '')}-{index + 1:03d}"
    cid = str(row.get("id") or "")
    return f"CLM-{cid[:8].upper()}" if cid else f"CLM-{index + 1:03d}"


def _patient_name_from_claim(row: dict[str, Any]) -> str:
    patients = row.get("patients")
    if isinstance(patients, list):
        patients = patients[0] if patients else {}
    if isinstance(patients, dict):
        fn = str(patients.get("first_name") or "").strip()
        ln = str(patients.get("last_name") or "").strip()
        name = f"{fn} {ln}".strip()
        if name:
            return name
    return "—"


@router.get("/aging-report")
def aging_report(clinic_id: str = Query(...)):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    today = datetime.now(NY).date()

    try:
        resp = (
            supabase.table("insurance_claims")
            .select(
                "id, payer_name, first_treatment_date, total_amount, status, "
                "patients(first_name, last_name)"
            )
            .eq("clinic_id", cid)
            .order("first_treatment_date", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)

        open_rows = [
            r
            for r in (resp.data or [])
            if isinstance(r, dict)
            and str(r.get("status") or "").strip().lower() != "paid"
        ]

        bucket_counts = {"0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
        bucket_amounts = {"0_30": 0.0, "31_60": 0.0, "61_90": 0.0, "90_plus": 0.0}
        bucket_cents = {
            "0_30": 0,
            "31_60": 0,
            "61_90": 0,
            "90_plus": 0,
        }
        detail_rows: list[dict[str, Any]] = []

        for idx, row in enumerate(open_rows):
            dos = _parse_claim_date(row.get("first_treatment_date"))
            if dos is None:
                continue

            age_days = max(0, (today - dos).days)
            bucket = _aging_bucket_key(age_days)
            amount = float(row.get("total_amount") or 0)
            amount_cents = _amount_to_cents(amount)

            bucket_counts[bucket] += 1
            bucket_amounts[bucket] += amount
            bucket_cents[bucket] += amount_cents

            detail_rows.append(
                {
                    "id": str(row.get("id") or ""),
                    "claim_number": _claim_number_from_row(row, idx),
                    "patient_name": _patient_name_from_claim(row),
                    "payer_name": str(row.get("payer_name") or "").strip() or "—",
                    "first_treatment_date": dos.isoformat(),
                    "total_amount": round(amount, 2),
                    "status": str(row.get("status") or "draft").strip().lower(),
                    "days_outstanding": age_days,
                    "bucket": bucket,
                }
            )

        summary = [
            {
                "bucket": key,
                "label": _AGING_BUCKET_LABELS[key],
                "count": bucket_counts[key],
                "total_amount": round(bucket_amounts[key], 2),
                "total_amount_cents": bucket_cents[key],
            }
            for key in ("0_30", "31_60", "61_90", "90_plus")
        ]

        aging = {
            "bucket_0_30": bucket_cents["0_30"],
            "bucket_31_60": bucket_cents["31_60"],
            "bucket_61_90": bucket_cents["61_90"],
            "bucket_90_plus": bucket_cents["90_plus"],
            "total": sum(bucket_cents.values()),
        }

        return {
            "summary": summary,
            "aging": aging,
            "claims": detail_rows,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("aging_report failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
