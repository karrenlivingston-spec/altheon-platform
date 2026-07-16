"""Patient outcome measures (NDI, ODI, QuickDASH) — SMS link flow."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.db import supabase
from app.retry_utils import supabase_execute
from app.sms import send_sms
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()
logger = logging.getLogger(__name__)

FormType = Literal["ndi", "odi", "quickdash"]
OUTCOMES_BASE_URL = "https://www.altheon.app/outcomes"

FORM_QUESTION_COUNTS: dict[str, int] = {
    "ndi": 10,
    "odi": 10,
    "quickdash": 11,
}


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


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    try:
        access = _sb_execute(
            lambda: supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "clinic_users lookup failed user_id=%s clinic_id=%s",
            user_id,
            clinic_id,
        )
        raise HTTPException(status_code=500, detail="Failed to verify clinic access") from exc
    if not access.data:
        raise HTTPException(status_code=403, detail="No clinic access for user")


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _normalize_form_type(raw: str) -> FormType:
    ft = (raw or "").strip().lower()
    if ft not in FORM_QUESTION_COUNTS:
        raise HTTPException(
            status_code=400,
            detail="form_type must be one of: ndi, odi, quickdash",
        )
    return ft  # type: ignore[return-value]


def _fetch_token_row(token: str) -> Optional[dict[str, Any]]:
    t = (token or "").strip()
    if not t:
        return None
    try:
        resp = _sb_execute(
            lambda: supabase.table("outcome_measure_tokens")
            .select("id, token, patient_id, clinic_id, form_type, completed")
            .eq("token", t)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("outcome_measure_tokens lookup failed token=%s", t[:8])
        raise HTTPException(status_code=500, detail="Failed to load outcome measure token") from exc
    rows = resp.data or []
    return rows[0] if rows else None


def _is_completed(row: dict[str, Any]) -> bool:
    c = row.get("completed")
    return c is True or str(c).lower() in ("true", "t", "1")


def _assert_patient_in_clinic(patient_id: str, clinic_id: str) -> None:
    try:
        resp = _sb_execute(
            lambda: supabase.table("patient_clinic_access")
            .select("id")
            .eq("patient_id", patient_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "patient_clinic_access lookup failed patient_id=%s clinic_id=%s",
            patient_id,
            clinic_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to verify patient clinic access",
        ) from exc
    if not resp.data:
        raise HTTPException(status_code=404, detail="Patient not found in clinic")


def _interpret_ndi(score: float) -> str:
    if score <= 4:
        return "No disability"
    if score <= 14:
        return "Mild"
    if score <= 24:
        return "Moderate"
    if score <= 34:
        return "Severe"
    return "Complete disability"


def _interpret_odi(percentage: float) -> str:
    if percentage <= 20:
        return "Minimal"
    if percentage <= 40:
        return "Moderate"
    if percentage <= 60:
        return "Severe"
    if percentage <= 80:
        return "Crippled"
    return "Bed-bound"


def _interpret_quickdash(percentage: float) -> str:
    if percentage <= 25:
        return "Mild"
    if percentage <= 50:
        return "Moderate"
    if percentage <= 75:
        return "Severe"
    return "Complete disability"


def _calculate_scores(form_type: FormType, answers: list[int]) -> dict[str, Any]:
    if form_type == "ndi":
        score = float(sum(answers))
        percentage = round((score / 50.0) * 100.0, 2)
        interpretation = _interpret_ndi(score)
        return {
            "score": score,
            "percentage": percentage,
            "interpretation": interpretation,
        }
    if form_type == "odi":
        score = float(sum(answers))
        percentage = round(score * 2.0, 2)
        interpretation = _interpret_odi(percentage)
        return {
            "score": score,
            "percentage": percentage,
            "interpretation": interpretation,
        }
    total = float(sum(answers))
    percentage = round(((total / 11.0) - 1.0) * 25.0, 2)
    interpretation = _interpret_quickdash(percentage)
    return {
        "score": percentage,
        "percentage": percentage,
        "interpretation": interpretation,
    }


def _validate_answers(form_type: FormType, answers: list[int]) -> None:
    expected = FORM_QUESTION_COUNTS[form_type]
    if len(answers) != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected} answers for {form_type}",
        )
    if form_type == "quickdash":
        for a in answers:
            if a < 1 or a > 5:
                raise HTTPException(
                    status_code=400,
                    detail="QuickDASH answers must be between 1 and 5",
                )
    else:
        for a in answers:
            if a < 0 or a > 5:
                raise HTTPException(
                    status_code=400,
                    detail=f"{form_type.upper()} answers must be between 0 and 5",
                )


class SendOutcomeMeasureBody(BaseModel):
    patient_id: str
    form_type: str
    clinic_id: str

    @field_validator("patient_id", "clinic_id")
    @classmethod
    def _strip_ids(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("required")
        return s


class SubmitOutcomeMeasureBody(BaseModel):
    answers: list[int] = Field(min_length=1)


@router.post("/outcome-measures/send")
def send_outcome_measure(
    body: SendOutcomeMeasureBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        user_id = _resolve_bearer_user_id(authorization)
        form_type = _normalize_form_type(body.form_type)
        patient_id = body.patient_id.strip()
        clinic_id = body.clinic_id.strip()

        _assert_user_has_clinic_access(user_id, clinic_id)
        _assert_patient_in_clinic(patient_id, clinic_id)

        pt_resp = _sb_execute(
            lambda: supabase.table("patients")
            .select("first_name, phone")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        pt_row = (pt_resp.data or [None])[0]
        if not isinstance(pt_row, dict):
            raise HTTPException(status_code=404, detail="Patient not found")

        phone = (pt_row.get("phone") or "").strip()
        if not phone:
            raise HTTPException(status_code=400, detail="Patient has no phone number on file")

        token = secrets.token_urlsafe(32)
        ins = _sb_execute(
            lambda: supabase.table("outcome_measure_tokens")
            .insert(
                {
                    "token": token,
                    "patient_id": patient_id,
                    "clinic_id": clinic_id,
                    "form_type": form_type,
                    "completed": False,
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create outcome measure token")

        link = f"{OUTCOMES_BASE_URL}/{token}"
        fname = (pt_row.get("first_name") or "").strip() or "there"
        form_label = {
            "ndi": "Neck Disability Index",
            "odi": "Oswestry Disability Index",
            "quickdash": "QuickDASH",
        }[form_type]
        sms_body = (
            f"Hi {fname}, please complete your {form_label} outcome measure: {link}"
        )

        sid = send_sms(
            clinic_id,
            _to_e164_us(phone),
            sms_body,
            patient_id=patient_id,
            message_type="outcome_measure",
        )
        if sid is None:
            raise HTTPException(status_code=502, detail="Failed to send SMS")

        return {
            "success": True,
            "token": token,
            "link": link,
            "twilio_sid": sid,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "send_outcome_measure failed patient_id=%s clinic_id=%s form_type=%s",
            body.patient_id,
            body.clinic_id,
            body.form_type,
        )
        raise HTTPException(status_code=500, detail="Failed to send outcome measure") from exc


@router.get("/outcome-measures/patient/{patient_id}")
def list_patient_outcome_measures(
    patient_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    try:
        user_id = _resolve_bearer_user_id(authorization)
        pid = patient_id.strip()
        cid = clinic_id.strip()
        if not pid:
            raise HTTPException(status_code=400, detail="patient_id is required")

        _assert_user_has_clinic_access(user_id, cid)
        _assert_patient_in_clinic(pid, cid)

        resp = _sb_execute(
            lambda: supabase.table("outcome_measure_results")
            .select(
                "id, patient_id, clinic_id, form_type, score, percentage, "
                "interpretation, answers, completed_at"
            )
            .eq("patient_id", pid)
            .eq("clinic_id", cid)
            .order("completed_at", desc=True)
            .execute()
        )
        return {"results": resp.data or []}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "list_patient_outcome_measures failed patient_id=%s clinic_id=%s",
            patient_id,
            clinic_id,
        )
        raise HTTPException(status_code=500, detail="Failed to load outcome measures") from exc


@router.get("/outcome-measures/{token}")
def get_outcome_measure_form(token: str):
    try:
        row = _fetch_token_row(token)
        if not row:
            raise HTTPException(status_code=404, detail="Token not found")
        if _is_completed(row):
            return {"status": "already_completed"}

        patient_id = str(row.get("patient_id") or "").strip()
        if not patient_id:
            raise HTTPException(status_code=500, detail="Invalid token row")

        pt_resp = _sb_execute(
            lambda: supabase.table("patients")
            .select("first_name")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        pt_row = (pt_resp.data or [None])[0]
        if not isinstance(pt_row, dict):
            raise HTTPException(status_code=404, detail="Patient not found")

        return {
            "status": "valid",
            "form_type": row.get("form_type"),
            "patient_first_name": pt_row.get("first_name"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("get_outcome_measure_form failed token=%s", (token or "")[:8])
        raise HTTPException(status_code=500, detail="Failed to load outcome measure form") from exc


@router.post("/outcome-measures/{token}/submit")
def submit_outcome_measure(token: str, body: SubmitOutcomeMeasureBody):
    try:
        row = _fetch_token_row(token)
        if not row:
            raise HTTPException(status_code=404, detail="Token not found")
        if _is_completed(row):
            raise HTTPException(status_code=400, detail="This form has already been completed")

        form_type = _normalize_form_type(str(row.get("form_type") or ""))
        _validate_answers(form_type, body.answers)
        scores = _calculate_scores(form_type, body.answers)

        patient_id = str(row.get("patient_id") or "").strip()
        clinic_id = str(row.get("clinic_id") or "").strip()
        token_id = str(row.get("id") or "").strip()
        if not patient_id or not clinic_id or not token_id:
            raise HTTPException(status_code=500, detail="Invalid token row")

        completed_at = datetime.now(timezone.utc).isoformat()
        ins = _sb_execute(
            lambda: supabase.table("outcome_measure_results")
            .insert(
                {
                    "patient_id": patient_id,
                    "clinic_id": clinic_id,
                    "form_type": form_type,
                    "score": scores["score"],
                    "percentage": scores["percentage"],
                    "interpretation": scores["interpretation"],
                    "answers": body.answers,
                    "completed_at": completed_at,
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to save outcome measure result")

        upd = _sb_execute(
            lambda: supabase.table("outcome_measure_tokens")
            .update({"completed": True})
            .eq("id", token_id)
            .execute()
        )

        result_row = ins.data[0]
        return {
            "success": True,
            "score": scores["score"],
            "percentage": scores["percentage"],
            "interpretation": scores["interpretation"],
            "result": result_row,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("submit_outcome_measure failed token=%s", (token or "")[:8])
        raise HTTPException(status_code=500, detail="Failed to submit outcome measure") from exc
