from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.db import supabase

router = APIRouter()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


@router.get("")
def list_patients(clinic_id: str = Query(...)):
    """Return all patients linked to a clinic via patient_clinic_access."""
    try:
        resp = (
            supabase.table("patient_clinic_access")
            .select("patients(*)")
            .eq("clinic_id", clinic_id)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    patients = []
    for row in rows:
        p = row.get("patients")
        if isinstance(p, dict):
            patients.append(p)
        elif isinstance(p, list):
            patients.extend(x for x in p if isinstance(x, dict))
    return patients
