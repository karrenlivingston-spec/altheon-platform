"""Medical records search and merged PDF export."""

from __future__ import annotations

import base64
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 42.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 36.0
TEAL = (13 / 255, 148 / 255, 136 / 255)
DARK = (0.13, 0.16, 0.18)
GRAY = (0.45, 0.5, 0.53)
LINE = (0.8, 0.84, 0.85)
FONT = "helv"
FONT_B = "hebo"

NOTE_TYPE_LABELS = {
    "initial_evaluation": "Initial Evaluation",
    "daily_note": "Daily Note",
    "progress_note": "Progress Note",
    "discharge_note": "Discharge Note",
}


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _one(table: str, **eq_filters: Any) -> Optional[dict[str, Any]]:
    q = supabase.table(table).select("*")
    for k, v in eq_filters.items():
        q = q.eq(k, v)
    try:
        resp = q.limit(1).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    return rows[0] if rows else None


def _fmt_date(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return "—"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%m/%d/%Y")
    except ValueError:
        return s[:10]


def _note_date_iso(note: dict[str, Any]) -> str:
    raw = note.get("signed_at") or note.get("created_at") or ""
    s = str(raw).strip()
    if not s:
        return ""
    return s[:10] if len(s) >= 10 else s


def _author_display_name(row: Optional[dict[str, Any]]) -> str:
    if not row:
        return "Unknown"
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    combined = f"{fn} {ln}".strip()
    if combined:
        return combined
    email = str(row.get("email") or "").strip()
    return email or "Unknown"


def _load_clinic_users_map(author_ids: list[str]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    if not author_ids:
        return by_id
    try:
        resp = (
            supabase.table("clinic_users")
            .select("id,first_name,last_name,email")
            .in_("id", author_ids)
            .execute()
        )
        _handle_supabase_error(resp)
        for row in resp.data or []:
            if isinstance(row, dict) and row.get("id"):
                by_id[str(row["id"])] = row
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return by_id


def _date_range_bounds(from_ymd: str, to_ymd: str) -> tuple[str, str]:
    start = f"{from_ymd}T00:00:00"
    end = f"{to_ymd}T23:59:59.999999"
    return start, end


class RecordsExportBody(BaseModel):
    patient_id: str = Field(...)
    note_ids: list[str] = Field(..., min_length=1)
    recipient_email: str = Field(...)
    clinic_id: str = Field(...)


class RecordsPdfBuilder:
    """Merged medical-records PDF with cover page, note sections, and page numbers."""

    def __init__(self) -> None:
        self.doc = fitz.open()
        self.page: fitz.Page = None  # type: ignore[assignment]
        self.y = 0.0
        self._new_page()

    def _new_page(self) -> None:
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = MARGIN

    def _ensure(self, needed: float) -> None:
        if self.y + needed > PAGE_H - FOOTER_H - MARGIN / 2:
            self._new_page()

    @staticmethod
    def _wrap(text: str, width: float, fontsize: float) -> list[str]:
        out: list[str] = []
        for raw_line in (text or "").split("\n"):
            words = raw_line.split(" ")
            cur = ""
            for word in words:
                cand = f"{cur} {word}".strip()
                if fitz.get_text_length(cand, fontname=FONT, fontsize=fontsize) <= width:
                    cur = cand
                else:
                    if cur:
                        out.append(cur)
                    cur = word
            out.append(cur)
        return out or [""]

    def _text(self, x: float, text: str, *, size: float, bold: bool = False, color=DARK) -> None:
        self.page.insert_text(
            (x, self.y),
            text,
            fontsize=size,
            fontname=FONT_B if bold else FONT,
            color=color,
        )

    def cover_page(
        self,
        *,
        patient_name: str,
        patient_dob: str,
        clinic_name: str,
        date_range: str,
        requested_on: str,
    ) -> None:
        self.y = PAGE_H * 0.28
        title = "Medical Records"
        tw = fitz.get_text_length(title, fontname=FONT_B, fontsize=22)
        self._text((PAGE_W - tw) / 2, title, size=22, bold=True, color=TEAL)
        self.y += 48

        lines = [
            ("Patient", patient_name),
            ("Date of Birth", patient_dob),
            ("Clinic", clinic_name),
            ("Date Range", date_range),
            ("Records Requested On", requested_on),
        ]
        for label, value in lines:
            self._ensure(36)
            self._text(MARGIN + 80, label, size=10, bold=True, color=GRAY)
            self.y += 16
            self._text(MARGIN + 80, value or "—", size=13, bold=True)
            self.y += 28

        self._new_page()

    def note_section(
        self,
        *,
        note_type: str,
        note_date: str,
        clinician_name: str,
        subjective: str,
        objective: str,
        assessment: str,
        plan: str,
    ) -> None:
        type_label = NOTE_TYPE_LABELS.get(note_type.lower(), note_type or "Clinical Note")
        header = f"{type_label}  ·  {note_date}  ·  {clinician_name}"
        self._ensure(28)
        rect = fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + 20)
        self.page.draw_rect(rect, color=None, fill=TEAL)
        self.page.insert_text(
            (MARGIN + 8, self.y + 14),
            header,
            fontsize=9.5,
            fontname=FONT_B,
            color=(1, 1, 1),
        )
        self.y += 30

        for label, body in [
            ("Subjective", subjective),
            ("Objective", objective),
            ("Assessment", assessment),
            ("Plan", plan),
        ]:
            self._ensure(40)
            self.page.insert_text(
                (MARGIN, self.y + 10),
                label.upper(),
                fontsize=8,
                fontname=FONT_B,
                color=GRAY,
            )
            self.y += 18
            fontsize = 9.0
            line_h = fontsize * 1.35
            for line in self._wrap(body.strip() or "—", CONTENT_W, fontsize):
                self._ensure(line_h)
                self.page.insert_text(
                    (MARGIN, self.y + fontsize),
                    line,
                    fontsize=fontsize,
                    fontname=FONT,
                    color=DARK,
                )
                self.y += line_h
            self.y += 10

        self.y += 8
        self.page.draw_line(
            fitz.Point(MARGIN, self.y),
            fitz.Point(PAGE_W - MARGIN, self.y),
            color=LINE,
            width=0.7,
        )
        self.y += 16

    def finish(self) -> bytes:
        total = self.doc.page_count
        for i, page in enumerate(self.doc):
            label = f"Page {i + 1} of {total}"
            w = fitz.get_text_length(label, fontname=FONT, fontsize=8)
            page.insert_text(
                ((PAGE_W - w) / 2, PAGE_H - 22),
                label,
                fontsize=8,
                fontname=FONT,
                color=GRAY,
            )
        return self.doc.tobytes()


def _send_records_email(
    *,
    recipient: str,
    patient_name: str,
    clinic_name: str,
    pdf_bytes: bytes,
) -> bool:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT")
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    required = [smtp_host, smtp_port, smtp_user, smtp_password]
    if not all(required):
        return False

    subject = f"Medical Records — {patient_name} — {clinic_name}"
    body = (
        f"Please find attached medical records for {patient_name} "
        f"from {clinic_name}.\n\n"
        "This message was sent from the Altheon platform."
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_user
    message["To"] = recipient
    message.set_content(body)
    safe_name = patient_name.replace(" ", "_")[:40] or "patient"
    message.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=f"{safe_name}_records.pdf",
    )

    with smtplib.SMTP(smtp_host, int(smtp_port), timeout=30) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(message)
    return True


@router.get("/clinical-notes")
def list_signed_clinical_notes_for_records(
    clinic: ClinicUserDep,
    patient_id: str = Query(...),
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
):
    """Signed notes for a patient within a date range (records export UI)."""
    pid = patient_id.strip()
    from_ymd = from_.strip()
    to_ymd = to.strip()
    if not pid or not from_ymd or not to_ymd:
        raise HTTPException(status_code=400, detail="patient_id, from, and to are required")

    patient = _one("patients", id=pid, clinic_id=clinic.clinic_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    start_bound, end_bound = _date_range_bounds(from_ymd, to_ymd)
    try:
        resp = (
            supabase.table("clinical_notes")
            .select("id, note_type, status, signed_at, created_at, author_id")
            .eq("clinic_id", clinic.clinic_id)
            .eq("patient_id", pid)
            .eq("status", "signed")
            .gte("signed_at", start_bound)
            .lte("signed_at", end_bound)
            .order("signed_at", desc=False)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    author_ids = list({str(r.get("author_id") or "") for r in rows if r.get("author_id")})
    clinicians_by_id: dict[str, dict[str, Any]] = {}
    if author_ids:
        try:
            cresp = (
                supabase.table("clinicians")
                .select("id,first_name,last_name")
                .in_("id", author_ids)
                .execute()
            )
            _handle_supabase_error(cresp)
            for crow in cresp.data or []:
                if isinstance(crow, dict) and crow.get("id"):
                    clinicians_by_id[str(crow["id"])] = crow
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    out: list[dict[str, Any]] = []
    for r in rows:
        aid = str(r.get("author_id") or "")
        c = clinicians_by_id.get(aid)
        fn = str((c or {}).get("first_name") or "").strip()
        ln = str((c or {}).get("last_name") or "").strip()
        clinician_name = f"{fn} {ln}".strip() or "Unknown"
        out.append(
            {
                "id": r.get("id"),
                "note_date": _note_date_iso(r),
                "note_type": r.get("note_type"),
                "clinician_name": clinician_name,
                "status": r.get("status"),
            }
        )
    return out


@router.post("/records/export")
def export_records(
    body: RecordsExportBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    from routers.fee_schedule import _resolve_bearer_user_id, _assert_user_has_clinic_access

    user_id = _resolve_bearer_user_id(authorization)
    cid = body.clinic_id.strip()
    pid = body.patient_id.strip()
    email = body.recipient_email.strip()
    note_ids = [str(n).strip() for n in body.note_ids if str(n).strip()]

    if not cid or not pid or not email or not note_ids:
        raise HTTPException(status_code=400, detail="Missing required fields")
    _assert_user_has_clinic_access(user_id, cid)

    patient = _one("patients", id=pid, clinic_id=cid)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    clinic_row = _one("clinics", id=cid) or {}
    patient_name = (
        f"{str(patient.get('first_name') or '').strip()} "
        f"{str(patient.get('last_name') or '').strip()}"
    ).strip() or "Patient"
    clinic_name = str(clinic_row.get("name") or "Clinic")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .eq("status", "signed")
            .in_("id", note_ids)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    notes = [n for n in (resp.data or []) if isinstance(n, dict)]
    if len(notes) != len(note_ids):
        raise HTTPException(status_code=400, detail="One or more notes were not found or are not signed")

    author_ids = list({str(n.get("author_id") or "") for n in notes if n.get("author_id")})
    clinicians_by_id: dict[str, dict[str, Any]] = {}
    if author_ids:
        try:
            cresp = (
                supabase.table("clinicians")
                .select("id,first_name,last_name")
                .in_("id", author_ids)
                .execute()
            )
            _handle_supabase_error(cresp)
            for crow in cresp.data or []:
                if isinstance(crow, dict) and crow.get("id"):
                    clinicians_by_id[str(crow["id"])] = crow
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    notes.sort(key=lambda n: str(n.get("signed_at") or n.get("created_at") or ""))

    dates = [_note_date_iso(n) for n in notes if _note_date_iso(n)]
    date_range = f"{min(dates)} – {max(dates)}" if dates else "—"
    requested_on = datetime.now(timezone.utc).strftime("%m/%d/%Y")

    builder = RecordsPdfBuilder()
    builder.cover_page(
        patient_name=patient_name,
        patient_dob=_fmt_date(patient.get("date_of_birth")),
        clinic_name=clinic_name,
        date_range=date_range,
        requested_on=requested_on,
    )

    for note in notes:
        aid = str(note.get("author_id") or "")
        c = clinicians_by_id.get(aid)
        fn = str((c or {}).get("first_name") or "").strip()
        ln = str((c or {}).get("last_name") or "").strip()
        clinician_name = f"{fn} {ln}".strip() or "Unknown"
        builder.note_section(
            note_type=str(note.get("note_type") or ""),
            note_date=_fmt_date(note.get("signed_at") or note.get("created_at")),
            clinician_name=clinician_name,
            subjective=str(note.get("subjective") or ""),
            objective=str(note.get("objective") or ""),
            assessment=str(note.get("assessment") or ""),
            plan=str(note.get("plan") or ""),
        )

    pdf_bytes = builder.finish()
    email_sent = False
    try:
        email_sent = _send_records_email(
            recipient=email,
            patient_name=patient_name,
            clinic_name=clinic_name,
            pdf_bytes=pdf_bytes,
        )
    except Exception:
        email_sent = False

    try:
        log_resp = (
            supabase.table("record_exports")
            .insert(
                {
                    "clinic_id": cid,
                    "patient_id": pid,
                    "note_ids": note_ids,
                    "recipient_email": email,
                    "exported_by": user_id,
                }
            )
            .execute()
        )
        _handle_supabase_error(log_resp)
    except Exception:
        pass

    result: dict[str, Any] = {
        "success": True,
        "email_sent": email_sent,
        "message": (
            f"Records sent to {email}"
            if email_sent
            else "Records PDF generated. Email is not configured — download the PDF below."
        ),
    }
    if not email_sent:
        result["pdf_base64"] = base64.b64encode(pdf_bytes).decode("ascii")
        result["filename"] = f"{patient_name.replace(' ', '_')}_records.pdf"

    return result
