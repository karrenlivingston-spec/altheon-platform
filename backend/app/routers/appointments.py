import logging
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.constants import STTPDN_CLINIC_ID
from app.db import supabase
from app.sms import send_sms

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
def list_appointments(clinic_id: str = Query(...)):
    """Return all appointments for a clinic with patient names and treatment type name."""
    try:
        resp = (
            supabase.table("appointments")
            .select(
                "id, clinic_id, patient_id, clinician_id, location_id, treatment_type_id, "
                "start_time, end_time, status, notes, created_at, "
                "patients(first_name, last_name), treatment_types(name)"
            )
            .eq("clinic_id", clinic_id)
            .order("start_time")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return resp.data or []


@router.patch("/{appointment_id}/status")
def update_appointment_status(
    appointment_id: str,
    body: dict,
    clinic_id: str = Query(...),
):
    logger.debug(
        "PATCH /appointments/%s/status clinic_id=%s body=%s",
        appointment_id,
        clinic_id,
        body,
    )
    status = body.get("status")
    if status not in ["scheduled", "checked_in", "completed", "cancelled"]:
        logger.debug(
            "PATCH appointment status rejected invalid status=%r appointment_id=%s",
            status,
            appointment_id,
        )
        raise HTTPException(status_code=400, detail="Invalid status")

    try:
        result = (
            supabase.table("appointments")
            .update({"status": status})
            .eq("id", appointment_id)
            .eq("clinic_id", clinic_id)
            .execute()
        )
        err = getattr(result, "error", None)
        logger.debug(
            "PATCH appointment status Supabase response appointment_id=%s data=%s error=%s",
            appointment_id,
            result.data,
            err,
        )
        if not result.data:
            logger.warning(
                "PATCH appointment status no row updated appointment_id=%s clinic_id=%s status=%s",
                appointment_id,
                clinic_id,
                status,
            )
            raise HTTPException(status_code=404, detail="Appointment not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "PATCH appointment status Supabase update failed appointment_id=%s clinic_id=%s",
            appointment_id,
            clinic_id,
        )
        raise HTTPException(status_code=500, detail=str(e)) from e


class CreateAppointmentRequest(BaseModel):
    clinic_id: str
    clinician_id: str
    location_id: str
    treatment_type_id: str
    start_time: str
    end_time: str
    patient_first_name: str
    patient_last_name: str
    patient_phone: str
    patient_email: Optional[str] = None
    notes: Optional[str] = None


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _format_confirmation_sms(start_time_iso: str, first_name: str) -> str:
    s = str(start_time_iso).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_e = dt.astimezone(ZoneInfo("America/New_York"))
    day_name = dt_e.strftime("%A")
    date_part = f"{dt_e.month}/{dt_e.day}/{dt_e.year}"
    h12 = dt_e.hour % 12 or 12
    time_part = f"{h12}:{dt_e.minute:02d} {dt_e.strftime('%p')}"
    fn = (first_name or "there").strip() or "there"
    return (
        f"Hi {fn}! Your appointment at Straight To The Point Dry Needling is "
        f"confirmed for {day_name}, {date_part} at {time_part}. "
        f"Questions? Call us at 561-772-5799. Reply STOP to opt out."
    )


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


@router.post("")
def create_appointment(payload: CreateAppointmentRequest):
    try:
        patient_lookup = (
            supabase.table("patients")
            .select("id")
            .eq("phone", payload.patient_phone)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(patient_lookup)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patient_data = patient_lookup.data or []
    if patient_data:
        patient_id = patient_data[0]["id"]
    else:
        try:
            patient_insert = (
                supabase.table("patients")
                .insert(
                    {
                        "first_name": payload.patient_first_name,
                        "last_name": payload.patient_last_name,
                        "phone": payload.patient_phone,
                        "email": payload.patient_email,
                        "clinic_id": STTPDN_CLINIC_ID,
                    }
                )
                .execute()
            )
            _handle_supabase_error(patient_insert)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        inserted_patients = patient_insert.data or []
        if not inserted_patients:
            raise HTTPException(status_code=500, detail="Failed to create patient")
        patient_id = inserted_patients[0]["id"]

    try:
        access_lookup = (
            supabase.table("patient_clinic_access")
            .select("id")
            .eq("patient_id", patient_id)
            .eq("clinic_id", payload.clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(access_lookup)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not (access_lookup.data or []):
        try:
            access_insert = (
                supabase.table("patient_clinic_access")
                .insert({"patient_id": patient_id, "clinic_id": payload.clinic_id})
                .execute()
            )
            _handle_supabase_error(access_insert)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        appointment_insert = (
            supabase.table("appointments")
            .insert(
                {
                    "clinic_id": payload.clinic_id,
                    "patient_id": patient_id,
                    "clinician_id": payload.clinician_id,
                    "location_id": payload.location_id,
                    "treatment_type_id": payload.treatment_type_id,
                    "start_time": payload.start_time,
                    "end_time": payload.end_time,
                    "notes": payload.notes,
                    "source": "ai",
                    "status": "scheduled",
                }
            )
            .execute()
        )
        _handle_supabase_error(appointment_insert)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    appointment_rows = appointment_insert.data or []
    if not appointment_rows:
        raise HTTPException(status_code=500, detail="Failed to create appointment")

    appointment_id = str(appointment_rows[0]["id"])

    try:
        pt_msg = (
            supabase.table("patients")
            .select("first_name, phone")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(pt_msg)
        prow = (pt_msg.data or [{}])[0]
        phone_out = prow.get("phone") or payload.patient_phone
        fname = (prow.get("first_name") or payload.patient_first_name or "").strip()
        if phone_out:
            body = _format_confirmation_sms(payload.start_time, fname)
            send_sms(
                _to_e164_us(str(phone_out)),
                body,
                patient_id=str(patient_id),
                appointment_id=appointment_id,
                message_type="confirmation",
            )
    except Exception:
        logger.exception(
            "confirmation SMS failed appointment_id=%s patient_id=%s",
            appointment_id,
            patient_id,
        )

    return {
        "success": True,
        "appointment_id": appointment_id,
        "patient_id": patient_id,
    }
