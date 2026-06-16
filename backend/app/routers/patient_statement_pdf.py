"""Patient statement PDF generation — same PyMuPDF styling as superbill_pdf.py."""

from __future__ import annotations

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


def _normalize_cpt_codes(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        items: list[Any] = value
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        if "," in s:
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


class StatementPdfBuilder:
    """Single-page patient statement using the same styling as superbill PDFs."""

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
        for line in (h["clinic_address"], h["clinic_phone"]):
            if line:
                p.insert_text(
                    (MARGIN, left_y), line, fontsize=8, fontname=FONT, color=GRAY
                )
                left_y += 10

        title = "PATIENT STATEMENT"
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
            f"Account #: {h['account_no']}",
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

    def summary_rows(
        self, rows: list[tuple[str, str]], *, highlight_last: bool = True
    ) -> None:
        """Right-aligned label/amount pairs for the account summary."""
        fontsize = 9.0
        row_h = 18.0
        label_x = MARGIN + 4
        amount_x = PAGE_W - MARGIN - 4
        for idx, (label, amount) in enumerate(rows):
            is_last = highlight_last and idx == len(rows) - 1
            fname = FONT_B if is_last else FONT
            if is_last:
                self.page.draw_rect(
                    fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + row_h),
                    color=None,
                    fill=(0.91, 0.96, 0.95),
                )
            self.page.insert_text(
                (label_x, self.y + 13),
                label,
                fontsize=fontsize,
                fontname=fname,
                color=DARK,
            )
            w = fitz.get_text_length(amount, fontname=fname, fontsize=fontsize)
            self.page.insert_text(
                (amount_x - w, self.y + 13),
                amount,
                fontsize=fontsize,
                fontname=fname,
                color=DARK,
            )
            self.y += row_h
        self.y += 8

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

        def draw_row(cells: list[str], fname: str, fill: Optional[tuple]) -> None:
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
            label = str(r[0]).strip().upper() if r else ""
            is_total = label == "TOTAL"
            draw_row(
                r,
                FONT_B if is_total else FONT,
                LIGHT_ROW if i % 2 and not is_total else None,
            )
        self.y += 8

    def footer_block(self, clinic_name: str, phone: str, today: str) -> None:
        self.y += 10
        self.page.draw_line(
            fitz.Point(MARGIN, self.y),
            fitz.Point(PAGE_W - MARGIN, self.y),
            color=LINE,
            width=0.7,
        )
        self.y += 16
        lines = [
            f"Please remit payment to: {clinic_name}",
            f"Questions? Call {phone}" if phone else "Questions? Call the clinic.",
            f"This statement reflects services rendered as of {today}.",
        ]
        for i, line in enumerate(lines):
            self.page.insert_text(
                (MARGIN, self.y),
                line,
                fontsize=8.5 if i == 0 else 8,
                fontname=FONT_B if i == 0 else FONT,
                color=DARK if i == 0 else GRAY,
            )
            self.y += 13

    def finish(self) -> bytes:
        return self.doc.tobytes()


def build_patient_statement_pdf(
    *,
    clinic: dict[str, Any],
    patient: dict[str, Any],
    claims: list[dict[str, Any]],
    total_billed: float,
    insurance_paid: float,
    adjustments: float,
    balance_due: float,
) -> tuple[bytes, str]:
    today = datetime.now(timezone.utc).strftime("%m/%d/%Y")
    patient_id = str(patient.get("id") or "")
    account_no = patient_id[:8].upper() if patient_id else "—"

    patient_name = (
        f"{str(patient.get('first_name') or '').strip()} "
        f"{str(patient.get('last_name') or '').strip()}"
    ).strip() or "Patient"

    clinic_name = str(clinic.get("name") or "Clinic").strip()
    clinic_address = str(clinic.get("address") or "").strip()
    clinic_phone_raw = str(clinic.get("phone") or "").strip()
    clinic_phone = f"Phone: {clinic_phone_raw}" if clinic_phone_raw else ""

    builder = StatementPdfBuilder(
        {
            "clinic_name": clinic_name,
            "clinic_address": clinic_address,
            "clinic_phone": clinic_phone,
            "today": today,
            "account_no": account_no,
        }
    )

    builder.section_header("Patient Info")
    builder.field_grid(
        [
            ("PATIENT", patient_name),
            ("DOB", _fmt_date(patient.get("date_of_birth"))),
            ("ADDRESS", _patient_address(patient)),
            ("PHONE", str(patient.get("phone") or "—")),
        ],
        cols=2,
    )

    builder.section_header("Account Summary")
    builder.summary_rows(
        [
            ("Total Billed:", _fmt_money(total_billed)),
            ("Insurance Paid:", _fmt_money(insurance_paid)),
            ("Adjustments:", _fmt_money(adjustments)),
            ("Balance Due:", _fmt_money(balance_due)),
        ]
    )

    builder.section_header("Charges")
    charge_rows: list[list[str]] = []
    for claim in claims:
        dos = _fmt_date(claim.get("first_treatment_date"))
        codes = ", ".join(_normalize_cpt_codes(claim.get("cpt_codes"))) or "—"
        description = str(claim.get("payer_name") or "—").strip() or "—"
        try:
            billed = float(claim.get("total_amount") or 0)
        except (TypeError, ValueError):
            billed = 0.0
        is_paid = str(claim.get("status") or "").strip().lower() == "paid"
        paid = billed if is_paid else 0.0
        balance = round(billed - paid, 2)
        charge_rows.append(
            [
                dos,
                codes,
                description,
                _fmt_money(billed),
                _fmt_money(paid),
                _fmt_money(balance),
            ]
        )

    charge_rows.append(
        [
            "TOTAL",
            "",
            "",
            _fmt_money(total_billed),
            _fmt_money(insurance_paid),
            _fmt_money(balance_due),
        ]
    )

    builder.table(
        ["Date of Service", "CPT Codes", "Description", "Billed", "Paid", "Balance"],
        charge_rows,
        [0.18, 0.18, 0.26, 0.13, 0.12, 0.13],
    )

    builder.footer_block(clinic_name, clinic_phone_raw, today)

    pdf_bytes = builder.finish()

    safe_patient = "".join(
        c for c in patient_name if c.isalnum() or c in (" ", "-", "_")
    ).strip().replace(" ", "_") or "patient"
    today_safe = today.replace("/", "-")
    filename = f"statement_{safe_patient}_{today_safe}.pdf"
    return pdf_bytes, filename
