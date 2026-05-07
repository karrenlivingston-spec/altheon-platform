# SQL migration (run manually):
# ALTER TABLE appointments ADD COLUMN IF NOT EXISTS google_event_id TEXT;

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

_CAL_SCOPE = "https://www.googleapis.com/auth/calendar"
_NY_TZ = ZoneInfo("America/New_York")


def _calendar_service():
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    calendar_id = os.getenv("GOOGLE_CALENDAR_ID", "").strip()
    if not raw or not calendar_id:
        raise ValueError("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CALENDAR_ID")

    info = json.loads(raw)
    creds = Credentials.from_service_account_info(info, scopes=[_CAL_SCOPE])
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    return service, calendar_id


def _to_datetime(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _event_payload(
    appointment_id: Optional[str],
    patient_name: str,
    clinician_name: str,
    treatment_type: str,
    start_datetime_utc,
    end_datetime_utc,
    location: Optional[str] = None,
):
    start_dt = _to_datetime(start_datetime_utc)
    end_dt = _to_datetime(end_datetime_utc)
    if start_dt is None:
        raise ValueError("start_datetime_utc is required")
    if end_dt is None or end_dt <= start_dt:
        end_dt = start_dt + timedelta(minutes=60)

    start_local = start_dt.astimezone(_NY_TZ)
    end_local = end_dt.astimezone(_NY_TZ)
    title = f"{(patient_name or '').strip() or 'Patient'} — {(treatment_type or '').strip() or 'Appointment'}"
    description = "Booked via Aria"
    if appointment_id:
        description = f"{description} | Appointment ID: {appointment_id}"
    description = f"{description}\nClinician: {(clinician_name or '').strip() or 'Unknown'}"
    body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_local.isoformat(), "timeZone": "America/New_York"},
        "end": {"dateTime": end_local.isoformat(), "timeZone": "America/New_York"},
    }
    if location:
        body["location"] = location
    return body


def create_calendar_event(
    appointment_id,
    patient_name,
    clinician_name,
    treatment_type,
    start_datetime_utc,
    end_datetime_utc,
    location=None,
):
    try:
        service, calendar_id = _calendar_service()
        body = _event_payload(
            appointment_id=appointment_id,
            patient_name=patient_name,
            clinician_name=clinician_name,
            treatment_type=treatment_type,
            start_datetime_utc=start_datetime_utc,
            end_datetime_utc=end_datetime_utc,
            location=location,
        )
        event = service.events().insert(calendarId=calendar_id, body=body).execute()
        return event.get("id")
    except Exception:
        logger.exception(
            "Google Calendar create failed appointment_id=%s",
            appointment_id,
        )
        return None


def update_calendar_event(
    google_event_id,
    patient_name,
    clinician_name,
    treatment_type,
    start_datetime_utc,
    end_datetime_utc,
):
    try:
        if not google_event_id:
            return
        service, calendar_id = _calendar_service()
        body = _event_payload(
            appointment_id=None,
            patient_name=patient_name,
            clinician_name=clinician_name,
            treatment_type=treatment_type,
            start_datetime_utc=start_datetime_utc,
            end_datetime_utc=end_datetime_utc,
            location=None,
        )
        service.events().patch(
            calendarId=calendar_id,
            eventId=google_event_id,
            body=body,
        ).execute()
    except Exception:
        logger.exception(
            "Google Calendar update failed google_event_id=%s",
            google_event_id,
        )


def delete_calendar_event(google_event_id):
    try:
        if not google_event_id:
            return
        service, calendar_id = _calendar_service()
        service.events().delete(
            calendarId=calendar_id,
            eventId=google_event_id,
        ).execute()
    except Exception:
        logger.exception(
            "Google Calendar delete failed google_event_id=%s",
            google_event_id,
        )
