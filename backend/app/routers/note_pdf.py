"""Clinical note PDF export — WebPT-style PT Recertification Note layout (PyMuPDF)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, HTTPException, Response

from app.db import supabase
from app.retry_utils import supabase_execute
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

# ---------------------------------------------------------------------------
# Layout constants
# ---------------------------------------------------------------------------

PAGE_W, PAGE_H = 612.0, 792.0  # US Letter, points
MARGIN = 42.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 36.0
TEAL = (13 / 255, 148 / 255, 136 / 255)
DARK = (0.13, 0.16, 0.18)
GRAY = (0.45, 0.5, 0.53)
LIGHT_ROW = (0.96, 0.97, 0.97)
LINE = (0.8, 0.84, 0.85)

FONT = "helv"
FONT_B = "hebo"

NOTE_TITLES = {
    "initial_evaluation": "Physical Therapy Initial Evaluation",
    "daily_note": "Physical Therapy Daily Note",
    "progress_note": "Physical Therapy Recertification Note",
    "discharge_note": "Physical Therapy Discharge Note",
}

OUTCOME_TOOL_NAMES = {
    "ndi": "Neck Disability Index (NDI)",
    "odi": "Oswestry Disability Index (ODI)",
    "quickdash": "QuickDASH",
}

CERT_STATEMENT = (
    "I certify the need for these medically necessary services furnished under "
    "this plan of care. Services will be furnished while the patient is under my "
    "care, and the plan will be reviewed at least every 90 days or as required."
)


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


def _q(table: str, **eq_filters: Any):
    q = supabase.table(table).select("*")
    for k, v in eq_filters.items():
        q = q.eq(k, v)
    return q


def _one(table: str, **eq_filters: Any) -> Optional[dict[str, Any]]:
    try:
        resp = _sb_execute(lambda: _q(table, **eq_filters).limit(1).execute())
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


def _fmt_datetime(value: Any) -> tuple[str, str]:
    s = str(value or "").strip()
    if not s:
        return "—", "—"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%m/%d/%Y"), dt.strftime("%I:%M %p")
    except ValueError:
        return s[:10], "—"


def _clinic_user_name(clinic_user: Optional[dict[str, Any]]) -> str:
    if not clinic_user:
        return "—"
    full = (
        f"{str(clinic_user.get('first_name') or '').strip()} "
        f"{str(clinic_user.get('last_name') or '').strip()}"
    ).strip()
    return full or str(clinic_user.get("email") or "").strip() or "—"


# ---------------------------------------------------------------------------
# PDF builder
# ---------------------------------------------------------------------------


class NotePdfBuilder:
    """Y-cursor flow layout over PyMuPDF pages with letterhead + page numbers."""

    def __init__(self, letterhead: dict[str, str]):
        self.doc = fitz.open()
        self.letterhead = letterhead
        self.page: fitz.Page = None  # type: ignore[assignment]
        self.y = 0.0
        self._first_page = True
        self._new_page()

    # -- page management ----------------------------------------------------

    def _new_page(self) -> None:
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = self._draw_letterhead(first=self._first_page)
        self._first_page = False

    def _draw_letterhead(self, *, first: bool) -> float:
        lh = self.letterhead
        p = self.page
        top = MARGIN - 10

        if first:
            # Clinic block (left)
            p.insert_text(
                (MARGIN, top + 10), lh["clinic_name"], fontsize=11,
                fontname=FONT_B, color=TEAL,
            )
            y = top + 22
            for line in (lh["clinic_address"], lh["clinic_phone"], lh["clinic_fax"]):
                if line:
                    p.insert_text((MARGIN, y), line, fontsize=8, fontname=FONT, color=GRAY)
                    y += 10

            # Title (center)
            title = lh["title"]
            tw = fitz.get_text_length(title, fontname=FONT_B, fontsize=13)
            p.insert_text(
                ((PAGE_W - tw) / 2, top + 14), title, fontsize=13,
                fontname=FONT_B, color=DARK,
            )

            # Patient block (right)
            right_lines = [
                ("Patient:", lh["patient_name"]),
                ("DOB:", lh["patient_dob"]),
                ("Document Date:", lh["doc_date"]),
            ]
            ry = top + 10
            for label, value in right_lines:
                text = f"{label} {value}"
                w = fitz.get_text_length(text, fontname=FONT, fontsize=8.5)
                p.insert_text(
                    (PAGE_W - MARGIN - w, ry), text, fontsize=8.5,
                    fontname=FONT, color=DARK,
                )
                ry += 11

            bottom = max(y, ry, top + 50) + 6
        else:
            # Slim continuation letterhead
            p.insert_text(
                (MARGIN, top + 10), lh["clinic_name"], fontsize=9,
                fontname=FONT_B, color=TEAL,
            )
            cont = f"{lh['patient_name']}  ·  DOB {lh['patient_dob']}  ·  {lh['title']}"
            w = fitz.get_text_length(cont, fontname=FONT, fontsize=8)
            p.insert_text(
                (PAGE_W - MARGIN - w, top + 10), cont, fontsize=8,
                fontname=FONT, color=GRAY,
            )
            bottom = top + 18

        p.draw_line(
            fitz.Point(MARGIN, bottom), fitz.Point(PAGE_W - MARGIN, bottom),
            color=TEAL, width=1.2,
        )
        return bottom + 14

    def _ensure(self, needed: float) -> None:
        if self.y + needed > PAGE_H - FOOTER_H - MARGIN / 2:
            self._new_page()

    # -- text helpers ---------------------------------------------------------

    @staticmethod
    def _wrap(text: str, width: float, fontsize: float, fontname: str = FONT) -> list[str]:
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
                    # Hard-break very long single words
                    while fitz.get_text_length(word, fontname=fontname, fontsize=fontsize) > width:
                        cut = len(word)
                        while cut > 1 and fitz.get_text_length(
                            word[:cut], fontname=fontname, fontsize=fontsize
                        ) > width:
                            cut -= 1
                        out.append(word[:cut])
                        word = word[cut:]
                    cur = word
            out.append(cur)
        return out or [""]

    # -- building blocks ------------------------------------------------------

    def section_header(self, title: str) -> None:
        h = 18.0
        self._ensure(h + 30)
        rect = fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + h)
        self.page.draw_rect(rect, color=None, fill=TEAL)
        self.page.insert_text(
            (MARGIN + 7, self.y + 13), title.upper(), fontsize=9.5,
            fontname=FONT_B, color=(1, 1, 1),
        )
        self.y += h + 8

    def field_grid(self, pairs: list[tuple[str, str]], cols: int = 2) -> None:
        """Label/value pairs in an N-column grid."""
        col_w = CONTENT_W / cols
        fontsize = 8.5
        row_h = 22.0
        for i in range(0, len(pairs), cols):
            self._ensure(row_h)
            row = pairs[i : i + cols]
            for j, (label, value) in enumerate(row):
                x = MARGIN + j * col_w
                self.page.insert_text(
                    (x, self.y + 8), label, fontsize=7,
                    fontname=FONT_B, color=GRAY,
                )
                val_lines = self._wrap(value or "—", col_w - 12, fontsize)
                self.page.insert_text(
                    (x, self.y + 18), val_lines[0], fontsize=fontsize,
                    fontname=FONT, color=DARK,
                )
            self.y += row_h
        self.y += 4

    def labeled_text(self, label: str, text: str) -> None:
        fontsize = 9.0
        line_h = fontsize * 1.35
        self._ensure(line_h * 2 + 14)
        self.page.insert_text(
            (MARGIN, self.y + 8), label, fontsize=7.5,
            fontname=FONT_B, color=GRAY,
        )
        self.y += 14
        lines = self._wrap(text.strip() or "—", CONTENT_W, fontsize)
        for line in lines:
            self._ensure(line_h)
            self.page.insert_text(
                (MARGIN, self.y + fontsize), line, fontsize=fontsize,
                fontname=FONT, color=DARK,
            )
            self.y += line_h
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
            self._ensure(h)
            if fill:
                self.page.draw_rect(
                    fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + h),
                    color=None, fill=fill,
                )
            x = MARGIN
            for idx, cell in enumerate(cells):
                lines = self._wrap(str(cell), widths[idx] - 2 * pad, fontsize, fname)
                ty = self.y + pad + fontsize
                for line in lines:
                    self.page.insert_text(
                        (x + pad, ty), line, fontsize=fontsize,
                        fontname=fname, color=DARK,
                    )
                    ty += fontsize * 1.3
                x += widths[idx]
            self.page.draw_line(
                fitz.Point(MARGIN, self.y + h), fitz.Point(PAGE_W - MARGIN, self.y + h),
                color=LINE, width=0.5,
            )
            self.y += h

        draw_row(headers, FONT_B, (0.91, 0.96, 0.95))
        for i, r in enumerate(rows):
            draw_row(r, FONT, LIGHT_ROW if i % 2 else None)
        self.y += 8

    def spacer(self, h: float = 6.0) -> None:
        self.y += h

    def signature_block(
        self,
        signed_line: str,
        referring_physician: str,
    ) -> None:
        self._ensure(90)
        self.spacer(10)
        self.page.draw_line(
            fitz.Point(MARGIN, self.y), fitz.Point(PAGE_W - MARGIN, self.y),
            color=LINE, width=0.7,
        )
        self.spacer(16)
        self.page.insert_text(
            (MARGIN, self.y), signed_line, fontsize=9,
            fontname=FONT_B, color=DARK,
        )
        self.spacer(34)
        line_w = 220.0
        self.page.draw_line(
            fitz.Point(MARGIN, self.y), fitz.Point(MARGIN + line_w, self.y),
            color=DARK, width=0.7,
        )
        self.page.draw_line(
            fitz.Point(PAGE_W - MARGIN - 120, self.y),
            fitz.Point(PAGE_W - MARGIN, self.y),
            color=DARK, width=0.7,
        )
        self.spacer(10)
        self.page.insert_text(
            (MARGIN, self.y),
            f"Referring Physician Signature ({referring_physician})",
            fontsize=7.5, fontname=FONT, color=GRAY,
        )
        self.page.insert_text(
            (PAGE_W - MARGIN - 120, self.y), "Date", fontsize=7.5,
            fontname=FONT, color=GRAY,
        )
        self.spacer(8)

    def finish(self) -> bytes:
        total = self.doc.page_count
        for i, page in enumerate(self.doc):
            label = f"Page {i + 1} of {total}"
            w = fitz.get_text_length(label, fontname=FONT, fontsize=8)
            page.insert_text(
                ((PAGE_W - w) / 2, PAGE_H - 22), label, fontsize=8,
                fontname=FONT, color=GRAY,
            )
        return self.doc.tobytes()


# ---------------------------------------------------------------------------
# Data assembly
# ---------------------------------------------------------------------------


def _fetch_measurements(appointment_id: Optional[str]) -> list[dict[str, Any]]:
    aid = (appointment_id or "").strip()
    if not aid:
        return []
    try:
        resp = _sb_execute(lambda: _q("measurements", appointment_id=aid).execute())
    except HTTPException:
        raise
    except Exception:
        return []
    return resp.data or []


def _previous_note(note: dict[str, Any]) -> Optional[dict[str, Any]]:
    try:
        resp = _sb_execute(
            lambda: supabase.table("clinical_notes")
            .select("*")
            .eq("patient_id", note["patient_id"])
            .eq("clinic_id", note["clinic_id"])
            .eq("note_type", note.get("note_type") or "daily_note")
            .lt("created_at", note.get("created_at") or "9999-01-01")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception:
        return None
    rows = resp.data or []
    return rows[0] if rows else None


def _outcome_results(patient_id: str, clinic_id: str) -> dict[str, list[dict[str, Any]]]:
    """form_type → results newest-first (max 2 per form)."""
    try:
        resp = _sb_execute(
            lambda: supabase.table("outcome_measure_results")
            .select("form_type,score,percentage,completed_at")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .order("completed_at", desc=True)
            .limit(40)
            .execute()
        )
    except HTTPException:
        raise
    except Exception:
        return {}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in resp.data or []:
        ft = str(row.get("form_type") or "").strip().lower()
        if not ft:
            continue
        grouped.setdefault(ft, [])
        if len(grouped[ft]) < 2:
            grouped[ft].append(row)
    return grouped


def _soc_and_visits(
    patient_id: str, clinic_id: str, note_created: str
) -> tuple[str, str, str]:
    """Returns (original_eval_date, soc_date, visits_from_soc)."""
    original_eval = "—"
    try:
        ev = supabase_execute(
            lambda: supabase.table("clinical_notes")
            .select("created_at")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .eq("note_type", "initial_evaluation")
            .order("created_at")
            .limit(1)
            .execute()
        )
        rows = ev.data or []
        if rows:
            original_eval = _fmt_date(rows[0].get("created_at"))
    except Exception:
        pass

    soc_date = "—"
    visits = "—"
    try:
        appts = supabase_execute(
            lambda: supabase.table("appointments")
            .select("id,start_time,status")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .neq("status", "cancelled")
            .lte("start_time", note_created)
            .order("start_time")
            .execute()
        )
        rows = appts.data or []
        if rows:
            soc_date = _fmt_date(rows[0].get("start_time"))
            visits = str(len(rows))
    except Exception:
        pass

    return original_eval, soc_date, visits


def _rom_rows(
    current: list[dict[str, Any]], previous: list[dict[str, Any]]
) -> list[list[str]]:
    """Two-column R/L layout with previous findings."""
    prev_index: dict[tuple[str, str], dict[str, Any]] = {}
    for m in previous:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("rom") or []:
            prev_index[(bp, str(e.get("label") or ""))] = e

    rows: list[list[str]] = []
    for m in current:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("rom") or []:
            label = str(e.get("label") or "")
            prev = prev_index.get((bp, label)) or {}

            def fmt(entry: dict[str, Any], side: str) -> str:
                a = entry.get(f"{side}_active")
                p_ = entry.get(f"{side}_passive")
                parts = []
                if a is not None:
                    parts.append(f"A {a}°")
                if p_ is not None:
                    parts.append(f"P {p_}°")
                return " / ".join(parts) or "—"

            rows.append(
                [
                    f"{bp} — {label}",
                    fmt(e, "right"),
                    fmt(e, "left"),
                    fmt(prev, "right") if prev else "—",
                    fmt(prev, "left") if prev else "—",
                ]
            )
    return rows


def _strength_rows(
    current: list[dict[str, Any]], previous: list[dict[str, Any]]
) -> list[list[str]]:
    prev_index: dict[tuple[str, str], dict[str, Any]] = {}
    for m in previous:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("strength") or []:
            prev_index[(bp, str(e.get("label") or ""))] = e

    rows: list[list[str]] = []
    for m in current:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("strength") or []:
            label = str(e.get("label") or "")
            prev = prev_index.get((bp, label)) or {}
            rows.append(
                [
                    f"{bp} — {label}",
                    str(e.get("right") or "—"),
                    str(e.get("left") or "—"),
                    str(prev.get("right") or "—"),
                    str(prev.get("left") or "—"),
                ]
            )
    return rows


def _functional_rows(
    current: list[dict[str, Any]], previous: list[dict[str, Any]]
) -> list[list[str]]:
    prev_index: dict[tuple[str, str], dict[str, Any]] = {}
    for m in previous:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("functional_outcomes") or []:
            prev_index[(bp, str(e.get("label") or ""))] = e

    rows: list[list[str]] = []
    for m in current:
        bp = str(m.get("body_part") or "").strip()
        for e in m.get("functional_outcomes") or []:
            label = str(e.get("label") or "")
            prev = prev_index.get((bp, label)) or {}
            rows.append(
                [
                    f"{bp} — {label}",
                    str(e.get("score") or "—"),
                    str(prev.get("score") or "—"),
                ]
            )
    return rows


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/clinical-notes/{note_id}/pdf")
def export_clinical_note_pdf(note_id: str, clinic: ClinicUserDep):
    note = _one("clinical_notes", id=note_id.strip())
    if not note:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    if str(note.get("clinic_id") or "") != clinic.clinic_id:
        raise HTTPException(status_code=403, detail="Note does not belong to this clinic")

    patient = _one("patients", id=str(note.get("patient_id") or "")) or {}
    clinic_row = _one("clinics", id=clinic.clinic_id) or {}

    author_cu = _one("clinic_users", id=str(note.get("author_id") or ""))
    signer_cu = (
        _one("clinic_users", id=str(note.get("signed_by") or ""))
        if note.get("signed_by")
        else None
    )
    signer_name = _clinic_user_name(signer_cu or author_cu)

    # Credentials from the supervising PT (or signer match in clinicians)
    credentials = ""
    sup_id = str(note.get("supervising_pt_id") or "").strip()
    if sup_id:
        sup = _one("clinicians", id=sup_id)
        if sup and str(sup.get("title") or "").strip():
            credentials = str(sup["title"]).strip()

    prev_note = _previous_note(note)
    cur_meas = _fetch_measurements(note.get("appointment_id"))
    prev_meas = _fetch_measurements(prev_note.get("appointment_id")) if prev_note else []

    outcomes = _outcome_results(
        str(note.get("patient_id") or ""), clinic.clinic_id
    )

    note_created = str(note.get("created_at") or "")
    original_eval, soc_date, visits = _soc_and_visits(
        str(note.get("patient_id") or ""), clinic.clinic_id, note_created or "9999-01-01"
    )

    patient_name = (
        f"{str(patient.get('first_name') or '').strip()} "
        f"{str(patient.get('last_name') or '').strip()}"
    ).strip() or "Patient"

    doc_date = _fmt_date(note.get("signed_at") or note.get("created_at"))
    note_type = str(note.get("note_type") or "daily_note").strip().lower()
    title = NOTE_TITLES.get(note_type, "Physical Therapy Clinical Note")

    builder = NotePdfBuilder(
        {
            "clinic_name": str(clinic_row.get("name") or "Clinic"),
            "clinic_address": str(clinic_row.get("address") or ""),
            "clinic_phone": (
                f"Phone: {clinic_row.get('phone')}" if clinic_row.get("phone") else ""
            ),
            "clinic_fax": "",
            "title": title,
            "patient_name": patient_name,
            "patient_dob": _fmt_date(patient.get("date_of_birth")),
            "doc_date": doc_date,
        }
    )

    # -- Header field grid ----------------------------------------------------
    builder.field_grid(
        [
            ("REFERRING PHYSICIAN / NPP", str(patient.get("referring_provider") or "—")),
            ("DIAGNOSIS (ICD10)", str(patient.get("primary_complaint") or "—")),
            ("DATE OF ORIGINAL EVAL", original_eval),
            ("TREATMENT DIAGNOSIS", str(patient.get("primary_complaint") or "—")),
            ("SOC DATE", soc_date),
            ("VISITS FROM SOC", visits),
            ("INSURANCE NAME", str(patient.get("insurance_carrier") or "—")),
            ("DATE OF RECERTIFICATION", doc_date),
            ("POLICY / GROUP NO.", (
                f"{patient.get('insurance_policy_number') or '—'}"
                f" / {patient.get('insurance_group_number') or '—'}"
            )),
            ("INJURY / ONSET / CHANGE OF STATUS DATE", "—"),
        ],
        cols=2,
    )

    # -- 1. Subjective ----------------------------------------------------------
    builder.section_header("Subjective")
    builder.labeled_text(
        "HISTORY OF PRESENT CONDITION / MECHANISM OF INJURY",
        str(patient.get("primary_complaint") or "—"),
    )
    builder.labeled_text(
        "CURRENT COMPLAINTS / GAINS", str(note.get("subjective") or "—")
    )
    builder.field_grid(
        [
            ("HOME HEALTH CARE", "No"),
            ("MENTAL STATUS / COGNITIVE FUNCTION APPEARS IMPAIRED", "No"),
        ],
        cols=2,
    )
    if str(patient.get("notes") or "").strip():
        builder.labeled_text("MEDICAL HISTORY", str(patient.get("notes")))

    # -- 2. Objective ------------------------------------------------------------
    builder.section_header("Objective")

    outcome_rows: list[list[str]] = []
    for ft, results in outcomes.items():
        name = OUTCOME_TOOL_NAMES.get(ft, ft.upper())
        cur = results[0] if results else {}
        prev = results[1] if len(results) > 1 else {}

        def score_str(r: dict[str, Any]) -> str:
            if not r:
                return "—"
            score = r.get("score")
            pct = r.get("percentage")
            base = f"{score}" if score is not None else "—"
            if pct is not None:
                base += f" ({pct}%)"
            return f"{base} — {_fmt_date(r.get('completed_at'))}"

        outcome_rows.append([name, score_str(cur), score_str(prev)])

    if outcome_rows:
        builder.labeled_text("OUTCOME MEASUREMENT TOOLS", "")
        builder.table(
            ["Tool", "Current Score", "Previous Score"],
            outcome_rows,
            [0.4, 0.3, 0.3],
        )

    rom_rows = _rom_rows(cur_meas, prev_meas)
    if rom_rows:
        builder.labeled_text("RANGE OF MOTION", "")
        builder.table(
            ["Region / Motion", "Right", "Left", "Prev Right", "Prev Left"],
            rom_rows,
            [0.36, 0.16, 0.16, 0.16, 0.16],
        )

    strength_rows = _strength_rows(cur_meas, prev_meas)
    if strength_rows:
        builder.labeled_text("STRENGTH (GROSS MUSCLE TESTS)", "")
        builder.table(
            ["Region / Muscle Group", "Right", "Left", "Prev Right", "Prev Left"],
            strength_rows,
            [0.36, 0.16, 0.16, 0.16, 0.16],
        )

    func_rows = _functional_rows(cur_meas, prev_meas)
    if func_rows:
        builder.labeled_text("SPECIAL TESTS / FUNCTIONAL MEASURES", "")
        builder.table(
            ["Test", "Current Finding", "Previous Finding"],
            func_rows,
            [0.44, 0.28, 0.28],
        )

    palpation = "; ".join(
        str(m.get("notes")) for m in cur_meas if str(m.get("notes") or "").strip()
    )
    pain_vals = [m.get("pain_nrs") for m in cur_meas if m.get("pain_nrs") is not None]
    if pain_vals:
        builder.field_grid(
            [("PAIN (NRS 0–10)", ", ".join(str(v) for v in pain_vals))], cols=2
        )
    builder.labeled_text("PALPATION / COMMENTS", palpation or "—")
    builder.labeled_text("OBJECTIVE FINDINGS", str(note.get("objective") or "—"))

    # -- 3. Assessment -------------------------------------------------------------
    builder.section_header("Assessment")
    builder.labeled_text("ASSESSMENT / DIAGNOSIS", str(note.get("assessment") or "—"))
    builder.field_grid(
        [
            ("PATIENT DEMONSTRATES COMPLIANCE WITH HEP", "Yes"),
            ("REHAB POTENTIAL", "Good"),
        ],
        cols=2,
    )

    # -- 4. Plan --------------------------------------------------------------------
    builder.section_header("Plan")
    builder.labeled_text("TREATMENT PLAN / PROCEDURES AND MODALITIES", str(note.get("plan") or "—"))
    builder.labeled_text("CERTIFICATION OF MEDICAL NECESSITY", CERT_STATEMENT)

    # -- Signature -------------------------------------------------------------------
    if str(note.get("status") or "").lower() == "signed" and note.get("signed_at"):
        sd, st = _fmt_datetime(note.get("signed_at"))
        cred_part = f", {credentials}" if credentials else ""
        signed_line = f"Electronically Signed by {signer_name}{cred_part} on {sd} at {st}"
    else:
        signed_line = "UNSIGNED DRAFT — not valid for billing or medical record"

    builder.signature_block(
        signed_line, str(patient.get("referring_provider") or "Referring Physician")
    )

    pdf_bytes = builder.finish()

    safe_patient = "".join(
        c for c in patient_name if c.isalnum() or c in (" ", "-", "_")
    ).strip().replace(" ", "_") or "patient"
    filename = f"{safe_patient}_{note_type}_{doc_date.replace('/', '-')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
