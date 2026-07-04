"""APS (Athlete Performance Score) — Kinvent PDF upload and session retrieval."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header
from app.services.aps_parser import (
    flatten_findings,
    parse_kinvent_pdf,
    parse_session_date,
)
from app.services.aps_rules import apply_aps_rules
from app.utils.auth_users import get_email_from_token, get_user_id_from_token

router = APIRouter()
logger = logging.getLogger(__name__)

_MAX_PDF_BYTES = 20 * 1024 * 1024


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _assert_patient_in_clinic(patient_id: str, clinic_id: str) -> None:
    try:
        resp = (
            supabase.table("patient_clinic_access")
            .select("id")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Failed to verify patient clinic access",
        ) from exc
    if not resp.data:
        raise HTTPException(status_code=404, detail="Patient not found in clinic")


def _resolve_clinician_id_optional(
    authorization: Optional[str],
    clinic_id: str,
) -> Optional[str]:
    """Map JWT caller to clinicians.id when possible; nullable for non-clinician uploaders."""
    email = get_email_from_token(authorization or "")
    if not email:
        return None
    try:
        resp = (
            supabase.table("clinicians")
            .select("id")
            .eq("clinic_id", clinic_id)
            .eq("email", email)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        return None
    except Exception:
        logger.exception("APS clinician lookup failed clinic_id=%s", clinic_id)
        return None
    rows = resp.data or []
    if not rows:
        return None
    cid = str(rows[0].get("id") or "").strip()
    return cid or None


def _shape_finding(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "aps_session_id": row.get("aps_session_id"),
        "test_type": row.get("test_type"),
        "metric_name": row.get("metric_name"),
        "left_value": row.get("left_value"),
        "right_value": row.get("right_value"),
        "unit": row.get("unit"),
        "asymmetry_pct": row.get("asymmetry_pct"),
        "is_notable": row.get("is_notable"),
        "confidence_tier": row.get("confidence_tier"),
        "recommended_next_test": row.get("recommended_next_test"),
        "created_at": row.get("created_at"),
    }


def _load_session_with_findings(session_id: str) -> dict[str, Any]:
    try:
        sresp = (
            supabase.table("aps_sessions")
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(sresp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sessions = sresp.data or []
    if not sessions:
        raise HTTPException(status_code=404, detail="APS session not found")
    session = dict(sessions[0])

    try:
        fresp = (
            supabase.table("aps_findings")
            .select("*")
            .eq("aps_session_id", session_id)
            .order("created_at")
            .execute()
        )
        _handle_supabase_error(fresp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    session["findings"] = [_shape_finding(r) for r in (fresp.data or [])]
    return session


@router.post("/sessions/upload")
async def upload_aps_session(
    file: UploadFile = File(...),
    patient_id: str = Form(...),
    clinic_id: str = Form(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *CLINICAL_ROLES,
    )
    pid = patient_id.strip()
    cid = auth.clinic_id
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id is required")

    created_by = get_user_id_from_token(authorization or "")
    if not created_by:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    _assert_patient_in_clinic(pid, cid)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 20MB limit")

    try:
        parsed = parse_kinvent_pdf(raw)
    except Exception as exc:
        logger.exception("APS PDF parse failed patient_id=%s", pid)
        raise HTTPException(status_code=422, detail=f"Could not parse Kinvent PDF: {exc}") from exc

    finding_rows = flatten_findings(parsed)
    scored = apply_aps_rules(finding_rows)

    session_date = parse_session_date(str(parsed.get("session_date") or ""))
    clinician_id = _resolve_clinician_id_optional(authorization, cid)

    raw_json = {
        k: v for k, v in parsed.items() if k != "raw_text"
    }
    if parsed.get("unparsed_sections"):
        raw_json["unparsed_sections"] = parsed["unparsed_sections"]

    session_row: dict[str, Any] = {
        "clinic_id": cid,
        "patient_id": pid,
        "clinician_id": clinician_id,
        "session_date": session_date.isoformat(),
        "source_filename": file.filename,
        "raw_extracted_json": raw_json,
        "created_by_user_id": created_by,
    }

    try:
        ins = supabase.table("aps_sessions").insert(session_row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    inserted = ins.data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="Failed to create APS session")
    session = dict(inserted[0])
    session_id = str(session["id"])

    db_findings: list[dict[str, Any]] = []
    for row in scored:
        frow = {
            "aps_session_id": session_id,
            "test_type": row.get("test_type"),
            "metric_name": row.get("metric_name"),
            "left_value": row.get("left_value"),
            "right_value": row.get("right_value"),
            "unit": row.get("unit"),
            "asymmetry_pct": row.get("asymmetry_pct"),
            "is_notable": bool(row.get("is_notable")),
            "confidence_tier": row.get("confidence_tier"),
            "recommended_next_test": row.get("recommended_next_test"),
        }
        try:
            fins = supabase.table("aps_findings").insert(frow).execute()
            _handle_supabase_error(fins)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        frows = fins.data or []
        if frows:
            db_findings.append(_shape_finding(frows[0]))

    session["findings"] = db_findings
    return session


@router.get("/sessions/{session_id}")
def get_aps_session(
    session_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)
    sid = session_id.strip()
    session = _load_session_with_findings(sid)
    if str(session.get("clinic_id") or "") != clinic_id.strip():
        raise HTTPException(status_code=404, detail="APS session not found")
    return session


@router.get("/patients/{patient_id}/sessions")
def list_patient_aps_sessions(
    patient_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)
    pid = patient_id.strip()
    cid = clinic_id.strip()
    _assert_patient_in_clinic(pid, cid)

    try:
        resp = (
            supabase.table("aps_sessions")
            .select("*")
            .eq("patient_id", pid)
            .eq("clinic_id", cid)
            .order("session_date", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sessions = [dict(r) for r in (resp.data or [])]
    if not sessions:
        return []

    session_ids = [str(s["id"]) for s in sessions if s.get("id")]
    findings_by_session: dict[str, list[dict[str, Any]]] = {sid: [] for sid in session_ids}
    if session_ids:
        try:
            fresp = (
                supabase.table("aps_findings")
                .select("*")
                .in_("aps_session_id", session_ids)
                .order("created_at")
                .execute()
            )
            _handle_supabase_error(fresp)
            for row in fresp.data or []:
                sid = str(row.get("aps_session_id") or "")
                if sid in findings_by_session:
                    findings_by_session[sid].append(_shape_finding(row))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    for session in sessions:
        sid = str(session.get("id") or "")
        session["findings"] = findings_by_session.get(sid, [])

    return sessions
