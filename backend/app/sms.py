"""Twilio SMS sending with Supabase sms_logs audit trail."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from app.db import supabase

logger = logging.getLogger(__name__)

_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
_MESSAGING_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID")


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
        supabase.table("sms_logs").insert(row).execute()
    except Exception:
        logger.exception(
            "sms_logs insert failed message_type=%s to=%s status=%s",
            message_type,
            to_number,
            status,
        )


def send_sms(
    to: str,
    body: str,
    *,
    patient_id: Optional[str] = None,
    appointment_id: Optional[str] = None,
    message_type: str = "outbound",
) -> Optional[str]:
    """
    Send SMS via Twilio Messaging Service and append sms_logs.

    Returns Twilio message SID on success, or None on failure (errors are logged).
    """
    if not _ACCOUNT_SID or not _AUTH_TOKEN or not _MESSAGING_SERVICE_SID:
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

    try:
        from twilio.rest import Client

        client = Client(_ACCOUNT_SID, _AUTH_TOKEN)
        msg = client.messages.create(
            messaging_service_sid=_MESSAGING_SERVICE_SID,
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
        logger.exception("Twilio send_sms failed to=%s type=%s", to, message_type)
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
