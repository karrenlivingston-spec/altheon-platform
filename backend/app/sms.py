"""Twilio SMS sending with per-clinic display prefix and sms_logs audit trail."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from app.db import supabase
from app.retry_utils import supabase_execute

logger = logging.getLogger(__name__)

_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
_DEFAULT_MESSAGING_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID")


def _log_sms_row(
    *,
    patient_id: Optional[str],
    appointment_id: Optional[str],
    message_type: str,
    message_body: str,
    to_number: str,
    twilio_sid: Optional[str],
    status: str,
) -> None:
    row: dict[str, Any] = {
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "message_type": message_type,
        "message_body": message_body,
        "to_number": to_number,
        "twilio_sid": twilio_sid,
        "status": status,
    }
    try:
        supabase_execute(lambda: supabase.table("sms_logs").insert(row).execute())
    except Exception:
        logger.exception(
            "sms_logs insert failed message_type=%s to=%s status=%s",
            message_type,
            to_number,
            status,
        )


def _fetch_clinic_sms_config(clinic_id: str) -> tuple[str, str]:
    """Return (sms_display_name, messaging_service_sid) for a clinic."""
    cid = (clinic_id or "").strip()
    if not cid:
        return "Clinic", (_DEFAULT_MESSAGING_SERVICE_SID or "").strip()

    try:
        resp = supabase_execute(
            lambda: supabase.table("clinics")
            .select("sms_display_name, brand_name, name, messaging_service_sid")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            display = (
                str(row.get("sms_display_name") or "").strip()
                or str(row.get("brand_name") or "").strip()
                or str(row.get("name") or "").strip()
                or "Clinic"
            )
            sid = (
                str(row.get("messaging_service_sid") or "").strip()
                or (_DEFAULT_MESSAGING_SERVICE_SID or "").strip()
            )
            return display, sid
    except Exception:
        logger.exception("clinic SMS config lookup failed clinic_id=%s", cid)

    return "Clinic", (_DEFAULT_MESSAGING_SERVICE_SID or "").strip()


def _prefix_message(display_name: str, message: str) -> str:
    name = (display_name or "").strip() or "Clinic"
    body = (message or "").strip()
    return f"{name}:\n{body}"


def send_sms(
    clinic_id: str,
    to_number: str,
    message: str,
    *,
    patient_id: Optional[str] = None,
    appointment_id: Optional[str] = None,
    message_type: str = "outbound",
) -> Optional[str]:
    """
    Send patient-facing SMS via the clinic's Twilio Messaging Service.

    Prepends ``{sms_display_name}:\\n`` to the message body before send.
    Returns Twilio message SID on success, or None on failure (errors are logged).
    """
    to = (to_number or "").strip()
    display_name, messaging_service_sid = _fetch_clinic_sms_config(clinic_id)
    body = _prefix_message(display_name, message)

    if not _ACCOUNT_SID or not _AUTH_TOKEN:
        logger.warning("Twilio env not configured; skipping SMS send")
        _log_sms_row(
            patient_id=patient_id,
            appointment_id=appointment_id,
            message_type=message_type,
            message_body=body,
            to_number=to,
            twilio_sid=None,
            status="skipped_no_config",
        )
        return None

    if not messaging_service_sid:
        logger.warning(
            "No messaging_service_sid for clinic_id=%s; skipping SMS send",
            clinic_id,
        )
        _log_sms_row(
            patient_id=patient_id,
            appointment_id=appointment_id,
            message_type=message_type,
            message_body=body,
            to_number=to,
            twilio_sid=None,
            status="skipped_no_messaging_sid",
        )
        return None

    try:
        from twilio.rest import Client

        client = Client(_ACCOUNT_SID, _AUTH_TOKEN)
        msg = client.messages.create(
            messaging_service_sid=messaging_service_sid,
            body=body,
            to=to,
        )
        sid = getattr(msg, "sid", None) or None
        st = getattr(msg, "status", None) or "sent"
        _log_sms_row(
            patient_id=patient_id,
            appointment_id=appointment_id,
            message_type=message_type,
            message_body=body,
            to_number=to,
            twilio_sid=sid,
            status=str(st),
        )
        return sid
    except Exception:
        logger.exception(
            "Twilio send_sms failed clinic_id=%s to=%s type=%s",
            clinic_id,
            to,
            message_type,
        )
        _log_sms_row(
            patient_id=patient_id,
            appointment_id=appointment_id,
            message_type=message_type,
            message_body=body,
            to_number=to,
            twilio_sid=None,
            status="failed",
        )
        return None
