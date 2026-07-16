"""Standardized outcome questionnaire tokens, SMS links, and response capture."""

from __future__ import annotations

import logging
import os
import secrets
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.retry_utils import supabase_execute
from app.dependencies.permissions import ALL_ROLES, enforce_clinic_role_from_auth_header
from app.sms import send_sms

router = APIRouter(prefix="/questionnaires", tags=["Questionnaires"])
logger = logging.getLogger(__name__)

_QUESTIONNAIRE_NOTE_TYPES = frozenset(
    {"initial_evaluation", "progress_note", "discharge_note"}
)
_QUESTIONNAIRE_BASE_URL = (
    os.environ.get("QUESTIONNAIRE_BASE_URL") or "https://altheon.app"
).rstrip("/")


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


def _questionnaire_for_body_region(body_region: str) -> Optional[str]:
    return questionnaire_for_body_region(body_region)


def questionnaire_for_body_region(body_region: str) -> Optional[str]:
    mapping = {
        "lumbar": "oswestry",
        "cervical": "ndi",
        "hip": "lefs",
        "knee": "lefs",
        "ankle": "lefs",
        "foot": "lefs",
        "shoulder": "quickdash",
        "elbow": "quickdash",
        "wrist": "quickdash",
        "hand": "quickdash",
    }
    br = (body_region or "").strip().lower()
    if not br:
        return None
    direct = mapping.get(br)
    if direct:
        return direct
    if "lumbar" in br or "low back" in br:
        return "oswestry"
    if "cervical" in br or "neck" in br:
        return "ndi"
    if any(k in br for k in ("hip", "knee", "ankle", "foot")):
        return "lefs"
    if any(k in br for k in ("shoulder", "elbow", "wrist", "hand")):
        return "quickdash"
    return None


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _clinic_display_name(clinic_id: str) -> str:
    try:
        resp = supabase_execute(
            lambda: supabase.table("clinics")
            .select("name, brand_name")
            .eq("id", clinic_id.strip())
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            return (
                str(row.get("name") or "").strip()
                or str(row.get("brand_name") or "").strip()
                or "your clinic"
            )
    except Exception:
        logger.exception("clinic lookup failed clinic_id=%s", clinic_id)
    return "your clinic"


def _token_row(token: str) -> Optional[dict[str, Any]]:
    t = (token or "").strip()
    if not t:
        return None
    try:
        resp = _sb_execute(
            lambda: supabase.table("questionnaire_tokens")
            .select("*")
            .eq("token", t)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except HTTPException:
        raise
    except Exception:
        logger.exception("questionnaire_tokens lookup failed")
        return None


def _unused_token_exists(clinical_note_id: str, questionnaire_type: str) -> bool:
    try:
        resp = _sb_execute(
            lambda: supabase.table("questionnaire_tokens")
            .select("id")
            .eq("clinical_note_id", clinical_note_id.strip())
            .eq("questionnaire_type", questionnaire_type.strip())
            .eq("used", False)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        logger.exception(
            "questionnaire_tokens idempotency check failed note_id=%s",
            clinical_note_id,
        )
        return True


def _numeric_responses(responses: dict[str, Any]) -> list[float]:
    values: list[float] = []
    for raw in responses.values():
        if raw is None or raw == "":
            continue
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            continue
    return values


def _calculate_score(
    questionnaire_type: str, responses: dict[str, Any]
) -> tuple[Optional[int], Optional[float]]:
    values = _numeric_responses(responses)
    if not values:
        return None, None

    qtype = questionnaire_type.strip().lower()
    total = int(round(sum(values)))

    if qtype in ("oswestry", "ndi"):
        max_score = len(values) * 5
        pct = round((total / max_score) * 100, 2) if max_score else None
        return total, pct

    if qtype == "lefs":
        max_score = len(values) * 4
        pct = round((total / max_score) * 100, 2) if max_score else None
        return total, pct

    if qtype == "quickdash":
        n = len(values)
        converted = [v + 1 for v in values]
        dash = round(((sum(converted) / n) - 1) * 25, 2)
        return total, dash

    return total, None


def maybe_send_questionnaire_sms_for_note(note: dict[str, Any]) -> None:
    """Best-effort SMS after clinical note save; never raises."""
    try:
        note_id = str(note.get("id") or "").strip()
        patient_id = str(note.get("patient_id") or "").strip()
        clinic_id = str(note.get("clinic_id") or "").strip()
        appointment_id = str(note.get("appointment_id") or "").strip() or None
        note_type = str(note.get("note_type") or "").strip().lower()
        body_region = str(note.get("body_region") or "").strip()

        if not note_id or not patient_id or not clinic_id:
            return
        if note_type not in _QUESTIONNAIRE_NOTE_TYPES:
            return
        if not body_region:
            return

        questionnaire_type = questionnaire_for_body_region(body_region)
        if not questionnaire_type:
            return

        if _unused_token_exists(note_id, questionnaire_type):
            return

        pt_resp = _sb_execute(
            lambda: supabase.table("patients")
            .select("first_name, phone")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        pt_rows = pt_resp.data or []
        if not pt_rows:
            return
        patient = pt_rows[0]
        phone_raw = str(patient.get("phone") or "").strip()
        if not phone_raw:
            return

        first_name = str(patient.get("first_name") or "").strip() or "there"
        token = secrets.token_hex(32)

        ins = _sb_execute(
            lambda: supabase.table("questionnaire_tokens")
            .insert(
                {
                    "token": token,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "clinical_note_id": note_id,
                    "clinic_id": clinic_id,
                    "questionnaire_type": questionnaire_type,
                    "used": False,
                }
            )
            .execute()
        )

        url = (
            f"{_QUESTIONNAIRE_BASE_URL}/questionnaires/{questionnaire_type}.html"
            f"?token={token}"
        )
        message = (
            f"Hi {first_name}! Your clinician has requested you complete a short "
            f"questionnaire before your visit. It takes about 3 minutes: {url} "
            f"— Reply STOP to opt out."
        )
        send_sms(
            clinic_id,
            _to_e164_us(phone_raw),
            message,
            patient_id=patient_id,
            appointment_id=appointment_id,
            message_type=f"questionnaire_{questionnaire_type}",
        )
    except Exception:
        logger.exception(
            "questionnaire SMS failed note_id=%s", note.get("id")
        )


class QuestionnaireSubmitBody(BaseModel):
    token: str = Field(..., min_length=1)
    questionnaire_type: str = Field(..., min_length=1)
    responses: dict[str, Any] = Field(default_factory=dict)


@router.get("/token-info")
def get_questionnaire_token_info(token: str = Query(default="")):
    try:
        row = _token_row(token)
        if not row or row.get("used") is True:
            return {
                "patient_first_name": "",
                "clinic_name": "",
                "questionnaire_type": "",
            }

        patient_id = str(row.get("patient_id") or "").strip()
        clinic_id = str(row.get("clinic_id") or "").strip()
        questionnaire_type = str(row.get("questionnaire_type") or "").strip()

        first_name = ""
        if patient_id:
            pt = _sb_execute(
                lambda: supabase.table("patients")
                .select("first_name")
                .eq("id", patient_id)
                .limit(1)
                .execute()
            )
            pt_rows = pt.data or []
            if pt_rows:
                first_name = str(pt_rows[0].get("first_name") or "").strip()

        clinic_name = _clinic_display_name(clinic_id) if clinic_id else ""

        return {
            "patient_first_name": first_name,
            "clinic_name": clinic_name,
            "questionnaire_type": questionnaire_type,
        }
    except Exception:
        logger.exception("get_questionnaire_token_info failed")
        return {
            "patient_first_name": "",
            "clinic_name": "",
            "questionnaire_type": "",
        }


@router.get("/results")
def get_questionnaire_results(
    appointment_id: str = Query(..., min_length=1),
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        cid = clinic_id.strip()
        aid = appointment_id.strip()
        enforce_clinic_role_from_auth_header(authorization, cid, *ALL_ROLES)

        resp = _sb_execute(
            lambda: supabase.table("questionnaire_responses")
            .select(
                "questionnaire_type, body_region, total_score, "
                "score_percentage, responses, submitted_at"
            )
            .eq("appointment_id", aid)
            .eq("clinic_id", cid)
            .order("submitted_at", desc=True)
            .execute()
        )
        rows = resp.data or []
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "questionnaire_type": row.get("questionnaire_type"),
                    "body_region": row.get("body_region"),
                    "total_score": row.get("total_score"),
                    "score_percentage": row.get("score_percentage"),
                    "responses": row.get("responses") or {},
                    "submitted_at": row.get("submitted_at"),
                }
            )
        return out
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "get_questionnaire_results failed appointment_id=%s clinic_id=%s",
            appointment_id,
            clinic_id,
        )
        return []


@router.post("/submit")
def submit_questionnaire(body: QuestionnaireSubmitBody):
    try:
        row = _token_row(body.token)
        if not row:
            return {"success": False}
        if row.get("used") is True:
            return {"success": False}

        expected_type = str(row.get("questionnaire_type") or "").strip().lower()
        submitted_type = body.questionnaire_type.strip().lower()
        if expected_type != submitted_type:
            return {"success": False}

        patient_id = str(row.get("patient_id") or "").strip()
        clinic_id = str(row.get("clinic_id") or "").strip()
        note_id = str(row.get("clinical_note_id") or "").strip() or None
        appointment_id = str(row.get("appointment_id") or "").strip() or None

        body_region = ""
        if note_id:
            note_resp = _sb_execute(
                lambda: supabase.table("clinical_notes")
                .select("body_region")
                .eq("id", note_id)
                .limit(1)
                .execute()
            )
            note_rows = note_resp.data or []
            if note_rows:
                body_region = str(note_rows[0].get("body_region") or "").strip()

        if not body_region:
            body_region = submitted_type

        total_score, score_percentage = _calculate_score(
            submitted_type, body.responses
        )

        ins = _sb_execute(
            lambda: supabase.table("questionnaire_responses")
            .insert(
                {
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "clinical_note_id": note_id,
                    "clinic_id": clinic_id,
                    "questionnaire_type": submitted_type,
                    "body_region": body_region,
                    "responses": body.responses,
                    "total_score": total_score,
                    "score_percentage": score_percentage,
                }
            )
            .execute()
        )

        upd = _sb_execute(
            lambda: supabase.table("questionnaire_tokens")
            .update({"used": True})
            .eq("id", row["id"])
            .execute()
        )

        return {"success": True}
    except Exception:
        logger.exception("submit_questionnaire failed")
        return {"success": False}
