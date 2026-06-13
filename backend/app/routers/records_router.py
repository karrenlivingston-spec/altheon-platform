"""Medical records search and merged PDF export."""

from __future__ import annotations

import base64
import os
import smtplib
from datetime import date, datetime, time, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Optional
from zoneinfo import ZoneInfo

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_CLOSED_LEGAL_STATUSES = frozenset({"delivered", "archived"})
_RECORD_TYPE_META = (
    ("clinical_notes", "Clinical Notes", "#16a34a"),
    ("evaluations", "Evaluations", "#8b5cf6"),
    ("billing", "Billing Documents", "#3b82f6"),
    ("imaging", "Imaging", "#f59e0b"),
    ("other", "Other Documents", "#9ca3af"),
)
_CLINICAL_NOTE_TYPES = frozenset({"daily_note", "progress_note", "discharge_note"})
_EVAL_NOTE_TYPES = frozenset({"initial_evaluation"})

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


def _patient_pt_id(patient_id: str, pt_id: str | None = None) -> str:
    if pt_id and str(pt_id).strip():
        return str(pt_id).strip()
    pid = (patient_id or "").strip()
    if not pid:
        return ""
    return f"PT-{pid.replace('-', '')[-6:].upper()}"


def _patient_initials(first: str, last: str) -> str:
    f = (first or "").strip()
    l = (last or "").strip()
    if f and l:
        return f"{f[0]}{l[0]}".upper()
    if f:
        return f[:2].upper()
    if l:
        return l[:2].upper()
    return "?"


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _prev_month_start(d: date) -> date:
    if d.month == 1:
        return date(d.year - 1, 12, 1)
    return date(d.year, d.month - 1, 1)


def _pct_change(this: int, last: int) -> int:
    if last == 0:
        return 100 if this > 0 else 0
    return round((this - last) / last * 100)


def _parse_date_only(value: Any) -> Optional[date]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _parse_utc_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _format_export_datetime(value: Any) -> str:
    dt = _parse_utc_dt(value)
    if not dt:
        return "—"
    local = dt.astimezone(_CLINIC_TZ)
    hour = local.strftime("%I").lstrip("0") or "12"
    return (
        f"{local.strftime('%b')} {local.day}, {local.year} "
        f"{hour}:{local.strftime('%M')} {local.strftime('%p')}"
    )


def _legal_due_date(row: dict[str, Any]) -> Optional[date]:
    due = _parse_date_only(row.get("records_due_date") or row.get("due_date"))
    if due:
        return due
    req = _parse_date_only(row.get("request_date"))
    if req:
        return req + timedelta(days=30)
    return None


def _empty_stats() -> dict[str, Any]:
    return {
        "generated_this_month": 0,
        "generated_vs_last_month": 0,
        "pending_requests": 0,
        "pending_overdue": 0,
        "shared_this_month": 0,
        "shared_vs_last_month": 0,
        "downloads_this_month": 0,
        "on_time_delivery_pct": 100,
    }


def _empty_type_breakdown() -> dict[str, Any]:
    return {
        "total": 0,
        "breakdown": [
            {"label": label, "count": 0, "pct": 0, "color": color}
            for _, label, color in _RECORD_TYPE_META
        ],
    }


def _note_types_for_record_types(record_types: list[str]) -> set[str]:
    types: set[str] = set()
    normalized = {str(t).strip().lower() for t in record_types}
    if "clinical_notes" in normalized:
        types |= _CLINICAL_NOTE_TYPES
    if "evaluations" in normalized:
        types |= _EVAL_NOTE_TYPES
    return types


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


class RecordsGenerateBody(BaseModel):
    clinic_id: str = Field(...)
    patient_id: str = Field(...)
    record_types: list[str] = Field(..., min_length=1)
    date_from: str = Field(...)
    date_to: str = Field(...)
    recipient_email: Optional[str] = None
    legal_request_id: Optional[str] = None


def _shape_recent_export(row: dict[str, Any], users_by_id: dict[str, dict]) -> dict[str, Any]:
    patient = row.get("patients") or {}
    if isinstance(patient, list):
        patient = patient[0] if patient else {}
    first = str(patient.get("first_name") or "").strip()
    last = str(patient.get("last_name") or "").strip()
    patient_name = f"{first} {last}".strip() or "Unknown"
    pid = str(row.get("patient_id") or "")
    generated_by = str(row.get("generated_by_name") or "").strip()
    if not generated_by:
        exporter = users_by_id.get(str(row.get("exported_by") or ""))
        generated_by = _author_display_name(exporter) if exporter else "Aria (AI)"
    record_types = list(row.get("record_types") or [])
    if not record_types:
        note_ids = row.get("note_ids") or []
        if note_ids:
            record_types = ["clinical_notes"]
    return {
        "id": str(row.get("id") or ""),
        "patient_name": patient_name,
        "patient_avatar_initials": _patient_initials(first, last),
        "patient_pt_id": _patient_pt_id(pid, patient.get("pt_id")),
        "generated_by": generated_by,
        "exported_at": _format_export_datetime(row.get("exported_at")),
        "record_types": record_types,
        "page_count": int(row.get("page_count") or 0),
        "status": str(row.get("status") or "completed"),
        "file_url": row.get("file_url"),
        "recipient_email": row.get("recipient_email"),
    }


@router.get("/records/stats")
def get_records_stats(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    try:
        today = datetime.now(_CLINIC_TZ).date()
        month_start = _month_start(today)
        prev_start = _prev_month_start(today)
        prev_end = month_start - timedelta(days=1)

        exports_resp = (
            supabase.table("record_exports")
            .select(
                "id, exported_at, recipient_email, legal_request_id, status"
            )
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(exports_resp)
        exports = [r for r in (exports_resp.data or []) if isinstance(r, dict)]

        generated_this_month = 0
        generated_last_month = 0
        shared_this_month = 0
        shared_last_month = 0
        downloads_this_month = 0

        for row in exports:
            exported = _parse_utc_dt(row.get("exported_at"))
            if not exported:
                continue
            ed = exported.astimezone(_CLINIC_TZ).date()
            has_recipient = bool(str(row.get("recipient_email") or "").strip())
            if ed >= month_start:
                generated_this_month += 1
                downloads_this_month += 1
                if has_recipient:
                    shared_this_month += 1
            elif prev_start <= ed <= prev_end:
                generated_last_month += 1
                if has_recipient:
                    shared_last_month += 1

        legal_resp = (
            supabase.table("legal_requests")
            .select("id, status, records_due_date, due_date, request_date")
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(legal_resp)
        legal_rows = [r for r in (legal_resp.data or []) if isinstance(r, dict)]

        pending_requests = 0
        pending_overdue = 0
        for lr in legal_rows:
            st = str(lr.get("status") or "").lower()
            if st in _CLOSED_LEGAL_STATUSES:
                continue
            pending_requests += 1
            due = _legal_due_date(lr)
            if due and due < today:
                pending_overdue += 1

        on_time = 0
        linked_total = 0
        legal_by_id = {str(r.get("id") or ""): r for r in legal_rows if r.get("id")}
        for row in exports:
            lid = str(row.get("legal_request_id") or "")
            if not lid or lid not in legal_by_id:
                continue
            exported = _parse_utc_dt(row.get("exported_at"))
            due = _legal_due_date(legal_by_id[lid])
            if not exported or not due:
                continue
            linked_total += 1
            if exported.astimezone(_CLINIC_TZ).date() <= due:
                on_time += 1

        on_time_pct = (
            round(on_time / linked_total * 100) if linked_total > 0 else 100
        )

        return {
            "generated_this_month": generated_this_month,
            "generated_vs_last_month": _pct_change(
                generated_this_month, generated_last_month
            ),
            "pending_requests": pending_requests,
            "pending_overdue": pending_overdue,
            "shared_this_month": shared_this_month,
            "shared_vs_last_month": _pct_change(
                shared_this_month, shared_last_month
            ),
            "downloads_this_month": downloads_this_month,
            "on_time_delivery_pct": on_time_pct,
        }
    except Exception as e:
        print(f"[records] stats error: {e}")
        return _empty_stats()


@router.get("/records/recent-exports")
def get_records_recent_exports(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=100),
    page: int = Query(1, ge=1),
):
    cid = clinic_id.strip()
    offset = (page - 1) * limit
    try:
        resp = (
            supabase.table("record_exports")
            .select(
                "*, patients(first_name, last_name, pt_id)"
            )
            .eq("clinic_id", cid)
            .order("exported_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
        exporter_ids = list(
            {str(r.get("exported_by") or "") for r in rows if r.get("exported_by")}
        )
        users_by_id = _load_clinic_users_map(exporter_ids)
        return [_shape_recent_export(r, users_by_id) for r in rows]
    except Exception as e:
        print(f"[records] recent-exports error: {e}")
        return []


@router.get("/records/attorney-requests")
def get_records_attorney_requests(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=50),
):
    cid = clinic_id.strip()
    today = datetime.now(_CLINIC_TZ).date()
    try:
        resp = (
            supabase.table("legal_requests")
            .select(
                "id, patient_name, firm_name, request_date, records_due_date, "
                "due_date, status, patients(first_name, last_name)"
            )
            .eq("clinic_id", cid)
            .neq("status", "archived")
            .neq("status", "delivered")
            .order("request_date", desc=False)
            .limit(100)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]

        def sort_key(r: dict[str, Any]) -> date:
            due = _legal_due_date(r)
            return due or date.max

        rows.sort(key=sort_key)
        out: list[dict[str, Any]] = []
        for r in rows[:limit]:
            patient = r.get("patients") or {}
            if isinstance(patient, list):
                patient = patient[0] if patient else {}
            patient_name = str(r.get("patient_name") or "").strip()
            if not patient_name:
                fn = str(patient.get("first_name") or "").strip()
                ln = str(patient.get("last_name") or "").strip()
                patient_name = f"{fn} {ln}".strip() or "Unknown"
            due = _legal_due_date(r)
            days_until = (due - today).days if due else 0
            out.append(
                {
                    "id": str(r.get("id") or ""),
                    "patient_name": patient_name,
                    "firm_name": str(r.get("firm_name") or "—"),
                    "requested_date": _fmt_date(r.get("request_date")),
                    "records_due_date": due.isoformat() if due else None,
                    "days_until_due": days_until,
                    "is_overdue": days_until < 0,
                    "status": str(r.get("status") or ""),
                }
            )
        return out
    except Exception as e:
        print(f"[records] attorney-requests error: {e}")
        return []


@router.get("/records/type-breakdown")
def get_records_type_breakdown(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    try:
        today = datetime.now(_CLINIC_TZ).date()
        month_start = _month_start(today)
        start_local = datetime.combine(month_start, time(0, 0), tzinfo=_CLINIC_TZ)
        start_utc = start_local.astimezone(timezone.utc)

        resp = (
            supabase.table("record_exports")
            .select("record_types, exported_at, note_ids")
            .eq("clinic_id", cid)
            .gte("exported_at", start_utc.isoformat())
            .execute()
        )
        _handle_supabase_error(resp)
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]

        counts = {k: 0 for k, _, _ in _RECORD_TYPE_META}
        for row in rows:
            types = list(row.get("record_types") or [])
            if not types and row.get("note_ids"):
                types = ["clinical_notes"]
            for t in types:
                key = str(t).strip().lower()
                if key in counts:
                    counts[key] += 1
                else:
                    counts["other"] += 1

        total = sum(counts.values()) or len(rows)
        if total == 0:
            total = 1
        breakdown = []
        for key, label, color in _RECORD_TYPE_META:
            count = counts.get(key, 0)
            pct = round(count / total * 100) if total > 0 else 0
            breakdown.append(
                {"label": label, "count": count, "pct": pct, "color": color}
            )
        return {"total": sum(counts.values()), "breakdown": breakdown}
    except Exception as e:
        print(f"[records] type-breakdown error: {e}")
        return _empty_type_breakdown()


@router.post("/records/generate")
def generate_records_packet(
    body: RecordsGenerateBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    from routers.fee_schedule import _resolve_bearer_user_id, _assert_user_has_clinic_access

    user_id: Optional[str] = None
    generated_by_name: Optional[str] = None
    try:
        user_id = _resolve_bearer_user_id(authorization)
    except HTTPException:
        user_id = None

    cid = body.clinic_id.strip()
    pid = body.patient_id.strip()
    from_ymd = body.date_from.strip()[:10]
    to_ymd = body.date_to.strip()[:10]
    record_types = [str(t).strip().lower() for t in body.record_types if str(t).strip()]

    if not cid or not pid or not from_ymd or not to_ymd or not record_types:
        raise HTTPException(status_code=400, detail="Missing required fields")

    if user_id:
        _assert_user_has_clinic_access(user_id, cid)
        user_row = _one("clinic_users", id=user_id)
        generated_by_name = _author_display_name(user_row)

    patient = _one("patients", id=pid, clinic_id=cid)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    note_ids: list[str] = []
    note_type_filter = _note_types_for_record_types(record_types)
    if note_type_filter:
        start_bound, end_bound = _date_range_bounds(from_ymd, to_ymd)
        try:
            nresp = (
                supabase.table("clinical_notes")
                .select("id, note_type")
                .eq("clinic_id", cid)
                .eq("patient_id", pid)
                .eq("status", "signed")
                .gte("signed_at", start_bound)
                .lte("signed_at", end_bound)
                .execute()
            )
            _handle_supabase_error(nresp)
            for n in nresp.data or []:
                if not isinstance(n, dict):
                    continue
                nt = str(n.get("note_type") or "").lower()
                if nt in note_type_filter and n.get("id"):
                    note_ids.append(str(n["id"]))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if "billing" in record_types:
        try:
            bresp = (
                supabase.table("billing_records")
                .select("id, service_date")
                .eq("clinic_id", cid)
                .eq("patient_id", pid)
                .execute()
            )
            _handle_supabase_error(bresp)
            for b in bresp.data or []:
                if not isinstance(b, dict) or not b.get("id"):
                    continue
                svc = _parse_date_only(b.get("service_date"))
                from_d = _parse_date_only(from_ymd)
                to_d = _parse_date_only(to_ymd)
                if svc and from_d and to_d and from_d <= svc <= to_d:
                    note_ids.append(str(b["id"]))
        except Exception:
            pass

    page_count = max(len(note_ids) * 2, 0)
    recipient = (body.recipient_email or "").strip() or None
    payload: dict[str, Any] = {
        "clinic_id": cid,
        "patient_id": pid,
        "note_ids": note_ids,
        "record_types": record_types,
        "date_from": from_ymd,
        "date_to": to_ymd,
        "page_count": page_count,
        "status": "processing",
        "recipient_email": recipient or "",
        "exported_by": user_id,
        "generated_by_name": generated_by_name,
        "legal_request_id": (body.legal_request_id or "").strip() or None,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        ins = supabase.table("record_exports").insert(payload).execute()
        _handle_supabase_error(ins)
        rows = ins.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create export")
        row = rows[0]
        users_by_id = _load_clinic_users_map(
            [str(user_id)] if user_id else []
        )
        shaped = _shape_recent_export(row, users_by_id)
        return shaped
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
