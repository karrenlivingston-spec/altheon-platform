"""Retell AI voice agent webhook — book appointments and send confirmation SMS."""

from __future__ import annotations

import json
import os
import re
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.db import supabase
from app.sms import send_sms

router = APIRouter()

VITALITY_CLINIC_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
VITALITY_LOCATION_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12"
DEFAULT_CLINICIAN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13"
DEFAULT_TREATMENT_TYPE_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380e02"

NOTES_TEXT = "Booked via Jessica - Vitality voice agent"

_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "patient_first_name": (
        "patient_first_name",
        "first_name",
        "patientfirstname",
        "patient_firstname",
    ),
    "patient_last_name": (
        "patient_last_name",
        "last_name",
        "patientlastname",
        "patient_lastname",
    ),
    "patient_dob": ("patient_dob", "dob", "date_of_birth", "patientdateofbirth"),
    "patient_phone": (
        "patient_phone",
        "phone",
        "phone_number",
        "patientphone",
        "caller_phone",
    ),
    "appointment_date": (
        "appointment_date",
        "date",
        "appt_date",
        "scheduled_date",
    ),
    "appointment_time": (
        "appointment_time",
        "time",
        "appt_time",
        "scheduled_time",
    ),
    "clinician_id": (
        "clinician_id",
        "provider_id",
        "clinicianid",
        "providerid",
    ),
    "treatment_type_id": (
        "treatment_type_id",
        "treatment_type",
        "treatmenttypeid",
    ),
}

_VITALITY_SMS_TEMPLATE = (
    "Hi {first_name}! Your appointment at Vitality Sports & Wellness has been scheduled. "
    "We look forward to seeing you! Questions? Call us at (561) 486-5542."
)


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key or "").lower())


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return ""
    return str(value).strip()


def _deep_dicts(obj: Any, out: Optional[list[dict[str, Any]]] = None) -> list[dict[str, Any]]:
    if out is None:
        out = []
    if isinstance(obj, dict):
        out.append(obj)
        for v in obj.values():
            _deep_dicts(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _deep_dicts(item, out)
    return out


def _extract_from_transcript(text: str) -> dict[str, str]:
    """Best-effort key: value extraction from transcript or summary text."""
    found: dict[str, str] = {}
    if not text or not isinstance(text, str):
        return found
    patterns = [
        (r"(?i)patient[_\s-]*first[_\s-]*name\s*[:=]\s*([^\n,;]+)", "patient_first_name"),
        (r"(?i)patient[_\s-]*last[_\s-]*name\s*[:=]\s*([^\n,;]+)", "patient_last_name"),
        (r"(?i)(?:patient[_\s-]*)?phone\s*[:=]\s*([+\d()\s.-]+)", "patient_phone"),
        (r"(?i)appointment[_\s-]*date\s*[:=]\s*([^\n,;]+)", "appointment_date"),
        (r"(?i)appointment[_\s-]*time\s*[:=]\s*([^\n,;]+)", "appointment_time"),
        (r"(?i)clinician[_\s-]*id\s*[:=]\s*([a-f0-9-]{36})", "clinician_id"),
        (r"(?i)(?:provider|treatment)[_\s-]*(?:type[_\s-]*)?id\s*[:=]\s*([a-f0-9-]{36})", "treatment_type_id"),
    ]
    for pattern, field in patterns:
        m = re.search(pattern, text)
        if m and field not in found:
            found[field] = m.group(1).strip()
    return found


def _extract_booking_fields(payload: dict[str, Any]) -> dict[str, str]:
    found: dict[str, str] = {}
    alias_to_field: dict[str, str] = {}
    for field, aliases in _FIELD_ALIASES.items():
        for alias in aliases:
            alias_to_field[_normalize_key(alias)] = field

    call = payload.get("call")
    if isinstance(call, dict):
        for bucket_key in (
            "retell_llm_dynamic_variables",
            "metadata",
            "dynamic_variables",
            "collected_dynamic_variables",
        ):
            bucket = call.get(bucket_key)
            if isinstance(bucket, dict):
                _deep_dicts(bucket)

        for text_key in ("transcript", "transcript_summary", "summary"):
            chunk = call.get(text_key)
            if isinstance(chunk, str):
                found.update(_extract_from_transcript(chunk))

        analysis = call.get("call_analysis")
        if isinstance(analysis, dict):
            custom = analysis.get("custom_analysis_data")
            if isinstance(custom, dict):
                _deep_dicts(custom)
            summary = analysis.get("call_summary")
            if isinstance(summary, str):
                found.update(_extract_from_transcript(summary))

    for d in _deep_dicts(payload):
        for raw_key, raw_val in d.items():
            field = alias_to_field.get(_normalize_key(raw_key))
            if not field:
                continue
            val = _coerce_str(raw_val)
            if val and field not in found:
                found[field] = val

    return found


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise RuntimeError(detail)


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _parse_appointment_datetime(date_raw: str, time_raw: str) -> Optional[datetime]:
    date_s = (date_raw or "").strip()
    time_s = (time_raw or "").strip()
    if not date_s or not time_s:
        return None

    try:
        appt_date = date.fromisoformat(date_s[:10])
    except ValueError:
        for fmt in ("%m/%d/%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
            try:
                appt_date = datetime.strptime(date_s, fmt).date()
                break
            except ValueError:
                continue
        else:
            return None

    time_s = time_s.upper().replace(".", "")
    parsed_time: Optional[datetime] = None
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p", "%I %p"):
        try:
            parsed_time = datetime.strptime(time_s, fmt)
            break
        except ValueError:
            continue
    if parsed_time is None:
        return None

    try:
        import pytz

        eastern = pytz.timezone("America/New_York")
        naive = datetime.combine(appt_date, parsed_time.time())
        return eastern.localize(naive).astimezone(timezone.utc)
    except Exception:
        traceback.print_exc()
        return None


def _duration_minutes(treatment_type_id: str) -> int:
    try:
        resp = (
            supabase.table("treatment_types")
            .select("duration_minutes")
            .eq("id", treatment_type_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = resp.data or []
        if rows:
            return int(rows[0].get("duration_minutes") or 60)
    except Exception:
        traceback.print_exc()
    return 60


def _resolve_or_create_patient(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    dob: str,
) -> str:
    phone_norm = _to_e164_us(phone)
    lookup = (
        supabase.table("patients")
        .select("id")
        .eq("phone", phone_norm)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(lookup)
    rows = lookup.data or []
    if rows:
        patient_id = str(rows[0]["id"])
    else:
        row: dict[str, Any] = {
            "first_name": first_name,
            "last_name": last_name,
            "phone": phone_norm,
            "clinic_id": VITALITY_CLINIC_ID,
        }
        if dob:
            row["date_of_birth"] = dob
        ins = supabase.table("patients").insert(row).execute()
        _handle_supabase_error(ins)
        ins_rows = ins.data or []
        if not ins_rows:
            raise RuntimeError("Failed to create patient")
        patient_id = str(ins_rows[0]["id"])

    access = (
        supabase.table("patient_clinic_access")
        .select("id")
        .eq("patient_id", patient_id)
        .eq("clinic_id", VITALITY_CLINIC_ID)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(access)
    if not (access.data or []):
        supabase.table("patient_clinic_access").insert(
            {"patient_id": patient_id, "clinic_id": VITALITY_CLINIC_ID}
        ).execute()

    return patient_id


def _send_vitality_sms(
    *,
    to_phone: str,
    first_name: str,
    patient_id: str,
    appointment_id: str,
) -> None:
    body = _VITALITY_SMS_TEMPLATE.format(
        first_name=(first_name or "there").strip() or "there"
    )
    to_e164 = _to_e164_us(to_phone)

    from_number = (os.getenv("TWILIO_PHONE_NUMBER") or "").strip()
    account_sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    auth_token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()

    if from_number and account_sid and auth_token:
        try:
            from twilio.rest import Client

            client = Client(account_sid, auth_token)
            client.messages.create(from_=from_number, body=body, to=to_e164)
            return
        except Exception:
            traceback.print_exc()

    send_sms(
        to_e164,
        body,
        patient_id=patient_id,
        appointment_id=appointment_id,
        message_type="retell_confirmation",
    )


def _book_appointment(fields: dict[str, str]) -> Optional[str]:
    first_name = fields.get("patient_first_name", "").strip()
    last_name = fields.get("patient_last_name", "").strip()
    if not first_name or not last_name:
        return None

    phone = fields.get("patient_phone", "").strip()
    if not phone:
        print("[retell_webhook] missing patient_phone; cannot book")
        return None

    appt_date = fields.get("appointment_date", "").strip()
    appt_time = fields.get("appointment_time", "").strip()
    start_utc = _parse_appointment_datetime(appt_date, appt_time)
    if start_utc is None:
        print(
            f"[retell_webhook] could not parse date/time: date={appt_date!r} time={appt_time!r}"
        )
        return None

    clinician_id = (
        fields.get("clinician_id", "").strip() or DEFAULT_CLINICIAN_ID
    )
    treatment_type_id = (
        fields.get("treatment_type_id", "").strip() or DEFAULT_TREATMENT_TYPE_ID
    )
    duration = _duration_minutes(treatment_type_id)
    end_utc = start_utc + timedelta(minutes=duration)

    patient_id = _resolve_or_create_patient(
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        dob=fields.get("patient_dob", "").strip(),
    )

    ins = (
        supabase.table("appointments")
        .insert(
            {
                "clinic_id": VITALITY_CLINIC_ID,
                "location_id": VITALITY_LOCATION_ID,
                "clinician_id": clinician_id,
                "treatment_type_id": treatment_type_id,
                "patient_id": patient_id,
                "start_time": start_utc.isoformat(),
                "end_time": end_utc.isoformat(),
                "status": "scheduled",
                "source": "ai",
                "notes": NOTES_TEXT,
            }
        )
        .execute()
    )
    _handle_supabase_error(ins)
    rows = ins.data or []
    if not rows:
        raise RuntimeError("Appointment insert returned no row")

    appointment_id = str(rows[0]["id"])
    print(
        f"[retell_webhook] booked appointment_id={appointment_id} "
        f"patient={first_name} {last_name} start={start_utc.isoformat()}"
    )

    try:
        _send_vitality_sms(
            to_phone=phone,
            first_name=first_name,
            patient_id=patient_id,
            appointment_id=appointment_id,
        )
    except Exception:
        traceback.print_exc()

    return appointment_id


@router.post("/retell/webhook")
async def retell_webhook(request: Request):
    try:
        raw_body = await request.body()
        try:
            payload = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {"raw": payload}

        print("[retell_webhook] incoming payload:")
        print(json.dumps(payload, indent=2, default=str))

        fields = _extract_booking_fields(payload)
        print(f"[retell_webhook] extracted fields: {json.dumps(fields, default=str)}")

        if fields.get("patient_first_name") and fields.get("patient_last_name"):
            appointment_id = _book_appointment(fields)
            if appointment_id:
                return {"status": "ok", "appointment_id": appointment_id}
            return {
                "status": "ok",
                "message": "booking skipped (missing phone or date/time)",
            }

        print("[retell_webhook] patient name not present; skipping booking")
        return {"status": "ok", "message": "no booking (patient name missing)"}

    except Exception as exc:
        traceback.print_exc()
        print(f"[retell_webhook] error: {exc}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": str(exc)},
        )
