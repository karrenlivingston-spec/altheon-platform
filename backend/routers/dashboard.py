"""Admin dashboard summary — aggregates clinic metrics from existing tables."""

from __future__ import annotations

import traceback
from datetime import date, datetime, timedelta, timezone
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


def _eastern_now() -> datetime:
    return datetime.now(NY)


def _eastern_ymd(dt: datetime) -> str:
    return dt.astimezone(NY).strftime("%Y-%m-%d")


def _parse_iso(value: Any) -> Optional[datetime]:
    s = str(value or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _eastern_day_start_utc(d: date) -> datetime:
    local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=NY)
    return local.astimezone(timezone.utc)


def _eastern_day_end_utc(d: date) -> datetime:
    local = datetime(d.year, d.month, d.day, 23, 59, 59, 999999, tzinfo=NY)
    return local.astimezone(timezone.utc)


def _monday_of_week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _patient_name(row: dict[str, Any]) -> str:
    patients = row.get("patients") or {}
    if isinstance(patients, list):
        patients = patients[0] if patients else {}
    fn = str(patients.get("first_name") or "").strip()
    ln = str(patients.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "—"


def _clinician_name(row: dict[str, Any]) -> str:
    clinicians = row.get("clinicians") or {}
    if isinstance(clinicians, list):
        clinicians = clinicians[0] if clinicians else {}
    fn = str(clinicians.get("first_name") or "").strip()
    ln = str(clinicians.get("last_name") or "").strip()
    if ln:
        return f"Dr. {ln}"
    if fn:
        return f"Dr. {fn}"
    return "—"


def _treatment_type(row: dict[str, Any]) -> str:
    tt = row.get("treatment_types") or {}
    if isinstance(tt, list):
        tt = tt[0] if tt else {}
    return str(tt.get("name") or "").strip() or "—"


def _shape_appointment_row(
    row: dict[str, Any], *, intake_ids: set[str]
) -> dict[str, Any]:
    appt_id = str(row.get("id") or "")
    status = str(row.get("status") or "scheduled").strip().lower()
    if status in ("scheduled", "confirmed") and appt_id not in intake_ids:
        display_status = "needs_intake"
    else:
        display_status = status
    return {
        "id": appt_id,
        "start_time": row.get("start_time"),
        "patient_name": _patient_name(row),
        "treatment_type": _treatment_type(row),
        "clinician_name": _clinician_name(row),
        "status": display_status,
    }


def _sum_amount(rows: list[dict[str, Any]], key: str = "total_billed_cents") -> int:
    total = 0
    for row in rows:
        try:
            total += int(row.get(key) or 0)
        except (TypeError, ValueError):
            pass
    return total


def _claims_bucket(status: str) -> Optional[str]:
    s = (status or "draft").strip().lower()
    if s == "paid":
        return "paid"
    if s == "denied":
        return "denied"
    if s == "submitted":
        return "submitted"
    if s in ("partial", "pending"):
        return "pending"
    return None


@router.get("/dashboard/summary")
def dashboard_summary(clinic: ClinicUserDep):
    try:
        cid = clinic.clinic_id
        now_et = _eastern_now()
        today = now_et.date()
        today_start = _eastern_day_start_utc(today)
        today_end = _eastern_day_end_utc(today)
        now_utc = datetime.now(timezone.utc)

        week_start = _monday_of_week(today)
        last_week_start = week_start - timedelta(days=7)
        last_week_end = week_start - timedelta(days=1)

        month_start = date(today.year, today.month, 1)
        month_start_iso = month_start.isoformat()
        upcoming_end = now_utc + timedelta(days=7)

        # --- Appointments (today + week + upcoming) ---
        appt_select = (
            "id, start_time, status, patient_id, "
            "patients(first_name, last_name), treatment_types(name), "
            "clinicians(first_name, last_name)"
        )
        appt_resp = (
            supabase.table("appointments")
            .select(appt_select)
            .eq("clinic_id", cid)
            .gte("start_time", _eastern_day_start_utc(last_week_start).isoformat())
            .lte("start_time", upcoming_end.isoformat())
            .order("start_time")
            .execute()
        )
        _handle_supabase_error(appt_resp)
        appts = appt_resp.data or []

        today_ymd = _eastern_ymd(now_et)
        today_appts: list[dict[str, Any]] = []
        week_patient_ids: set[str] = set()
        last_week_patient_ids: set[str] = set()
        upcoming_raw: list[dict[str, Any]] = []

        for row in appts:
            st = _parse_iso(row.get("start_time"))
            if not st:
                continue
            ymd = _eastern_ymd(st)
            pid = str(row.get("patient_id") or "").strip()
            if ymd == today_ymd:
                today_appts.append(row)
            if week_start <= st.astimezone(NY).date() <= today:
                if pid:
                    week_patient_ids.add(pid)
            lw_date = st.astimezone(NY).date()
            if last_week_start <= lw_date <= last_week_end:
                if pid:
                    last_week_patient_ids.add(pid)
            if st > now_utc and st <= upcoming_end:
                upcoming_raw.append(row)

        # Intake completion lookup for today's schedule
        intake_appt_ids: set[str] = set()
        try:
            if today_appts:
                ids = [str(a.get("id") or "") for a in today_appts if a.get("id")]
                if ids:
                    forms_resp = (
                        supabase.table("intake_forms")
                        .select("appointment_id")
                        .eq("clinic_id", cid)
                        .in_("appointment_id", ids)
                        .execute()
                    )
                    _handle_supabase_error(forms_resp)
                    intake_appt_ids = {
                        str(r.get("appointment_id") or "")
                        for r in (forms_resp.data or [])
                        if r.get("appointment_id")
                    }
        except Exception:
            traceback.print_exc()

        schedule_today = [
            _shape_appointment_row(r, intake_ids=intake_appt_ids)
            for r in today_appts[:8]
        ]
        upcoming_appointments = [
            _shape_appointment_row(r, intake_ids=intake_appt_ids)
            for r in upcoming_raw[:10]
        ]

        # --- Billing records ---
        billing_resp = (
            supabase.table("billing_records")
            .select(
                "id, status, total_billed_cents, amount_paid_cents, "
                "date_of_service, appointment_id"
            )
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(billing_resp)
        billing_rows = billing_resp.data or []

        mtd_records = [
            r
            for r in billing_rows
            if str(r.get("date_of_service") or "")[:10] >= month_start_iso
        ]
        total_billed_mtd_cents = _sum_amount(mtd_records)

        claims_summary: dict[str, int] = {
            "paid": 0,
            "pending": 0,
            "denied": 0,
            "submitted": 0,
        }
        denied_rows: list[dict[str, Any]] = []
        pending_rows: list[dict[str, Any]] = []
        ready_rows: list[dict[str, Any]] = []

        for row in billing_rows:
            status = str(row.get("status") or "draft").strip().lower()
            bucket = _claims_bucket(status)
            if bucket:
                claims_summary[bucket] = claims_summary.get(bucket, 0) + 1
            if status == "denied":
                denied_rows.append(row)
            elif status in ("submitted", "partial", "pending"):
                pending_rows.append(row)
            elif status == "draft":
                ready_rows.append(row)

        record_ids = [str(r.get("id") or "") for r in billing_rows if r.get("id")]
        collections_mtd_cents = 0
        if record_ids:
            pay_resp = (
                supabase.table("billing_payments")
                .select("amount_cents, payment_date, billing_record_id")
                .gte("payment_date", month_start_iso)
                .execute()
            )
            _handle_supabase_error(pay_resp)
            record_id_set = set(record_ids)
            for p in pay_resp.data or []:
                if str(p.get("billing_record_id") or "") in record_id_set:
                    try:
                        collections_mtd_cents += int(p.get("amount_cents") or 0)
                    except (TypeError, ValueError):
                        pass

        billed_appt_ids = {
            str(r.get("appointment_id") or "")
            for r in billing_rows
            if r.get("appointment_id")
        }
        unbilled_rows: list[dict[str, Any]] = []
        try:
            completed_resp = (
                supabase.table("appointments")
                .select("id, start_time, status")
                .eq("clinic_id", cid)
                .eq("status", "completed")
                .gte(
                    "start_time",
                    (now_utc - timedelta(days=90)).isoformat(),
                )
                .execute()
            )
            _handle_supabase_error(completed_resp)
            for row in completed_resp.data or []:
                aid = str(row.get("id") or "")
                if aid and aid not in billed_appt_ids:
                    unbilled_rows.append(row)
        except Exception:
            traceback.print_exc()

        # --- Voice interaction logs (Aria) ---
        aria = {
            "calls_today": 0,
            "booked_today": 0,
            "missed_today": 0,
            "avg_duration_seconds": 0,
            "success_rate": 0,
            "is_online": True,
        }
        try:
            voice_resp = (
                supabase.table("voice_interaction_logs")
                .select(
                    "outcome, intent_detected, duration_seconds, "
                    "success_flag, created_at"
                )
                .eq("clinic_id", cid)
                .gte("created_at", today_start.isoformat())
                .execute()
            )
            _handle_supabase_error(voice_resp)
            today_calls = voice_resp.data or []
            aria["calls_today"] = len(today_calls)
            durations: list[int] = []
            for c in today_calls:
                outcome = str(c.get("outcome") or "").lower()
                intent = str(c.get("intent_detected") or "").lower()
                if "book" in outcome or "appointment" in outcome or "book" in intent:
                    aria["booked_today"] += 1
                if c.get("success_flag") is False:
                    aria["missed_today"] += 1
                try:
                    d = int(c.get("duration_seconds") or 0)
                    if d >= 0:
                        durations.append(d)
                except (TypeError, ValueError):
                    pass
            if durations:
                aria["avg_duration_seconds"] = round(sum(durations) / len(durations))

            all_voice_resp = (
                supabase.table("voice_interaction_logs")
                .select("success_flag")
                .eq("clinic_id", cid)
                .execute()
            )
            _handle_supabase_error(all_voice_resp)
            all_voice = all_voice_resp.data or []
            if all_voice:
                successes = sum(1 for v in all_voice if v.get("success_flag") is True)
                aria["success_rate"] = round(successes / len(all_voice) * 100)
        except Exception:
            traceback.print_exc()

        # --- Tasks ---
        incomplete_intakes = 0
        try:
            token_resp = (
                supabase.table("intake_tokens")
                .select("id")
                .eq("clinic_id", cid)
                .eq("used", False)
                .gte("expires_at", now_utc.isoformat())
                .execute()
            )
            _handle_supabase_error(token_resp)
            incomplete_intakes = len(token_resp.data or [])
        except Exception:
            traceback.print_exc()

        notes_review = 0
        try:
            notes_resp = (
                supabase.table("clinical_notes")
                .select("id", count="exact")
                .eq("clinic_id", cid)
                .in_("status", ["draft", "ai_flagged", "needs_correction", "ready_for_review"])
                .execute()
            )
            _handle_supabase_error(notes_resp)
            notes_review = int(getattr(notes_resp, "count", None) or 0)
            if not notes_review and notes_resp.data is not None:
                notes_review = len(notes_resp.data)
        except Exception:
            traceback.print_exc()

        legal_in_progress = 0
        try:
            legal_resp = (
                supabase.table("legal_requests")
                .select("id", count="exact")
                .eq("clinic_id", cid)
                .not_.in_("status", ["delivered", "archived"])
                .execute()
            )
            _handle_supabase_error(legal_resp)
            legal_in_progress = int(getattr(legal_resp, "count", None) or 0)
            if not legal_in_progress and legal_resp.data is not None:
                legal_in_progress = len(legal_resp.data)
        except Exception:
            traceback.print_exc()

        appts_unconfirmed = sum(
            1
            for r in today_appts
            if str(r.get("status") or "").strip().lower() == "scheduled"
        )

        # --- Recent activity ---
        activities: list[dict[str, Any]] = []

        try:
            signed_resp = (
                supabase.table("clinical_notes")
                .select("id, signed_at, patients(first_name, last_name)")
                .eq("clinic_id", cid)
                .not_.is_("signed_at", "null")
                .order("signed_at", desc=True)
                .limit(6)
                .execute()
            )
            _handle_supabase_error(signed_resp)
            for n in signed_resp.data or []:
                ts = n.get("signed_at")
                if not ts:
                    continue
                pname = _patient_name(n)
                activities.append(
                    {
                        "type": "note",
                        "description": f"Clinical note signed — {pname}",
                        "link_to": "/admin/clinical-notes",
                        "timestamp": ts,
                    }
                )
        except Exception:
            traceback.print_exc()

        try:
            if record_ids:
                recent_pay = (
                    supabase.table("billing_payments")
                    .select("amount_cents, payment_date, billing_record_id")
                    .order("payment_date", desc=True)
                    .limit(15)
                    .execute()
                )
                _handle_supabase_error(recent_pay)
                rid_set = set(record_ids)
                for p in recent_pay.data or []:
                    if str(p.get("billing_record_id") or "") not in rid_set:
                        continue
                    cents = int(p.get("amount_cents") or 0)
                    activities.append(
                        {
                            "type": "payment",
                            "description": f"Payment received — ${cents / 100:,.2f}",
                            "link_to": "/admin/billing",
                            "timestamp": p.get("payment_date"),
                        }
                    )
        except Exception:
            traceback.print_exc()

        try:
            intake_act = (
                supabase.table("intake_forms")
                .select("id, submitted_at, patients(first_name, last_name)")
                .eq("clinic_id", cid)
                .order("submitted_at", desc=True)
                .limit(6)
                .execute()
            )
            _handle_supabase_error(intake_act)
            for f in intake_act.data or []:
                ts = f.get("submitted_at")
                if not ts:
                    continue
                pname = _patient_name(f)
                activities.append(
                    {
                        "type": "intake",
                        "description": f"Intake form submitted — {pname}",
                        "link_to": "/admin/patients",
                        "timestamp": ts,
                    }
                )
        except Exception:
            traceback.print_exc()

        try:
            legal_act = (
                supabase.table("legal_requests")
                .select("id, created_at, requesting_party_name")
                .eq("clinic_id", cid)
                .order("created_at", desc=True)
                .limit(4)
                .execute()
            )
            _handle_supabase_error(legal_act)
            for lr in legal_act.data or []:
                ts = lr.get("created_at")
                if not ts:
                    continue
                party = str(lr.get("requesting_party_name") or "Request").strip()
                activities.append(
                    {
                        "type": "legal",
                        "description": f"Legal request — {party}",
                        "link_to": "/admin/legal-requests",
                        "timestamp": ts,
                    }
                )
        except Exception:
            traceback.print_exc()

        try:
            claims_resp = (
                supabase.table("insurance_claims")
                .select("id")
                .eq("clinic_id", cid)
                .execute()
            )
            _handle_supabase_error(claims_resp)
            claim_ids = [str(c.get("id") or "") for c in (claims_resp.data or []) if c.get("id")]
            if claim_ids:
                audit_resp = (
                    supabase.table("claim_audit_log")
                    .select("action, created_at, claim_id")
                    .in_("claim_id", claim_ids)
                    .order("created_at", desc=True)
                    .limit(6)
                    .execute()
                )
                _handle_supabase_error(audit_resp)
                for a in audit_resp.data or []:
                    ts = a.get("created_at")
                    if not ts:
                        continue
                    action = str(a.get("action") or "updated").replace("_", " ")
                    activities.append(
                        {
                            "type": "claim",
                            "description": f"Claim {action}",
                            "link_to": "/admin/billing",
                            "timestamp": ts,
                        }
                    )
        except Exception:
            traceback.print_exc()

        activities.sort(
            key=lambda x: str(x.get("timestamp") or ""),
            reverse=True,
        )
        recent_activity = activities[:8]

        patients_this_week = len(week_patient_ids)
        patients_last_week = len(last_week_patient_ids)

        return {
            "appointments_today": len(today_appts),
            "patients_this_week": patients_this_week,
            "patients_last_week": patients_last_week,
            "collections_mtd_cents": collections_mtd_cents,
            "total_billed_mtd_cents": total_billed_mtd_cents,
            "claims_summary": claims_summary,
            "claims_requiring_action": {
                "denied": {
                    "count": len(denied_rows),
                    "amount_cents": _sum_amount(denied_rows),
                },
                "pending": {
                    "count": len(pending_rows),
                    "amount_cents": _sum_amount(pending_rows),
                },
                "ready_to_send": {
                    "count": len(ready_rows),
                    "amount_cents": _sum_amount(ready_rows),
                },
                "unbilled": {
                    "count": len(unbilled_rows),
                    "amount_cents": 0,
                },
            },
            "aria": aria,
            "tasks": {
                "incomplete_intakes": incomplete_intakes,
                "notes_review": notes_review,
                "legal_in_progress": legal_in_progress,
                "unconfirmed_appointments": appts_unconfirmed,
            },
            "schedule_today": schedule_today,
            "upcoming_appointments": upcoming_appointments,
            "recent_activity": recent_activity,
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Dashboard summary failed: {exc}",
        ) from exc
