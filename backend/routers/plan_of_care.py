"""Plan of Care (POC) PDF generation for signed evaluation notes."""

from __future__ import annotations

import base64
import traceback
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 54.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 36.0
TEAL = (13 / 255, 148 / 255, 136 / 255)
DARK = (0.13, 0.16, 0.18)
GRAY = (0.45, 0.5, 0.53)
LINE = (0.8, 0.84, 0.85)
FONT = "helv"
FONT_B = "hebo"


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _one(table: str, **eq_filters: Any) -> Optional[dict[str, Any]]:
    q = supabase.table(table).select("*")
    for k, v in eq_filters.items():
        q = q.eq(k, v)
    resp = q.limit(1).execute()
    _handle_supabase_error(resp)
    rows = resp.data or []
    return rows[0] if rows else None


def _parse_dt(value: Any) -> Optional[datetime]:
    s = str(value or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt_date(value: Any) -> str:
    dt = _parse_dt(value)
    if dt:
        return dt.strftime("%m/%d/%Y")
    s = str(value or "").strip()
    return s[:10] if s else "—"


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%m/%d/%Y")


def _add_weeks_date(value: Any, weeks: int) -> str:
    dt = _parse_dt(value)
    if not dt:
        return "—"
    end = dt + timedelta(weeks=max(weeks, 0))
    return end.strftime("%m/%d/%Y")


class PlanOfCareRequest(BaseModel):
    note_id: str
    patient_id: str
    clinic_id: str
    frequency: str = ""
    duration_weeks: int = Field(default=4, ge=1, le=52)
    short_term_goals: str = ""
    long_term_goals: str = ""
    procedures: list[str] = Field(default_factory=list)
    diagnosis_code: str = ""
    diagnosis_description: str = ""
    clinician_signature: str = ""


class PocPdfBuilder:
    """Simple faxable Plan of Care layout."""

    def __init__(self) -> None:
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = MARGIN

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

    def _ensure(self, needed: float) -> None:
        if self.y + needed > PAGE_H - FOOTER_H:
            self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
            self.y = MARGIN

    def title(self, text: str) -> None:
        self._ensure(36)
        tw = fitz.get_text_length(text, fontname=FONT_B, fontsize=16)
        self.page.insert_text(
            ((PAGE_W - tw) / 2, self.y + 16),
            text,
            fontsize=16,
            fontname=FONT_B,
            color=TEAL,
        )
        self.y += 30
        self.page.draw_line(
            fitz.Point(MARGIN, self.y),
            fitz.Point(PAGE_W - MARGIN, self.y),
            color=TEAL,
            width=1.2,
        )
        self.y += 16

    def two_col_row(self, left: str, right: str, fontsize: float = 9.5) -> None:
        self._ensure(16)
        self.page.insert_text((MARGIN, self.y + 10), left, fontsize=fontsize, fontname=FONT, color=DARK)
        rw = fitz.get_text_length(right, fontname=FONT, fontsize=fontsize)
        self.page.insert_text(
            (PAGE_W - MARGIN - rw, self.y + 10),
            right,
            fontsize=fontsize,
            fontname=FONT,
            color=DARK,
        )
        self.y += 16

    def section_header(self, title: str) -> None:
        h = 18.0
        self._ensure(h + 20)
        rect = fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + h)
        self.page.draw_rect(rect, color=None, fill=TEAL)
        self.page.insert_text(
            (MARGIN + 7, self.y + 13),
            title.upper(),
            fontsize=9.5,
            fontname=FONT_B,
            color=(1, 1, 1),
        )
        self.y += h + 10

    def field_line(self, label: str, value: str) -> None:
        fontsize = 9.5
        self._ensure(14)
        self.page.insert_text(
            (MARGIN, self.y + 10),
            f"{label}: {value or '—'}",
            fontsize=fontsize,
            fontname=FONT,
            color=DARK,
        )
        self.y += 14

    def bullet_list(self, items: list[str]) -> None:
        fontsize = 9.5
        line_h = fontsize * 1.4
        for item in items:
            text = (item or "").strip()
            if not text:
                continue
            lines = self._wrap(f"- {text}", CONTENT_W, fontsize)
            for line in lines:
                self._ensure(line_h)
                self.page.insert_text(
                    (MARGIN + 8, self.y + fontsize),
                    line,
                    fontsize=fontsize,
                    fontname=FONT,
                    color=DARK,
                )
                self.y += line_h
        self.y += 6

    def labeled_block(self, label: str, text: str) -> None:
        fontsize = 9.5
        line_h = fontsize * 1.4
        self._ensure(line_h + 12)
        self.page.insert_text(
            (MARGIN, self.y + 8),
            label,
            fontsize=8,
            fontname=FONT_B,
            color=GRAY,
        )
        self.y += 14
        for line in self._wrap(text.strip() or "—", CONTENT_W, fontsize):
            self._ensure(line_h)
            self.page.insert_text(
                (MARGIN, self.y + fontsize),
                line,
                fontsize=fontsize,
                fontname=FONT,
                color=DARK,
            )
            self.y += line_h
        self.y += 8

    def signature_line(self, label: str, name: str, date_label: str) -> None:
        self._ensure(52)
        self.page.insert_text(
            (MARGIN, self.y + 8),
            label,
            fontsize=8,
            fontname=FONT_B,
            color=GRAY,
        )
        self.y += 16
        self.page.draw_line(
            fitz.Point(MARGIN, self.y + 10),
            fitz.Point(MARGIN + 220, self.y + 10),
            color=LINE,
            width=0.8,
        )
        if name.strip():
            self.page.insert_text(
                (MARGIN, self.y + 22),
                name.strip(),
                fontsize=9,
                fontname=FONT,
                color=DARK,
            )
        self.page.insert_text(
            (MARGIN + 260, self.y + 22),
            date_label,
            fontsize=9,
            fontname=FONT,
            color=DARK,
        )
        self.y += 34

    def finish(self) -> bytes:
        return self.doc.tobytes()


def _build_poc_pdf(
    *,
    clinic: dict[str, Any],
    patient: dict[str, Any],
    note: dict[str, Any],
    body: PlanOfCareRequest,
) -> bytes:
    today = _today_str()
    first = str(patient.get("first_name") or "").strip()
    last = str(patient.get("last_name") or "").strip()
    service_date = note.get("created_at")
    start_date = _fmt_date(service_date)
    end_date = _add_weeks_date(service_date, body.duration_weeks)
    procedures = [p.strip() for p in body.procedures if str(p).strip()]

    builder = PocPdfBuilder()
    builder.title("PLAN OF CARE")

    clinic_name = str(clinic.get("name") or "Clinic").strip()
    clinic_address = str(clinic.get("address") or "").strip()
    clinic_phone = str(clinic.get("phone") or "").strip()
    builder.two_col_row(f"Clinic: {clinic_name}", f"Date: {today}")
    if clinic_address:
        builder.field_line("Address", clinic_address)
    if clinic_phone:
        builder.field_line("Phone", clinic_phone)
    builder.y += 6

    builder.section_header("Patient Information")
    builder.two_col_row(
        f"Name: {first} {last}".strip(),
        f"DOB: {_fmt_date(patient.get('date_of_birth'))}",
    )
    builder.two_col_row(
        f"Insurance: {str(patient.get('insurance_carrier') or '—')}",
        f"Policy #: {str(patient.get('insurance_policy_number') or '—')}",
    )

    builder.section_header("Diagnosis")
    dx_code = body.diagnosis_code.strip() or "—"
    dx_desc = body.diagnosis_description.strip() or "—"
    builder.field_line("ICD-10", f"{dx_code} — {dx_desc}")

    builder.section_header("Plan of Care")
    builder.field_line("Frequency", body.frequency.strip() or "—")
    builder.field_line("Duration", f"{body.duration_weeks} weeks")
    builder.field_line("Start Date", start_date)
    builder.field_line("Projected End Date", end_date)
    body_region = str(note.get("body_region") or "").strip()
    if body_region:
        builder.field_line("Body Region", body_region)

    builder.section_header("Procedures/Interventions")
    if procedures:
        builder.bullet_list(procedures)
    else:
        builder.field_line("", "—")

    builder.section_header("Short-Term Goals (2 weeks)")
    builder.labeled_block("", body.short_term_goals.strip() or "—")

    builder.section_header(f"Long-Term Goals ({body.duration_weeks} weeks)")
    builder.labeled_block("", body.long_term_goals.strip() or "—")

    builder.section_header("Medical Necessity")
    builder.labeled_block("", str(note.get("plan") or "").strip() or "—")

    builder.signature_line(
        "PHYSICIAN/THERAPIST SIGNATURE",
        body.clinician_signature.strip(),
        f"Date: {today}",
    )
    builder.signature_line(
        "REFERRING PROVIDER SIGNATURE (if required)",
        "",
        "Date: _______________",
    )

    return builder.finish()


@router.post("/plan-of-care/generate")
def generate_plan_of_care(body: PlanOfCareRequest, clinic: ClinicUserDep):
    try:
        if body.clinic_id.strip() != clinic.clinic_id:
            raise HTTPException(status_code=403, detail="clinic_id does not match session")

        note = _one("clinical_notes", id=body.note_id.strip())
        if not note:
            raise HTTPException(status_code=404, detail="Clinical note not found")
        if str(note.get("clinic_id") or "") != clinic.clinic_id:
            raise HTTPException(status_code=403, detail="Note does not belong to this clinic")
        if str(note.get("patient_id") or "") != body.patient_id.strip():
            raise HTTPException(status_code=400, detail="patient_id does not match note")

        patient = _one("patients", id=body.patient_id.strip())
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        if str(patient.get("clinic_id") or "") != clinic.clinic_id:
            raise HTTPException(status_code=403, detail="Patient does not belong to this clinic")

        clinic_row = _one("clinics", id=clinic.clinic_id) or {}

        pdf_bytes = _build_poc_pdf(
            clinic=clinic_row,
            patient=patient,
            note=note,
            body=body,
        )
        last_name = str(patient.get("last_name") or "patient").strip() or "patient"
        safe_last = "".join(c if c.isalnum() or c in "-_" else "_" for c in last_name)
        date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
        filename = f"POC_{safe_last}_{date_part}.pdf"

        return {
            "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
            "filename": filename,
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Plan of Care PDF generation failed: {exc}",
        ) from exc
