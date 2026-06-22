"""Patient header stats and overview aggregates for the patient detail panel."""

from __future__ import annotations

import traceback
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from app.db import supabase
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

NY = ZoneInfo("America/New_York")


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _int_cents(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _remaining_cents(row: dict[str, Any]) -> int:
    if row.get("amount_remaining_cents") is not None:
        return _int_cents(row.get("amount_remaining_cents"))
    billed = _int_cents(row.get("total_billed_cents"))
    paid = _int_cents(row.get("amount_paid_cents"))
    return max(0, billed - paid)


def _parse_dt(value: Any) -> Optional[datetime]:
    s = str(value or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt_date_short(value: Any) -> Optional[str]:
    dt = _parse_dt(value)
    if dt:
        return dt.astimezone(NY).strftime("%b %d")
    s = str(value or "")[:10]
    if not s:
        return None
    try:
        d = date.fromisoformat(s)
        return d.strftime("%b %d")
    except ValueError:
        return s


def _fmt_date_long(value: Any) -> Optional[str]:
    dt = _parse_dt(value)
    if dt:
        return dt.astimezone(NY).strftime("%b %d, %Y")
    s = str(value or "")[:10]
    if not s:
        return None
    try:
        return date.fromisoformat(s).strftime("%b %d, %Y")
    except ValueError:
        return s


def _fmt_time(value: Any) -> Optional[str]:
    dt = _parse_dt(value)
    if not dt:
        return None
    return dt.astimezone(NY).strftime("%I:%M %p").lstrip("0")


def _clinician_name(c: Any) -> str:
    if isinstance(c, list):
        c = c[0] if c else None
    if not isinstance(c, dict):
        return "—"
    fn = str(c.get("first_name") or "").strip()
    ln = str(c.get("last_name") or "").strip()
    if ln:
        return f"Dr. {ln}"
    return fn or "—"


def _treatment_name(t: Any) -> str:
    if isinstance(t, list):
        t = t[0] if t else None
    if not isinstance(t, dict):
        return "—"
    return str(t.get("name") or "").strip() or "—"


def _patient_display_id(patient_id: str) -> str:
    tail = patient_id.replace("-", "")[-6:].upper()
    return f"PT-{tail}"


@router.get("/patients/{patient_id}/header-stats")
def patient_header_stats(patient_id: str, clinic: ClinicUserDep):
    try:
        pid = patient_id.strip()
        cid = clinic.clinic_id
        if not pid:
            raise HTTPException(status_code=400, detail="Invalid patient_id")

        patient_resp = (
            supabase.table("patients")
            .select("*")
            .eq("id", pid)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(patient_resp)
        patients = patient_resp.data or []
        if not patients:
            raise HTTPException(status_code=404, detail="Patient not found")
        patient = patients[0]

        now_utc = datetime.now(timezone.utc)

        appt_resp = (
            supabase.table("appointments")
            .select(
                "id, start_time, status, treatment_type_id, "
                "treatment_types(name), clinicians(first_name, last_name)"
            )
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .order("start_time", desc=True)
            .execute()
        )
        _handle_supabase_error(appt_resp)
        appointments = appt_resp.data or []

        billing_resp = (
            supabase.table("billing_records")
            .select(
                "id, total_billed_cents, amount_paid_cents, amount_remaining_cents, "
                "status, insurance_carrier, notes, claim_number"
            )
            .eq("clinic_id", cid)
            .eq("patient_id", pid)
            .execute()
        )
        _handle_supabase_error(billing_resp)
        billing_rows = billing_resp.data or []

        balance_due_cents = sum(
            _remaining_cents(r)
            for r in billing_rows
            if str(r.get("status") or "").lower() != "paid"
        )

        past_appts = [
            a
            for a in appointments
            if (_parse_dt(a.get("start_time")) or now_utc) <= now_utc
        ]
        future_appts = [
            a
            for a in appointments
            if (_parse_dt(a.get("start_time")) or now_utc) > now_utc
        ]
        future_appts.sort(
            key=lambda a: str(a.get("start_time") or ""),
        )
        past_appts.sort(
            key=lambda a: str(a.get("start_time") or ""),
            reverse=True,
        )

        last_visit = past_appts[0] if past_appts else None
        next_appt = future_appts[0] if future_appts else None

        total_visits = len(appointments)
        completed_visits = sum(
            1
            for a in appointments
            if str(a.get("status") or "").lower() == "completed"
        )
        care_plan_label = (
            f"{completed_visits}/{total_visits}" if total_visits > 0 else "—"
        )

        carrier = str(patient.get("insurance_carrier") or "").strip()
        insurance_status = "Active" if carrier else "None"

        outcome_score: Optional[str] = None
        try:
            om_resp = (
                supabase.table("outcome_measure_results")
                .select("score, percentage, completed_at")
                .eq("patient_id", pid)
                .eq("clinic_id", cid)
                .order("completed_at", desc=True)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(om_resp)
            if om_resp.data:
                row = om_resp.data[0]
                pct = row.get("percentage")
                score = row.get("score")
                if pct is not None:
                    outcome_score = f"{pct}%"
                elif score is not None:
                    outcome_score = str(score)
        except Exception:
            traceback.print_exc()

        treating_provider = "—"
        if past_appts:
            treating_provider = _clinician_name(past_appts[0].get("clinicians"))
        elif appointments:
            treating_provider = _clinician_name(appointments[0].get("clinicians"))

        tags: list[str] = []
        complaint = str(patient.get("primary_complaint") or "").strip()
        if complaint:
            for word in complaint.replace(",", " ").split():
                w = word.strip().strip(".")
                if len(w) > 2 and w.lower() not in {"and", "the", "for", "with"}:
                    tags.append(w)
                    if len(tags) >= 4:
                        break
        for row in billing_rows:
            cn = str(row.get("claim_number") or "").strip()
            if cn and cn not in tags:
                tags.append(cn)
            if len(tags) >= 6:
                break

        upcoming = []
        for a in future_appts[:3]:
            st = a.get("start_time")
            upcoming.append(
                {
                    "id": str(a.get("id") or ""),
                    "start_time": st,
                    "month_label": _fmt_date_short(st),
                    "time_label": _fmt_time(st),
                    "treatment_type": _treatment_name(a.get("treatment_types")),
                    "clinician_name": _clinician_name(a.get("clinicians")),
                    "status": str(a.get("status") or "scheduled"),
                }
            )

        activities: list[dict[str, Any]] = []
        try:
            notes_resp = (
                supabase.table("clinical_notes")
                .select("id, signed_at, status")
                .eq("clinic_id", cid)
                .eq("patient_id", pid)
                .not_.is_("signed_at", "null")
                .order("signed_at", desc=True)
                .limit(5)
                .execute()
            )
            _handle_supabase_error(notes_resp)
            for n in notes_resp.data or []:
                ts = n.get("signed_at")
                if not ts:
                    continue
                activities.append(
                    {
                        "type": "note",
                        "description": "Clinical note signed",
                        "timestamp": ts,
                        "badge": "Clinical Notes",
                        "link_to": "/admin/clinical-notes",
                    }
                )
        except Exception:
            traceback.print_exc()

        record_ids = [str(r.get("id") or "") for r in billing_rows if r.get("id")]
        if record_ids:
            try:
                pay_resp = (
                    supabase.table("billing_payments")
                    .select("amount_cents, payment_date, billing_record_id")
                    .in_("billing_record_id", record_ids)
                    .order("payment_date", desc=True)
                    .limit(5)
                    .execute()
                )
                _handle_supabase_error(pay_resp)
                for p in pay_resp.data or []:
                    activities.append(
                        {
                            "type": "payment",
                            "description": f"Payment received — ${_int_cents(p.get('amount_cents')) / 100:,.2f}",
                            "timestamp": str(p.get("payment_date") or ""),
                            "badge": "Billing",
                            "link_to": "/admin/billing",
                        }
                    )
            except Exception:
                traceback.print_exc()

        try:
            intake_resp = (
                supabase.table("intake_forms")
                .select("id, completed_at")
                .eq("clinic_id", cid)
                .eq("patient_id", pid)
                .order("completed_at", desc=True)
                .limit(3)
                .execute()
            )
            _handle_supabase_error(intake_resp)
            for f in intake_resp.data or []:
                ts = f.get("completed_at")
                if not ts:
                    continue
                activities.append(
                    {
                        "type": "intake",
                        "description": "Intake form submitted",
                        "timestamp": ts,
                        "badge": "Intake",
                        "link_to": "/admin/patients",
                    }
                )
        except Exception:
            traceback.print_exc()

        activities.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
        recent_activity = activities[:5]

        insurance_balance_cents = sum(
            _remaining_cents(r)
            for r in billing_rows
            if str(r.get("status") or "").lower() in ("submitted", "partial", "pending")
        )
        patient_balance_cents = max(0, balance_due_cents - insurance_balance_cents)

        return {
            "patient_display_id": _patient_display_id(pid),
            "insurance_status": insurance_status,
            "insurance_carrier": carrier or None,
            "last_visit_date": _fmt_date_short(last_visit.get("start_time")) if last_visit else None,
            "last_visit_clinician": _clinician_name(last_visit.get("clinicians")) if last_visit else None,
            "next_appointment_date": _fmt_date_short(next_appt.get("start_time")) if next_appt else None,
            "next_appointment_time": _fmt_time(next_appt.get("start_time")) if next_appt else None,
            "next_appointment_clinician": _clinician_name(next_appt.get("clinicians")) if next_appt else None,
            "balance_due_cents": balance_due_cents,
            "care_plan_total_visits": total_visits,
            "care_plan_completed_visits": completed_visits,
            "care_plan_label": care_plan_label,
            "patient_since": _fmt_date_long(patient.get("created_at")),
            "clinical_summary": {
                "primary_complaint": str(patient.get("primary_complaint") or "").strip() or "—",
                "treating_provider": treating_provider,
                "care_plan": care_plan_label,
                "last_treatment": _fmt_date_short(last_visit.get("start_time")) if last_visit else "—",
                "outcome_score": outcome_score or "—",
            },
            "tags": tags,
            "upcoming_appointments": upcoming,
            "recent_activity": recent_activity,
            "account_summary": {
                "total_balance_cents": balance_due_cents,
                "insurance_balance_cents": insurance_balance_cents,
                "patient_balance_cents": patient_balance_cents,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Patient header stats failed: {exc}",
        ) from exc
