"""APS (Athlete Performance Score) — Kinvent PDF upload and session retrieval."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header
from app.retry_utils import supabase_execute
from app.services.aps_parser import (
    ApsParseError,
    flatten_findings,
    parse_kinvent_pdf,
    parse_session_date,
)
from app.services.aps_rules import (
    apply_aps_rules,
    build_session_summary_from_findings,
    deficient_side,
)
from app.utils.auth_users import get_email_from_token, get_user_id_from_token

router = APIRouter()
logger = logging.getLogger(__name__)

_MAX_PDF_BYTES = 20 * 1024 * 1024
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 100

_TIER_COUNT_KEYS = ("high", "moderate", "low")


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _assert_patient_in_clinic(patient_id: str, clinic_id: str) -> None:
    try:
        resp = supabase_execute(
            lambda: (
                supabase.table("patient_clinic_access")
                .select("id")
                .eq("patient_id", patient_id)
                .eq("clinic_id", clinic_id)
                .limit(1)
                .execute()
            )
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
        resp = supabase_execute(
            lambda: (
                supabase.table("clinicians")
                .select("id")
                .eq("clinic_id", clinic_id)
                .eq("email", email)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
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


def _count_exact(resp: Any) -> int:
    count = int(getattr(resp, "count", None) or 0)
    if count == 0 and resp.data is not None:
        count = len(resp.data)
    return count


def _nested_row(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, dict) else {}


def _patient_display_name(first: Any, last: Any) -> str:
    return f"{str(first or '').strip()} {str(last or '').strip()}".strip()


def _empty_tier_counts() -> dict[str, int]:
    return {key: 0 for key in _TIER_COUNT_KEYS}


def _increment_tier_count(counts: dict[str, int], tier: Any) -> None:
    if tier is None:
        return
    key = str(tier).strip().lower()
    if key in counts:
        counts[key] += 1


def _side_label(left: Any, right: Any) -> Optional[str]:
    side = deficient_side(left, right)
    if not side:
        return None
    return side.capitalize()


def _compute_clinic_session_stats(clinic_id: str) -> dict[str, Any]:
    """Aggregate APS stats for a clinic (count queries + findings for tier breakdown)."""
    cid = clinic_id.strip()
    month_start = date.today().replace(day=1).isoformat()
    volume_start = (date.today() - timedelta(weeks=8)).isoformat()

    try:
        total_resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("id", count="exact")
                .eq("clinic_id", cid)
                .execute()
            )
        )
        _handle_supabase_error(total_resp)
        month_resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("id", count="exact")
                .eq("clinic_id", cid)
                .gte("session_date", month_start)
                .execute()
            )
        )
        _handle_supabase_error(month_resp)
        patient_resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("patient_id")
                .eq("clinic_id", cid)
                .execute()
            )
        )
        _handle_supabase_error(patient_resp)
        sessions_resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("id, session_date, patients(first_name, last_name)")
                .eq("clinic_id", cid)
                .execute()
            )
        )
        _handle_supabase_error(sessions_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    total_sessions = _count_exact(total_resp)
    sessions_this_month = _count_exact(month_resp)
    patient_ids = {
        str(row.get("patient_id") or "").strip()
        for row in (patient_resp.data or [])
        if str(row.get("patient_id") or "").strip()
    }

    session_ids: list[str] = []
    session_patient_names: dict[str, str] = {}
    testing_volume_counts: dict[str, int] = {}
    for row in sessions_resp.data or []:
        sid = str(row.get("id") or "").strip()
        if not sid:
            continue
        session_ids.append(sid)
        patient = _nested_row(row.get("patients"))
        session_patient_names[sid] = (
            _patient_display_name(patient.get("first_name"), patient.get("last_name"))
            or "Unknown athlete"
        )
        session_day = str(row.get("session_date") or "")[:10]
        if session_day and session_day >= volume_start:
            testing_volume_counts[session_day] = testing_volume_counts.get(session_day, 0) + 1

    testing_volume = [
        {"date": day, "count": testing_volume_counts[day]}
        for day in sorted(testing_volume_counts.keys())
    ]

    tier_counts = _empty_tier_counts()
    notable_all: list[dict[str, Any]] = []
    if session_ids:
        try:
            fresp = supabase_execute(
                lambda: (
                    supabase.table("aps_findings")
                    .select("*")
                    .in_("aps_session_id", session_ids)
                    .execute()
                )
            )
            _handle_supabase_error(fresp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        findings_by_session: dict[str, list[dict[str, Any]]] = {
            sid: [] for sid in session_ids
        }
        for row in fresp.data or []:
            sid = str(row.get("aps_session_id") or "").strip()
            if sid in findings_by_session:
                findings_by_session[sid].append(_shape_finding(row))

        for sid in session_ids:
            session_findings = findings_by_session.get(sid, [])
            summary = build_session_summary_from_findings(session_findings)
            _increment_tier_count(tier_counts, summary.get("overall_tier"))
            outlier_keys = {
                (
                    str(item.get("test_type") or ""),
                    str(item.get("metric_name") or ""),
                )
                for item in (summary.get("outlier_findings") or [])
            }
            patient_name = session_patient_names.get(sid, "Unknown athlete")
            for finding in session_findings:
                if not finding.get("is_notable"):
                    continue
                test_type = str(finding.get("test_type") or "")
                metric_name = str(finding.get("metric_name") or "")
                asym = finding.get("asymmetry_pct")
                asym_val = float(asym) if asym is not None else None
                notable_all.append(
                    {
                        "patient_name": patient_name,
                        "test_type": test_type,
                        "metric_name": metric_name,
                        "asymmetry_pct": asym_val,
                        "side": _side_label(
                            finding.get("left_value"),
                            finding.get("right_value"),
                        ),
                        "is_outlier": (test_type, metric_name) in outlier_keys,
                    }
                )

    notable_all.sort(
        key=lambda row: float(row.get("asymmetry_pct") or 0),
        reverse=True,
    )

    return {
        "total_sessions": total_sessions,
        "sessions_this_month": sessions_this_month,
        "distinct_patients": len(patient_ids),
        "tier_counts": tier_counts,
        "notable_findings_count": len(notable_all),
        "notable_findings": notable_all[:5],
        "testing_volume": testing_volume,
    }


def _shape_clinic_session_row(row: dict[str, Any]) -> dict[str, Any]:
    shaped = dict(row)
    patient = _nested_row(shaped.pop("patients", None))
    first = patient.get("first_name")
    last = patient.get("last_name")
    shaped["patient_first_name"] = first
    shaped["patient_last_name"] = last
    shaped["patient_name"] = _patient_display_name(first, last) or None
    shaped["patient_sport"] = patient.get("sport")
    shaped.pop("raw_extracted_json", None)
    return shaped


def _shape_finding(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "aps_session_id": row.get("aps_session_id"),
        "test_type": row.get("test_type"),
        "metric_name": row.get("metric_name"),
        "left_value": row.get("left_value"),
        "right_value": row.get("right_value"),
        "combined_value": row.get("combined_value"),
        "unit": row.get("unit"),
        "asymmetry_pct": row.get("asymmetry_pct"),
        "is_notable": row.get("is_notable"),
        "confidence_tier": row.get("confidence_tier"),
        "recommended_next_test": row.get("recommended_next_test"),
        "created_at": row.get("created_at"),
    }


def _load_session_with_findings(session_id: str) -> dict[str, Any]:
    try:
        sresp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("*")
                .eq("id", session_id)
                .limit(1)
                .execute()
            )
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
        fresp = supabase_execute(
            lambda: (
                supabase.table("aps_findings")
                .select("*")
                .eq("aps_session_id", session_id)
                .order("created_at")
                .execute()
            )
        )
        _handle_supabase_error(fresp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    session["findings"] = [_shape_finding(r) for r in (fresp.data or [])]
    session["session_summary"] = build_session_summary_from_findings(session["findings"])
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
    except ApsParseError as exc:
        logger.warning("APS parse failed patient_id=%s: %s", pid, exc)
        detail = str(exc)
        if exc.parse_error:
            detail = f"{detail} ({exc.parse_error})"
        raise HTTPException(status_code=422, detail=detail) from exc
    except Exception as exc:
        logger.exception("APS PDF parse failed patient_id=%s", pid)
        raise HTTPException(status_code=422, detail=f"Could not parse Kinvent PDF: {exc}") from exc

    if not parsed.get("tests"):
        raise HTTPException(
            status_code=422,
            detail="No jump test data could be extracted from this PDF",
        )

    finding_rows = flatten_findings(parsed)
    rules_result = apply_aps_rules(finding_rows)
    scored = rules_result["findings"]
    session_summary = rules_result["session_summary"]

    session_date = parse_session_date(str(parsed.get("session_date") or ""))
    clinician_id = _resolve_clinician_id_optional(authorization, cid)

    raw_json = {
        k: v
        for k, v in parsed.items()
        if k not in ("llm_raw_response",)
    }

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
        ins = supabase_execute(
            lambda: supabase.table("aps_sessions").insert(session_row).execute()
        )
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
            "combined_value": row.get("combined_value"),
            "unit": row.get("unit"),
            "asymmetry_pct": row.get("asymmetry_pct"),
            "is_notable": bool(row.get("is_notable")),
            "confidence_tier": row.get("confidence_tier"),
            "recommended_next_test": row.get("recommended_next_test"),
        }
        try:
            fins = supabase_execute(
                lambda frow=frow: supabase.table("aps_findings").insert(frow).execute()
            )
            _handle_supabase_error(fins)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        frows = fins.data or []
        if frows:
            db_findings.append(_shape_finding(frows[0]))

    session["findings"] = db_findings
    session["session_summary"] = session_summary
    return session


@router.get("/sessions")
def list_clinic_aps_sessions(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(default=_DEFAULT_LIST_LIMIT, ge=0, le=_MAX_LIST_LIMIT),
    offset: int = Query(default=0, ge=0),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)
    cid = clinic_id.strip()
    stats = _compute_clinic_session_stats(cid)

    if limit == 0:
        return {
            "stats": stats,
            "total": stats["total_sessions"],
            "limit": limit,
            "offset": offset,
            "sessions": [],
        }

    try:
        resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("*, patients(first_name, last_name, sport)", count="exact")
                .eq("clinic_id", cid)
                .order("session_date", desc=True)
                .range(offset, offset + limit - 1)
                .execute()
            )
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    total = _count_exact(resp)
    sessions = [_shape_clinic_session_row(dict(r)) for r in (resp.data or [])]
    if not sessions:
        return {
            "stats": stats,
            "total": total,
            "limit": limit,
            "offset": offset,
            "sessions": [],
        }

    session_ids = [str(s["id"]) for s in sessions if s.get("id")]
    findings_by_session: dict[str, list[dict[str, Any]]] = {sid: [] for sid in session_ids}
    if session_ids:
        try:
            fresp = supabase_execute(
                lambda: (
                    supabase.table("aps_findings")
                    .select("*")
                    .in_("aps_session_id", session_ids)
                    .order("created_at")
                    .execute()
                )
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
        findings = findings_by_session.get(sid, [])
        session["findings"] = findings
        session["session_summary"] = build_session_summary_from_findings(findings)

    return {
        "stats": stats,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sessions": sessions,
    }


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
        resp = supabase_execute(
            lambda: (
                supabase.table("aps_sessions")
                .select("*")
                .eq("patient_id", pid)
                .eq("clinic_id", cid)
                .order("session_date", desc=True)
                .execute()
            )
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
            fresp = supabase_execute(
                lambda: (
                    supabase.table("aps_findings")
                    .select("*")
                    .in_("aps_session_id", session_ids)
                    .order("created_at")
                    .execute()
                )
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
        session["session_summary"] = build_session_summary_from_findings(session["findings"])

    return sessions
