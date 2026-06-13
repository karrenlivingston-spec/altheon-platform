"""Appointments dashboard API (mounted under /api/appointments)."""

from __future__ import annotations

import traceback
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from app.db import supabase

router = APIRouter()

_CLINIC_TZ = ZoneInfo("America/New_York")
_UTIL_STATUSES = frozenset(
    {"confirmed", "checked_in", "in_progress", "completed"}
)
_MAX_SLOTS_PER_DAY = 8


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _parse_target_date(date_str: Optional[str]) -> date:
    if date_str and str(date_str).strip():
        try:
            return date.fromisoformat(str(date_str).strip()[:10])
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="date must be YYYY-MM-DD"
            ) from exc
    return datetime.now(_CLINIC_TZ).date()


def _day_bounds(target: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(target, time(0, 0), tzinfo=_CLINIC_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _week_bounds(target: date) -> tuple[date, date]:
    monday = target - timedelta(days=target.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _local_date_from_iso(iso: str) -> Optional[date]:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_CLINIC_TZ).date()
    except ValueError:
        return None


def _format_time_ampm(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(_CLINIC_TZ)
        return local.strftime("%I:%M %p").lstrip("0")
    except ValueError:
        return "—"


def _patient_pt_id(patient_id: str) -> str:
    pid = (patient_id or "").strip()
    if not pid:
        return ""
    return f"PT-{pid.replace('-', '')[-6:].upper()}"


def _patient_initials(first: str, last: str) -> str:
    f = (first or "").strip()
    l = (last or "").strip()
    if f and l:
        return f"{f[0]}{l[0]}".upper()
    if f:
        return f[:2].upper()
    if l:
        return l[:2].upper()
    return "?"


def _clinician_display(clinician: dict[str, Any]) -> tuple[str, str]:
    first = str(clinician.get("first_name") or "").strip()
    last = str(clinician.get("last_name") or "").strip()
    title = str(clinician.get("title") or "").strip()
    name = f"{first} {last}".strip()
    if title and title.upper() in ("DPT", "PT", "DC", "MD", "DO", "NP", "PA"):
        prefix = "Dr." if title.upper() in ("DC", "MD", "DO") else ""
        display = f"{prefix} {name}".strip() if prefix else name
    else:
        display = name or "Provider"
    credentials = title if title else ""
    return display, credentials


def _fetch_day_appointments(
    clinic_id: str,
    target: date,
    clinician_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    start_utc, end_utc = _day_bounds(target)
    q = (
        supabase.table("appointments")
        .select(
            "id,start_time,end_time,status,source,notes,is_virtual,patient_id,clinician_id,"
            "patients(first_name,last_name),"
            "clinicians(first_name,last_name,title,color),"
            "treatment_types(name,requires_evaluation)"
        )
        .eq("clinic_id", clinic_id)
        .neq("status", "cancelled")
        .gte("start_time", start_utc.isoformat())
        .lt("start_time", end_utc.isoformat())
        .order("start_time")
    )
    if clinician_id and clinician_id.strip():
        q = q.eq("clinician_id", clinician_id.strip())
    resp = q.execute()
    _handle_supabase_error(resp)
    return [r for r in (resp.data or []) if isinstance(r, dict)]


@router.get("/stats")
def get_appointments_stats(
    clinic_id: str = Query(..., min_length=1),
    date_param: Optional[str] = Query(default=None, alias="date"),
):
    cid = clinic_id.strip()
    target = _parse_target_date(date_param)
    week_start, week_end = _week_bounds(target)
    now_utc = datetime.now(timezone.utc)

    try:
        rows = _fetch_day_appointments(cid, target)
        week_start_utc, _ = _day_bounds(week_start)
        _, week_end_utc = _day_bounds(week_end + timedelta(days=1))

        week_resp = (
            supabase.table("appointments")
            .select("id,status,start_time,end_time")
            .eq("clinic_id", cid)
            .neq("status", "cancelled")
            .gte("start_time", week_start_utc.isoformat())
            .lt("start_time", week_end_utc.isoformat())
            .execute()
        )
        _handle_supabase_error(week_resp)
        week_rows = week_resp.data or []

        appointments_today = len(rows)
        scheduled = sum(1 for r in rows if str(r.get("status") or "") == "scheduled")
        no_shows = sum(1 for r in rows if str(r.get("status") or "") == "no_show")
        no_shows_week = sum(
            1 for r in week_rows if str(r.get("status") or "") == "no_show"
        )

        util_count = sum(
            1 for r in rows if str(r.get("status") or "") in _UTIL_STATUSES
        )
        utilization_pct = (
            round((util_count / appointments_today) * 100)
            if appointments_today
            else 0
        )

        durations: list[float] = []
        week_durations: list[float] = []
        for r in rows:
            if str(r.get("status") or "") != "completed":
                continue
            try:
                st = datetime.fromisoformat(
                    str(r["start_time"]).replace("Z", "+00:00")
                )
                en = datetime.fromisoformat(
                    str(r["end_time"]).replace("Z", "+00:00")
                )
                if st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                if en.tzinfo is None:
                    en = en.replace(tzinfo=timezone.utc)
                mins = (en - st).total_seconds() / 60
                if mins > 0:
                    durations.append(mins)
            except (ValueError, KeyError, TypeError):
                pass

        for r in week_rows:
            if str(r.get("status") or "") != "completed":
                continue
            try:
                st = datetime.fromisoformat(
                    str(r["start_time"]).replace("Z", "+00:00")
                )
                en = datetime.fromisoformat(
                    str(r["end_time"]).replace("Z", "+00:00")
                )
                if st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                if en.tzinfo is None:
                    en = en.replace(tzinfo=timezone.utc)
                mins = (en - st).total_seconds() / 60
                if mins > 0:
                    week_durations.append(mins)
            except (ValueError, KeyError, TypeError):
                pass

        upcoming_count = 0
        for r in rows:
            try:
                st = datetime.fromisoformat(
                    str(r["start_time"]).replace("Z", "+00:00")
                )
                if st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                if st > now_utc:
                    upcoming_count += 1
            except (ValueError, KeyError, TypeError):
                pass

        return {
            "appointments_today": appointments_today,
            "scheduled": scheduled,
            "scheduled_pct": (
                round((scheduled / appointments_today) * 100)
                if appointments_today
                else 0
            ),
            "no_shows": no_shows,
            "no_shows_week": no_shows_week,
            "utilization_pct": utilization_pct,
            "avg_visit_duration_min": (
                round(sum(durations) / len(durations)) if durations else 0
            ),
            "avg_visit_duration_week_min": (
                round(sum(week_durations) / len(week_durations))
                if week_durations
                else 0
            ),
            "upcoming_count": upcoming_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Appointment stats failed: {exc}"
        ) from exc


@router.get("/tasks")
def get_appointments_tasks(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    target = datetime.now(_CLINIC_TZ).date()
    intakes_pending = 0
    consent_forms_missing = 0
    insurance_verifications = 0
    claims_ready = 0

    try:
        rows = _fetch_day_appointments(cid, target)
        appt_ids = [str(r.get("id") or "") for r in rows if r.get("id")]
        patient_ids = list(
            {str(r.get("patient_id") or "") for r in rows if r.get("patient_id")}
        )

        intake_appt_ids: set[str] = set()
        if appt_ids:
            try:
                intake_resp = (
                    supabase.table("intake_forms")
                    .select("appointment_id")
                    .in_("appointment_id", appt_ids)
                    .execute()
                )
                _handle_supabase_error(intake_resp)
                intake_appt_ids = {
                    str(r.get("appointment_id") or "")
                    for r in (intake_resp.data or [])
                    if r.get("appointment_id")
                }
            except Exception:
                try:
                    ci_resp = (
                        supabase.table("clinical_intakes")
                        .select("appointment_id")
                        .in_("appointment_id", appt_ids)
                        .execute()
                    )
                    intake_appt_ids = {
                        str(r.get("appointment_id") or "")
                        for r in (ci_resp.data or [])
                        if r.get("appointment_id")
                    }
                except Exception:
                    pass

        intakes_pending = sum(
            1 for r in rows if str(r.get("id") or "") not in intake_appt_ids
        )

        if appt_ids:
            try:
                consent_resp = (
                    supabase.table("intake_forms")
                    .select("appointment_id,consent_to_treatment")
                    .in_("appointment_id", appt_ids)
                    .execute()
                )
                consented = {
                    str(r.get("appointment_id") or "")
                    for r in (consent_resp.data or [])
                    if r.get("consent_to_treatment") is True
                }
                consent_forms_missing = sum(
                    1 for aid in appt_ids if aid not in consented
                )
            except Exception:
                consent_forms_missing = 0

        if patient_ids:
            try:
                pat_resp = (
                    supabase.table("patients")
                    .select("id,insurance_carrier,insurance_status")
                    .in_("id", patient_ids)
                    .execute()
                )
                unverified = 0
                for p in pat_resp.data or []:
                    status = str(p.get("insurance_status") or "").strip().lower()
                    carrier = str(p.get("insurance_carrier") or "").strip()
                    if status == "verified":
                        continue
                    if status and status != "verified":
                        unverified += 1
                    elif not carrier:
                        unverified += 1
                insurance_verifications = unverified
            except Exception:
                insurance_verifications = 0

        try:
            claims_resp = (
                supabase.table("billing_records")
                .select("id", count="exact")
                .eq("clinic_id", cid)
                .eq("status", "ready_to_submit")
                .execute()
            )
            _handle_supabase_error(claims_resp)
            claims_ready = int(getattr(claims_resp, "count", None) or 0)
            if not claims_ready and claims_resp.data is not None:
                claims_ready = len(claims_resp.data)
        except Exception:
            try:
                draft_resp = (
                    supabase.table("billing_records")
                    .select("id", count="exact")
                    .eq("clinic_id", cid)
                    .eq("status", "draft")
                    .execute()
                )
                claims_ready = len(draft_resp.data or [])
            except Exception:
                claims_ready = 0

        return {
            "intakes_pending": intakes_pending,
            "consent_forms_missing": consent_forms_missing,
            "insurance_verifications": insurance_verifications,
            "claims_ready": claims_ready,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Appointment tasks failed: {exc}"
        ) from exc


@router.get("/utilization")
def get_appointments_utilization(
    clinic_id: str = Query(..., min_length=1),
    date_param: Optional[str] = Query(default=None, alias="date"),
):
    cid = clinic_id.strip()
    target = _parse_target_date(date_param)

    try:
        clinicians_resp = (
            supabase.table("clinicians")
            .select("id,first_name,last_name,title")
            .eq("clinic_id", cid)
            .eq("is_active", True)
            .execute()
        )
        _handle_supabase_error(clinicians_resp)
        clinicians = clinicians_resp.data or []

        rows = _fetch_day_appointments(cid, target)
        by_clinician: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            cid_key = str(r.get("clinician_id") or "")
            by_clinician.setdefault(cid_key, []).append(r)

        out: list[dict[str, Any]] = []
        for c in clinicians:
            cid_key = str(c.get("id") or "")
            appts = by_clinician.get(cid_key, [])
            active = sum(
                1 for a in appts if str(a.get("status") or "") in _UTIL_STATUSES
            )
            total = len(appts)
            denom = max(_MAX_SLOTS_PER_DAY, total)
            pct = round(min(100, (active / denom) * 100))
            name, credentials = _clinician_display(c)
            out.append(
                {
                    "clinician_id": cid_key,
                    "clinician_name": name,
                    "credentials": credentials,
                    "utilization_pct": pct,
                    "appointments_count": total,
                }
            )

        out.sort(key=lambda x: -x["utilization_pct"])
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Utilization failed: {exc}"
        ) from exc


@router.get("/aria-stats")
def get_appointments_aria_stats(
    clinic_id: str = Query(..., min_length=1),
    date_param: Optional[str] = Query(default=None, alias="date"),
):
    cid = clinic_id.strip()
    target = _parse_target_date(date_param)
    start_utc, end_utc = _day_bounds(target)

    result = {
        "calls_today": 0,
        "appointments_booked": 0,
        "reschedules": 0,
        "missed_calls": 0,
    }

    try:
        voice_resp = (
            supabase.table("voice_interaction_logs")
            .select("outcome,intent_detected,success_flag,created_at")
            .eq("clinic_id", cid)
            .gte("created_at", start_utc.isoformat())
            .lt("created_at", end_utc.isoformat())
            .execute()
        )
        _handle_supabase_error(voice_resp)
        calls = voice_resp.data or []
        result["calls_today"] = len(calls)
        for c in calls:
            outcome = str(c.get("outcome") or "").lower()
            intent = str(c.get("intent_detected") or "").lower()
            if "book" in outcome or "appointment" in outcome or "book" in intent:
                result["appointments_booked"] += 1
            if "resched" in outcome or "resched" in intent:
                result["reschedules"] += 1
            if c.get("success_flag") is False:
                result["missed_calls"] += 1
    except Exception:
        traceback.print_exc()

    return result


@router.get("/day-list")
def get_appointments_day_list(
    clinic_id: str = Query(..., min_length=1),
    date_param: Optional[str] = Query(default=None, alias="date"),
    clinician_id: Optional[str] = Query(default=None),
):
    cid = clinic_id.strip()
    target = _parse_target_date(date_param)

    try:
        rows = _fetch_day_appointments(cid, target, clinician_id)
        patient_ids = list(
            {str(r.get("patient_id") or "") for r in rows if r.get("patient_id")}
        )

        appt_count_by_patient: dict[str, int] = {}
        if patient_ids:
            hist = (
                supabase.table("appointments")
                .select("patient_id")
                .eq("clinic_id", cid)
                .in_("patient_id", patient_ids)
                .execute()
            )
            for h in hist.data or []:
                pid = str(h.get("patient_id") or "")
                appt_count_by_patient[pid] = appt_count_by_patient.get(pid, 0) + 1

        intake_appt_ids: set[str] = set()
        appt_ids = [str(r.get("id") or "") for r in rows if r.get("id")]
        if appt_ids:
            try:
                intake_resp = (
                    supabase.table("intake_forms")
                    .select("appointment_id")
                    .in_("appointment_id", appt_ids)
                    .execute()
                )
                intake_appt_ids = {
                    str(r.get("appointment_id") or "")
                    for r in (intake_resp.data or [])
                }
            except Exception:
                pass

        verified_patients: set[str] = set()
        if patient_ids:
            try:
                pat_resp = (
                    supabase.table("patients")
                    .select("id,insurance_status,insurance_carrier")
                    .in_("id", patient_ids)
                    .execute()
                )
                for p in pat_resp.data or []:
                    pid = str(p.get("id") or "")
                    status = str(p.get("insurance_status") or "").strip().lower()
                    if status == "verified":
                        verified_patients.add(pid)
            except Exception:
                pass

        copay_appt_ids: set[str] = set()
        if appt_ids:
            try:
                bill_resp = (
                    supabase.table("billing_records")
                    .select("appointment_id,copay_collected,amount_paid_cents")
                    .in_("appointment_id", appt_ids)
                    .execute()
                )
                for b in bill_resp.data or []:
                    aid = str(b.get("appointment_id") or "")
                    if b.get("copay_collected") is True:
                        copay_appt_ids.add(aid)
                    elif int(b.get("amount_paid_cents") or 0) > 0:
                        copay_appt_ids.add(aid)
            except Exception:
                pass

        out: list[dict[str, Any]] = []
        for r in rows:
            status = str(r.get("status") or "scheduled")
            is_blocked = status == "blocked"
            patient = r.get("patients") or {}
            clinician = r.get("clinicians") or {}
            treatment = r.get("treatment_types") or {}
            pid = str(r.get("patient_id") or "")
            aid = str(r.get("id") or "")

            first = str(patient.get("first_name") or "")
            last = str(patient.get("last_name") or "")
            patient_name = f"{first} {last}".strip() or "—"
            clinician_name, _ = _clinician_display(clinician)
            treatment_name = str(treatment.get("name") or "Appointment")

            visit_subtype = ""
            notes = str(r.get("notes") or "").strip()
            if notes:
                visit_subtype = notes[:80]
            elif treatment.get("requires_evaluation"):
                visit_subtype = "Initial visit"
            else:
                visit_subtype = "Follow-up"

            tags: list[str] = []
            if not is_blocked:
                if appt_count_by_patient.get(pid, 0) <= 1:
                    tags.append("New Patient")
                if aid not in intake_appt_ids:
                    tags.append("Needs Intake")
                if pid in verified_patients:
                    tags.append("Insurance Verified")
                if aid in copay_appt_ids:
                    tags.append("Copay Paid")

            out.append(
                {
                    "id": aid,
                    "start_time": _format_time_ampm(str(r.get("start_time") or "")),
                    "end_time": _format_time_ampm(str(r.get("end_time") or "")),
                    "start_time_iso": str(r.get("start_time") or ""),
                    "patient_name": patient_name if not is_blocked else "Blocked",
                    "patient_avatar_initials": (
                        _patient_initials(first, last) if not is_blocked else "—"
                    ),
                    "patient_pt_id": _patient_pt_id(pid) if not is_blocked else "",
                    "treatment_type": treatment_name if not is_blocked else "Blocked Time",
                    "visit_subtype": visit_subtype if not is_blocked else "",
                    "clinician_name": clinician_name,
                    "clinician_color": str(clinician.get("color") or "#16a34a"),
                    "status": status,
                    "is_virtual": bool(r.get("is_virtual")),
                    "is_blocked": is_blocked,
                    "tags": tags if not is_blocked else [],
                }
            )

        clinician_ids: list[str] = []
        if clinician_id and clinician_id.strip():
            clinician_ids = [clinician_id.strip()]
        else:
            clin_resp = (
                supabase.table("clinicians")
                .select("id")
                .eq("clinic_id", cid)
                .eq("is_active", True)
                .execute()
            )
            clinician_ids = [
                str(c.get("id") or "") for c in (clin_resp.data or []) if c.get("id")
            ]

        date_iso = target.isoformat()
        for cid_key in clinician_ids:
            try:
                block_resp = (
                    supabase.table("blocked_time")
                    .select(
                        "id,clinician_id,start_time,end_time,"
                        "start_time_of_day,end_time_of_day,reason"
                    )
                    .eq("clinician_id", cid_key)
                    .lte("start_time", date_iso)
                    .gte("end_time", date_iso)
                    .execute()
                )
                for b in block_resp.data or []:
                    clin_row = next(
                        (
                            r.get("clinicians") or {}
                            for r in rows
                            if str(r.get("clinician_id") or "") == cid_key
                        ),
                        {},
                    )
                    if not clin_row:
                        cr = (
                            supabase.table("clinicians")
                            .select("first_name,last_name,title,color")
                            .eq("id", cid_key)
                            .limit(1)
                            .execute()
                        )
                        clin_row = (cr.data or [{}])[0]
                    clinician_name, _ = _clinician_display(clin_row)
                    st_tod = str(b.get("start_time_of_day") or "09:00:00")[:5]
                    en_tod = str(b.get("end_time_of_day") or "10:00:00")[:5]
                    try:
                        st_h, st_m = map(int, st_tod.split(":"))
                        en_h, en_m = map(int, en_tod.split(":"))
                        st_label = datetime(2000, 1, 1, st_h, st_m).strftime(
                            "%I:%M %p"
                        ).lstrip("0")
                        en_label = datetime(2000, 1, 1, en_h, en_m).strftime(
                            "%I:%M %p"
                        ).lstrip("0")
                    except ValueError:
                        st_label = st_tod
                        en_label = en_tod

                    out.append(
                        {
                            "id": f"block-{b.get('id')}",
                            "start_time": st_label,
                            "end_time": en_label,
                            "start_time_iso": f"{date_iso}T{st_tod}:00",
                            "patient_name": "Blocked",
                            "patient_avatar_initials": "—",
                            "patient_pt_id": "",
                            "treatment_type": "Blocked Time",
                            "visit_subtype": str(b.get("reason") or ""),
                            "clinician_name": clinician_name,
                            "clinician_color": str(clin_row.get("color") or "#9ca3af"),
                            "status": "blocked",
                            "is_virtual": False,
                            "is_blocked": True,
                            "tags": [],
                        }
                    )
            except Exception:
                pass

        out.sort(key=lambda x: str(x.get("start_time_iso") or ""))
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Day list failed: {exc}"
        ) from exc


@router.get("/upcoming")
def get_upcoming_appointments(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(default=4, ge=1, le=20),
):
    """Next upcoming appointments for the side panel strip."""
    cid = clinic_id.strip()
    now_utc = datetime.now(timezone.utc)
    try:
        resp = (
            supabase.table("appointments")
            .select(
                "id,start_time,end_time,status,"
                "patients(first_name,last_name),"
                "clinicians(first_name,last_name,title),"
                "treatment_types(name)"
            )
            .eq("clinic_id", cid)
            .neq("status", "cancelled")
            .neq("status", "blocked")
            .gte("start_time", now_utc.isoformat())
            .order("start_time")
            .limit(limit)
            .execute()
        )
        _handle_supabase_error(resp)
        out = []
        for r in resp.data or []:
            patient = r.get("patients") or {}
            clinician = r.get("clinicians") or {}
            treatment = r.get("treatment_types") or {}
            first = str(patient.get("first_name") or "")
            last = str(patient.get("last_name") or "")
            clinician_name, _ = _clinician_display(clinician)
            local_date = _local_date_from_iso(str(r.get("start_time") or ""))
            out.append(
                {
                    "id": str(r.get("id") or ""),
                    "day_label": (
                        local_date.strftime("%a") if local_date else "—"
                    ),
                    "date_label": (
                        local_date.strftime("%b %d") if local_date else "—"
                    ),
                    "start_time": _format_time_ampm(str(r.get("start_time") or "")),
                    "patient_name": f"{first} {last}".strip() or "—",
                    "treatment_type": str(treatment.get("name") or "Visit"),
                    "clinician_name": clinician_name,
                    "status": str(r.get("status") or "scheduled"),
                }
            )
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Upcoming appointments failed: {exc}"
        ) from exc
