"""Itemized billing record PDF — PyMuPDF styling shared with superbill_pdf.py."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.routers.superbill_pdf import (
    SuperbillPdfBuilder,
    _fmt_date,
    _fmt_money,
    _patient_address,
    pdf_display_value,
)


def _fmt_cents(cents: Any) -> str:
    try:
        amount = int(cents or 0) / 100.0
    except (TypeError, ValueError):
        return "$0.00"
    return _fmt_money(amount)


def _attorney_display(pi_case: Optional[dict[str, Any]]) -> list[tuple[str, str]]:
    if not pi_case:
        return []
    firm = str(pi_case.get("firm_name") or "").strip()
    attorney = str(pi_case.get("attorney_name") or "").strip()
    phone = str(pi_case.get("attorney_phone") or "").strip()
    email = str(pi_case.get("attorney_email") or "").strip()
    if not any([firm, attorney, phone, email]):
        return []
    pairs: list[tuple[str, str]] = []
    if firm:
        pairs.append(("LAW FIRM", firm))
    if attorney:
        pairs.append(("ATTORNEY", attorney))
    if phone:
        pairs.append(("PHONE", phone))
    if email:
        pairs.append(("EMAIL", email))
    return pairs


def _status_label(status: Any) -> str:
    s = str(status or "draft").strip().lower()
    return s.capitalize() if s else "Draft"


def build_billing_record_pdf(
    *,
    clinic: dict[str, Any],
    patient: dict[str, Any],
    record: dict[str, Any],
    line_items: list[dict[str, Any]],
    pi_case: Optional[dict[str, Any]] = None,
) -> tuple[bytes, str]:
    today = datetime.now(timezone.utc).strftime("%m/%d/%Y")
    dos = _fmt_date(record.get("date_of_service"))

    patient_name = (
        f"{str(patient.get('first_name') or '').strip()} "
        f"{str(patient.get('last_name') or '').strip()}"
    ).strip() or "Patient"

    clinic_name = str(clinic.get("name") or "Clinic").strip()
    clinic_address = str(clinic.get("address") or "").strip()
    clinic_phone_raw = str(clinic.get("phone") or "").strip()
    clinic_phone = f"Phone: {clinic_phone_raw}" if clinic_phone_raw else ""

    builder = SuperbillPdfBuilder(
        {
            "clinic_name": clinic_name,
            "clinic_address": clinic_address,
            "clinic_phone": clinic_phone,
            "clinic_ids": "",
            "today": today,
            "dos": dos,
            "document_title": "ITEMIZED BILL",
        }
    )

    builder.section_header("Patient Info")
    builder.field_grid(
        [
            ("PATIENT", patient_name),
            ("DOB", _fmt_date(patient.get("date_of_birth"))),
            ("ADDRESS", _patient_address(patient)),
        ],
        cols=2,
    )

    attorney_pairs = _attorney_display(pi_case)
    if attorney_pairs:
        builder.section_header("Attorney")
        builder.field_grid(attorney_pairs, cols=2)

    service_pairs: list[tuple[str, str]] = [
        ("DATE OF SERVICE", dos),
        ("STATUS", _status_label(record.get("status"))),
    ]
    claim_number = str(record.get("claim_number") or "").strip()
    if claim_number:
        service_pairs.append(("CLAIM #", claim_number))
    carrier = str(record.get("insurance_carrier") or "").strip()
    if carrier:
        service_pairs.append(("INSURANCE CARRIER", carrier))

    builder.section_header("Service")
    builder.field_grid(service_pairs, cols=2)

    charge_rows: list[list[str]] = []
    line_subtotal_cents = 0
    for item in line_items:
        if not isinstance(item, dict):
            continue
        code = pdf_display_value(item.get("cpt_code"))
        desc = pdf_display_value(item.get("description"))
        if desc == "-" and code != "-":
            desc = "-"
        units = str(item.get("units") if item.get("units") is not None else 1)
        rate_cents = int(item.get("rate_cents") or 0)
        total_cents = int(item.get("total_cents") or 0)
        line_subtotal_cents += total_cents
        charge_rows.append(
            [
                code,
                desc,
                units,
                _fmt_cents(rate_cents),
                _fmt_cents(total_cents),
            ]
        )

    record_total_cents = int(record.get("total_billed_cents") or 0)
    grand_total_cents = (
        record_total_cents if record_total_cents > 0 else line_subtotal_cents
    )

    if not charge_rows:
        charge_rows.append(["—", "No line items", "—", "—", "—"])
    charge_rows.append(["", "", "TOTAL:", "", _fmt_cents(grand_total_cents)])

    builder.section_header("Charges")
    builder.table(
        ["CPT", "Description", "Units", "Rate", "Line Total"],
        charge_rows,
        [0.12, 0.34, 0.1, 0.18, 0.26],
    )

    builder.footer_block(
        clinic_name,
        clinic_phone_raw,
        clinic_address,
        disclaimer=(
            "This itemized bill lists services rendered on the date of service above. "
            "It is provided for billing and legal documentation purposes only."
        ),
    )

    pdf_bytes = builder.finish()

    safe_patient = (
        "".join(c for c in patient_name if c.isalnum() or c in (" ", "-", "_"))
        .strip()
        .replace(" ", "_")
        or "patient"
    )
    dos_safe = dos.replace("/", "-") if dos != "—" else today.replace("/", "-")
    filename = f"billing_record_{safe_patient}_{dos_safe}.pdf"
    return pdf_bytes, filename
