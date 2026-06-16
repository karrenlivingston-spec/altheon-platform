"""Superbill PDF generation — same PyMuPDF styling as clinical note PDF export."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any, Optional

import fitz  # PyMuPDF

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 42.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 48.0
TEAL = (13 / 255, 148 / 255, 136 / 255)
DARK = (0.13, 0.16, 0.18)
GRAY = (0.45, 0.5, 0.53)
LIGHT_ROW = (0.96, 0.97, 0.97)
LINE = (0.8, 0.84, 0.85)

FONT = "helv"
FONT_B = "hebo"

_PLACEHOLDER_VALUES = frozenset(
    {"·", "•", "-", "—", "–", "n/a", "na", "none", "null"}
)


def sanitize_group_number(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in _PLACEHOLDER_VALUES:
        return None
    return s


def display_field(value: Any) -> str:
    if value is None:
        return "—"
    s = str(value).strip()
    if not s or s.lower() in _PLACEHOLDER_VALUES:
        return "—"
    return s


def normalize_cpt_codes(value: Any) -> list[str]:
    if value is None:
        return []
    items: list[Any]
    if isinstance(value, list):
        items = value
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                items = parsed if isinstance(parsed, list) else [s]
            except json.JSONDecodeError:
                items = [part.strip() for part in s.split(",") if part.strip()]
        elif "," in s:
            items = [part.strip() for part in s.split(",") if part.strip()]
        else:
            items = [s]
    else:
        return []

    out: list[str] = []
    for item in items:
        code = str(item).strip().upper().replace(".", "")
        if code and code not in out:
            out.append(code)
    return out


def _fmt_date(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return "—"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%m/%d/%Y")
    except ValueError:
        if len(s) >= 10:
            try:
                return date.fromisoformat(s[:10]).strftime("%m/%d/%Y")
            except ValueError:
                pass
        return s[:10]


def _fmt_money(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return "$0.00"
    return f"${amount:,.2f}"


def _patient_address(patient: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("address_line1", "address_line2"):
        val = str(patient.get(key) or "").strip()
        if val:
            parts.append(val)
    city = str(patient.get("city") or "").strip()
    state = str(patient.get("state") or "").strip()
    zip_code = str(patient.get("zip") or "").strip()
    city_line = ", ".join(x for x in [city, state] if x)
    if city_line and zip_code:
        city_line = f"{city_line} {zip_code}"
    elif zip_code:
        city_line = zip_code
    if city_line:
        parts.append(city_line)
    return ", ".join(parts) or "—"


def _clinician_display(clinician: Optional[dict[str, Any]]) -> str:
    if not clinician:
        return "—"
    name = (
        f"{str(clinician.get('first_name') or '').strip()} "
        f"{str(clinician.get('last_name') or '').strip()}"
    ).strip()
    title = str(clinician.get("title") or "").strip()
    if name and title:
        return f"{name}, {title}"
    return name or title or "—"


class SuperbillPdfBuilder:
    """Single-page superbill using the same letterhead/table styling as note PDFs."""

    def __init__(self, header: dict[str, str]):
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.header = header
        self.y = self._draw_header()

    @staticmethod
    def _wrap(
        text: str, width: float, fontsize: float, fontname: str = FONT
    ) -> list[str]:
        out: list[str] = []
        for raw_line in (text or "").split("\n"):
            words = raw_line.split(" ")
            cur = ""
            for word in words:
                cand = f"{cur} {word}".strip()
                if fitz.get_text_length(cand, fontname=fontname, fontsize=fontsize) <= width:
                    cur = cand
                else:
                    if cur:
                        out.append(cur)
                    cur = word
            out.append(cur)
        return out or [""]

    def _draw_header(self) -> float:
        h = self.header
        p = self.page
        top = MARGIN - 10
        left_y = top + 10

        p.insert_text(
            (MARGIN, left_y),
            h["clinic_name"],
            fontsize=11,
            fontname=FONT_B,
            color=TEAL,
        )
        left_y += 12
        for line in (h["clinic_address"], h["clinic_phone"], h["clinic_ids"]):
            if line:
                p.insert_text(
                    (MARGIN, left_y), line, fontsize=8, fontname=FONT, color=GRAY
                )
                left_y += 10

        title = "SUPERBILL"
        tw = fitz.get_text_length(title, fontname=FONT_B, fontsize=14)
        p.insert_text(
            (PAGE_W - MARGIN - tw, top + 8),
            title,
            fontsize=14,
            fontname=FONT_B,
            color=DARK,
        )

        right_lines = [
            f"Date: {h['today']}",
            f"DOS: {h['dos']}",
        ]
        ry = top + 26
        for line in right_lines:
            w = fitz.get_text_length(line, fontname=FONT, fontsize=8.5)
            p.insert_text(
                (PAGE_W - MARGIN - w, ry),
                line,
                fontsize=8.5,
                fontname=FONT,
                color=DARK,
            )
            ry += 11

        bottom = max(left_y, ry, top + 44) + 4
        p.draw_line(
            fitz.Point(MARGIN, bottom),
            fitz.Point(PAGE_W - MARGIN, bottom),
            color=TEAL,
            width=1.2,
        )
        return bottom + 14

    def section_header(self, title: str) -> None:
        h = 18.0
        rect = fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + h)
        self.page.draw_rect(rect, color=None, fill=TEAL)
        self.page.insert_text(
            (MARGIN + 7, self.y + 13),
            title.upper(),
            fontsize=9.5,
            fontname=FONT_B,
            color=(1, 1, 1),
        )
        self.y += h + 8

    def field_grid(self, pairs: list[tuple[str, str]], cols: int = 2) -> None:
        col_w = CONTENT_W / cols
        fontsize = 8.5
        row_h = 22.0
        for i in range(0, len(pairs), cols):
            row = pairs[i : i + cols]
            max_lines = 1
            rendered: list[tuple[str, list[str]]] = []
            for label, value in row:
                val_lines = self._wrap(value or "—", col_w - 12, fontsize)
                rendered.append((label, val_lines))
                max_lines = max(max_lines, len(val_lines))
            block_h = row_h + max(0, max_lines - 1) * 11
            x_positions = [MARGIN + j * col_w for j in range(len(row))]
            for j, (label, val_lines) in enumerate(rendered):
                x = x_positions[j]
                self.page.insert_text(
                    (x, self.y + 8),
                    label,
                    fontsize=7,
                    fontname=FONT_B,
                    color=GRAY,
                )
                for li, line in enumerate(val_lines):
                    self.page.insert_text(
                        (x, self.y + 18 + li * 11),
                        line,
                        fontsize=fontsize,
                        fontname=FONT,
                        color=DARK,
                    )
            self.y += block_h
        self.y += 4

    def table(
        self,
        headers: list[str],
        rows: list[list[str]],
        col_fracs: Optional[list[float]] = None,
    ) -> None:
        if not rows:
            return
        n = len(headers)
        fracs = col_fracs or [1.0 / n] * n
        widths = [CONTENT_W * f for f in fracs]
        fontsize = 8.0
        pad = 4.0

        def row_height(cells: list[str], fname: str) -> float:
            max_lines = 1
            for idx, cell in enumerate(cells):
                lines = self._wrap(str(cell), widths[idx] - 2 * pad, fontsize, fname)
                max_lines = max(max_lines, len(lines))
            return max_lines * fontsize * 1.3 + 2 * pad

        def draw_row(
            cells: list[str], fname: str, fill: Optional[tuple]
        ) -> None:
            h = row_height(cells, fname)
            if fill:
                self.page.draw_rect(
                    fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + h),
                    color=None,
                    fill=fill,
                )
            x = MARGIN
            for idx, cell in enumerate(cells):
                lines = self._wrap(str(cell), widths[idx] - 2 * pad, fontsize, fname)
                ty = self.y + pad + fontsize
                for line in lines:
                    self.page.insert_text(
                        (x + pad, ty),
                        line,
                        fontsize=fontsize,
                        fontname=fname,
                        color=DARK,
                    )
                    ty += fontsize * 1.3
                x += widths[idx]
            self.page.draw_line(
                fitz.Point(MARGIN, self.y + h),
                fitz.Point(PAGE_W - MARGIN, self.y + h),
                color=LINE,
                width=0.5,
            )
            self.y += h

        draw_row(headers, FONT_B, (0.91, 0.96, 0.95))
        for i, r in enumerate(rows):
            label = str(r[2]).strip().upper() if len(r) >= 3 else ""
            is_summary = label in ("TOTAL:", "SUBTOTAL:", "TOTAL BILLED:")
            draw_row(
                r,
                FONT_B if is_summary else FONT,
                LIGHT_ROW if i % 2 and not is_summary else None,
            )
        self.y += 8

    def footer_block(self, clinic_name: str, phone: str, address: str) -> None:
        self.y += 10
        self.page.draw_line(
            fitz.Point(MARGIN, self.y),
            fitz.Point(PAGE_W - MARGIN, self.y),
            color=LINE,
            width=0.7,
        )
        self.y += 18
        self.page.insert_text(
            (MARGIN, self.y),
            "Signature: _______________________    Date: _____________",
            fontsize=9,
            fontname=FONT,
            color=DARK,
        )
        self.y += 18
        disclaimer = (
            "This superbill is provided for insurance reimbursement purposes."
        )
        self.page.insert_text(
            (MARGIN, self.y),
            disclaimer,
            fontsize=8,
            fontname=FONT,
            color=GRAY,
        )
        self.y += 12
        footer = " | ".join(x for x in [clinic_name, phone, address] if x)
        self.page.insert_text(
            (MARGIN, self.y),
            footer,
            fontsize=7.5,
            fontname=FONT,
            color=GRAY,
        )

    def finish(self) -> bytes:
        return self.doc.tobytes()


def build_superbill_pdf(
    *,
    clinic: dict[str, Any],
    patient: dict[str, Any],
    claim: dict[str, Any],
    clinician: Optional[dict[str, Any]],
    cpt_descriptions: dict[str, str],
    fee_by_code: dict[str, float],
    npi: str,
    tax_id: str,
) -> tuple[bytes, str]:
    today = datetime.now(timezone.utc).strftime("%m/%d/%Y")
    dos = _fmt_date(claim.get("first_treatment_date"))
    patient_name = (
        f"{str(patient.get('first_name') or '').strip()} "
        f"{str(patient.get('last_name') or '').strip()}"
    ).strip() or "Patient"

    clinic_name = str(clinic.get("name") or "Clinic").strip()
    clinic_address = str(clinic.get("address") or "").strip()
    clinic_phone_raw = str(clinic.get("phone") or "").strip()
    clinic_phone = f"Phone: {clinic_phone_raw}" if clinic_phone_raw else ""
    clinic_ids = f"NPI: {npi}   Tax ID: {tax_id}"

    group_number = display_field(sanitize_group_number(patient.get("insurance_group_number")))

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

    if line_subtotal != billed_total and len(charge_rows) > 0:
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

    builder = SuperbillPdfBuilder(
        {
            "clinic_name": clinic_name,
            "clinic_address": clinic_address,
            "clinic_phone": clinic_phone,
            "clinic_ids": clinic_ids,
            "today": today,
            "dos": dos,
        }
    )

    builder.section_header("Patient Info")
    builder.field_grid(
        [
            ("PATIENT", patient_name),
            ("DOB", _fmt_date(patient.get("date_of_birth"))),
            ("ADDRESS", _patient_address(patient)),
            ("INSURANCE", display_field(claim.get("payer_name"))),
            ("MEMBER ID", display_field(claim.get("member_id"))),
            ("POLICY #", display_field(claim.get("policy_number"))),
            ("GROUP #", group_number),
        ],
        cols=2,
    )

    builder.section_header("Provider")
    builder.field_grid(
        [("TREATING PROVIDER", _clinician_display(clinician))],
        cols=1,
    )

    builder.section_header("Diagnosis")
    builder.field_grid([("ICD-10 CODES", icd10)], cols=1)

    builder.section_header("Charges")
    builder.table(
        ["CPT Code", "Description", "Units", "Charge"],
        charge_rows,
        [0.14, 0.46, 0.12, 0.28],
    )

    builder.footer_block(clinic_name, clinic_phone_raw, clinic_address)

    pdf_bytes = builder.finish()

    safe_patient = "".join(
        c for c in patient_name if c.isalnum() or c in (" ", "-", "_")
    ).strip().replace(" ", "_") or "patient"
    dos_safe = dos.replace("/", "-") if dos != "—" else today.replace("/", "-")
    filename = f"superbill_{safe_patient}_{dos_safe}.pdf"
    return pdf_bytes, filename
