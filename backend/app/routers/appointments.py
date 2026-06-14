import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import pytz
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.constants import STTPDN_CLINIC_ID
from app.db import supabase
from app.google_calendar import (
    create_calendar_event,
    delete_calendar_event,
    update_calendar_event,
)
from app.routers.intake import send_booking_intake_sms
from app.services.waitlist import run_waitlist_notify_for_freed_slot
from app.sms import send_sms

router = APIRouter()
logger = logging.getLogger(__name__)
# SQL migration (run manually):
# ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'aria';


@router.get("")
def list_appointments(clinic_id: str = Query(...)):
    """Return all appointments for a clinic with patient names and treatment type name."""
    try:
        resp = (
            supabase.table("appointments")
            .select(
                "id, clinic_id, patient_id, clinician_id, location_id, treatment_type_id, "
                "start_time, end_time, status, notes, created_at, "
                "patients(first_name, last_name), treatment_types(name), "
                "clinicians(first_name, last_name)"
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


class AppointmentStatusPatchBody(BaseModel):
    status: str = Field(...)


class AppointmentTimePatchBody(BaseModel):
    start_time: str = Field(...)


class AppointmentSwapBody(BaseModel):
    appointment_id_1: str = Field(...)
    appointment_id_2: str = Field(...)


class PatientFlowStats(BaseModel):
    total: int
    new_patients: int
    scheduled: int
    checked_in: int
    completed: int
    cancelled: int
    no_show: int
    rescheduled: int


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def _resolve_bearer_user_id(authorization: Optional[str]) -> str:
    token = _extract_bearer_token(authorization)
    try:
        auth_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    user_obj = getattr(auth_response, "user", None)
    if user_obj is None and isinstance(auth_response, dict):
        user_obj = auth_response.get("user")

    user_id = str(getattr(user_obj, "id", None) or "").strip()
    if not user_id and isinstance(user_obj, dict):
        user_id = str(user_obj.get("id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user_id


def _assert_user_has_clinic_access(user_id: str, clinic_id: str) -> None:
    try:
        access = (
            supabase.table("clinic_users")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(access)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not access.data:
        raise HTTPException(status_code=403, detail="No clinic access for user")


@router.get("/patient-flow")
def get_patient_flow(
    clinic_id: str = Query(...),
    date_ymd: Optional[str] = Query(default=None, alias="date"),
):
    target_date_str = (date_ymd or datetime.now(ZoneInfo("America/New_York")).date().isoformat()).strip()
    try:
        target_date = date.fromisoformat(target_date_str)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc

    clinic_tz = ZoneInfo("America/New_York")
    day_start_local = datetime.combine(target_date, time(0, 0), tzinfo=clinic_tz)
    day_end_local = day_start_local + timedelta(days=1)
    day_start_utc = day_start_local.astimezone(timezone.utc)
    day_end_utc = day_end_local.astimezone(timezone.utc)

    try:
        ap_resp = (
            supabase.table("appointments")
            .select(
                "id,clinic_id,patient_id,clinician_id,location_id,treatment_type_id,"
                "start_time,end_time,status,source,"
                "patients(id,first_name,last_name,phone,created_at),"
                "clinicians(id,first_name,last_name,color,title),"
                "treatment_types(name,duration_minutes)"
            )
            .eq("clinic_id", clinic_id)
            .gte("start_time", day_start_utc.isoformat())
            .lt("start_time", day_end_utc.isoformat())
            .order("start_time")
            .execute()
        )
        _handle_supabase_error(ap_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ap_resp.data or []
    patient_ids = sorted(
        {
            str(r.get("patient_id") or "").strip()
            for r in rows
            if str(r.get("patient_id") or "").strip()
        }
    )
    first_appt_by_patient: dict[str, datetime] = {}
    if patient_ids:
        try:
            hist_resp = (
                supabase.table("appointments")
                .select("patient_id,start_time")
                .eq("clinic_id", clinic_id)
                .in_("patient_id", patient_ids)
                .order("start_time")
                .execute()
            )
            _handle_supabase_error(hist_resp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        for hr in hist_resp.data or []:
            pid = str(hr.get("patient_id") or "").strip()
            if not pid or pid in first_appt_by_patient:
                continue
            start_raw = str(hr.get("start_time") or "").strip()
            if not start_raw:
                continue
            try:
                dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            first_appt_by_patient[pid] = dt.astimezone(clinic_tz)

    stats = {
        "total": len(rows),
        "new_patients": 0,
        "scheduled": 0,
        "checked_in": 0,
        "completed": 0,
        "cancelled": 0,
        "no_show": 0,
        "rescheduled": 0,
    }
    out_rows: list[dict[str, Any]] = []
    for r in rows:
        status = str(r.get("status") or "scheduled").strip().lower()
        if status == "confirmed":
            stats["scheduled"] += 1
        elif status in stats:
            stats[status] += 1

        start_raw = str(r.get("start_time") or "").strip()
        try:
            dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            local = dt.astimezone(clinic_tz)
            start_display = local.strftime("%H:%M")
        except ValueError:
            start_display = ""

        patient = r.get("patients") or {}
        clinician = r.get("clinicians") or {}
        treatment = r.get("treatment_types") or {}
        pid = str(patient.get("id") or r.get("patient_id") or "").strip()
        first_dt = first_appt_by_patient.get(pid)
        is_new_patient = bool(first_dt and first_dt.date().isoformat() == target_date_str)
        if is_new_patient:
            stats["new_patients"] += 1

        out_rows.append(
            {
                "id": r.get("id"),
                "start_time": start_display,
                "duration_minutes": int(treatment.get("duration_minutes") or 0),
                "status": status,
                "source": r.get("source") or "manual",
                "is_new_patient": is_new_patient,
                "location_id": r.get("location_id"),
                "patient": {
                    "id": pid or r.get("patient_id"),
                    "first_name": patient.get("first_name"),
                    "last_name": patient.get("last_name"),
                    "phone": patient.get("phone"),
                },
                "clinician": {
                    "id": clinician.get("id") or r.get("clinician_id"),
                    "first_name": clinician.get("first_name"),
                    "last_name": clinician.get("last_name"),
                    "title": clinician.get("title"),
                    "color": clinician.get("color"),
                },
                "treatment_type": {
                    "name": treatment.get("name"),
                    "duration_minutes": int(treatment.get("duration_minutes") or 0),
                },
            }
        )

    return {
        "date": target_date_str,
        "stats": PatientFlowStats(**stats).model_dump(),
        "appointments": out_rows,
    }


def _format_calendar_appt_row(
    r: dict[str, Any],
    first_appt_by_patient: dict[str, datetime],
    clinic_tz: ZoneInfo,
) -> dict[str, Any]:
    patient = r.get("patients") or {}
    clinician = r.get("clinicians") or {}
    treatment = r.get("treatment_types") or {}
    pid = str(patient.get("id") or r.get("patient_id") or "").strip()
    start_raw = str(r.get("start_time") or "").strip()
    appt_date_str = ""
    try:
        dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(clinic_tz)
        appt_date_str = local.date().isoformat()
    except ValueError:
        pass
    first_dt = first_appt_by_patient.get(pid)
    is_new_patient = bool(
        first_dt and appt_date_str and first_dt.date().isoformat() == appt_date_str
    )
    return {
        "id": str(r.get("id")),
        "start_time": start_raw,
        "end_time": str(r.get("end_time") or ""),
        "status": str(r.get("status") or "scheduled"),
        "source": r.get("source") or "manual",
        "location_id": str(r.get("location_id") or ""),
        "is_virtual": bool(r.get("is_virtual")),
        "is_new_patient": is_new_patient,
        "patient": {
            "id": pid or str(r.get("patient_id") or ""),
            "first_name": patient.get("first_name"),
            "last_name": patient.get("last_name"),
            "phone": patient.get("phone"),
        },
        "clinician": {
            "id": str(clinician.get("id") or r.get("clinician_id") or ""),
            "first_name": clinician.get("first_name"),
            "last_name": clinician.get("last_name"),
            "title": clinician.get("title"),
            "color": clinician.get("color") or "#0EA5A4",
        },
        "treatment_type": {
            "name": treatment.get("name"),
            "duration_minutes": int(treatment.get("duration_minutes") or 0),
        },
    }


@router.get("/calendar")
def get_appointments_calendar(
    start_date: str = Query(...),
    end_date: str = Query(...),
    clinic_id: str = Query(...),
    clinician_id: Optional[str] = Query(default=None),
):
    clinic_tz = ZoneInfo("America/New_York")
    try:
        sd = date.fromisoformat(start_date.strip())
        ed = date.fromisoformat(end_date.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="start_date and end_date must be YYYY-MM-DD",
        ) from exc
    if ed < sd:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

    range_start_local = datetime.combine(sd, time(0, 0), tzinfo=clinic_tz)
    range_end_exclusive = datetime.combine(ed + timedelta(days=1), time(0, 0), tzinfo=clinic_tz)
    range_start_utc = range_start_local.astimezone(timezone.utc)
    range_end_utc = range_end_exclusive.astimezone(timezone.utc)

    try:
        q = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,is_virtual,"
                "patients(id,first_name,last_name,phone),"
                "clinicians(id,first_name,last_name,color,title),"
                "treatment_types(name,duration_minutes)"
            )
            .eq("clinic_id", clinic_id)
            .neq("status", "cancelled")
            .gte("start_time", range_start_utc.isoformat())
            .lt("start_time", range_end_utc.isoformat())
            .order("start_time")
        )
        if clinician_id and clinician_id.strip():
            q = q.eq("clinician_id", clinician_id.strip())
        ap_resp = q.execute()
        _handle_supabase_error(ap_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ap_resp.data or []
    patient_ids = sorted(
        {
            str(r.get("patient_id") or "").strip()
            for r in rows
            if str(r.get("patient_id") or "").strip()
        }
    )
    first_appt_by_patient: dict[str, datetime] = {}
    if patient_ids:
        try:
            hist_resp = (
                supabase.table("appointments")
                .select("patient_id,start_time")
                .eq("clinic_id", clinic_id)
                .in_("patient_id", patient_ids)
                .order("start_time")
                .execute()
            )
            _handle_supabase_error(hist_resp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        for hr in hist_resp.data or []:
            pid = str(hr.get("patient_id") or "").strip()
            if not pid or pid in first_appt_by_patient:
                continue
            start_raw_h = str(hr.get("start_time") or "").strip()
            if not start_raw_h:
                continue
            try:
                dth = datetime.fromisoformat(start_raw_h.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dth.tzinfo is None:
                dth = dth.replace(tzinfo=timezone.utc)
            first_appt_by_patient[pid] = dth.astimezone(clinic_tz)

    appointments = [_format_calendar_appt_row(r, first_appt_by_patient, clinic_tz) for r in rows]
    return {"appointments": appointments}


def _duration_minutes_from_appt_row(row: dict[str, Any]) -> int:
    treatment = row.get("treatment_types") or {}
    d = int(treatment.get("duration_minutes") or 0)
    if d > 0:
        return d
    try:
        s = datetime.fromisoformat(str(row.get("start_time")).replace("Z", "+00:00"))
        e = datetime.fromisoformat(str(row.get("end_time")).replace("Z", "+00:00"))
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if e.tzinfo is None:
            e = e.replace(tzinfo=timezone.utc)
        mins = int((e - s).total_seconds() // 60)
        return mins if mins > 0 else 30
    except Exception:
        return 30


@router.get("/{appointment_id}")
def get_appointment(
    appointment_id: str,
    clinic_id: str = Query(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    """Single appointment for calendar popup enrichment."""
    user_id = _resolve_bearer_user_id(authorization)
    _assert_user_has_clinic_access(user_id, clinic_id)
    try:
        resp = (
            supabase.table("appointments")
            .select(
                "id, clinic_id, patient_id, clinician_id, start_time, end_time, status, notes, "
                "patients(first_name, last_name, phone, insurance_carrier), "
                "treatment_types(name), clinicians(first_name, last_name)"
            )
            .eq("id", appointment_id)
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Appointment not found")
    row = rows[0]
    patient = row.get("patients") or {}
    clinician = row.get("clinicians") or {}
    treatment = row.get("treatment_types") or {}
    p_fn = str(patient.get("first_name") or "").strip()
    p_ln = str(patient.get("last_name") or "").strip()
    c_fn = str(clinician.get("first_name") or "").strip()
    c_ln = str(clinician.get("last_name") or "").strip()
    return {
        "id": row.get("id"),
        "patient_id": row.get("patient_id"),
        "patient_name": f"{p_fn} {p_ln}".strip(),
        "patient_phone": patient.get("phone"),
        "clinician_name": f"{c_fn} {c_ln}".strip(),
        "appointment_type": treatment.get("name"),
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
        "status": row.get("status"),
        "insurance_carrier": patient.get("insurance_carrier"),
        "diagnosis_code": None,
    }


def _maybe_notify_waitlist_for_freed_slot(
    clinic_id: str,
    clinician_id: str,
    start_time: str,
    end_time: str,
) -> None:
    """Best-effort waitlist SMS; never affects the caller's HTTP response."""
    if not clinic_id or not clinician_id or not start_time or not end_time:
        return
    run_waitlist_notify_for_freed_slot(
        supabase,
        clinic_id,
        clinician_id,
        start_time,
        end_time,
    )


@router.patch("/{appointment_id}/time")
def update_appointment_time(
    appointment_id: str,
    body: AppointmentTimePatchBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    try:
        ap_resp = (
            supabase.table("appointments")
            .select(
                "id,clinic_id,patient_id,clinician_id,location_id,start_time,end_time,status,source,"
                "treatment_types(duration_minutes)"
            )
            .eq("id", appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(ap_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows_a = ap_resp.data or []
    if not rows_a:
        raise HTTPException(status_code=404, detail="Appointment not found")
    row = rows_a[0]
    clinic_id = str(row.get("clinic_id") or "").strip()
    if not clinic_id:
        raise HTTPException(status_code=500, detail="Appointment has no clinic_id")
    _assert_user_has_clinic_access(user_id, clinic_id)

    old_start_time = str(row.get("start_time") or "")
    old_end_time = str(row.get("end_time") or "")
    old_clinician_id = str(row.get("clinician_id") or "").strip()
    old_status = str(row.get("status") or "").strip().lower()

    dur = _duration_minutes_from_appt_row(row)
    new_start = _parse_iso_utc(body.start_time)
    new_end = new_start + timedelta(minutes=dur)

    try:
        upd = (
            supabase.table("appointments")
            .update(
                {
                    "start_time": new_start.isoformat(),
                    "end_time": new_end.isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", appointment_id)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    new_start_iso = new_start.isoformat()
    if (
        old_status in {"scheduled", "confirmed"}
        and old_start_time
        and old_end_time
        and old_start_time != new_start_iso
    ):
        _maybe_notify_waitlist_for_freed_slot(
            clinic_id,
            old_clinician_id,
            old_start_time,
            old_end_time,
        )

    clinic_tz = ZoneInfo("America/New_York")
    try:
        refetch = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,is_virtual,"
                "patients(id,first_name,last_name,phone),"
                "clinicians(id,first_name,last_name,color,title),"
                "treatment_types(name,duration_minutes)"
            )
            .eq("id", appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(refetch)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    r_rows = refetch.data or []
    if not r_rows:
        raise HTTPException(status_code=500, detail="Appointment missing after update")
    r0 = r_rows[0]
    patient = r0.get("patients") or {}
    pid = str(patient.get("id") or r0.get("patient_id") or "").strip()
    first_map: dict[str, datetime] = {}
    if pid:
        try:
            hist_resp = (
                supabase.table("appointments")
                .select("patient_id,start_time")
                .eq("clinic_id", clinic_id)
                .eq("patient_id", pid)
                .order("start_time")
                .limit(1)
                .execute()
            )
            _handle_supabase_error(hist_resp)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        hr = (hist_resp.data or [None])[0]
        if hr:
            st = str(hr.get("start_time") or "")
            try:
                dth = datetime.fromisoformat(st.replace("Z", "+00:00"))
                if dth.tzinfo is None:
                    dth = dth.replace(tzinfo=timezone.utc)
                first_map[pid] = dth.astimezone(clinic_tz)
            except ValueError:
                pass

    return _format_calendar_appt_row(r0, first_map, clinic_tz)


@router.post("/swap")
def swap_appointment_times(
    body: AppointmentSwapBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    id1 = body.appointment_id_1.strip()
    id2 = body.appointment_id_2.strip()
    if id1 == id2:
        raise HTTPException(status_code=400, detail="Cannot swap an appointment with itself")

    def fetch_slot(aid: str) -> dict[str, Any]:
        resp = (
            supabase.table("appointments")
            .select("id,clinic_id,start_time,end_time")
            .eq("id", aid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=404, detail=f"Appointment not found: {aid}")
        return rows[0]

    try:
        r1 = fetch_slot(id1)
        r2 = fetch_slot(id2)
    except HTTPException:
        raise

    c1 = str(r1.get("clinic_id") or "")
    c2 = str(r2.get("clinic_id") or "")
    if not c1 or c1 != c2:
        raise HTTPException(
            status_code=400,
            detail="Appointments must belong to the same clinic",
        )
    _assert_user_has_clinic_access(user_id, c1)

    s1, e1 = r1.get("start_time"), r1.get("end_time")
    s2, e2 = r2.get("start_time"), r2.get("end_time")
    now_ts = datetime.now(timezone.utc).isoformat()

    try:
        u1 = (
            supabase.table("appointments")
            .update({"start_time": s2, "end_time": e2, "updated_at": now_ts})
            .eq("id", id1)
            .execute()
        )
        _handle_supabase_error(u1)
        u2 = (
            supabase.table("appointments")
            .update({"start_time": s1, "end_time": e1, "updated_at": now_ts})
            .eq("id", id2)
            .execute()
        )
        _handle_supabase_error(u2)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    clinic_tz = ZoneInfo("America/New_York")
    first_map: dict[str, datetime] = {}
    pids: list[str] = []
    out_rows: list[dict[str, Any]] = []
    try:
        for aid in (id1, id2):
            refetch = (
                supabase.table("appointments")
                .select(
                    "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,is_virtual,"
                    "patients(id,first_name,last_name,phone),"
                    "clinicians(id,first_name,last_name,color,title),"
                    "treatment_types(name,duration_minutes)"
                )
                .eq("id", aid)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(refetch)
            r0 = (refetch.data or [None])[0]
            if r0:
                out_rows.append(r0)
                p = r0.get("patients") or {}
                pid = str(p.get("id") or r0.get("patient_id") or "").strip()
                if pid and pid not in pids:
                    pids.append(pid)

        if pids:
            hist_resp = (
                supabase.table("appointments")
                .select("patient_id,start_time")
                .eq("clinic_id", c1)
                .in_("patient_id", pids)
                .order("start_time")
                .execute()
            )
            _handle_supabase_error(hist_resp)
            for hr in hist_resp.data or []:
                pid = str(hr.get("patient_id") or "").strip()
                if not pid or pid in first_map:
                    continue
                st = str(hr.get("start_time") or "")
                try:
                    dth = datetime.fromisoformat(st.replace("Z", "+00:00"))
                except ValueError:
                    continue
                if dth.tzinfo is None:
                    dth = dth.replace(tzinfo=timezone.utc)
                first_map[pid] = dth.astimezone(clinic_tz)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    formatted = [_format_calendar_appt_row(r, first_map, clinic_tz) for r in out_rows]
    return {"appointments": formatted}


@router.patch("/{appointment_id}/status")
def update_appointment_status(
    appointment_id: str,
    body: AppointmentStatusPatchBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    allowed = {"checked_in", "completed", "no_show", "cancelled"}
    status = (body.status or "").strip().lower()
    if status not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Invalid status. Use checked_in, completed, no_show, or cancelled.",
        )

    try:
        appt = (
            supabase.table("appointments")
            .select(
                "id, clinic_id, google_event_id, clinician_id, start_time, end_time, status"
            )
            .eq("id", appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(appt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    rows = appt.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appt_row = rows[0]
    clinic_id = str(appt_row.get("clinic_id") or "").strip()
    google_event_id = str(appt_row.get("google_event_id") or "").strip()
    freed_clinician_id = str(appt_row.get("clinician_id") or "").strip()
    freed_start_time = str(appt_row.get("start_time") or "")
    freed_end_time = str(appt_row.get("end_time") or "")
    prior_status = str(appt_row.get("status") or "").strip().lower()
    if not clinic_id:
        raise HTTPException(status_code=500, detail="Appointment has no clinic_id")
    _assert_user_has_clinic_access(user_id, clinic_id)

    logger.debug(
        "PATCH /appointments/%s/status clinic_id=%s body=%s user_id=%s",
        appointment_id,
        clinic_id,
        body,
        user_id,
    )

    try:
        result = (
            supabase.table("appointments")
            .update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", appointment_id)
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
        if status == "cancelled" and google_event_id:
            try:
                delete_calendar_event(google_event_id)
            except Exception:
                logger.exception(
                    "google calendar delete failed appointment_id=%s event_id=%s",
                    appointment_id,
                    google_event_id,
                )
        if (
            status == "cancelled"
            and prior_status not in {"cancelled"}
            and freed_start_time
            and freed_end_time
        ):
            _maybe_notify_waitlist_for_freed_slot(
                clinic_id,
                freed_clinician_id,
                freed_start_time,
                freed_end_time,
            )
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
    end_time: Optional[str] = None
    patient_id: Optional[str] = None
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    notes: Optional[str] = None
    source: Optional[str] = None
    preferred_language: Optional[str] = "en"
    is_virtual: Optional[bool] = False


class PatchAppointmentVirtualRequest(BaseModel):
    is_virtual: bool


class RescheduleAppointmentRequest(BaseModel):
    patient_phone: str = Field(...)
    new_date: str = Field(..., description="YYYY-MM-DD")
    new_time: str = Field(..., description="HH:MM (24-hour)")
    preferred_language: Optional[str] = None

    @field_validator("new_date")
    @classmethod
    def _validate_new_date(cls, v: str) -> str:
        s = v.strip()
        date.fromisoformat(s)
        return s

    @field_validator("new_time")
    @classmethod
    def _validate_new_time(cls, v: str) -> str:
        s = v.strip()
        parts = s.split(":")
        if len(parts) != 2:
            raise ValueError("new_time must be HH:MM")
        h, m = int(parts[0]), int(parts[1])
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError("invalid new_time")
        return f"{h:02d}:{m:02d}"


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


_WD_EN = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)
_WD_ES = (
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
)
_WD_FR = (
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
)

_SMS_CONFIRM_TEMPLATES = {
    "en": (
        "Hi {first_name}! Your appointment at STTPDN is confirmed for {day} at {time}.{loc_slot}"
        "Questions? Call 561-772-5799. Reply STOP to opt out."
    ),
    "es": (
        "¡Hola {first_name}! Tu cita en STTPDN está confirmada para el {day} a las {time}.{loc_slot}"
        "¿Preguntas? Llama al 561-772-5799. Responde STOP para cancelar."
    ),
    "fr": (
        "Bonjour {first_name}! Votre rendez-vous chez STTPDN est confirmé pour le {day} à {time}.{loc_slot}"
        "Des questions? Appelez le 561-772-5799. Répondez STOP pour vous désabonner."
    ),
}


def _normalize_preferred_language(code: Optional[str]) -> str:
    """Map stored or incoming codes to en | es | fr; default English."""
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


def _format_sms_day_time_eastern(dt_e: datetime, lang: str) -> tuple[str, str]:
    idx = dt_e.weekday()
    if lang == "es":
        day = f"{_WD_ES[idx]} {dt_e.day}/{dt_e.month}/{dt_e.year}"
    elif lang == "fr":
        day = f"{_WD_FR[idx]} {dt_e.day}/{dt_e.month}/{dt_e.year}"
    else:
        day = f"{_WD_EN[idx]}, {dt_e.month}/{dt_e.day}/{dt_e.year}"
    h12 = dt_e.hour % 12 or 12
    time_part = f"{h12}:{dt_e.minute:02d} {dt_e.strftime('%p')}"
    return day, time_part


def _sms_location_slot(lang: str, clinic_address: Optional[str]) -> str:
    """Space before follow-up sentence, or location line + trailing space (omit if no address)."""
    addr = (clinic_address or "").strip()
    if not addr:
        return " "
    if lang == "es":
        return f" 📍 Ubicación: {addr} "
    if lang == "fr":
        return f" 📍 Adresse: {addr} "
    return f" 📍 Location: {addr} "


def _format_confirmation_sms(
    start_time_iso: str,
    first_name: str,
    preferred_language: Optional[str] = None,
    clinic_address: Optional[str] = None,
) -> str:
    s = str(start_time_iso).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_e = dt.astimezone(ZoneInfo("America/New_York"))
    lang = _normalize_preferred_language(preferred_language)
    day_s, time_s = _format_sms_day_time_eastern(dt_e, lang)
    fn = (first_name or "there").strip() or "there"
    loc_slot = _sms_location_slot(lang, clinic_address)
    template = _SMS_CONFIRM_TEMPLATES.get(lang, _SMS_CONFIRM_TEMPLATES["en"])
    return template.format(
        first_name=fn, day=day_s, time=time_s, loc_slot=loc_slot
    )


def _fetch_clinic_address(clinic_id: str) -> Optional[str]:
    """Return clinics.address for SMS; None if missing, empty, or on error."""
    cid = str(clinic_id or "").strip()
    if not cid:
        return None
    try:
        resp = (
            supabase.table("clinics")
            .select("address")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except Exception:
        logger.exception("fetch clinic address failed clinic_id=%s", cid)
        return None
    rows = resp.data or []
    if not rows:
        return None
    raw = rows[0].get("address")
    if raw is None:
        return None
    out = str(raw).strip()
    return out or None


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _parse_iso_utc(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_blocked_time(clinician_id: str, start_time: str, end_time: str) -> bool:
    start_dt = _parse_iso_utc(start_time)
    end_dt = _parse_iso_utc(end_time)
    query = (
        supabase.table("blocked_time")
        .select("id,start_time,end_time")
        .eq("clinician_id", clinician_id)
        .lt("start_time", end_dt.isoformat())
        .gt("end_time", start_dt.isoformat())
        .limit(1)
        .execute()
    )
    _handle_supabase_error(query)
    return bool(query.data)


def _duration_minutes_from_reschedule_row(row: dict[str, Any]) -> int:
    treatment = row.get("treatment_types") or {}
    if isinstance(treatment, list):
        treatment = treatment[0] if treatment else {}
    if isinstance(treatment, dict):
        d = int(treatment.get("duration_minutes") or 0)
        if d > 0:
            return d
    try:
        s = datetime.fromisoformat(str(row.get("start_time")).replace("Z", "+00:00"))
        e = datetime.fromisoformat(str(row.get("end_time")).replace("Z", "+00:00"))
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if e.tzinfo is None:
            e = e.replace(tzinfo=timezone.utc)
        mins = int((e - s).total_seconds() // 60)
        return mins if mins > 0 else 30
    except Exception:
        return 30


def _patient_name_from_row(row: dict[str, Any]) -> str:
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "Patient"


def _clinician_name_from_row(row: dict[str, Any]) -> str:
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "Unknown"


@router.post("/reschedule")
def reschedule_appointment(payload: RescheduleAppointmentRequest):
    """Cancel the patient's next upcoming visit and book a new one; clinician, treatment, and location carry over."""
    patient_phone = payload.patient_phone.strip()
    if not patient_phone:
        raise HTTPException(status_code=400, detail="patient_phone is required")

    print(f"Looking up patient by phone: {patient_phone}")

    clean_input = re.sub(r"\D", "", patient_phone)
    if not clean_input:
        raise HTTPException(status_code=400, detail="patient_phone has no digits")

    clinic_id_for_lookup = STTPDN_CLINIC_ID
    try:
        all_patients = (
            supabase.table("patients")
            .select("id, phone, first_name, last_name, preferred_language")
            .eq("clinic_id", clinic_id_for_lookup)
            .execute()
        )
        _handle_supabase_error(all_patients)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patient = next(
        (
            p
            for p in (all_patients.data or [])
            if re.sub(r"\D", "", str(p.get("phone") or "")) == clean_input
        ),
        None,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient_id = str(patient["id"])
    print(f"Found patient: {patient_id}")

    if payload.preferred_language is not None:
        new_lang = str(payload.preferred_language).strip()
        if new_lang:
            try:
                supabase.table("patients").update({"preferred_language": new_lang}).eq(
                    "id", patient_id
                ).execute()
                patient["preferred_language"] = new_lang
            except Exception:
                logger.exception(
                    "reschedule: failed to update preferred_language patient_id=%s",
                    patient_id,
                )

    try:
        result = (
            supabase.table("appointments")
            .select("*")
            .eq("patient_id", patient_id)
            .in_("status", ["scheduled", "confirmed"])
            .order("start_time", desc=False)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    erows = result.data or []
    if not erows:
        raise HTTPException(
            status_code=404,
            detail="No active appointment found for this patient",
        )
    row = erows[0]
    old_appointment_id = str(row.get("id") or "").strip()
    print(f"Found appointment to reschedule: {result.data[0]['id']}")
    if not old_appointment_id:
        print("ERROR: old_appointment_id is None or empty before cancel; aborting")
        raise HTTPException(
            status_code=500,
            detail="Could not resolve existing appointment id to cancel",
        )

    clinician_id = str(row.get("clinician_id") or "")
    treatment_type_id = str(row.get("treatment_type_id") or "")
    location_id = str(row.get("location_id") or "")
    clinic_id = str(row.get("clinic_id") or "")
    if not clinician_id or not treatment_type_id or not location_id or not clinic_id:
        raise HTTPException(
            status_code=500,
            detail="Existing appointment is missing required booking fields",
        )

    old_start_time = str(row.get("start_time") or "")
    old_end_time = str(row.get("end_time") or "")

    eastern = pytz.timezone("America/New_York")
    naive_dt = datetime.strptime(
        f"{payload.new_date} {payload.new_time}", "%Y-%m-%d %H:%M"
    )
    eastern_dt = eastern.localize(naive_dt)
    utc_start = eastern_dt.astimezone(timezone.utc)
    dur = _duration_minutes_from_reschedule_row(row)
    utc_end = utc_start + timedelta(minutes=dur)
    start_iso = utc_start.isoformat()
    end_iso = utc_end.isoformat()

    try:
        if _is_blocked_time(clinician_id, start_iso, end_iso):
            raise HTTPException(
                status_code=409,
                detail="Selected slot falls within blocked time",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    print("Cancelling old appointment...")
    try:
        cancel_updated_at = datetime.now(timezone.utc).isoformat()
        cancel_result = (
            supabase.table("appointments")
            .update({"status": "cancelled", "updated_at": cancel_updated_at})
            .eq("id", old_appointment_id)
            .execute()
        )
        _handle_supabase_error(cancel_result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    print(f"Old appointment cancelled: {cancel_result.data}")

    _maybe_notify_waitlist_for_freed_slot(
        clinic_id,
        clinician_id,
        old_start_time,
        old_end_time,
    )

    cancel_rows = cancel_result.data or []
    if not cancel_rows:
        print(
            f"ERROR: cancel returned no rows for old_appointment_id={old_appointment_id!r}"
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to cancel existing appointment (no row updated)",
        )

    print("Booking new appointment...")
    try:
        ins = (
            supabase.table("appointments")
            .insert(
                {
                    "clinic_id": clinic_id,
                    "patient_id": patient_id,
                    "clinician_id": clinician_id,
                    "location_id": location_id,
                    "treatment_type_id": treatment_type_id,
                    "start_time": start_iso,
                    "end_time": end_iso,
                    "notes": row.get("notes"),
                    "source": "ai",
                    "status": "scheduled",
                }
            )
            .execute()
        )
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    ins_rows = ins.data or []
    if not ins_rows:
        raise HTTPException(status_code=500, detail="Failed to create rescheduled appointment")
    new_appointment_id = str(ins_rows[0]["id"])
    print(f"New appointment booked: {new_appointment_id}")

    try:
        new_appt = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,google_event_id,"
                "patients(first_name,last_name),"
                "clinicians(first_name,last_name),"
                "treatment_types(name)"
            )
            .eq("id", new_appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(new_appt)
        nrow = (new_appt.data or [None])[0]
        if nrow:
            pat = nrow.get("patients") or {}
            cli = nrow.get("clinicians") or {}
            trt = nrow.get("treatment_types") or {}
            patient_name = _patient_name_from_row(pat if isinstance(pat, dict) else {})
            clinician_name = _clinician_name_from_row(
                cli if isinstance(cli, dict) else {}
            )
            treatment_name = str(trt.get("name") or treatment_type_id).strip()
            existing_google_event_id = str(nrow.get("google_event_id") or "").strip()

            if existing_google_event_id:
                update_calendar_event(
                    existing_google_event_id,
                    patient_name,
                    clinician_name,
                    treatment_name,
                    nrow.get("start_time"),
                    nrow.get("end_time"),
                )
            else:
                created_google_event_id = create_calendar_event(
                    appointment_id=new_appointment_id,
                    patient_name=patient_name,
                    clinician_name=clinician_name,
                    treatment_type=treatment_name,
                    start_datetime_utc=nrow.get("start_time"),
                    end_datetime_utc=nrow.get("end_time"),
                    location=None,
                )
                if created_google_event_id:
                    supabase.table("appointments").update(
                        {"google_event_id": created_google_event_id}
                    ).eq("id", new_appointment_id).execute()
    except Exception:
        logger.exception(
            "google calendar sync failed for reschedule appointment_id=%s",
            new_appointment_id,
        )

    try:
        pt_msg = (
            supabase.table("patients")
            .select("first_name, phone, preferred_language")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(pt_msg)
        pr = (pt_msg.data or [{}])[0]
        phone_out = pr.get("phone") or patient_phone
        fname = (pr.get("first_name") or "").strip()
        pref_lang = pr.get("preferred_language")
        if phone_out:
            clinic_addr = _fetch_clinic_address(clinic_id)
            body = _format_confirmation_sms(
                start_iso, fname, pref_lang, clinic_address=clinic_addr
            )
            send_sms(
                clinic_id,
                _to_e164_us(str(phone_out)),
                body,
                patient_id=str(patient_id),
                appointment_id=new_appointment_id,
                message_type="confirmation",
            )
    except Exception:
        logger.exception(
            "reschedule confirmation SMS failed appointment_id=%s patient_id=%s",
            new_appointment_id,
            patient_id,
        )

    return {
        "success": True,
        "appointment_id": new_appointment_id,
        "patient_id": patient_id,
    }


@router.patch("/{appointment_id}/virtual")
def patch_appointment_virtual(
    appointment_id: str,
    body: PatchAppointmentVirtualRequest,
    clinic_id: str = Query(...),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    user_id = _resolve_bearer_user_id(authorization)
    cid = clinic_id.strip()
    _assert_user_has_clinic_access(user_id, cid)

    try:
        appt = (
            supabase.table("appointments")
            .select("id,clinic_id")
            .eq("id", appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(appt)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    rows = appt.data or []
    if not rows or str(rows[0].get("clinic_id") or "") != cid:
        raise HTTPException(status_code=404, detail="Appointment not found")

    try:
        upd = (
            supabase.table("appointments")
            .update({"is_virtual": bool(body.is_virtual)})
            .eq("id", appointment_id)
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {"id": appointment_id, "is_virtual": bool(body.is_virtual)}


@router.post("")
def create_appointment(payload: CreateAppointmentRequest):
    source = (payload.source or "ai").strip().lower() or "ai"
    patient_id = (payload.patient_id or "").strip()
    if not patient_id:
        phone = (payload.patient_phone or "").strip()
        if not phone:
            raise HTTPException(
                status_code=400,
                detail="patient_phone is required when patient_id is not provided",
            )
        try:
            patient_lookup = (
                supabase.table("patients")
                .select("id")
                .eq("phone", phone)
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
            patient_id = str(patient_data[0]["id"])
        else:
            first_name = (payload.patient_first_name or "").strip()
            last_name = (payload.patient_last_name or "").strip()
            if not first_name or not last_name:
                raise HTTPException(
                    status_code=400,
                    detail="patient_first_name and patient_last_name are required for new patient booking",
                )
            try:
                patient_insert = (
                    supabase.table("patients")
                    .insert(
                        {
                            "first_name": first_name,
                            "last_name": last_name,
                            "phone": phone,
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
            patient_id = str(inserted_patients[0]["id"])

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

    pref_raw = payload.preferred_language
    pref_stored = (
        (str(pref_raw).strip() if pref_raw is not None else "") or "en"
    )
    try:
        supabase.table("patients").update({"preferred_language": pref_stored}).eq(
            "id", patient_id
        ).execute()
    except Exception:
        logger.exception(
            "create appointment: failed to update preferred_language patient_id=%s",
            patient_id,
        )

    start_iso = payload.start_time
    if payload.end_time:
        end_iso = payload.end_time
    else:
        try:
            tt = (
                supabase.table("treatment_types")
                .select("duration_minutes")
                .eq("id", payload.treatment_type_id)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(tt)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        trows = tt.data or []
        duration_minutes = int((trows[0] or {}).get("duration_minutes") or 60) if trows else 60
        start_dt = _parse_iso_utc(start_iso)
        end_iso = (start_dt + timedelta(minutes=duration_minutes)).isoformat()

    try:
        if _is_blocked_time(payload.clinician_id, start_iso, end_iso):
            raise HTTPException(
                status_code=409,
                detail="Selected slot falls within blocked time",
            )
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
                    "start_time": start_iso,
                    "end_time": end_iso,
                    "notes": payload.notes,
                    "source": source,
                    "status": "scheduled",
                    "is_virtual": bool(payload.is_virtual),
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
        appt_with_details = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,"
                "patients(first_name,last_name),"
                "clinicians(first_name,last_name),"
                "treatment_types(name)"
            )
            .eq("id", appointment_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(appt_with_details)
        crow = (appt_with_details.data or [None])[0]
        if crow:
            pat = crow.get("patients") or {}
            cli = crow.get("clinicians") or {}
            trt = crow.get("treatment_types") or {}
            patient_name = _patient_name_from_row(
                pat if isinstance(pat, dict) else {}
            ) or f"{payload.patient_first_name} {payload.patient_last_name}".strip()
            clinician_name = _clinician_name_from_row(
                cli if isinstance(cli, dict) else {}
            ) or payload.clinician_id
            treatment_name = str(trt.get("name") or payload.treatment_type_id).strip()

            google_event_id = create_calendar_event(
                appointment_id=appointment_id,
                patient_name=patient_name,
                clinician_name=clinician_name,
                treatment_type=treatment_name,
                start_datetime_utc=crow.get("start_time") or start_iso,
                end_datetime_utc=crow.get("end_time") or end_iso,
                location=None,
            )
            if google_event_id:
                supabase.table("appointments").update(
                    {"google_event_id": google_event_id}
                ).eq("id", appointment_id).execute()
    except Exception:
        logger.exception(
            "google calendar sync failed for create appointment_id=%s",
            appointment_id,
        )

    phone_out: Any = payload.patient_phone
    fname = (payload.patient_first_name or "").strip()
    pref_lang = pref_stored
    try:
        pt_msg = (
            supabase.table("patients")
            .select("first_name, phone, preferred_language")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(pt_msg)
        prow = (pt_msg.data or [{}])[0]
        phone_out = prow.get("phone") or payload.patient_phone
        fname = (prow.get("first_name") or payload.patient_first_name or "").strip()
        pref_lang = prow.get("preferred_language") or pref_stored
        if phone_out:
            clinic_addr = _fetch_clinic_address(payload.clinic_id)
            body = _format_confirmation_sms(
                start_iso, fname, pref_lang, clinic_address=clinic_addr
            )
            send_sms(
                payload.clinic_id,
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

    try:
        send_booking_intake_sms(
            appointment_id=appointment_id,
            patient_id=patient_id,
            clinic_id=payload.clinic_id,
            start_time_iso=start_iso,
            patient_phone=phone_out,
            patient_first_name=fname,
            preferred_language=pref_lang,
        )
    except Exception:
        logger.exception(
            "booking intake SMS failed appointment_id=%s patient_id=%s",
            appointment_id,
            patient_id,
        )

    return {
        "success": True,
        "appointment_id": appointment_id,
        "patient_id": patient_id,
    }
