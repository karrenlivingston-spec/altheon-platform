"""Insurance billing claims and audit log."""

from __future__ import annotations

import base64
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
from app.routers.patient_statement_pdf import build_patient_statement_pdf
from app.routers.resubmission_pdf import (
    _insurance_address,
    build_resubmission_pdf,
    clean_cover_letter_body,
)
from app.routers.superbill_pdf import (
    build_superbill_pdf,
    format_letter_date,
    normalize_cpt_codes,
    resolve_claim_number,
)
from app.sms import send_sms
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

MEDICARE_CAP_DOLLARS = 2480.0
logger = logging.getLogger(__name__)

STEDI_SUBMIT_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/professionalclaims/v3/submission"
)
STEDI_STATUS_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/claimstatus/v2"
)
STEDI_ELIGIBILITY_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/eligibility/v3"
)
STEDI_PDF_URL = "https://healthcare.us.stedi.com/2024-04-01/export/pdf"
STEDI_TEST_PAYER_ID = "STEDITEST"

BILLING_PROVIDER_NPI = "1234567893"
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


async def _fetch_stedi_cms1500_pdf_bytes(business_id: str) -> bytes:
    """Retrieve CMS-1500 PDF bytes from Stedi using claimReference.correlationId."""
    api_key = _stedi_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Stedi API key not configured")

    headers = _stedi_headers(api_key)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                STEDI_PDF_URL,
                params={"businessId": business_id},
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

    pdfs = data.get("pdfs") or []
    if isinstance(pdfs, list):
        for item in pdfs:
            if not isinstance(item, dict):
                continue
            raw = item.get("data")
            if not raw:
                continue
            try:
                return base64.b64decode(str(raw))
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to decode CMS-1500 PDF",
                ) from exc

    error_msgs: list[str] = []
    errors = data.get("errors") or []
    if isinstance(errors, list):
        for err in errors:
            if isinstance(err, dict) and err.get("error"):
                error_msgs.append(str(err["error"]))
    if error_msgs:
        logger.info(
            "Stedi CMS-1500 PDF not ready business_id=%s errors=%s",
            business_id,
            error_msgs,
        )

    raise HTTPException(
        status_code=404,
        detail="PDF not yet available, try again shortly",
    )


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
    claim_key = claim_id.replace("-", "")[:8]
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
                "providerControlNumber": f"{claim_key}-{idx + 1}"[:30],
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

    payer_id = str(claim.get("payer_id") or "").strip()
    usage_indicator = (
        "P"
        if payer_id and payer_id.upper() != STEDI_TEST_PAYER_ID.upper()
        else "T"
    )

    return {
        "usageIndicator": usage_indicator,
        "tradingPartnerName": str(claim.get("payer_name") or "").strip(),
        "tradingPartnerServiceId": payer_id,
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


def _build_stedi_claim_status_payload(
    claim: dict[str, Any],
    patient: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build Stedi 276 real-time claim status request (POST /claimstatus/v2)."""
    submit_payload = _build_stedi_837p_payload(claim, patient)
    billing = submit_payload["billing"]
    subscriber_src = submit_payload["subscriber"]

    payer_id = str(claim.get("payer_id") or "").strip()
    if not payer_id:
        raise HTTPException(status_code=400, detail="Claim is missing payer_id")

    member_id = str(subscriber_src.get("memberId") or "").strip()
    if not member_id:
        raise HTTPException(status_code=400, detail="Claim is missing member_id")

    dos = _parse_date_only(claim.get("first_treatment_date"))
    if dos is None:
        dos = date.today()
    encounter_start = dos - timedelta(days=7)
    encounter_end = dos + timedelta(days=7)

    provider: dict[str, Any] = {
        "providerType": billing["providerType"],
        "npi": billing["npi"],
        "organizationName": billing["organizationName"],
    }
    employer_id = str(billing.get("employerId") or "").strip()
    if employer_id:
        provider["taxId"] = employer_id

    subscriber: dict[str, Any] = {
        "memberId": member_id,
        "firstName": str(subscriber_src.get("firstName") or "Unknown").strip(),
        "lastName": str(subscriber_src.get("lastName") or "Patient").strip(),
        "dateOfBirth": str(subscriber_src.get("dateOfBirth") or "20000101").strip(),
    }

    return {
        "tradingPartnerServiceId": payer_id,
        "providers": [provider],
        "subscriber": subscriber,
        "encounter": {
            "beginningDateOfService": encounter_start.strftime("%Y%m%d"),
            "endDateOfService": encounter_end.strftime("%Y%m%d"),
        },
    }


def _parse_stedi_benefit_amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).strip().replace(",", "").replace("$", "")
    if not s:
        return None
    try:
        return round(float(s), 2)
    except (TypeError, ValueError):
        return None


def _stedi_date_to_iso(value: Any) -> str:
    s = str(value or "").strip()
    if len(s) >= 8 and s[:8].isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    d = _parse_date_only(value)
    return d.isoformat() if d else ""


def _build_stedi_eligibility_payload(body: "InsuranceVerificationBody") -> dict[str, Any]:
    encounter: dict[str, Any] = {"serviceTypeCodes": ["30"]}
    if body.date_of_service is not None:
        encounter["dateOfService"] = _format_stedi_date(body.date_of_service)

    return {
        "tradingPartnerServiceId": body.payer_id.strip(),
        "provider": {
            "organizationName": BILLING_PROVIDER_ORG_NAME,
            "npi": BILLING_PROVIDER_NPI,
        },
        "subscriber": {
            "firstName": body.first_name.strip(),
            "lastName": body.last_name.strip(),
            "dateOfBirth": _format_stedi_date(body.date_of_birth),
            "memberId": body.member_id.strip(),
        },
        "encounter": encounter,
    }


def _parse_stedi_271_response(
    data: dict[str, Any],
    *,
    fallback_member_id: str = "",
    fallback_subscriber_name: str = "",
) -> dict[str, Any]:
    benefits = data.get("benefitsInformation")
    if not isinstance(benefits, list):
        benefits = []

    eligible = False
    copay: Optional[float] = None
    deductible: Optional[float] = None
    deductible_met: Optional[float] = None
    out_of_pocket_max: Optional[float] = None
    out_of_pocket_met: Optional[float] = None
    coverage_details: list[dict[str, Any]] = []
    plan_name = ""

    for item in benefits:
        if not isinstance(item, dict):
            continue

        code = str(item.get("code") or "").strip().upper()
        name = str(item.get("name") or "").strip()
        time_code = str(item.get("timeQualifierCode") or "").strip()
        amount = _parse_stedi_benefit_amount(item.get("benefitAmount"))
        percent = item.get("benefitPercent")
        coverage_level = str(
            item.get("coverageLevel") or item.get("coverageLevelCode") or ""
        ).strip()

        if code == "1" or "active coverage" in name.lower():
            eligible = True
            if not plan_name:
                plan_name = str(
                    item.get("planCoverage")
                    or item.get("insuranceType")
                    or name
                    or ""
                ).strip()

        if code == "B" and copay is None and amount is not None:
            copay = amount
        elif code == "C":
            if time_code == "29" and amount is not None:
                remaining = amount
                if deductible is not None:
                    deductible_met = round(max(0.0, deductible - remaining), 2)
                else:
                    deductible_met = None
            elif time_code in ("23", "24", "") and amount is not None:
                deductible = amount
                if deductible_met is None and time_code == "29":
                    pass
        elif code == "G":
            if time_code == "29" and amount is not None:
                remaining = amount
                if out_of_pocket_max is not None:
                    out_of_pocket_met = round(
                        max(0.0, out_of_pocket_max - remaining), 2
                    )
            elif amount is not None:
                out_of_pocket_max = amount

        category = name
        if not category:
            service_types = item.get("serviceTypes")
            if isinstance(service_types, list) and service_types:
                category = str(service_types[0])
            else:
                st_codes = item.get("serviceTypeCodes")
                if isinstance(st_codes, list) and st_codes:
                    category = f"Service type {st_codes[0]}"

        amount_display: Any = amount
        if amount_display is None and percent is not None:
            amount_display = f"{percent}%"

        coverage_details.append(
            {
                "category": category or code or "Benefit",
                "coverage_level": coverage_level,
                "amount": amount_display if amount_display is not None else "",
            }
        )

    plan_info = data.get("planInformation")
    if isinstance(plan_info, dict):
        plan_name = plan_name or str(
            plan_info.get("groupDescription")
            or plan_info.get("planDescription")
            or plan_info.get("policyNumber")
            or ""
        ).strip()

    plan_dates = data.get("planDateInformation")
    plan_begin_date = ""
    if isinstance(plan_dates, dict):
        plan_begin_date = _stedi_date_to_iso(
            plan_dates.get("planBegin")
            or plan_dates.get("eligibilityBegin")
            or plan_dates.get("plan")
        )

    subscriber = data.get("subscriber")
    if not isinstance(subscriber, dict):
        subscriber = {}
    dep = data.get("dependents")
    if isinstance(dep, list) and dep and isinstance(dep[0], dict):
        subscriber = dep[0]

    sub_first = str(subscriber.get("firstName") or "").strip()
    sub_last = str(subscriber.get("lastName") or "").strip()
    subscriber_name = f"{sub_first} {sub_last}".strip() or fallback_subscriber_name
    member_id = str(subscriber.get("memberId") or fallback_member_id).strip()
    group_number = str(
        subscriber.get("groupNumber")
        or (plan_info.get("groupNumber") if isinstance(plan_info, dict) else "")
        or ""
    ).strip()

    if deductible is not None and deductible_met is None:
        for item in benefits:
            if not isinstance(item, dict):
                continue
            if str(item.get("code") or "").upper() != "C":
                continue
            if str(item.get("timeQualifierCode") or "") == "29":
                remaining = _parse_stedi_benefit_amount(item.get("benefitAmount"))
                if remaining is not None:
                    deductible_met = round(max(0.0, deductible - remaining), 2)
                    break

    if out_of_pocket_max is not None and out_of_pocket_met is None:
        for item in benefits:
            if not isinstance(item, dict):
                continue
            if str(item.get("code") or "").upper() != "G":
                continue
            if str(item.get("timeQualifierCode") or "") == "29":
                remaining = _parse_stedi_benefit_amount(item.get("benefitAmount"))
                if remaining is not None:
                    out_of_pocket_met = round(
                        max(0.0, out_of_pocket_max - remaining), 2
                    )
                    break

    errors = data.get("errors")
    if isinstance(errors, list) and errors:
        eligible = False

    return {
        "eligible": eligible,
        "plan_name": plan_name,
        "plan_begin_date": plan_begin_date,
        "subscriber_name": subscriber_name,
        "member_id": member_id,
        "group_number": group_number,
        "copay": copay,
        "deductible": deductible,
        "deductible_met": deductible_met,
        "out_of_pocket_max": out_of_pocket_max,
        "out_of_pocket_met": out_of_pocket_met,
        "coverage_details": coverage_details,
        "raw_response": data,
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
    status_code_value = str(claim_status.get("statusCodeValue") or "").lower()

    if category.startswith("F") or (
        "final" in category_value and "payment" in category_value
    ) or "has been paid" in status_code_value:
        return "paid"
    if "denied" in category_value or "reject" in category_value:
        return "denied"
    if "resubmit" in category_value:
        return "resubmitted"
    if "pending" in category_value or "pended" in category_value:
        return "pending"
    return "submitted"


def _fetch_patient_for_claim(patient_id: Any) -> Optional[dict[str, Any]]:
    if not patient_id:
        return None
    try:
        resp = (
            supabase.table("patients")
            .select(
                "first_name,last_name,date_of_birth,gender,"
                "address_line1,address_line2,city,state,zip,insurance_group_number"
            )
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


class InsuranceVerificationBody(BaseModel):
    clinic_id: str
    patient_id: str
    payer_id: str
    member_id: str
    date_of_birth: date
    first_name: str
    last_name: str
    date_of_service: Optional[date] = None


class SuperbillBody(BaseModel):
    clinic_id: str
    claim_id: str


class ResubmissionPackageBody(BaseModel):
    clinic_id: str
    patient_id: str
    claim_id: str
    eob_extraction_id: str


class PatientStatementBody(BaseModel):
    clinic_id: str
    patient_id: str
    delivery: str = "download"


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

    patient = _fetch_patient_for_claim(claim.get("patient_id"))
    payload = _build_stedi_claim_status_payload(claim, patient)
    headers = _stedi_headers(api_key)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                STEDI_STATUS_URL,
                headers=headers,
                json=payload,
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


@router.get("/claims/{claim_id}/cms1500-pdf")
async def get_claim_cms1500_pdf(claim_id: str):
    """Return the Stedi-generated CMS-1500 PDF for a submitted claim."""
    claim = _fetch_claim(claim_id)
    status = str(claim.get("status") or "").strip().lower()
    if status == "draft":
        raise HTTPException(
            status_code=400,
            detail="Claim has not been submitted yet",
        )

    reference_number = str(claim.get("reference_number") or "").strip()
    if not reference_number:
        raise HTTPException(
            status_code=400,
            detail="Claim has not been submitted yet",
        )

    pdf_bytes = await _fetch_stedi_cms1500_pdf_bytes(reference_number)
    claim_label = resolve_claim_number(claim) or str(claim_id)[:8]
    filename = f"cms1500-{claim_label}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


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


@router.get("/payer-summary")
def payer_summary_report(clinic_id: str = Query(...)):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    try:
        resp = (
            supabase.table("insurance_claims")
            .select("payer_name, total_amount, status")
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(resp)

        payer_map: dict[str, dict[str, Any]] = {}
        for row in resp.data or []:
            if not isinstance(row, dict):
                continue
            payer = str(row.get("payer_name") or "").strip() or "Unknown"
            status = str(row.get("status") or "").strip().lower()
            try:
                amount = float(row.get("total_amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0

            entry = payer_map.setdefault(
                payer,
                {
                    "payer_name": payer,
                    "total_billed": 0.0,
                    "total_collected": 0.0,
                    "claim_count": 0,
                    "paid_count": 0,
                    "denied_count": 0,
                },
            )
            entry["total_billed"] += amount
            entry["claim_count"] += 1
            if status == "paid":
                entry["total_collected"] += amount
                entry["paid_count"] += 1
            elif status == "denied":
                entry["denied_count"] += 1

        payers: list[dict[str, Any]] = []
        total_billed_all = 0.0
        total_collected_all = 0.0

        for entry in payer_map.values():
            billed = round(float(entry["total_billed"]), 2)
            collected = round(float(entry["total_collected"]), 2)
            outstanding = round(max(0.0, billed - collected), 2)
            rate = round(collected / billed * 100) if billed > 0 else 0
            payers.append(
                {
                    "payer_name": entry["payer_name"],
                    "total_billed": billed,
                    "total_collected": collected,
                    "total_outstanding": outstanding,
                    "claim_count": entry["claim_count"],
                    "paid_count": entry["paid_count"],
                    "denied_count": entry["denied_count"],
                    "collection_rate": rate,
                }
            )
            total_billed_all += billed
            total_collected_all += collected

        payers.sort(key=lambda x: x["total_billed"], reverse=True)

        overall_rate = (
            round(total_collected_all / total_billed_all * 100)
            if total_billed_all > 0
            else 0
        )

        return {
            "summary": {
                "total_payers": len(payers),
                "total_billed_all": round(total_billed_all, 2),
                "total_collected_all": round(total_collected_all, 2),
                "overall_collection_rate": overall_rate,
            },
            "payers": payers,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("payer_summary_report failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/benefits-ledger")
def clinic_benefits_ledger(clinic: ClinicUserDep):
    """Insurance utilization grouped by patient and payer (clinic-wide)."""
    cid = clinic.clinic_id
    try:
        resp = (
            supabase.table("insurance_claims")
            .select(
                "patient_id, payer_name, total_amount, status, "
                "patients(first_name, last_name)"
            )
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(resp)

        groups: dict[tuple[str, str], dict[str, Any]] = {}
        for row in resp.data or []:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("patient_id") or "").strip()
            if not pid:
                continue

            payer = str(row.get("payer_name") or "").strip() or "Unknown"
            key = (pid, payer)

            patients_raw = row.get("patients")
            if isinstance(patients_raw, list):
                patients_raw = patients_raw[0] if patients_raw else {}
            if not isinstance(patients_raw, dict):
                patients_raw = {}
            fn = str(patients_raw.get("first_name") or "").strip()
            ln = str(patients_raw.get("last_name") or "").strip()

            entry = groups.get(key)
            if not entry:
                entry = {
                    "patient_id": pid,
                    "patient_name": f"{fn} {ln}".strip() or "—",
                    "patient_last_name": ln.lower(),
                    "patient_first_name": fn.lower(),
                    "payer_name": payer,
                    "visit_count": 0,
                    "total_billed": 0.0,
                    "total_paid": 0.0,
                }
                groups[key] = entry

            try:
                amount = float(row.get("total_amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0
            entry["visit_count"] += 1
            entry["total_billed"] += amount
            if str(row.get("status") or "").strip().lower() == "paid":
                entry["total_paid"] += amount

        sorted_entries = sorted(
            groups.values(),
            key=lambda entry: (
                str(entry.get("patient_last_name") or ""),
                str(entry.get("patient_first_name") or ""),
                str(entry.get("payer_name") or "").lower(),
            ),
        )
        out: list[dict[str, Any]] = []
        for entry in sorted_entries:
            payer_name = str(entry["payer_name"])
            is_medicare = "medicare" in payer_name.lower()
            total_billed = round(float(entry["total_billed"]), 2)
            total_paid = round(float(entry["total_paid"]), 2)
            medicare_cap_used = total_billed if is_medicare else None
            medicare_cap_remaining = (
                round(max(0.0, MEDICARE_CAP_DOLLARS - total_billed), 2)
                if is_medicare
                else None
            )
            out.append(
                {
                    "patient_id": entry["patient_id"],
                    "patient_name": entry["patient_name"],
                    "payer_name": payer_name,
                    "visit_count": int(entry["visit_count"]),
                    "total_billed": total_billed,
                    "total_paid": total_paid,
                    "is_medicare": is_medicare,
                    "medicare_cap_used": medicare_cap_used,
                    "medicare_cap_remaining": medicare_cap_remaining,
                }
            )

        return out
    except HTTPException:
        raise
    except Exception:
        logger.exception("clinic_benefits_ledger failed clinic_id=%s", cid)
        return []


@router.post("/insurance-verification")
def insurance_verification(body: InsuranceVerificationBody):
    cid = body.clinic_id.strip()
    pid = body.patient_id.strip()
    if not cid or not pid:
        raise HTTPException(
            status_code=400, detail="clinic_id and patient_id are required"
        )
    if not body.payer_id.strip() or not body.member_id.strip():
        raise HTTPException(
            status_code=400, detail="payer_id and member_id are required"
        )

    api_key = _stedi_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Stedi API key not configured")

    payload = _build_stedi_eligibility_payload(body)
    headers = _stedi_headers(api_key)

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                STEDI_ELIGIBILITY_URL,
                headers=headers,
                json=payload,
            )
    except httpx.RequestError as exc:
        logger.exception("Stedi eligibility request failed patient_id=%s", pid)
        raise HTTPException(
            status_code=502, detail=f"Stedi request failed: {exc}"
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=_stedi_error_detail(response)
        )

    try:
        data = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="Invalid JSON response from Stedi"
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502, detail="Unexpected Stedi response format"
        )

    fallback_name = f"{body.first_name.strip()} {body.last_name.strip()}".strip()
    summary = _parse_stedi_271_response(
        data,
        fallback_member_id=body.member_id.strip(),
        fallback_subscriber_name=fallback_name,
    )

    verified_at = _now_iso()
    save_row: dict[str, Any] = {
        "clinic_id": cid,
        "patient_id": pid,
        "payer_id": body.payer_id.strip(),
        "member_id": body.member_id.strip(),
        "verified_at": verified_at,
        "eligible": summary["eligible"],
        "plan_name": summary.get("plan_name") or None,
        "copay": summary.get("copay"),
        "deductible": summary.get("deductible"),
        "raw_response": summary.get("raw_response") or data,
    }

    try:
        ins = supabase.table("insurance_verifications").insert(save_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "insurance_verification save failed clinic_id=%s patient_id=%s",
            cid,
            pid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    saved = (ins.data or [{}])[0]
    summary["verification_id"] = str(saved.get("id") or "")
    summary["verified_at"] = verified_at
    return summary


@router.get("/insurance-verification-history")
def insurance_verification_history(
    clinic_id: str = Query(...),
    patient_id: str = Query(...),
):
    cid = clinic_id.strip()
    pid = patient_id.strip()
    if not cid or not pid:
        raise HTTPException(
            status_code=400, detail="clinic_id and patient_id are required"
        )

    try:
        resp = (
            supabase.table("insurance_verifications")
            .select(
                "id, payer_id, member_id, verified_at, eligible, "
                "plan_name, copay, deductible"
            )
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .order("verified_at", desc=True)
            .limit(50)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "insurance_verification_history failed clinic_id=%s patient_id=%s",
            cid,
            pid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "id": str(row.get("id") or ""),
                "payer_id": str(row.get("payer_id") or ""),
                "member_id": str(row.get("member_id") or ""),
                "verified_at": row.get("verified_at"),
                "eligible": bool(row.get("eligible")),
                "plan_name": str(row.get("plan_name") or ""),
                "copay": row.get("copay"),
                "deductible": row.get("deductible"),
            }
        )
    return rows


def _nested_patient(row: dict[str, Any]) -> dict[str, Any]:
    patients = row.get("patients")
    if isinstance(patients, list):
        patients = patients[0] if patients else {}
    if isinstance(patients, dict):
        return patients
    return {}


@router.post("/superbill")
def generate_superbill(body: SuperbillBody):
    cid = body.clinic_id.strip()
    claim_id = body.claim_id.strip()
    if not cid or not claim_id:
        raise HTTPException(
            status_code=400, detail="clinic_id and claim_id are required"
        )

    try:
        claim_resp = (
            supabase.table("insurance_claims")
            .select(
                "*, patients(first_name, last_name, date_of_birth, "
                "address_line1, address_line2, city, state, zip, "
                "insurance_group_number)"
            )
            .eq("id", claim_id)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(claim_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("superbill fetch claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    claim_rows = claim_resp.data or []
    if not claim_rows:
        raise HTTPException(status_code=404, detail="Claim not found")

    claim = claim_rows[0]
    patient = _nested_patient(claim)
    if not patient:
        patient = _fetch_patient_for_claim(claim.get("patient_id")) or {}

    group_number = str(patient.get("insurance_group_number") or "").strip()
    group_display = (
        group_number
        if group_number
        and group_number.strip()
        not in ["", "·", "•", "—", "N/A", "null", "None"]
        else "—"
    )
    patient = {
        **patient,
        "insurance_group_number": None if group_display == "—" else group_number,
    }

    try:
        clinic_resp = (
            supabase.table("clinics")
            .select("name, address, phone")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(clinic_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("superbill fetch clinic failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    clinic_rows = clinic_resp.data or []
    clinic = clinic_rows[0] if clinic_rows else {}

    clinician: Optional[dict[str, Any]] = None
    clinician_id = str(claim.get("clinician_id") or "").strip()
    if clinician_id:
        try:
            clin_resp = (
                supabase.table("clinicians")
                .select("first_name, last_name, title")
                .eq("id", clinician_id)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(clin_resp)
            clin_rows = clin_resp.data or []
            clinician = clin_rows[0] if clin_rows else None
        except Exception:
            logger.exception("superbill fetch clinician failed id=%s", clinician_id)

    cpt_codes = normalize_cpt_codes(claim.get("cpt_codes"))
    if not cpt_codes:
        cpt_codes = ["99213"]

    claim = {**claim, "cpt_codes": cpt_codes}

    cpt_descriptions: dict[str, str] = {}
    try:
        cpt_resp = (
            supabase.table("cpt_codes")
            .select("code, description")
            .in_("code", cpt_codes)
            .execute()
        )
        _handle_supabase_error(cpt_resp)
        for row in cpt_resp.data or []:
            if isinstance(row, dict) and row.get("code"):
                cpt_descriptions[str(row["code"]).strip().upper()] = str(
                    row.get("description") or ""
                ).strip()
    except Exception:
        logger.exception("superbill fetch cpt codes failed claim_id=%s", claim_id)

    fee_by_code: dict[str, float] = {}
    try:
        fee_resp = (
            supabase.table("clinic_fee_schedules")
            .select("cpt_code, charge")
            .eq("clinic_id", cid)
            .in_("cpt_code", cpt_codes)
            .eq("is_active", True)
            .execute()
        )
        _handle_supabase_error(fee_resp)
        for row in fee_resp.data or []:
            if not isinstance(row, dict):
                continue
            code = str(row.get("cpt_code") or "").strip().upper()
            try:
                fee_by_code[code] = float(row.get("charge") or 0)
            except (TypeError, ValueError):
                continue
    except Exception:
        logger.exception("superbill fetch fee schedule failed clinic_id=%s", cid)

    try:
        pdf_bytes, filename = build_superbill_pdf(
            clinic=clinic,
            patient=patient,
            claim=claim,
            clinician=clinician,
            cpt_descriptions=cpt_descriptions,
            fee_by_code=fee_by_code,
            npi=BILLING_PROVIDER_NPI,
            tax_id=BILLING_PROVIDER_TAX_ID,
        )
    except Exception as exc:
        logger.exception("superbill pdf generation failed claim_id=%s", claim_id)
        raise HTTPException(
            status_code=500, detail=f"Superbill PDF generation failed: {exc}"
        ) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _patient_statement_totals(
    claims: list[dict[str, Any]],
) -> tuple[float, float, float]:
    """Returns (total_billed, insurance_paid, balance_due)."""
    total_billed = 0.0
    insurance_paid = 0.0
    for claim in claims:
        try:
            billed = float(claim.get("total_amount") or 0)
        except (TypeError, ValueError):
            billed = 0.0
        total_billed += billed
        if str(claim.get("status") or "").strip().lower() == "paid":
            insurance_paid += billed
    total_billed = round(total_billed, 2)
    insurance_paid = round(insurance_paid, 2)
    balance_due = round(max(0.0, total_billed - insurance_paid), 2)
    return total_billed, insurance_paid, balance_due


@router.post("/patient-statement")
def generate_patient_statement(body: PatientStatementBody):
    cid = body.clinic_id.strip()
    pid = body.patient_id.strip()
    delivery = (body.delivery or "download").strip().lower()
    if not cid or not pid:
        raise HTTPException(
            status_code=400, detail="clinic_id and patient_id are required"
        )
    if delivery not in ("download", "sms", "both"):
        raise HTTPException(status_code=400, detail="Invalid delivery option")

    try:
        claims_resp = (
            supabase.table("insurance_claims")
            .select(
                "id, first_treatment_date, payer_name, cpt_codes, "
                "total_amount, status"
            )
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .order("first_treatment_date")
            .execute()
        )
        _handle_supabase_error(claims_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "patient statement fetch claims failed clinic_id=%s patient_id=%s",
            cid,
            pid,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    claims = [r for r in (claims_resp.data or []) if isinstance(r, dict)]

    try:
        patient_resp = (
            supabase.table("patients")
            .select(
                "id, first_name, last_name, date_of_birth, phone, "
                "address_line1, address_line2, city, state, zip"
            )
            .eq("id", pid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(patient_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("patient statement fetch patient failed patient_id=%s", pid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patient_rows = patient_resp.data or []
    if not patient_rows:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient = patient_rows[0]

    try:
        clinic_resp = (
            supabase.table("clinics")
            .select("name, address, phone")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(clinic_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("patient statement fetch clinic failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    clinic_rows = clinic_resp.data or []
    clinic = clinic_rows[0] if clinic_rows else {}

    total_billed, insurance_paid, balance_due = _patient_statement_totals(claims)
    adjustments = 0.0

    try:
        pdf_bytes, filename = build_patient_statement_pdf(
            clinic=clinic,
            patient=patient,
            claims=claims,
            total_billed=total_billed,
            insurance_paid=insurance_paid,
            adjustments=adjustments,
            balance_due=balance_due,
        )
    except Exception as exc:
        logger.exception(
            "patient statement pdf generation failed patient_id=%s", pid
        )
        raise HTTPException(
            status_code=500, detail=f"Statement PDF generation failed: {exc}"
        ) from exc

    sms_sent = False
    if delivery in ("sms", "both"):
        phone = str(patient.get("phone") or "").strip()
        if not phone:
            raise HTTPException(
                status_code=400,
                detail="Patient has no phone number on file for SMS delivery",
            )
        clinic_name = str(clinic.get("name") or "your clinic").strip()
        clinic_phone = str(clinic.get("phone") or "").strip()
        first_name = str(patient.get("first_name") or "there").strip() or "there"
        call_clause = (
            f"Please call {clinic_phone} to make a payment. "
            if clinic_phone
            else "Please call us to make a payment. "
        )
        message = (
            f"Hi {first_name}, your statement from {clinic_name} is ready. "
            f"Total balance due: {_format_statement_amount(balance_due)}. "
            f"{call_clause}Reply STOP to opt out."
        )
        sid = send_sms(
            cid,
            phone,
            message,
            patient_id=pid,
            message_type="patient_statement",
        )
        sms_sent = sid is not None

    if delivery == "sms":
        return {
            "delivery": delivery,
            "sms_sent": sms_sent,
            "total_billed": total_billed,
            "insurance_paid": insurance_paid,
            "balance_due": balance_due,
        }

    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if delivery == "both":
        headers["X-SMS-Sent"] = "true" if sms_sent else "false"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=headers,
    )


def _safe_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()]


def _call_claude_resubmission_letter(
    *,
    patient_name: str,
    dob: str,
    insurance_company: str,
    claim_number: str,
    date_of_service: str,
    cpt_codes: list[str],
    denial_reasons: list[str],
    denial_codes: list[str],
    missing_information: list[str],
    soap_note_summary: str,
    letter_date: str,
    provider_name: str,
    clinic_phone: str,
) -> str:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed") from exc

    prompt = (
        "You are a medical billing specialist. Write a professional insurance claim "
        "resubmission cover letter for the following denial.\n\n"
        f"Patient: {patient_name}, DOB: {dob}\n"
        f"Insurance: {insurance_company}\n"
        f"Claim #: {claim_number}\n"
        f"Date of Service: {date_of_service}\n"
        f"CPT Codes: {', '.join(cpt_codes) if cpt_codes else '—'}\n"
        f"Denial Reasons: {', '.join(denial_reasons) if denial_reasons else '—'}\n"
        f"Denial Codes: {', '.join(denial_codes) if denial_codes else '—'}\n"
        f"Missing Information Requested: "
        f"{', '.join(missing_information) if missing_information else '—'}\n"
        f"Clinical Notes Summary: {soap_note_summary}\n\n"
        "Write ONLY 2-3 body paragraphs addressing each denial reason with supporting "
        "clinical justification. Be specific and reference the clinical documentation.\n\n"
        "Do NOT include letterhead, date line, recipient address block, salutation block, "
        "signature block, or any placeholder text in square brackets such as "
        "[Provider Letterhead], [Date], [Address], [Provider Name and Title], or "
        "[Contact Information]. Those elements are printed separately on clinic letterhead.\n\n"
        "Return only the body paragraphs."
    )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    blocks = getattr(message, "content", None) or []
    parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            parts.append(str(block["text"]))
    letter = "".join(parts).strip()
    if not letter:
        raise RuntimeError("Empty cover letter from AI")
    return letter


def _soap_note_summary(note: Optional[dict[str, Any]]) -> str:
    if not note:
        return "No clinical note available."
    parts: list[str] = []
    for label, key in (
        ("Subjective", "subjective"),
        ("Objective", "objective"),
        ("Assessment", "assessment"),
        ("Plan", "plan"),
    ):
        val = str(note.get(key) or "").strip()
        if val:
            parts.append(f"{label}: {val[:500]}")
    return " | ".join(parts) if parts else "Clinical note on file with limited content."


def _fetch_clinical_note_for_claim(
    *,
    clinic_id: str,
    patient_id: str,
    claim: dict[str, Any],
) -> Optional[dict[str, Any]]:
    note_fields = "subjective, objective, assessment, plan, signed_at, created_at"
    appointment_id = str(claim.get("appointment_id") or "").strip()
    if appointment_id:
        try:
            appt_note = (
                supabase.table("clinical_notes")
                .select(note_fields)
                .eq("clinic_id", clinic_id)
                .eq("patient_id", patient_id)
                .eq("appointment_id", appointment_id)
                .order("signed_at", desc=True)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(appt_note)
            rows = appt_note.data or []
            if rows:
                return rows[0]
        except Exception:
            logger.exception(
                "resubmission note lookup by appointment failed claim=%s",
                claim.get("id"),
            )

    try:
        notes_resp = (
            supabase.table("clinical_notes")
            .select(note_fields)
            .eq("clinic_id", clinic_id)
            .eq("patient_id", patient_id)
            .order("signed_at", desc=True)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
        _handle_supabase_error(notes_resp)
        rows = notes_resp.data or []
        return rows[0] if rows else None
    except Exception:
        logger.exception(
            "resubmission note lookup failed patient_id=%s", patient_id
        )
        return None


@router.post("/resubmission-package")
def generate_resubmission_package(body: ResubmissionPackageBody):
    cid = body.clinic_id.strip()
    pid = body.patient_id.strip()
    claim_id = body.claim_id.strip()
    eob_id = body.eob_extraction_id.strip()
    if not cid or not pid or not claim_id or not eob_id:
        raise HTTPException(
            status_code=400,
            detail="clinic_id, patient_id, claim_id, and eob_extraction_id are required",
        )

    try:
        eob_resp = (
            supabase.table("eob_extractions")
            .select("*")
            .eq("id", eob_id)
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(eob_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("resubmission fetch eob failed eob_id=%s", eob_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    eob_rows = eob_resp.data or []
    if not eob_rows:
        raise HTTPException(status_code=404, detail="EOB extraction not found")
    eob = eob_rows[0]

    try:
        claim_resp = (
            supabase.table("insurance_claims")
            .select(
                "*, patients(first_name, last_name, date_of_birth, "
                "address_line1, address_line2, city, state, zip, "
                "insurance_group_number)"
            )
            .eq("id", claim_id)
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(claim_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("resubmission fetch claim failed claim_id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    claim_rows = claim_resp.data or []
    if not claim_rows:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim = claim_rows[0]

    matched_claim_id = str(eob.get("claim_id") or "").strip()
    if matched_claim_id and matched_claim_id != claim_id:
        raise HTTPException(
            status_code=400,
            detail="EOB extraction is linked to a different claim",
        )

    patient = _nested_patient(claim)
    if not patient:
        patient = _fetch_patient_for_claim(pid) or {}

    try:
        clinic_resp = (
            supabase.table("clinics")
            .select("name, address, phone")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(clinic_resp)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("resubmission fetch clinic failed clinic_id=%s", cid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    clinic = (clinic_resp.data or [{}])[0]

    clinician: Optional[dict[str, Any]] = None
    clinician_id = str(claim.get("clinician_id") or "").strip()
    if clinician_id:
        try:
            clin_resp = (
                supabase.table("clinicians")
                .select("first_name, last_name, title")
                .eq("id", clinician_id)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(clin_resp)
            clin_rows = clin_resp.data or []
            clinician = clin_rows[0] if clin_rows else None
        except Exception:
            logger.exception("resubmission fetch clinician failed id=%s", clinician_id)

    clinical_note = _fetch_clinical_note_for_claim(
        clinic_id=cid, patient_id=pid, claim=claim
    )

    cpt_codes = normalize_cpt_codes(claim.get("cpt_codes"))
    if not cpt_codes:
        cpt_codes = ["99213"]
    claim = {**claim, "cpt_codes": cpt_codes}

    raw = eob.get("raw_extraction") if isinstance(eob.get("raw_extraction"), dict) else {}
    denial_reasons = _safe_str_list(eob.get("denial_reasons") or raw.get("denial_reasons"))
    denial_codes = _safe_str_list(eob.get("denial_codes") or raw.get("denial_codes"))
    missing_information = _safe_str_list(
        eob.get("missing_information") or raw.get("missing_information")
    )

    patient_name = (
        f"{patient.get('first_name') or ''} {patient.get('last_name') or ''}".strip()
        or "Patient"
    )
    dob = str(patient.get("date_of_birth") or "")[:10] or "—"
    insurance_company = str(
        eob.get("insurance_company") or claim.get("payer_name") or ""
    ).strip() or "Insurance Carrier"
    claim_number = resolve_claim_number(claim, eob=eob)
    dos = str(
        eob.get("date_of_service") or claim.get("first_treatment_date") or ""
    )[:10] or "—"
    soap_summary = _soap_note_summary(clinical_note)
    letter_date = format_letter_date()
    provider_name = " ".join(
        part
        for part in (
            str((clinician or {}).get("first_name") or "").strip(),
            str((clinician or {}).get("last_name") or "").strip(),
        )
        if part
    ).strip()
    title = str((clinician or {}).get("title") or "").strip()
    if provider_name and title:
        provider_display = f"{provider_name}, {title}"
    elif provider_name:
        provider_display = provider_name
    elif title:
        provider_display = title
    else:
        provider_display = str(clinic.get("name") or clinic.get("brand_name") or "Provider").strip()
    clinic_phone = str(clinic.get("phone") or "").strip()
    insurance_address = _insurance_address(eob)

    try:
        cover_letter = _call_claude_resubmission_letter(
            patient_name=patient_name,
            dob=dob,
            insurance_company=insurance_company,
            claim_number=claim_number,
            date_of_service=dos,
            cpt_codes=cpt_codes,
            denial_reasons=denial_reasons,
            denial_codes=denial_codes,
            missing_information=missing_information,
            soap_note_summary=soap_summary,
            letter_date=letter_date,
            provider_name=provider_display,
            clinic_phone=clinic_phone,
        )
        cover_letter = clean_cover_letter_body(
            cover_letter,
            letter_date=letter_date,
            provider_name=provider_display,
            clinic_phone=clinic_phone,
            insurance_address=insurance_address,
        )
    except Exception as exc:
        logger.exception("resubmission cover letter failed claim_id=%s", claim_id)
        raise HTTPException(
            status_code=500, detail=f"Cover letter generation failed: {exc}"
        ) from exc

    cpt_descriptions: dict[str, str] = {}
    try:
        cpt_resp = (
            supabase.table("cpt_codes")
            .select("code, description")
            .in_("code", cpt_codes)
            .execute()
        )
        _handle_supabase_error(cpt_resp)
        for row in cpt_resp.data or []:
            if isinstance(row, dict) and row.get("code"):
                cpt_descriptions[str(row["code"]).strip().upper()] = str(
                    row.get("description") or ""
                ).strip()
    except Exception:
        logger.exception("resubmission fetch cpt codes failed claim_id=%s", claim_id)

    fee_by_code: dict[str, float] = {}
    try:
        fee_resp = (
            supabase.table("clinic_fee_schedules")
            .select("cpt_code, charge")
            .eq("clinic_id", cid)
            .in_("cpt_code", cpt_codes)
            .eq("is_active", True)
            .execute()
        )
        _handle_supabase_error(fee_resp)
        for row in fee_resp.data or []:
            if not isinstance(row, dict):
                continue
            code = str(row.get("cpt_code") or "").strip().upper()
            try:
                fee_by_code[code] = float(row.get("charge") or 0)
            except (TypeError, ValueError):
                continue
    except Exception:
        logger.exception("resubmission fetch fee schedule failed clinic_id=%s", cid)

    try:
        pdf_bytes, filename = build_resubmission_pdf(
            clinic=clinic,
            patient=patient,
            claim={**claim, "claim_number": claim_number},
            clinician=clinician,
            eob=eob,
            cover_letter=cover_letter,
            clinical_note=clinical_note,
            cpt_descriptions=cpt_descriptions,
            fee_by_code=fee_by_code,
            npi=BILLING_PROVIDER_NPI,
            tax_id=BILLING_PROVIDER_TAX_ID,
        )
    except Exception as exc:
        logger.exception("resubmission pdf failed claim_id=%s", claim_id)
        raise HTTPException(
            status_code=500, detail=f"Resubmission PDF generation failed: {exc}"
        ) from exc

    now = _now_iso()
    task_id = str(eob.get("task_id") or "").strip()
    try:
        supabase.table("eob_extractions").update(
            {"resubmission_prepared": True}
        ).eq("id", eob_id).execute()
        if task_id:
            supabase.table("clinic_tasks").update(
                {"resubmission_generated_at": now, "updated_at": now}
            ).eq("id", task_id).eq("clinic_id", cid).execute()
        else:
            supabase.table("clinic_tasks").update(
                {"resubmission_generated_at": now, "updated_at": now}
            ).eq("claim_id", claim_id).eq("clinic_id", cid).eq(
                "task_type", "eob_resubmission"
            ).in_("status", ["open", "in_progress"]).execute()
    except Exception:
        logger.exception(
            "resubmission status update failed eob_id=%s claim_id=%s",
            eob_id,
            claim_id,
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _format_statement_amount(amount: float) -> str:
    try:
        return f"${float(amount):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"
