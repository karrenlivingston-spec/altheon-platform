"""Resubmission package PDF — cover letter, claim summary, EOB summary, SOAP support."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.routers.superbill_pdf import (
    SuperbillPdfBuilder,
    _clinician_display,
    _fmt_date,
    _fmt_money,
    _patient_address,
    display_field,
    normalize_cpt_codes,
    sanitize_group_number,
)


def _soap_summary(note: Optional[dict[str, Any]]) -> str:
    if not note:
        return "No clinical note on file for this date of service."
    parts: list[str] = []
    for label, key in (
        ("Subjective", "subjective"),
        ("Objective", "objective"),
        ("Assessment", "assessment"),
        ("Plan", "plan"),
    ):
        val = str(note.get(key) or "").strip()
        if val:
            parts.append(f"{label}: {val}")
    return "\n\n".join(parts) if parts else "Clinical note exists but SOAP sections are empty."


def _bullet_lines(items: list[str]) -> str:
    cleaned = [str(x).strip() for x in items if str(x).strip()]
    if not cleaned:
        return "—"
    return "\n".join(f"• {item}" for item in cleaned)


def _append_superbill_sections(
    builder: SuperbillPdfBuilder,
    *,
    patient: dict[str, Any],
    claim: dict[str, Any],
    clinician: Optional[dict[str, Any]],
    cpt_descriptions: dict[str, str],
    fee_by_code: dict[str, float],
    group_display: str,
) -> None:
    patient_name = display_field(
        f"{patient.get('first_name') or ''} {patient.get('last_name') or ''}".strip()
    )
    cpt_codes = normalize_cpt_codes(claim.get("cpt_codes"))
    if not cpt_codes:
        cpt_codes = ["99213"]

    try:
        total_amount = float(claim.get("total_amount") or 0)
    except (TypeError, ValueError):
        total_amount = 0.0

    per_line_fallback = (
        round(total_amount / len(cpt_codes), 2) if cpt_codes and total_amount > 0 else 0.0
    )
    charge_rows: list[list[str]] = []
    line_subtotal = 0.0
    for code in cpt_codes:
        desc = (
            cpt_descriptions.get(code)
            or cpt_descriptions.get(code.replace(".", ""))
            or "—"
        )
        charge = fee_by_code.get(code)
        if charge is None:
            charge = fee_by_code.get(code.replace(".", ""))
        if charge is None:
            charge = per_line_fallback
        line_subtotal += charge
        charge_rows.append([code, desc, "1", _fmt_money(charge)])

    line_subtotal = round(line_subtotal, 2)
    billed_total = round(total_amount, 2) if total_amount > 0 else line_subtotal
    if line_subtotal != billed_total and charge_rows:
        charge_rows.append(["", "", "Subtotal:", _fmt_money(line_subtotal)])
        charge_rows.append(["", "", "Total Billed:", _fmt_money(billed_total)])
    else:
        charge_rows.append(["", "", "TOTAL:", _fmt_money(billed_total)])

    diagnosis_codes = [
        str(c).strip().upper()
        for c in (claim.get("diagnosis_codes") or [])
        if str(c).strip()
    ]
    icd10 = ", ".join(diagnosis_codes) if diagnosis_codes else "—"

    builder.section_header("Patient Info")
    builder.field_grid(
        [
            ("PATIENT", patient_name),
            ("DOB", _fmt_date(patient.get("date_of_birth"))),
            ("ADDRESS", _patient_address(patient)),
            ("INSURANCE", display_field(claim.get("payer_name"))),
            ("MEMBER ID", display_field(claim.get("member_id"))),
            ("POLICY #", display_field(claim.get("policy_number"))),
            ("GROUP #", group_display),
        ],
        cols=2,
    )
    builder.section_header("Provider")
    builder.field_grid([("TREATING PROVIDER", _clinician_display(clinician))], cols=1)
    builder.section_header("Diagnosis")
    builder.field_grid([("ICD-10 CODES", icd10)], cols=1)
    builder.section_header("Charges")
    builder.table(
        ["CPT Code", "Description", "Units", "Charge"],
        charge_rows,
        [0.14, 0.46, 0.12, 0.28],
    )


def build_resubmission_pdf(
    *,
    clinic: dict[str, Any],
    patient: dict[str, Any],
    claim: dict[str, Any],
    clinician: Optional[dict[str, Any]],
    eob: dict[str, Any],
    cover_letter: str,
    clinical_note: Optional[dict[str, Any]],
    cpt_descriptions: dict[str, str],
    fee_by_code: dict[str, float],
    npi: str,
    tax_id: str,
) -> tuple[bytes, str]:
    clinic_name = display_field(clinic.get("name") or clinic.get("brand_name"))
    clinic_address = display_field(clinic.get("address"))
    clinic_phone_raw = str(clinic.get("phone") or "").strip()
    clinic_phone = display_field(clinic_phone_raw)
    clinic_ids = f"NPI: {npi}  |  Tax ID: {tax_id}"

    today = datetime.now(timezone.utc).strftime("%m/%d/%Y")
    dos = _fmt_date(
        eob.get("date_of_service") or claim.get("first_treatment_date")
    )
    patient_name = (
        f"{patient.get('first_name') or ''} {patient.get('last_name') or ''}".strip()
        or "Patient"
    )
    insurance_company = display_field(
        eob.get("insurance_company") or claim.get("payer_name")
    )
    claim_number = display_field(claim.get("claim_number"))

    group_number = str(patient.get("insurance_group_number") or "").strip()
    group_display = sanitize_group_number(group_number) or "-"

    header = {
        "clinic_name": clinic_name,
        "clinic_address": clinic_address,
        "clinic_phone": clinic_phone,
        "clinic_ids": clinic_ids,
        "today": today,
        "dos": dos,
        "document_title": "RESUBMISSION PACKAGE",
    }

    builder = SuperbillPdfBuilder(header)
    builder.section_header("Cover Letter")
    builder.field_grid(
        [
            ("TO", insurance_company),
            (
                "RE",
                f"Claim Resubmission — {patient_name} — DOS: {dos}",
            ),
            ("CLAIM #", claim_number),
        ],
        cols=1,
    )
    builder.body_text(cover_letter)

    builder.new_page("RESUBMISSION — ORIGINAL CLAIM")
    _append_superbill_sections(
        builder,
        patient=patient,
        claim=claim,
        clinician=clinician,
        cpt_descriptions=cpt_descriptions,
        fee_by_code=fee_by_code,
        group_display=group_display,
    )

    raw = eob.get("raw_extraction") if isinstance(eob.get("raw_extraction"), dict) else {}
    denial_reasons = eob.get("denial_reasons") or raw.get("denial_reasons") or []
    denial_codes = eob.get("denial_codes") or raw.get("denial_codes") or []
    missing_information = (
        eob.get("missing_information") or raw.get("missing_information") or []
    )
    if not isinstance(denial_reasons, list):
        denial_reasons = []
    if not isinstance(denial_codes, list):
        denial_codes = []
    if not isinstance(missing_information, list):
        missing_information = []

    builder.new_page("EOB SUMMARY")
    builder.section_header("Financial Summary")
    builder.field_grid(
        [
            ("TOTAL BILLED", _fmt_money(eob.get("total_billed"))),
            ("TOTAL ALLOWED", _fmt_money(eob.get("total_allowed"))),
            ("TOTAL PAID", _fmt_money(eob.get("total_paid"))),
            (
                "PATIENT RESPONSIBILITY",
                _fmt_money(eob.get("total_patient_responsibility")),
            ),
        ],
        cols=2,
    )
    builder.section_header("Denial Information")
    builder.field_grid(
        [
            ("DENIAL REASONS", _bullet_lines([str(x) for x in denial_reasons])),
            ("DENIAL CODES", _bullet_lines([str(x) for x in denial_codes])),
            (
                "MISSING INFORMATION",
                _bullet_lines([str(x) for x in missing_information]),
            ),
        ],
        cols=1,
    )

    builder.new_page("SUPPORTING DOCUMENTATION")
    builder.section_header("Clinical Notes Summary")
    builder.body_text(_soap_summary(clinical_note), fontsize=9.5)

    builder.footer_block(clinic_name, clinic_phone_raw, clinic_address)
    pdf_bytes = builder.finish()

    safe_patient = "".join(
        c for c in patient_name if c.isalnum() or c in (" ", "-", "_")
    ).strip().replace(" ", "_") or "patient"
    dos_safe = dos.replace("/", "-") if dos != "—" else today.replace("/", "-")
    filename = f"resubmission_{safe_patient}_{dos_safe}.pdf"
    return pdf_bytes, filename
