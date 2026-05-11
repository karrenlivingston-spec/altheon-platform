"""Clinical SOAP notes API (mounted under /api)."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()

_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

_SOAP_REVIEW_SYSTEM = """You are a clinical documentation reviewer for physical therapy \
and chiropractic notes. Review the submitted SOAP note and determine if it meets \
documentation standards.

Respond ONLY with valid JSON in this exact format:
{
  "passed": true/false,
  "feedback": "specific feedback string or empty string if passed"
}

A note PASSES if ALL of these are true:
- All four SOAP sections (Subjective, Objective, Assessment, Plan) are present and \
contain substantive content (not blank or single words)
- Objective section contains measurable data such as ROM measurements, strength \
grades (0-5), pain scores, or functional measures
- Assessment provides clinical reasoning that connects the subjective and objective \
findings
- Plan section contains specific interventions (not vague language like \
'continue treatment')

A note FAILS if any section is missing, blank, or lacks clinical specificity. \
List each specific issue in the feedback."""


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_json_object(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    # Fallback: first {...} block
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    return json.loads(text)


def _call_claude_review_soap(
    subjective: str,
    objective: str,
    assessment: str,
    plan: str,
) -> tuple[bool, str]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured",
        )

    try:
        import anthropic
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="anthropic package is not installed",
        ) from exc

    user_msg = (
        f"Subjective: {subjective}\n"
        f"Objective: {objective}\n"
        f"Assessment: {assessment}\n"
        f"Plan: {plan}"
    )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=_ANTHROPIC_MODEL,
        max_tokens=2048,
        system=_SOAP_REVIEW_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )

    blocks = getattr(message, "content", None) or []
    text_parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            text_parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            text_parts.append(str(block["text"]))
    raw = "".join(text_parts).strip()

    try:
        data = _extract_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI review returned invalid JSON: {exc}",
        ) from exc

    passed = bool(data.get("passed"))
    feedback = data.get("feedback")
    if feedback is None:
        feedback = ""
    return passed, str(feedback)


def _patient_display_name(row: dict[str, Any]) -> str:
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "—"


def _author_display_name(row: Optional[dict[str, Any]]) -> str:
    if not row:
        return "—"
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "—"


def _load_clinic_users_maps(
    author_ids: list[str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Match clinic_users by primary id or by user_id (author_id may be either)."""
    by_cu_id: dict[str, dict[str, Any]] = {}
    by_user_id: dict[str, dict[str, Any]] = {}
    if not author_ids:
        return by_cu_id, by_user_id

    try:
        r1 = (
            supabase.table("clinic_users")
            .select("id,user_id,first_name,last_name")
            .in_("id", author_ids)
            .execute()
        )
        _handle_supabase_error(r1)
        for row in r1.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("id") or "").strip()
            uid = str(row.get("user_id") or "").strip()
            if cid:
                by_cu_id[cid] = row
            if uid:
                by_user_id[uid] = row

        missing = [a for a in author_ids if a not in by_cu_id and a not in by_user_id]
        if missing:
            r2 = (
                supabase.table("clinic_users")
                .select("id,user_id,first_name,last_name")
                .in_("user_id", missing)
                .execute()
            )
            _handle_supabase_error(r2)
            for row in r2.data or []:
                if not isinstance(row, dict):
                    continue
                cid = str(row.get("id") or "").strip()
                uid = str(row.get("user_id") or "").strip()
                if cid:
                    by_cu_id[cid] = row
                if uid:
                    by_user_id[uid] = row
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return by_cu_id, by_user_id


def _resolve_clinic_user_row(
    author_id: str,
    by_cu_id: dict[str, dict[str, Any]],
    by_user_id: dict[str, dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if author_id in by_cu_id:
        return by_cu_id[author_id]
    if author_id in by_user_id:
        return by_user_id[author_id]
    return None


def _enrich_notes_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    patient_ids = list(
        {str(r["patient_id"]) for r in rows if r.get("patient_id")}
    )
    author_ids = list({str(r["author_id"]) for r in rows if r.get("author_id")})

    patients_map: dict[str, dict[str, Any]] = {}
    try:
        if patient_ids:
            presp = (
                supabase.table("patients")
                .select("id,first_name,last_name")
                .in_("id", patient_ids)
                .execute()
            )
            _handle_supabase_error(presp)
            for pr in presp.data or []:
                if isinstance(pr, dict) and pr.get("id"):
                    patients_map[str(pr["id"])] = pr
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    by_cu_id, by_user_id = _load_clinic_users_maps(author_ids)

    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        pid = str(r.get("patient_id") or "")
        aid = str(r.get("author_id") or "")
        pt = patients_map.get(pid)
        item["patient_name"] = _patient_display_name(pt) if pt else "—"
        cu = _resolve_clinic_user_row(aid, by_cu_id, by_user_id)
        item["author_name"] = _author_display_name(cu)
        out.append(item)
    return out


_PATCHABLE_STATUSES = frozenset({"draft", "ai_flagged", "needs_correction"})
_BLOCKED_PATCH_STATUSES = frozenset(
    {"ai_review_pending", "ready_for_review", "signed"}
)


class CreateClinicalNoteBody(BaseModel):
    patient_id: str
    clinic_id: str
    author_id: str
    supervising_pt_id: Optional[str] = None
    appointment_id: Optional[str] = None
    note_type: Optional[str] = None
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None


class PatchClinicalNoteBody(BaseModel):
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    supervising_pt_id: Optional[str] = None
    note_type: Optional[str] = None


class SignNoteBody(BaseModel):
    signed_by: str = Field(..., min_length=1)


class RequestCorrectionBody(BaseModel):
    correction_notes: str = Field(..., min_length=1)


_NOTE_TYPES = frozenset(
    {
        "daily_note",
        "initial_evaluation",
        "progress_note",
        "discharge_note",
    }
)


def _validate_note_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    if v not in _NOTE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid note_type; allowed: {sorted(_NOTE_TYPES)}",
        )
    return v


def _resolve_clinic_users_pk(
    raw_id: str,
    clinic_id: str,
    *,
    not_found_detail: str,
) -> str:
    """Map Supabase auth user_id or clinic_users.id to clinic_users.id for this clinic."""
    key = raw_id.strip()
    cid = clinic_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Invalid clinic user reference")

    try:
        by_id = (
            supabase.table("clinic_users")
            .select("id")
            .eq("id", key)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(by_id)
        rows = by_id.data or []
        if rows:
            rid = str(rows[0].get("id") or "").strip()
            if rid:
                return rid

        by_uid = (
            supabase.table("clinic_users")
            .select("id")
            .eq("user_id", key)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(by_uid)
        rows = by_uid.data or []
        if rows:
            rid = str(rows[0].get("id") or "").strip()
            if rid:
                return rid
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    raise HTTPException(status_code=404, detail=not_found_detail)


@router.post("/clinical-notes")
def create_clinical_note(body: CreateClinicalNoteBody):
    patient_id = body.patient_id.strip()
    clinic_id = body.clinic_id.strip()
    author_id = body.author_id.strip()
    if not patient_id or not clinic_id or not author_id:
        raise HTTPException(
            status_code=400,
            detail="patient_id, clinic_id, and author_id are required",
        )

    nt = _validate_note_type(body.note_type)

    resolved_author = _resolve_clinic_users_pk(
        author_id,
        clinic_id,
        not_found_detail="Author not found in clinic users",
    )

    row: dict[str, Any] = {
        "patient_id": patient_id,
        "clinic_id": clinic_id,
        "author_id": resolved_author,
        "status": "draft",
    }
    if nt:
        row["note_type"] = nt
    if body.supervising_pt_id is not None:
        s = body.supervising_pt_id.strip()
        if s:
            row["supervising_pt_id"] = _resolve_clinic_users_pk(
                s,
                clinic_id,
                not_found_detail="Supervising PT not found in clinic users",
            )
    if body.appointment_id is not None:
        a = body.appointment_id.strip()
        if a:
            row["appointment_id"] = a
    for key in ("subjective", "objective", "assessment", "plan"):
        val = getattr(body, key)
        if val is not None:
            row[key] = val

    try:
        ins = supabase.table("clinical_notes").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Insert returned no row")
    return rows[0]


@router.get("/clinical-notes/{note_id}")
def get_clinical_note(note_id: str):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return rows[0]


@router.patch("/clinical-notes/{note_id}")
def patch_clinical_note(note_id: str, body: PatchClinicalNoteBody):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    st = str(crows[0].get("status") or "").strip().lower()
    if st in _BLOCKED_PATCH_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit note while status is '{st}'",
        )
    if st not in _PATCHABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit note while status is '{st}'",
        )

    payload = body.model_dump(exclude_unset=True)
    if "note_type" in payload:
        payload["note_type"] = _validate_note_type(payload["note_type"])

    data = {k: v for k, v in payload.items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    data["updated_at"] = _now_iso()

    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return urows[0]


@router.post("/clinical-notes/{note_id}/submit")
def submit_clinical_note(note_id: str):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    note = rows[0]
    subjective = str(note.get("subjective") or "")
    objective = str(note.get("objective") or "")
    assessment = str(note.get("assessment") or "")
    plan = str(note.get("plan") or "")

    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured",
        )
    try:
        import anthropic  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="anthropic package is not installed",
        ) from exc

    pending_update = {
        "status": "ai_review_pending",
        "updated_at": _now_iso(),
    }
    try:
        upd_p = (
            supabase.table("clinical_notes")
            .update(pending_update)
            .eq("id", nid)
            .execute()
        )
        _handle_supabase_error(upd_p)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        passed, feedback = _call_claude_review_soap(
            subjective, objective, assessment, plan
        )
    except HTTPException as exc:
        fail_update = {
            "status": "ai_flagged",
            "ai_feedback": (exc.detail if isinstance(exc.detail, str) else str(exc.detail)),
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        try:
            supabase.table("clinical_notes").update(fail_update).eq("id", nid).execute()
        except Exception:
            pass
        raise
    except Exception as exc:
        fail_update = {
            "status": "ai_flagged",
            "ai_feedback": f"Automated review failed: {exc}",
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        try:
            supabase.table("clinical_notes").update(fail_update).eq("id", nid).execute()
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if passed:
        final_update: dict[str, Any] = {
            "status": "ready_for_review",
            "ai_feedback": None,
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    else:
        final_update = {
            "status": "ai_flagged",
            "ai_feedback": feedback,
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }

    try:
        upd_f = (
            supabase.table("clinical_notes")
            .update(final_update)
            .eq("id", nid)
            .execute()
        )
        _handle_supabase_error(upd_f)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    out_rows = upd_f.data or []
    if not out_rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return out_rows[0]


@router.post("/clinical-notes/{note_id}/sign")
def sign_clinical_note(note_id: str, body: SignNoteBody):
    nid = note_id.strip()
    signed_by = body.signed_by.strip()
    if not nid or not signed_by:
        raise HTTPException(status_code=400, detail="note_id and signed_by are required")

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    st = str(crows[0].get("status") or "").strip().lower()
    if st != "ready_for_review":
        raise HTTPException(
            status_code=409,
            detail="Note must be in ready_for_review status to sign",
        )

    data = {
        "status": "signed",
        "signed_at": _now_iso(),
        "signed_by": signed_by,
        "updated_at": _now_iso(),
    }
    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return urows[0]


@router.post("/clinical-notes/{note_id}/request-correction")
def request_correction(note_id: str, body: RequestCorrectionBody):
    nid = note_id.strip()
    notes = body.correction_notes.strip()
    if not nid or not notes:
        raise HTTPException(
            status_code=400,
            detail="note_id and correction_notes are required",
        )

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    st = str(crows[0].get("status") or "").strip().lower()
    if st != "ready_for_review":
        raise HTTPException(
            status_code=409,
            detail="Note must be in ready_for_review status to request correction",
        )

    data = {
        "status": "needs_correction",
        "correction_notes": notes,
        "updated_at": _now_iso(),
    }
    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return urows[0]


@router.get("/clinics/{clinic_id}/clinical-notes")
def list_clinic_clinical_notes(
    clinic_id: str,
    status: Optional[str] = Query(default=None),
    author_id: Optional[str] = Query(default=None),
):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Invalid clinic_id")

    try:
        q = supabase.table("clinical_notes").select("*").eq("clinic_id", cid)
        if status is not None and str(status).strip():
            q = q.eq("status", str(status).strip())
        if author_id is not None and str(author_id).strip():
            q = q.eq("author_id", str(author_id).strip())
        resp = q.order("created_at", desc=True).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    return _enrich_notes_rows(rows)


@router.get("/patients/{patient_id}/clinical-notes")
def list_patient_clinical_notes(patient_id: str):
    pid = patient_id.strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Invalid patient_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("patient_id", pid)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    return _enrich_notes_rows(rows)
