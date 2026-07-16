"""Plan of Care (POC) PDF generation for signed evaluation notes."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import traceback
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase
from app.retry_utils import supabase_execute
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header
from routers.fee_schedule import ClinicUserDep

router = APIRouter()
logger = logging.getLogger(__name__)

_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

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


def _sb_execute(fn):
    """Run Supabase query with transient-failure retry (Render-safe)."""
    try:
        resp = supabase_execute(fn)
        _handle_supabase_error(resp)
        return resp
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _one(table: str, **eq_filters: Any) -> Optional[dict[str, Any]]:
    q = supabase.table(table).select("*")
    for k, v in eq_filters.items():
        q = q.eq(k, v)
    resp = _sb_execute(lambda: q.limit(1).execute())
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
    pt_license: str = ""
    referring_physician: str = ""


class PocAISuggestBody(BaseModel):
    clinic_id: str = Field(..., min_length=1)
    soap_text: str


def _parse_ai_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise json.JSONDecodeError("empty response", text, 0)
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise json.JSONDecodeError("expected JSON object", text, 0)
    return data


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

    # Clinic + referring physician header
    clinic_name = str(clinic.get("name") or "Clinic").strip()
    clinic_address = str(clinic.get("address") or "").strip()
    clinic_phone = str(clinic.get("phone") or "").strip()
    builder.two_col_row(f"Clinic: {clinic_name}", f"Date of Care: {start_date}")
    if clinic_address:
        builder.field_line("Address", clinic_address)
    if clinic_phone:
        builder.field_line("Phone", clinic_phone)
    ref_phys = body.referring_physician.strip()
    builder.field_line("Referring Physician/NPP", ref_phys if ref_phys else "___________________________")
    builder.y += 6

    # Patient info
    builder.section_header("Patient Information")
    builder.two_col_row(
        f"Name: {first} {last}".strip(),
        f"DOB: {_fmt_date(patient.get('date_of_birth'))}",
    )
    builder.two_col_row(
        f"Date of Original Eval: {start_date}",
        f"Projected End of Plan: {end_date}",
    )
    builder.two_col_row(
        f"Insurance: {str(patient.get('insurance_carrier') or '—')}",
        f"Policy #: {str(patient.get('insurance_policy_number') or '—')}",
    )

    # Diagnosis
    builder.section_header("Diagnosis")
    dx_code = body.diagnosis_code.strip() or "—"
    dx_desc = body.diagnosis_description.strip() or "—"
    builder.field_line("ICD-10", f"{dx_code} — {dx_desc}")

    # Assessment from SOAP note
    builder.section_header("Assessment/Clinical Findings")
    assessment_text = str(note.get("assessment") or "").strip()
    subjective_text = str(note.get("subjective") or "").strip()
    full_assessment = "\n\n".join(filter(None, [subjective_text, assessment_text]))
    builder.labeled_block("", full_assessment or "—")

    # Goals
    builder.section_header("Short-Term Goals (2 weeks)")
    builder.labeled_block("", body.short_term_goals.strip() or "—")

    builder.section_header(f"Long-Term Goals ({body.duration_weeks} weeks)")
    builder.labeled_block("", body.long_term_goals.strip() or "—")

    # Plan
    builder.section_header("Plan of Care")
    builder.field_line("Frequency", body.frequency.strip() or "—")
    builder.field_line("Duration", f"{body.duration_weeks} weeks")
    builder.field_line("Start Date", start_date)
    builder.field_line("Projected End Date", end_date)

    # Procedures/Modalities
    builder.section_header("Procedures / Modalities")
    if procedures:
        builder.bullet_list(procedures)
    else:
        builder.field_line("", "—")

    # Medical necessity
    builder.section_header("Medical Necessity")
    builder.labeled_block("", str(note.get("plan") or "").strip() or "—")

    # Certification statement
    builder.section_header("Certification of Medical Necessity")
    cert_text = (
        "It is be understood that the treatment plan mentioned above is certified medically necessary "
        "by the documenting therapist and referring physician/NPP mentioned in this report. Unless the referring "
        "physician/NPP indicated otherwise, services will be furnished while the patient is under my care. "
        "Thank you for this referral."
    )
    builder.labeled_block("", cert_text)
    builder.y += 8

    # Signatures
    builder.signature_line(
        "REFERRING PHYSICIAN / NPP SIGNATURE",
        body.referring_physician.strip(),
        "Date: _______________",
    )
    pt_sig_label = "PHYSICAL THERAPIST SIGNATURE"
    if body.pt_license.strip():
        pt_sig_label += f"  |  License #: {body.pt_license.strip()}"
    builder.signature_line(
        pt_sig_label,
        body.clinician_signature.strip(),
        f"Date: {today}",
    )

    return builder.finish()


@router.post("/plan-of-care/ai-suggest-goals")
def ai_suggest_poc_goals(
    payload: PocAISuggestBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """
    Accepts { clinic_id, soap_text }.
    Returns { short_term_goals, long_term_goals } as plain text strings.
    """
    try:
        enforce_clinic_role_from_auth_header(
            authorization,
            payload.clinic_id,
            *CLINICAL_ROLES,
        )

        soap_text = payload.soap_text.strip()
        if not soap_text:
            raise HTTPException(status_code=400, detail="soap_text is required")

        api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY is not configured")

        prompt = f"""You are a physical therapy clinical assistant helping a clinician write a Plan of Care.

Based on the SOAP note below, generate:
1. Short-Term Goals (2-week goals) — 2 to 3 specific, measurable, functional goals
2. Long-Term Goals (end of plan of care) — 2 to 3 specific, measurable, functional goals

SOAP NOTE:
{soap_text}

Return ONLY a JSON object (no markdown, no explanation):
{{
  "short_term_goals": "1. [goal]\\n2. [goal]\\n3. [goal]",
  "long_term_goals": "1. [goal]\\n2. [goal]\\n3. [goal]"
}}

Goals must be:
- Specific and measurable (include time frames, distances, pain scales, repetitions where appropriate)
- Functional and patient-centered (what will the patient be able to DO)
- Realistic for the diagnosis and presentation in the SOAP note
- Written in third person (e.g. "Patient will...")"""

        try:
            import anthropic
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="anthropic package is not installed",
            ) from exc

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        blocks = getattr(message, "content", None) or []
        raw_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                raw_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                raw_parts.append(str(block["text"]))
        raw = "".join(raw_parts).strip()
        result = _parse_ai_json_object(raw)

        return {
            "short_term_goals": str(result.get("short_term_goals") or "").strip(),
            "long_term_goals": str(result.get("long_term_goals") or "").strip(),
        }

    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="AI response could not be parsed") from exc
    except Exception as exc:
        logger.exception("ai_suggest_poc_goals failed clinic_id=%s", payload.clinic_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
