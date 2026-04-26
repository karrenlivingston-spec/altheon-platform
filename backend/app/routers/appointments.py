from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import supabase

router = APIRouter()


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

    return {
        "success": True,
        "appointment_id": appointment_rows[0]["id"],
        "patient_id": patient_id,
    }
