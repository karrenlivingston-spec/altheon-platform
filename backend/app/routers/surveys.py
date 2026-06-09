"""
Patient survey SMS flow (Twilio webhook + scheduled send).

Twilio Console: set the Messaging Service **Inbound** webhook URL to:
https://altheon-platform.onrender.com/sms-webhook
(POST; same host/path if you use a custom domain.)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, time, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request, Response

from app.db import supabase
from app.sms import send_sms

router = APIRouter()
logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")

Q2_TEXT = (
    "Thanks! How would you rate your pain relief after today's "
    "session? Reply 1-5."
)
Q3_TEXT = (
    "Great! How was your experience with your provider today? Reply 1-5."
)
Q4_TEXT = (
    "Last one! How likely are you to recommend STTPDN to a friend or family "
    "member? Reply 1-5."
)
INVALID_TEXT = "Please reply with a number between 1 and 5."


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _find_patient_by_twilio_from(from_number: str) -> Optional[dict[str, Any]]:
    raw = (from_number or "").strip()
    digits = _digits(raw)
    if not digits:
        return None
    last10 = digits[-10:] if len(digits) >= 10 else digits

    candidates: list[str] = []
    for c in (raw, f"+1{last10}" if len(last10) == 10 else "", f"+{digits}", digits, last10):
        c = (c or "").strip()
        if c and c not in candidates:
            candidates.append(c)

    for phone_try in candidates:
        try:
            resp = (
                supabase.table("patients")
                .select("id, first_name, phone")
                .eq("phone", phone_try)
                .limit(1)
                .execute()
            )
        except Exception:
            continue
        if resp.data:
            return dict(resp.data[0])

    try:
        resp = (
            supabase.table("patients")
            .select("id, first_name, phone")
            .ilike("phone", f"%{last10}%")
            .limit(25)
            .execute()
        )
    except Exception:
        logger.exception("patient ilike lookup failed")
        return None

    for row in resp.data or []:
        if _digits(str(row.get("phone") or "")).endswith(last10):
            return dict(row)
    return None


def _clinic_id_for_survey(survey: dict[str, Any]) -> str:
    cid = str(survey.get("clinic_id") or "").strip()
    if cid:
        return cid
    appt_id = str(survey.get("appointment_id") or "").strip()
    if not appt_id:
        return ""
    try:
        resp = (
            supabase.table("appointments")
            .select("clinic_id")
            .eq("id", appt_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            return str(resp.data[0].get("clinic_id") or "").strip()
    except Exception:
        logger.exception("clinic_id lookup failed for survey appt=%s", appt_id)
    return ""


def _latest_open_survey(patient_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            supabase.table("survey_responses")
            .select("*")
            .eq("patient_id", patient_id)
            .eq("completed", False)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.exception("survey_responses lookup failed patient_id=%s", patient_id)
        return None
    rows = resp.data or []
    return dict(rows[0]) if rows else None


def _current_question(survey: dict[str, Any]) -> Optional[str]:
    if survey.get("q1_overall") is None:
        return "q1"
    if survey.get("q2_pain_relief") is None:
        return "q2"
    if survey.get("q3_provider") is None:
        return "q3"
    if survey.get("q4_recommend") is None:
        return "q4"
    return None


def _parse_score(body: str) -> Optional[int]:
    t = (body or "").strip()
    if not t.isdigit():
        return None
    v = int(t)
    if 1 <= v <= 5:
        return v
    return None


def _eastern_today_bounds_utc_iso() -> tuple[str, str]:
    now_e = datetime.now(EASTERN)
    start_e = datetime.combine(now_e.date(), time.min, tzinfo=EASTERN)
    end_e = datetime.combine(now_e.date(), time.max, tzinfo=EASTERN)
    return (
        start_e.astimezone(timezone.utc).isoformat(),
        end_e.astimezone(timezone.utc).isoformat(),
    )


def _to_e164_us(phone: str) -> str:
    d = _digits(phone)
    if not d:
        return phone
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    if phone.strip().startswith("+"):
        return phone.strip()
    return f"+{d}"


@router.post("/sms-webhook")
async def sms_webhook(request: Request) -> Response:
    """Twilio inbound SMS: advance multi-step survey or prompt for valid score."""
    from twilio.twiml.messaging_response import MessagingResponse

    try:
        form = await request.form()
        from_raw = str(form.get("From") or "")
        body_raw = str(form.get("Body") or "")
    except Exception:
        logger.exception("sms_webhook form parse failed")
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    if body_raw.strip().upper() == "STOP":
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    patient = _find_patient_by_twilio_from(from_raw)
    if not patient:
        logger.info("sms_webhook unknown caller From=%s", from_raw)
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    patient_id = str(patient["id"])
    first_name = (patient.get("first_name") or "there").strip() or "there"
    survey = _latest_open_survey(patient_id)
    if not survey:
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    survey_id = str(survey["id"])
    appointment_id = survey.get("appointment_id")
    appointment_id_s = str(appointment_id) if appointment_id else None
    clinic_id = _clinic_id_for_survey(survey)

    qkey = _current_question(survey)
    if not qkey:
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    score = _parse_score(body_raw)
    if score is None:
        if clinic_id:
            send_sms(
                clinic_id,
                _to_e164_us(from_raw),
                INVALID_TEXT,
                patient_id=patient_id,
                appointment_id=appointment_id_s,
                message_type="survey_invalid",
            )
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    col_map = {
        "q1": "q1_overall",
        "q2": "q2_pain_relief",
        "q3": "q3_provider",
        "q4": "q4_recommend",
    }
    col = col_map[qkey]
    now_iso = datetime.now(timezone.utc).isoformat()
    patch: dict[str, Any] = {col: score, "updated_at": now_iso}

    try:
        supabase.table("survey_responses").update(patch).eq("id", survey_id).execute()
    except Exception:
        logger.exception("survey update failed id=%s col=%s", survey_id, col)
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    refreshed = _latest_open_survey(patient_id)
    if not refreshed:
        return Response(
            content=str(MessagingResponse()),
            media_type="application/xml",
        )

    next_q = _current_question(refreshed)
    to = _to_e164_us(from_raw)
    if not clinic_id:
        clinic_id = _clinic_id_for_survey(refreshed)

    if next_q == "q2":
        if clinic_id:
            send_sms(
                clinic_id,
                to,
                Q2_TEXT,
                patient_id=patient_id,
                appointment_id=appointment_id_s,
                message_type="survey_q2",
            )
    elif next_q == "q3":
        if clinic_id:
            send_sms(
                clinic_id,
                to,
                Q3_TEXT,
                patient_id=patient_id,
                appointment_id=appointment_id_s,
                message_type="survey_q3",
            )
    elif next_q == "q4":
        if clinic_id:
            send_sms(
                clinic_id,
                to,
                Q4_TEXT,
                patient_id=patient_id,
                appointment_id=appointment_id_s,
                message_type="survey_q4",
            )
    else:
        q1 = int(refreshed.get("q1_overall") or 0)
        q2 = int(refreshed.get("q2_pain_relief") or 0)
        q3 = int(refreshed.get("q3_provider") or 0)
        q4 = int(refreshed.get("q4_recommend") or 0)
        avg = round((q1 + q2 + q3 + q4) / 4.0, 2)
        closing = (
            f"Thank you {first_name}! Your feedback means a lot to us. "
            f"See you at your next visit! — STTPDN"
        )
        try:
            supabase.table("survey_responses").update(
                {
                    "completed": True,
                    "avg_score": avg,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", survey_id).execute()
        except Exception:
            logger.exception("survey complete update failed id=%s", survey_id)
        if clinic_id:
            send_sms(
                clinic_id,
                to,
                closing,
                patient_id=patient_id,
                appointment_id=appointment_id_s,
                message_type="survey_complete",
            )

    return Response(
        content=str(MessagingResponse()),
        media_type="application/xml",
    )


@router.post("/send-survey-sms")
def send_survey_sms_batch() -> dict[str, Any]:
    """
    Daily batch (cron): completed appointments today (Eastern) without a survey row.
    """
    start_iso, end_iso = _eastern_today_bounds_utc_iso()
    sent = 0

    try:
        appt_resp = (
            supabase.table("appointments")
            .select("id, patient_id, clinic_id, start_time")
            .eq("status", "completed")
            .gte("start_time", start_iso)
            .lte("start_time", end_iso)
            .execute()
        )
    except Exception:
        logger.exception("send_survey_sms_batch appointment query failed")
        return {"sent": 0, "error": "appointment_query_failed"}

    appointments = appt_resp.data or []
    for appt in appointments:
        appt_id = str(appt.get("id"))
        patient_id = str(appt.get("patient_id") or "")
        clinic_id = str(appt.get("clinic_id") or "")
        if not patient_id or not clinic_id:
            continue

        try:
            existing = (
                supabase.table("survey_responses")
                .select("id")
                .eq("appointment_id", appt_id)
                .limit(1)
                .execute()
            )
        except Exception:
            logger.exception("survey existing check failed appt=%s", appt_id)
            continue
        if existing.data:
            continue

        try:
            pt = (
                supabase.table("patients")
                .select("first_name, phone")
                .eq("id", patient_id)
                .limit(1)
                .execute()
            )
        except Exception:
            logger.exception("patient fetch failed id=%s", patient_id)
            continue
        prow = (pt.data or [{}])[0]
        phone = prow.get("phone")
        if not phone:
            continue
        fn = (prow.get("first_name") or "there").strip() or "there"

        try:
            ins = (
                supabase.table("survey_responses")
                .insert(
                    {
                        "patient_id": patient_id,
                        "appointment_id": appt_id,
                        "clinic_id": clinic_id,
                        "completed": False,
                    }
                )
                .execute()
            )
        except Exception:
            logger.exception("survey_responses insert failed appt=%s", appt_id)
            continue
        ins_rows = ins.data or []
        if not ins_rows:
            continue

        msg = (
            f"Hi {fn}, thanks for visiting STTPDN today! How would you rate your "
            f"overall experience? Reply 1-5 (5 = excellent). Reply STOP to opt out."
        )
        sid = send_sms(
            clinic_id,
            _to_e164_us(str(phone)),
            msg,
            patient_id=patient_id,
            appointment_id=appt_id,
            message_type="survey_q1",
        )
        if sid is not None:
            sent += 1

    return {"sent": sent}
