"""Retell AI voice agent webhook — book appointments and send confirmation SMS."""

from __future__ import annotations

import json
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.db import supabase
from app.retry_utils import supabase_execute
from app.sms import send_sms

router = APIRouter()

VITALITY_CLINIC_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
VITALITY_LOCATION_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12"
DEFAULT_CLINICIAN_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13"
DEFAULT_TREATMENT_TYPE_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380e02"

NOTES_TEXT = "Booked via Jessica - Vitality voice agent"

_VITALITY_SMS_TEMPLATE = (
    "Hi {first_name}! Your appointment at Vitality Sports & Wellness has been scheduled. "
    "We look forward to seeing you! Questions? Call us at (561) 486-5542."
)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _extract_retell_booking_fields(payload: dict[str, Any]) -> dict[str, str]:
    """Pull post-call booking fields from Retell call_analysis.custom_analysis_data."""
    call_obj = _as_dict(payload.get("call"))

    analysis = _as_dict(call_obj.get("call_analysis"))
    custom_data = _as_dict(analysis.get("custom_analysis_data"))
    print(f"[retell_webhook] custom_analysis_data: {custom_data}")

    metadata = _as_dict(call_obj.get("metadata"))
    dynamic_vars = _as_dict(call_obj.get("retell_llm_dynamic_variables"))

    def get_field(*keys: str) -> Optional[str]:
        for key in keys:
            val = custom_data.get(key) or metadata.get(key) or dynamic_vars.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
        return None

    patient_first_name = get_field("patient_first_name")
    patient_last_name = get_field("patient_last_name")
    patient_phone = get_field("patient_phone")
    if not patient_phone:
        from_number = call_obj.get("from_number")
        if from_number is not None and str(from_number).strip():
            patient_phone = str(from_number).strip()
    patient_dob = get_field("patient_dob")
    appointment_date = get_field("appointment_date")
    appointment_time = get_field("appointment_time")
    clinician_id = DEFAULT_CLINICIAN_ID
    treatment_type_id = DEFAULT_TREATMENT_TYPE_ID

    print(
        f"[retell_webhook] extracted fields: first={patient_first_name} "
        f"last={patient_last_name} phone={patient_phone} "
        f"date={appointment_date} time={appointment_time}"
    )

    fields: dict[str, str] = {
        "clinician_id": clinician_id,
        "treatment_type_id": treatment_type_id,
    }
    if patient_first_name:
        fields["patient_first_name"] = patient_first_name
    if patient_last_name:
        fields["patient_last_name"] = patient_last_name
    if patient_phone:
        fields["patient_phone"] = patient_phone
    if patient_dob:
        fields["patient_dob"] = patient_dob
    if appointment_date:
        fields["appointment_date"] = appointment_date
    if appointment_time:
        fields["appointment_time"] = appointment_time
    return fields


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise RuntimeError(detail)


def _sb_execute(fn):
    """Run Supabase query with transient-failure retry (Render-safe)."""
    resp = supabase_execute(fn)
    _handle_supabase_error(resp)
    return resp


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
        resp = _sb_execute(
            lambda: supabase.table("treatment_types")
            .select("duration_minutes")
            .eq("id", treatment_type_id)
            .limit(1)
            .execute()
        )
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
    lookup = _sb_execute(
        lambda: supabase.table("patients")
        .select("id")
        .eq("phone", phone_norm)
        .limit(1)
        .execute()
    )
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
        ins = _sb_execute(lambda: supabase.table("patients").insert(row).execute())
        ins_rows = ins.data or []
        if not ins_rows:
            raise RuntimeError("Failed to create patient")
        patient_id = str(ins_rows[0]["id"])

    access = _sb_execute(
        lambda: supabase.table("patient_clinic_access")
        .select("id")
        .eq("patient_id", patient_id)
        .eq("clinic_id", VITALITY_CLINIC_ID)
        .limit(1)
        .execute()
    )
    if not (access.data or []):
        supabase_execute(
            lambda pid=patient_id: supabase.table("patient_clinic_access")
            .insert({"patient_id": pid, "clinic_id": VITALITY_CLINIC_ID})
            .execute()
        )

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
    send_sms(
        VITALITY_CLINIC_ID,
        _to_e164_us(to_phone),
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

    ins = _sb_execute(
        lambda: supabase.table("appointments")
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

        event_type = payload.get("event", "")
        print(f"[retell_webhook] event type: {event_type}")
        if event_type != "call_analyzed":
            print(f"[retell_webhook] ignoring non-call_analyzed event: {event_type}")
            return {"status": "ok", "skipped": True}

        print("[retell_webhook] incoming payload:")
        print(json.dumps(payload, indent=2, default=str))

        fields = _extract_retell_booking_fields(payload)

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
