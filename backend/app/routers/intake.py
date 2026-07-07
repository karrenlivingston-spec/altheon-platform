"""Public intake submissions from Aria / ElevenLabs webhook, scheduled reminders, and token-based forms.

Environment (reminder + token links):
  FRONTEND_URL — required for POST /intake/send-reminders SMS links (e.g. https://app.example.com).
  Cron schedule (Render): 0 6,12,18 * * * — ~24h safety-net for missed booking intake SMS.
  INTAKE_SECRET — existing webhook auth for POST /intake.

stdlib: secrets (token_urlsafe) — no PyPI package.

-- intake_tokens (create manually in Supabase)
-- id uuid primary key default gen_random_uuid()
-- patient_id uuid references patients(id)
-- appointment_id uuid references appointments(id)
-- clinic_id uuid references clinics(id)
-- token text unique not null
-- expires_at timestamptz not null
-- used boolean default false
-- created_at timestamptz default now()

-- intake_forms (token submit path; align with Supabase — create/alter manually)
-- id uuid primary key default gen_random_uuid()
-- patient_id uuid references patients(id)
-- appointment_id uuid references appointments(id)
-- clinic_id uuid references clinics(id)
-- chief_complaint text
-- pain_scale integer
-- symptom_duration text
-- mechanism_of_injury text
-- medications text
-- allergies text
-- medical_conditions text
-- previous_treatments text
-- consent_to_treatment boolean
-- submitted_at timestamptz default now()
"""

from __future__ import annotations

import logging
import re
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from dateutil import parser as date_parser
from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from zoneinfo import ZoneInfo

from app.db import supabase
from app.retry_utils import supabase_execute
from app.services.system_tasks import (
    TASK_INCOMPLETE_INTAKE,
    ensure_incomplete_intake_task,
    resolve_system_task,
)
from app.routers.questionnaires import _questionnaire_for_body_region
from app.sms import send_sms
from routers.fee_schedule import _resolve_bearer_user_id

router = APIRouter()
logger = logging.getLogger(__name__)


def _digits(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\D", "", str(s))


def _require_intake_secret(x_intake_secret: Optional[str]) -> Optional[JSONResponse]:
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    incoming = (x_intake_secret or "").strip()
    if not expected or not incoming or not secrets.compare_digest(incoming, expected):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return None


def _strip_nonempty(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


class IntakeSubmission(BaseModel):
    phone_number: str
    chief_complaint: str = ""
    pain_scale: int = Field(ge=1, le=10)
    symptom_duration: str = ""
    aggravating_factors: str = ""
    relieving_factors: str = ""
    medical_history_flags: list[Any] | str = Field(default_factory=list)
    allergies: str = ""
    other_conditions: str = ""
    goals: str = ""
    patient_dob: Optional[str] = None
    patient_gender: Optional[str] = None
    patient_occupation: Optional[str] = None
    patient_email: Optional[str] = None
    patient_address_line1: Optional[str] = None
    patient_city: Optional[str] = None
    patient_state: Optional[str] = None
    patient_zip: Optional[str] = None


def _patient_demographic_updates(body: IntakeSubmission) -> dict[str, Any]:
    """Map optional intake body fields to patients table columns (non-empty only)."""
    out: dict[str, Any] = {}
    dob_raw = _strip_nonempty(body.patient_dob)
    if dob_raw:
        try:
            out["date_of_birth"] = date_parser.parse(dob_raw).date().isoformat()
        except (ValueError, TypeError, OverflowError):
            pass
    mapping: tuple[tuple[Optional[str], str], ...] = (
        (body.patient_gender, "gender"),
        (body.patient_occupation, "occupation"),
        (body.patient_email, "email"),
        (body.patient_address_line1, "address_line1"),
        (body.patient_city, "city"),
        (body.patient_state, "state"),
        (body.patient_zip, "zip"),
    )
    for raw, col in mapping:
        s = _strip_nonempty(raw)
        if s:
            out[col] = s
    return out


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


_QUESTIONNAIRE_BASE_URL = (
    os.environ.get("QUESTIONNAIRE_BASE_URL") or "https://altheon.app"
).rstrip("/")


def _maybe_send_questionnaire_sms_after_intake(
    *,
    patient_id: str,
    appointment_id: str,
    clinic_id: str,
    symptom_location: Optional[str],
) -> None:
    """Best-effort questionnaire SMS after intake submit; never raises."""
    try:
        questionnaire_type = _questionnaire_for_body_region(symptom_location or "")
        if not questionnaire_type:
            return

        existing = supabase_execute(
                    lambda: supabase.table("questionnaire_tokens")
                    .select("id")
                    .eq("appointment_id", appointment_id.strip())
                    .eq("questionnaire_type", questionnaire_type.strip())
                    .eq("used", False)
                    .limit(1)
                    .execute()
                )
        if existing.data:
            return

        pt_resp = supabase_execute(
                    lambda: supabase.table("patients")
                    .select("first_name, phone")
                    .eq("id", patient_id.strip())
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

        _clinic_name = _fetch_clinic_display_name(clinic_id)

        token = secrets.token_hex(32)
        ins = supabase_execute(
                    lambda: supabase.table("questionnaire_tokens")
                    .insert(
                        {
                            "token": token,
                            "patient_id": patient_id.strip(),
                            "appointment_id": appointment_id.strip(),
                            "clinic_id": clinic_id.strip(),
                            "questionnaire_type": questionnaire_type,
                            "used": False,
                        }
                    )
                    .execute()
                )
        if getattr(ins, "error", None):
            return

        url = (
            f"{_QUESTIONNAIRE_BASE_URL}/questionnaires/{questionnaire_type}.html"
            f"?token={token}"
        )
        message = (
            f"Hi {first_name}! Thanks for completing your intake. Your clinician "
            f"has one more short questionnaire for you — it takes about 3 minutes: "
            f"{url} — Reply STOP to opt out."
        )
        send_sms(
            clinic_id.strip(),
            _to_e164_us(phone_raw),
            message,
            patient_id=patient_id.strip(),
            appointment_id=appointment_id.strip(),
            message_type=f"questionnaire_{questionnaire_type}",
        )
    except Exception:
        logger.exception(
            "questionnaire SMS after intake failed appointment_id=%s",
            appointment_id,
        )


def _normalize_pref_lang(code: Optional[str]) -> str:
    if code is None or str(code).strip() == "":
        return "en"
    c = str(code).strip().lower()
    if c in ("en", "english", "eng"):
        return "en"
    if c in ("es", "spa", "spanish", "espanol", "español"):
        return "es"
    if c in ("fr", "fra", "french", "francais", "français"):
        return "fr"
    return "en"


def _clinic_tz_name(tz_raw: Optional[str]) -> str:
    s = (tz_raw or "").strip()
    if not s:
        return "America/New_York"
    try:
        ZoneInfo(s)
    except Exception:
        return "America/New_York"
    return s


def _local_date_bounds_utc(d: date, tz_name: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(_clinic_tz_name(tz_name))
    start_local = datetime.combine(d, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
    )


def _parse_start_dt(value: Any) -> datetime:
    s = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _reminder_sms_body(
    lang: str,
    first_name: str,
    clinic_name: str,
    days: int,
    token: str,
    base_url: str,
) -> str:
    fn = (first_name or "there").strip() or "there"
    cn = (clinic_name or "the clinic").strip() or "the clinic"
    form_url = f"{base_url.rstrip('/')}/intake/form?token={token}"
    intake_url = f"{base_url.rstrip('/')}/intake"
    if lang == "es":
        return (
            f"Hola {fn}, su cita en {cn} es en {days} días. "
            f"Complete su formulario de ingreso:\n"
            f"📋 Formulario: {form_url}\n"
            f"🎙️ Prefiere hablar? {intake_url}"
        )
    if lang == "fr":
        return (
            f"Bonjour {fn}, votre rendez-vous à {cn} est dans "
            f"{days} jours. Veuillez compléter votre dossier:\n"
            f"📋 Formulaire: {form_url}\n"
            f"🎙️ Préférez parler? {intake_url}"
        )
    return (
        f"Hi {fn}, your appointment at {cn} is in {days} days! "
        f"Please complete your intake beforehand:\n"
        f"📋 Fill out a form: {form_url}\n"
        f"🎙️ Prefer to talk? {intake_url}"
    )


def _token_expires_at_utc(
    appointment_start_utc: datetime, tz_name: str
) -> datetime:
    """End of calendar day (local) following the appointment's local date."""
    tz = ZoneInfo(_clinic_tz_name(tz_name))
    local = appointment_start_utc.astimezone(tz)
    end_day = local.date() + timedelta(days=1)
    end_local = datetime.combine(end_day, time(23, 59, 59), tzinfo=tz)
    return end_local.astimezone(timezone.utc)


def _fetch_clinic_display_name(clinic_id: str) -> str:
    cid = str(clinic_id or "").strip()
    if not cid:
        return ""
    try:
        resp = supabase_execute(
                    lambda: supabase.table("clinics")
                    .select("name, brand_name")
                    .eq("id", cid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(resp)
        rows = resp.data or []
        if not rows:
            return ""
        r = rows[0]
        for key in ("brand_name", "name"):
            v = r.get(key)
            if v is not None and str(v).strip():
                return str(v).strip()
        return ""
    except HTTPException:
        return ""
    except Exception:
        logger.exception("fetch clinic name failed clinic_id=%s", cid)
        return ""


def _intake_token_exists_for_appointment(appointment_id: str) -> bool:
    return _get_intake_token_for_appointment(appointment_id) is not None


def _is_token_used(row: dict[str, Any]) -> bool:
    u = row.get("used")
    return u is True or str(u).lower() in ("true", "t", "1")


def _get_intake_token_for_appointment(appointment_id: str) -> Optional[dict[str, Any]]:
    aid = str(appointment_id or "").strip()
    if not aid:
        return None
    try:
        q = supabase_execute(
                    lambda: supabase.table("intake_tokens")
                    .select("id, token, used, expires_at")
                    .eq("appointment_id", aid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(q)
        rows = q.data or []
        return rows[0] if rows and isinstance(rows[0], dict) else None
    except Exception:
        logger.exception("intake_tokens lookup failed appointment_id=%s", aid)
        return None


def _fetch_clinic_timezone(clinic_id: str, cache: dict[str, str]) -> str:
    cid = str(clinic_id or "").strip()
    if not cid:
        return _clinic_tz_name("")
    if cid in cache:
        return cache[cid]
    tz_raw = ""
    try:
        resp = supabase_execute(
                    lambda: supabase.table("clinic_settings")
                    .select("timezone")
                    .eq("clinic_id", cid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(resp)
        rows = resp.data or []
        if rows and isinstance(rows[0], dict):
            tz_raw = str(rows[0].get("timezone") or "")
    except Exception:
        logger.exception("clinic timezone lookup failed clinic_id=%s", cid)
    cache[cid] = _clinic_tz_name(tz_raw)
    return cache[cid]


def _followup_sms_body(lang: str, token: str, base_url: str) -> str:
    form_url = f"{base_url.rstrip('/')}/intake/form?token={token}"
    if lang == "es":
        return (
            "¡Su cita es mañana! Si aún no completó su formulario de ingreso, "
            "use este enlace. Si ya lo completó, no necesita hacer nada.\n"
            f"{form_url}"
        )
    if lang == "fr":
        return (
            "Votre rendez-vous est demain! Si vous n'avez pas encore complété "
            "votre formulaire, voici le lien. Sinon, aucune action requise.\n"
            f"{form_url}"
        )
    return (
        "Your appointment is tomorrow! If you haven't completed your intake "
        "form yet, here's the link. If you already have, no action needed.\n"
        f"{form_url}"
    )


def _appointments_in_hours_window(hours_lo: float, hours_hi: float) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    start_utc = now + timedelta(hours=hours_lo)
    end_utc = now + timedelta(hours=hours_hi)
    try:
        apq = supabase_execute(
                    lambda: supabase.table("appointments")
                    .select("id, patient_id, clinic_id, start_time, status")
                    .gte("start_time", start_utc.isoformat())
                    .lt("start_time", end_utc.isoformat())
                    .execute()
                )
        _handle_supabase_error(apq)
        return [r for r in (apq.data or []) if isinstance(r, dict)]
    except Exception:
        logger.exception(
            "appointments window query failed hours=%s-%s", hours_lo, hours_hi
        )
        return []


def _intake_sms_sent(appointment_id: str, message_type: str) -> bool:
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
        _handle_supabase_error(resp)
        return bool(resp.data)
    except Exception:
        logger.exception("sms_logs lookup failed appointment_id=%s", aid)
        return False


def _days_until_appointment(start_time: Any) -> int:
    start_dt = _parse_start_dt(start_time)
    now = datetime.now(timezone.utc)
    delta = start_dt - now
    days = int(delta.total_seconds() // 86400)
    if delta.total_seconds() > 0 and delta.total_seconds() % 86400:
        days += 1
    return max(1, days)


def _ensure_intake_token(
    appointment_id: str,
    patient_id: str,
    clinic_id: str,
    start_time: Any,
    clinic_tz: str,
) -> Optional[str]:
    existing = _get_intake_token_for_appointment(appointment_id)
    if existing:
        tok = str(existing.get("token") or "").strip()
        return tok or None
    token = secrets.token_urlsafe(32)
    start_dt = _parse_start_dt(start_time)
    expires_dt = _token_expires_at_utc(start_dt, clinic_tz)
    ins = supabase_execute(
            lambda: supabase.table("intake_tokens")
            .insert(
                {
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "clinic_id": clinic_id,
                    "token": token,
                    "expires_at": expires_dt.isoformat(),
                    "used": False,
                }
            )
            .execute()
        )
    _handle_supabase_error(ins)
    if not ins.data:
        return None
    return token


def _patient_has_prior_completed_appointment(
    patient_id: str,
    clinic_id: str,
    appointment_id: str,
) -> bool:
    pid = str(patient_id or "").strip()
    cid = str(clinic_id or "").strip()
    aid = str(appointment_id or "").strip()
    if not pid or not cid or not aid:
        return False
    try:
        resp = supabase_execute(
                    lambda: supabase.table("appointments")
                    .select("id")
                    .eq("patient_id", pid)
                    .eq("clinic_id", cid)
                    .eq("status", "completed")
                    .neq("id", aid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(resp)
        return bool(resp.data)
    except Exception:
        logger.exception(
            "prior completed appointment lookup failed patient_id=%s clinic_id=%s",
            pid,
            cid,
        )
        return False


def send_booking_intake_sms(
    *,
    appointment_id: str,
    patient_id: str,
    clinic_id: str,
    start_time_iso: str,
    patient_phone: Optional[str],
    patient_first_name: str = "",
    preferred_language: Optional[str] = None,
) -> Optional[str]:
    """Create intake token if needed and send initial intake SMS at booking."""
    ensure_incomplete_intake_task(
        clinic_id=clinic_id,
        appointment_id=appointment_id,
        patient_id=patient_id,
        start_time=start_time_iso,
    )

    if _patient_has_prior_completed_appointment(
        patient_id, clinic_id, appointment_id
    ):
        print(f"intake SMS skipped — returning patient {patient_id}")
        return None

    if not (patient_phone and str(patient_phone).strip()):
        return None
    if _intake_sms_sent(appointment_id, "intake_reminder"):
        return None

    base = (os.environ.get("FRONTEND_URL") or "").strip()
    if not base:
        logger.warning("FRONTEND_URL not set; skipping booking intake SMS")
        return None

    clinic_tz = _fetch_clinic_timezone(clinic_id, {})
    token = _ensure_intake_token(
        appointment_id,
        patient_id,
        clinic_id,
        start_time_iso,
        clinic_tz,
    )
    if not token:
        return None

    days = _days_until_appointment(start_time_iso)
    clinic_name = _fetch_clinic_display_name(clinic_id)
    pref = _normalize_pref_lang(preferred_language)
    body = _reminder_sms_body(
        pref,
        patient_first_name,
        clinic_name,
        days,
        token,
        base,
    )
    return send_sms(
        clinic_id,
        _to_e164_us(str(patient_phone)),
        body,
        patient_id=patient_id,
        appointment_id=appointment_id,
        message_type="intake_reminder",
    )


@router.post("/intake")
def submit_intake(
    body: IntakeSubmission,
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    unauthorized = _require_intake_secret(x_intake_secret)
    if unauthorized is not None:
        return unauthorized

    clean_phone = _digits(body.phone_number)
    if not clean_phone:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    try:
        patients_resp = supabase_execute(
                    lambda: supabase.table("patients").select("id, phone").execute()
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patient_row = next(
        (
            row
            for row in (patients_resp.data or [])
            if _digits(row.get("phone")) == clean_phone
        ),
        None,
    )
    if not patient_row:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    patient_id = str(patient_row.get("id") or "").strip()
    if not patient_id:
        return JSONResponse(status_code=404, content={"error": "Patient not found"})

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        appt_resp = supabase_execute(
                    lambda: supabase.table("appointments")
                    .select("id, patient_id, clinic_id, start_time")
                    .eq("patient_id", patient_id)
                    .in_("status", ["scheduled", "confirmed"])
                    .gte("start_time", now_iso)
                    .order("start_time", desc=False)
                    .limit(1)
                    .execute()
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    appt_rows = appt_resp.data or []
    if not appt_rows:
        return JSONResponse(
            status_code=404,
            content={"error": "No upcoming appointment found for this patient"},
        )
    appt = appt_rows[0]
    appointment_id = str(appt.get("id") or "").strip()
    clinic_id = str(appt.get("clinic_id") or "").strip()
    if not appointment_id or not clinic_id:
        return JSONResponse(
            status_code=404,
            content={"error": "No upcoming appointment found for this patient"},
        )

    if isinstance(body.medical_history_flags, str):
        medical_history_flags = [
            part.strip()
            for part in body.medical_history_flags.split(",")
            if part.strip()
        ]
    else:
        medical_history_flags = body.medical_history_flags

    insert_row = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "chief_complaint": body.chief_complaint,
        "pain_scale": body.pain_scale,
        "symptom_duration": body.symptom_duration,
        "aggravating_factors": body.aggravating_factors,
        "relieving_factors": body.relieving_factors,
        "medical_history_flags": medical_history_flags,
        "allergies": body.allergies,
        "other_conditions": body.other_conditions,
        "goals": body.goals,
        "completed_at": now_iso,
    }

    ins = supabase_execute(
            lambda: supabase.table("intake_forms").insert(insert_row).execute()
        )
    data = getattr(ins, "data", None) or []
    if not data:
        err = getattr(ins, "error", None)
        msg = getattr(err, "message", None) or str(err) if err else "Insert failed"
        raise HTTPException(status_code=500, detail=msg)

    intake_id = data[0].get("id")

    try:
        demo_updates = _patient_demographic_updates(body)
        if demo_updates:
            supabase_execute(
                            lambda: supabase.table("patients").update(demo_updates).eq("id", patient_id).execute()
                        )
    except Exception as exc:
        print(
            f"POST /intake: could not update patient {patient_id} demographics: {exc}",
            flush=True,
        )

    try:
        supabase_execute(
                    lambda: supabase.table("appointments").update({"status": "checked_in"}).eq(
                    "id", appointment_id
                ).execute()
                )
    except Exception as exc:
        print(
            f"POST /intake: could not set appointment {appointment_id} to checked_in: {exc}",
            flush=True,
        )

    resolve_system_task(clinic_id, TASK_INCOMPLETE_INTAKE, appointment_id)

    return {
        "success": True,
        "intake_id": str(intake_id),
        "appointment_id": appointment_id,
    }


@router.get("/intake/patient/{patient_id}")
def list_intakes_for_patient(
    patient_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _resolve_bearer_user_id(authorization)

    try:
        resp = supabase_execute(
                    lambda: supabase.table("intake_forms")
                    .select(
                        "id,appointment_id,patient_id,chief_complaint,pain_scale,"
                        "symptom_duration,aggravating_factors,relieving_factors,"
                        "medical_history_flags,allergies,other_conditions,goals,created_at"
                    )
                    .eq("patient_id", patient_id)
                    .order("created_at", desc=True)
                    .execute()
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = getattr(resp, "data", None) or []
    return {"intakes": rows}


@router.post("/intake/send-reminders")
def send_intake_reminders():
    """Cron (~24h before): nudge patients who have not completed intake."""
    base = (os.environ.get("FRONTEND_URL") or "").strip()
    if not base:
        raise HTTPException(
            status_code=500,
            detail="FRONTEND_URL environment variable is not set",
        )

    sent = 0
    skipped = 0
    errors = 0

    for ap in _appointments_in_hours_window(20, 28):
        st_ap = str(ap.get("status") or "").lower().replace(" ", "_")
        if st_ap in ("cancelled", "canceled", "completed"):
            skipped += 1
            continue

        appt_id = str(ap.get("id") or "").strip()
        patient_id = str(ap.get("patient_id") or "").strip()
        clinic_id = str(ap.get("clinic_id") or "").strip()
        if not appt_id or not patient_id or not clinic_id:
            errors += 1
            continue

        try:
            if _patient_has_prior_completed_appointment(
                patient_id, clinic_id, appt_id
            ):
                print(f"intake reminder skipped — returning patient {patient_id}")
                skipped += 1
                continue

            tok_row = _get_intake_token_for_appointment(appt_id)
            if not tok_row or _is_token_used(tok_row):
                skipped += 1
                continue

            if _intake_sms_sent(appt_id, "intake_reminder"):
                skipped += 1
                continue

            if _intake_sms_sent(appt_id, "intake_followup_reminder"):
                skipped += 1
                continue

            token = str(tok_row.get("token") or "").strip()
            if not token:
                errors += 1
                continue

            pt_resp = supabase_execute(
                            lambda: supabase.table("patients")
                            .select("phone, preferred_language")
                            .eq("id", patient_id)
                            .limit(1)
                            .execute()
                        )
            _handle_supabase_error(pt_resp)
            prow = (pt_resp.data or [None])[0]
            if not isinstance(prow, dict) or not prow.get("phone"):
                errors += 1
                continue

            pref = _normalize_pref_lang(prow.get("preferred_language"))
            sms_body = _followup_sms_body(pref, token, base)
            sid = send_sms(
                clinic_id,
                _to_e164_us(str(prow["phone"])),
                sms_body,
                patient_id=patient_id,
                appointment_id=appt_id,
                message_type="intake_followup_reminder",
            )
            if sid is None:
                errors += 1
            else:
                sent += 1
        except Exception:
            logger.exception(
                "intake 24h reminder failed appt_id=%s patient_id=%s",
                appt_id,
                patient_id,
            )
            errors += 1

    return {"sent": sent, "skipped": skipped, "errors": errors}


def _parse_expires_at(raw: Any) -> datetime:
    if raw is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _inspect_intake_token(token: str) -> tuple[str, Optional[dict]]:
    """not_found | already_completed | expired | valid"""
    t = (token or "").strip()
    if not t:
        return "not_found", None
    resp = supabase_execute(
            lambda: supabase.table("intake_tokens")
            .select(
                "id, patient_id, appointment_id, clinic_id, token, expires_at, used"
            )
            .eq("token", t)
            .limit(1)
            .execute()
        )
    _handle_supabase_error(resp)
    rows = resp.data or []
    if not rows:
        return "not_found", None
    row = rows[0]
    u = row.get("used")
    if u is True or str(u).lower() in ("true", "t", "1"):
        return "already_completed", row
    exp_dt = _parse_expires_at(row.get("expires_at"))
    if exp_dt < datetime.now(timezone.utc):
        return "expired", row
    return "valid", row


@router.get("/intake/form/{token}")
def get_intake_form_prefill(token: str):
    try:
        status, row = _inspect_intake_token(token)
        if status == "not_found":
            raise HTTPException(status_code=404, detail="Token not found")
        if status == "already_completed":
            return {"status": "already_completed"}
        if status == "expired":
            return JSONResponse(
                status_code=400,
                content={"status": "expired"},
            )
        if row is None:
            raise HTTPException(status_code=500, detail="Invalid token state")
        pid = str(row.get("patient_id") or "").strip()
        aid = str(row.get("appointment_id") or "").strip()
        if not pid or not aid:
            raise HTTPException(status_code=500, detail="Invalid token row")

        pt = supabase_execute(
                    lambda: supabase.table("patients")
                    .select("first_name, last_name, phone, preferred_language")
                    .eq("id", pid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(pt)
        pt_row = (pt.data or [None])[0]
        if not isinstance(pt_row, dict):
            raise HTTPException(status_code=404, detail="Patient not found")

        ap = supabase_execute(
                    lambda: supabase.table("appointments")
                    .select("start_time, clinician_id")
                    .eq("id", aid)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(ap)
        ap_row = (ap.data or [None])[0]
        if not isinstance(ap_row, dict):
            raise HTTPException(status_code=404, detail="Appointment not found")

        start_raw = ap_row.get("start_time")
        start_dt = _parse_start_dt(start_raw)
        tz_name = _clinic_tz_name(None)
        try:
            cs = supabase_execute(
                            lambda: supabase.table("clinic_settings")
                            .select("timezone")
                            .eq("clinic_id", str(row.get("clinic_id") or ""))
                            .limit(1)
                            .execute()
                        )
            _handle_supabase_error(cs)
            crows = cs.data or []
            if crows and crows[0].get("timezone"):
                tz_name = _clinic_tz_name(str(crows[0].get("timezone")))
        except Exception:
            pass
        appt_local = start_dt.astimezone(ZoneInfo(tz_name))
        appointment_date = appt_local.date().isoformat()

        return {
            "status": "valid",
            "patient": {
                "first_name": pt_row.get("first_name"),
                "last_name": pt_row.get("last_name"),
                "phone": pt_row.get("phone"),
                "preferred_language": pt_row.get("preferred_language"),
            },
            "appointment": {
                "appointment_date": appointment_date,
                "start_time": start_raw,
                "clinician_id": ap_row.get("clinician_id"),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class IntakeTokenSubmitBody(BaseModel):
    token: str = Field(..., min_length=1)
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    chief_complaint: str = Field(..., min_length=1)
    pain_scale: Optional[int] = Field(default=None, ge=1, le=10)
    symptom_duration: Optional[str] = None
    mechanism_of_injury: Optional[str] = None
    medications: Optional[str] = None
    allergies: Optional[str] = None
    medical_conditions: Optional[str] = None
    previous_treatments: Optional[str] = None
    symptom_location: Optional[str] = None
    consent_to_treatment: bool

    @model_validator(mode="after")
    def consent_must_be_true(self) -> "IntakeTokenSubmitBody":
        if not self.consent_to_treatment:
            raise ValueError("consent_to_treatment must be true to submit")
        return self


@router.post("/intake/form/submit")
def submit_intake_token_form(body: IntakeTokenSubmitBody):
    try:
        status, row = _inspect_intake_token(body.token.strip())
        if status == "not_found":
            raise HTTPException(status_code=404, detail="Token not found")
        if status == "already_completed":
            raise HTTPException(
                status_code=400,
                detail={"status": "already_completed"},
            )
        if status == "expired":
            raise HTTPException(status_code=400, detail={"status": "expired"})
        assert row is not None
        pid = str(row.get("patient_id") or "").strip()
        aid = str(row.get("appointment_id") or "").strip()
        cid = str(row.get("clinic_id") or "").strip()
        tok_id = str(row.get("id") or "").strip()
        if not pid or not aid or not cid or not tok_id:
            raise HTTPException(status_code=500, detail="Invalid token row")

        patient_updates: dict[str, Any] = {}
        if body.date_of_birth is not None and str(body.date_of_birth).strip():
            try:
                patient_updates["date_of_birth"] = date_parser.parse(
                    str(body.date_of_birth).strip()
                ).date().isoformat()
            except (ValueError, TypeError, OverflowError):
                pass
        if body.gender is not None and str(body.gender).strip():
            patient_updates["gender"] = str(body.gender).strip()
        if body.address is not None and str(body.address).strip():
            patient_updates["address_line1"] = str(body.address).strip()
        if body.email is not None and str(body.email).strip():
            patient_updates["email"] = str(body.email).strip()

        if patient_updates:
            upd = supabase_execute(
                            lambda: supabase.table("patients")
                            .update(patient_updates)
                            .eq("id", pid)
                            .execute()
                        )
            _handle_supabase_error(upd)

        intake_row: dict[str, Any] = {
            "patient_id": pid,
            "appointment_id": aid,
            "clinic_id": cid,
            "chief_complaint": body.chief_complaint.strip(),
            "symptom_duration": (body.symptom_duration or "").strip() or None,
            "mechanism_of_injury": (body.mechanism_of_injury or "").strip() or None,
            "medications": (body.medications or "").strip() or None,
            "allergies": (body.allergies or "").strip() or None,
            "medical_conditions": (body.medical_conditions or "").strip() or None,
            "previous_treatments": (body.previous_treatments or "").strip() or None,
            "consent_to_treatment": bool(body.consent_to_treatment),
        }
        if body.pain_scale is not None:
            intake_row["pain_scale"] = int(body.pain_scale)
        if body.symptom_location is not None and str(body.symptom_location).strip():
            intake_row["symptom_location"] = str(body.symptom_location).strip()

        intake_row["completed_at"] = datetime.now(timezone.utc).isoformat()

        ins = supabase_execute(
                    lambda: supabase.table("intake_forms").insert(intake_row).execute()
                )
        _handle_supabase_error(ins)
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to save intake form")

        mark = supabase_execute(
                    lambda: supabase.table("intake_tokens")
                    .update({"used": True})
                    .eq("id", tok_id)
                    .execute()
                )
        _handle_supabase_error(mark)

        try:
            _maybe_send_questionnaire_sms_after_intake(
                patient_id=pid,
                appointment_id=aid,
                clinic_id=cid,
                symptom_location=body.symptom_location,
            )
        except Exception:
            pass

        resolve_system_task(cid, TASK_INCOMPLETE_INTAKE, aid)

        return {"status": "success", "message": "Intake submitted successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/intake/{appointment_id}")
def get_intake_for_appointment(
    appointment_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    _resolve_bearer_user_id(authorization)

    try:
        resp = supabase_execute(
                    lambda: supabase.table("intake_forms")
                    .select(
                        "id,appointment_id,patient_id,chief_complaint,pain_scale,"
                        "symptom_duration,aggravating_factors,relieving_factors,"
                        "medical_history_flags,allergies,other_conditions,goals,created_at"
                    )
                    .eq("appointment_id", appointment_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = getattr(resp, "data", None) or []
    if not rows:
        return {"intake": None}
    return {"intake": rows[0]}
