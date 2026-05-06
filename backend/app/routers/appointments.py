import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

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
                "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,"
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

    clinic_tz = ZoneInfo("America/New_York")
    try:
        refetch = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,"
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
                    "id,start_time,end_time,status,source,patient_id,clinician_id,location_id,"
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
            .select("id,clinic_id")
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
    clinic_id = str(rows[0].get("clinic_id") or "").strip()
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
        if _is_blocked_time(payload.clinician_id, payload.start_time, payload.end_time):
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
