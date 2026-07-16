"""Appointment reminder SMS cron (48h and 24h before scheduled visits)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter

from app.db import supabase
from app.retry_utils import supabase_execute
from app.sms import send_sms

router = APIRouter(prefix="/appointment-reminders", tags=["Appointment Reminders"])
logger = logging.getLogger(__name__)


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _clinic_display_name(clinic: Any) -> str:
    if not isinstance(clinic, dict):
        return "your clinic"
    return (
        str(clinic.get("name") or "").strip()
        or str(clinic.get("brand_name") or "").strip()
        or "your clinic"
    )


def _patient_row(appt: dict[str, Any]) -> Optional[dict[str, Any]]:
    patients = appt.get("patients")
    if isinstance(patients, dict):
        return patients
    if isinstance(patients, list) and patients:
        row = patients[0]
        return row if isinstance(row, dict) else None
    return None


def _clinic_row(appt: dict[str, Any]) -> Optional[dict[str, Any]]:
    clinics = appt.get("clinics")
    if isinstance(clinics, dict):
        return clinics
    if isinstance(clinics, list) and clinics:
        row = clinics[0]
        return row if isinstance(row, dict) else None
    return None


def _appointments_in_hours_window(hours_lo: float, hours_hi: float) -> list[dict[str, Any]]:
    now_utc = datetime.now(timezone.utc)
    window_start = now_utc + timedelta(hours=hours_lo)
    window_end = now_utc + timedelta(hours=hours_hi)
    try:
        resp = supabase_execute(
            lambda: supabase.table("appointments")
            .select(
                "id, patient_id, clinician_id, clinic_id, start_time, status, "
                "patients(first_name, phone), clinics(name, brand_name)"
            )
            .gte("start_time", window_start.isoformat())
            .lte("start_time", window_end.isoformat())
            .not_.in_("status", ["cancelled", "no_show"])
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
    except Exception:
        logger.exception(
            "appointment reminder query failed hours=%s-%s", hours_lo, hours_hi
        )
        return []


def _reminder_already_sent(appointment_id: str, message_type: str) -> bool:
    aid = str(appointment_id or "").strip()
    if not aid:
        return False
    try:
        resp = supabase_execute(
            lambda: supabase.table("sms_logs")
            .select("id")
            .eq("appointment_id", aid)
            .eq("message_type", message_type)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        logger.exception(
            "sms_logs lookup failed appointment_id=%s type=%s", aid, message_type
        )
        return False


def _process_pass(
    *,
    hours_lo: float,
    hours_hi: float,
    message_type: str,
    build_message,
) -> tuple[int, int, list[str]]:
    sent = 0
    skipped = 0
    errors: list[str] = []

    try:
        appointments = _appointments_in_hours_window(hours_lo, hours_hi)
    except Exception as exc:
        errors.append(f"{message_type} query failed: {exc}")
        return sent, skipped, errors

    for appt in appointments:
        try:
            appt_id = str(appt.get("id") or "").strip()
            patient_id = str(appt.get("patient_id") or "").strip()
            clinic_id = str(appt.get("clinic_id") or "").strip()
            if not appt_id or not patient_id or not clinic_id:
                skipped += 1
                continue

            if _reminder_already_sent(appt_id, message_type):
                skipped += 1
                continue

            patient = _patient_row(appt)
            if not patient:
                skipped += 1
                continue

            phone_raw = str(patient.get("phone") or "").strip()
            if not phone_raw:
                errors.append(f"{message_type} appointment {appt_id}: missing phone")
                continue

            first_name = str(patient.get("first_name") or "").strip() or "there"
            clinic_name = _clinic_display_name(_clinic_row(appt))
            message = build_message(first_name=first_name, clinic_name=clinic_name)
            to_number = _to_e164_us(phone_raw)

            sid = send_sms(
                clinic_id,
                to_number,
                message,
                patient_id=patient_id,
                appointment_id=appt_id,
                message_type=message_type,
            )
            if not sid:
                errors.append(f"{message_type} appointment {appt_id}: SMS send failed")
                continue

            sent += 1
        except Exception as exc:
            errors.append(
                f"{message_type} appointment {appt.get('id', '?')}: {exc}"
            )

    return sent, skipped, errors


@router.post("/send-reminders")
def send_appointment_reminders():
    """Cron endpoint: 48h and 24h appointment reminder SMS."""
    try:
        sent = 0
        skipped = 0
        errors: list[str] = []

        s48, k48, e48 = _process_pass(
            hours_lo=47,
            hours_hi=49,
            message_type="appointment_reminder_48hr",
            build_message=lambda first_name, clinic_name: (
                f"Hi {first_name}! This is {clinic_name} reminding you that you have "
                f"an appointment in 2 days. We look forward to seeing you! "
                f"Reply STOP to opt out."
            ),
        )
        sent += s48
        skipped += k48
        errors.extend(e48)

        s24, k24, e24 = _process_pass(
            hours_lo=23,
            hours_hi=25,
            message_type="appointment_reminder_24hr",
            build_message=lambda first_name, clinic_name: (
                f"Hi {first_name}! This is {clinic_name} — your appointment is tomorrow. "
                f"See you then! Reply STOP to opt out."
            ),
        )
        sent += s24
        skipped += k24
        errors.extend(e24)

        return {"sent": sent, "skipped": skipped, "errors": errors}
    except Exception as exc:
        logger.exception("send_appointment_reminders failed")
        return {
            "sent": 0,
            "skipped": 0,
            "errors": [str(exc)],
        }
