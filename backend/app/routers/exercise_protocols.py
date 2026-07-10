"""Clinic exercise protocol library — read-only retrieval (Programs foundation)."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.db import supabase
from app.dependencies.permissions import CLINICAL_ROLES, enforce_clinic_role_from_auth_header
from app.retry_utils import supabase_execute

router = APIRouter()
logger = logging.getLogger(__name__)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _shape_exercise(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "exercise_name": row.get("exercise_name"),
        "sets": row.get("sets"),
        "reps": row.get("reps"),
        "frequency": row.get("frequency"),
        "notes": row.get("notes"),
        "sort_order": row.get("sort_order"),
    }


def _shape_protocol(row: dict[str, Any]) -> dict[str, Any]:
    raw_exercises = row.get("protocol_exercises") or []
    if isinstance(raw_exercises, dict):
        raw_exercises = [raw_exercises]
    exercises = sorted(
        [_shape_exercise(ex) for ex in raw_exercises if isinstance(ex, dict)],
        key=lambda ex: int(ex.get("sort_order") or 0),
    )
    return {
        "id": row.get("id"),
        "clinic_id": row.get("clinic_id"),
        "name": row.get("name"),
        "phase_number": row.get("phase_number"),
        "description": row.get("description"),
        "created_by_clinician_id": row.get("created_by_clinician_id"),
        "created_at": row.get("created_at"),
        "exercises": exercises,
    }


@router.get("/exercise-protocols")
def list_exercise_protocols(
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """Return all exercise protocols for a clinic, with nested exercises per phase."""
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *CLINICAL_ROLES,
    )
    cid = auth.clinic_id

    try:
        resp = supabase_execute(
            lambda: (
                supabase.table("exercise_protocols")
                .select(
                    "id, clinic_id, name, phase_number, description, "
                    "created_by_clinician_id, created_at, "
                    "protocol_exercises(id, exercise_name, sets, reps, frequency, notes, sort_order)"
                )
                .eq("clinic_id", cid)
                .order("phase_number")
                .execute()
            )
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    protocols = [_shape_protocol(row) for row in (resp.data or [])]
    return protocols
