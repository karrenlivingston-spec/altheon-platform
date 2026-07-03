"""Auto-managed system tasks synced from clinical/billing workflow state."""

from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from app.db import supabase
from app.retry_utils import supabase_execute

logger = logging.getLogger(__name__)

TASK_INCOMPLETE_INTAKE = "incomplete_intake"
TASK_UNCONFIRMED_APPOINTMENT = "unconfirmed_appointment"
TASK_NOTE_REVIEW = "note_review"
TASK_LEGAL_REQUEST = "legal_request"

SYSTEM_TASK_TYPES = (
    TASK_INCOMPLETE_INTAKE,
    TASK_UNCONFIRMED_APPOINTMENT,
    TASK_NOTE_REVIEW,
    TASK_LEGAL_REQUEST,
)

REVIEWABLE_NOTE_STATUSES = frozenset(
    {"ready_for_review", "needs_correction", "ai_flagged"}
)
LEGAL_TERMINAL_STATUSES = frozenset({"delivered", "archived"})
_ACTIVE_APPOINTMENT_STATUSES = frozenset({"scheduled", "confirmed"})
_UNCONFIRMED_RESOLVE_STATUSES = frozenset(
    {"confirmed", "cancelled", "completed", "no_show", "checked_in", "in_progress"}
)

_OPEN_STATUSES = ("open", "acknowledged")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_utc(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_future_start(start_time: Any) -> bool:
    dt = _parse_iso_utc(start_time)
    if not dt:
        return False
    return dt >= datetime.now(timezone.utc)


def _is_unique_violation(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "duplicate" in msg or "unique" in msg or "23505" in msg


def _response_error(response: Any) -> Optional[str]:
    error = getattr(response, "error", None)
    if not error:
        return None
    return str(getattr(error, "message", None) or error)


def ensure_system_task(
    clinic_id: str,
    task_type: str,
    reference_type: str,
    reference_id: str,
    title: str,
    description: str,
    patient_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Create an open auto-managed system task if one does not already exist."""
    try:
        cid = str(clinic_id or "").strip()
        tt = str(task_type or "").strip()
        rt = str(reference_type or "").strip()
        rid = str(reference_id or "").strip()
        if not cid or not tt or not rt or not rid:
            return

        existing = supabase_execute(
            lambda: supabase.table("tasks")
            .select("id")
            .eq("clinic_id", cid)
            .eq("task_type", tt)
            .eq("reference_id", rid)
            .eq("auto_managed", True)
            .in_("status", list(_OPEN_STATUSES))
            .limit(1)
            .execute()
        )
        if existing.data:
            return

        now = _now_iso()
        row: dict[str, Any] = {
            "clinic_id": cid,
            "task_type": tt,
            "reference_type": rt,
            "reference_id": rid,
            "title": title.strip(),
            "description": (description or "").strip() or None,
            "priority": "normal",
            "source": "system",
            "status": "open",
            "auto_managed": True,
            "metadata": metadata or {},
            "created_at": now,
            "updated_at": now,
        }
        pid = str(patient_id or "").strip()
        if pid:
            row["patient_id"] = pid

        resp = supabase_execute(lambda: supabase.table("tasks").insert(row).execute())
        err = _response_error(resp)
        if err and ("duplicate" in err.lower() or "unique" in err.lower()):
            return
        if err:
            logger.warning(
                "ensure_system_task insert failed clinic_id=%s task_type=%s ref=%s: %s",
                cid,
                tt,
                rid,
                err,
            )
    except Exception as exc:
        if _is_unique_violation(exc):
            return
        logger.exception(
            "ensure_system_task failed clinic_id=%s task_type=%s reference_id=%s",
            clinic_id,
            task_type,
            reference_id,
        )


def resolve_system_task(
    clinic_id: str,
    task_type: str,
    reference_id: str,
) -> None:
    """Resolve open/acknowledged auto-managed system tasks for the reference."""
    try:
        cid = str(clinic_id or "").strip()
        tt = str(task_type or "").strip()
        rid = str(reference_id or "").strip()
        if not cid or not tt or not rid:
            return

        now = _now_iso()
        supabase_execute(
            lambda: supabase.table("tasks")
            .update(
                {
                    "status": "resolved",
                    "resolved_at": now,
                    "updated_at": now,
                }
            )
            .eq("clinic_id", cid)
            .eq("task_type", tt)
            .eq("reference_id", rid)
            .eq("auto_managed", True)
            .in_("status", list(_OPEN_STATUSES))
            .execute()
        )
    except Exception:
        logger.exception(
            "resolve_system_task failed clinic_id=%s task_type=%s reference_id=%s",
            clinic_id,
            task_type,
            reference_id,
        )


def ensure_incomplete_intake_task(
    *,
    clinic_id: str,
    appointment_id: str,
    patient_id: Optional[str] = None,
    start_time: Any = None,
) -> None:
    if not _is_future_start(start_time):
        return
    ensure_system_task(
        clinic_id,
        TASK_INCOMPLETE_INTAKE,
        "appointment",
        appointment_id,
        "Incomplete intake",
        "Patient has not completed intake for an upcoming appointment.",
        patient_id=patient_id,
        metadata={"appointment_id": appointment_id},
    )


def ensure_unconfirmed_appointment_task(
    *,
    clinic_id: str,
    appointment_id: str,
    patient_id: Optional[str] = None,
    start_time: Any = None,
) -> None:
    if not _is_future_start(start_time):
        return
    ensure_system_task(
        clinic_id,
        TASK_UNCONFIRMED_APPOINTMENT,
        "appointment",
        appointment_id,
        "Unconfirmed appointment",
        "Scheduled appointment is awaiting confirmation.",
        patient_id=patient_id,
        metadata={"appointment_id": appointment_id},
    )


def ensure_note_review_task(
    *,
    clinic_id: str,
    note_id: str,
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
) -> None:
    st = str(status or "").strip().lower()
    if st and st not in REVIEWABLE_NOTE_STATUSES:
        return
    ensure_system_task(
        clinic_id,
        TASK_NOTE_REVIEW,
        "clinical_note",
        note_id,
        "Clinical note pending review",
        "A clinical note requires review or correction.",
        patient_id=patient_id,
        metadata={"clinical_note_id": note_id, "status": st or None},
    )


def ensure_legal_request_task(
    *,
    clinic_id: str,
    request_id: str,
    patient_id: Optional[str] = None,
    requesting_party_name: Optional[str] = None,
    status: Optional[str] = None,
) -> None:
    st = str(status or "").strip().lower()
    if st in LEGAL_TERMINAL_STATUSES:
        return
    party = str(requesting_party_name or "Request").strip()
    ensure_system_task(
        clinic_id,
        TASK_LEGAL_REQUEST,
        "legal_request",
        request_id,
        "Legal request pending",
        f"Legal/medical records request from {party} requires action.",
        patient_id=patient_id,
        metadata={"legal_request_id": request_id, "status": st or None},
    )


def _fetch_all_rows(build_query):
    rows: list[dict[str, Any]] = []
    offset = 0
    page_size = 1000
    while True:
        start = offset
        end = offset + page_size - 1

        def _run(start=start, end=end):
            return build_query().range(start, end).execute()

        resp = supabase_execute(_run)
        batch = [r for r in (resp.data or []) if isinstance(r, dict)]
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def _list_clinic_ids(clinic_id: Optional[str]) -> list[str]:
    cid = str(clinic_id or "").strip()
    if cid:
        return [cid]
    resp = supabase_execute(
        lambda: supabase.table("clinics").select("id").execute()
    )
    return [
        str(r.get("id") or "").strip()
        for r in (resp.data or [])
        if isinstance(r, dict) and str(r.get("id") or "").strip()
    ]


def _completed_intake_appointment_ids(clinic_id: str) -> set[str]:
    rows = _fetch_all_rows(
        lambda: supabase.table("intake_forms")
        .select("appointment_id")
        .eq("clinic_id", clinic_id)
        .not_.is_("completed_at", "null")
    )
    return {
        str(r.get("appointment_id") or "").strip()
        for r in rows
        if str(r.get("appointment_id") or "").strip()
    }


def _should_have_incomplete_intake(
    appt: dict[str, Any], completed_intake_ids: set[str]
) -> bool:
    aid = str(appt.get("id") or "").strip()
    if not aid or aid in completed_intake_ids:
        return False
    status = str(appt.get("status") or "").strip().lower()
    if status not in _ACTIVE_APPOINTMENT_STATUSES:
        return False
    return _is_future_start(appt.get("start_time"))


def _should_have_unconfirmed(appt: dict[str, Any]) -> bool:
    status = str(appt.get("status") or "").strip().lower()
    return status == "scheduled" and _is_future_start(appt.get("start_time"))


def _fetch_open_system_task_refs(clinic_id: str, task_type: str) -> dict[str, str]:
    rows = _fetch_all_rows(
        lambda: supabase.table("tasks")
        .select("id, reference_id")
        .eq("clinic_id", clinic_id)
        .eq("task_type", task_type)
        .eq("auto_managed", True)
        .eq("source", "system")
        .in_("status", list(_OPEN_STATUSES))
    )
    out: dict[str, str] = {}
    for row in rows:
        ref = str(row.get("reference_id") or "").strip()
        tid = str(row.get("id") or "").strip()
        if ref and tid:
            out[ref] = tid
    return out


def reconcile_system_tasks_for_clinic(clinic_id: str) -> dict[str, Any]:
    """Recompute open system tasks for one clinic. Idempotent."""
    cid = clinic_id.strip()
    stats: dict[str, Any] = {
        "created": {t: 0 for t in SYSTEM_TASK_TYPES},
        "resolved": {t: 0 for t in SYSTEM_TASK_TYPES},
    }
    now_iso = _now_iso()

    completed_intake_ids = _completed_intake_appointment_ids(cid)
    future_appts = _fetch_all_rows(
        lambda: supabase.table("appointments")
        .select("id, patient_id, start_time, status")
        .eq("clinic_id", cid)
        .gte("start_time", now_iso)
    )

    should_incomplete = {
        str(a.get("id") or "").strip(): a
        for a in future_appts
        if _should_have_incomplete_intake(a, completed_intake_ids)
    }
    should_unconfirmed = {
        str(a.get("id") or "").strip(): a
        for a in future_appts
        if _should_have_unconfirmed(a)
    }

    open_incomplete = _fetch_open_system_task_refs(cid, TASK_INCOMPLETE_INTAKE)
    for aid, appt in should_incomplete.items():
        if aid not in open_incomplete:
            ensure_incomplete_intake_task(
                clinic_id=cid,
                appointment_id=aid,
                patient_id=str(appt.get("patient_id") or "").strip() or None,
                start_time=appt.get("start_time"),
            )
            stats["created"][TASK_INCOMPLETE_INTAKE] += 1
    for ref in open_incomplete:
        if ref not in should_incomplete:
            resolve_system_task(cid, TASK_INCOMPLETE_INTAKE, ref)
            stats["resolved"][TASK_INCOMPLETE_INTAKE] += 1

    open_unconfirmed = _fetch_open_system_task_refs(cid, TASK_UNCONFIRMED_APPOINTMENT)
    for aid, appt in should_unconfirmed.items():
        if aid not in open_unconfirmed:
            ensure_unconfirmed_appointment_task(
                clinic_id=cid,
                appointment_id=aid,
                patient_id=str(appt.get("patient_id") or "").strip() or None,
                start_time=appt.get("start_time"),
            )
            stats["created"][TASK_UNCONFIRMED_APPOINTMENT] += 1
    for ref in open_unconfirmed:
        if ref not in should_unconfirmed:
            resolve_system_task(cid, TASK_UNCONFIRMED_APPOINTMENT, ref)
            stats["resolved"][TASK_UNCONFIRMED_APPOINTMENT] += 1

    review_notes = _fetch_all_rows(
        lambda: supabase.table("clinical_notes")
        .select("id, patient_id, status")
        .eq("clinic_id", cid)
        .in_("status", list(REVIEWABLE_NOTE_STATUSES))
    )
    should_review = {
        str(n.get("id") or "").strip(): n
        for n in review_notes
        if str(n.get("id") or "").strip()
    }
    open_review = _fetch_open_system_task_refs(cid, TASK_NOTE_REVIEW)
    for nid, note in should_review.items():
        if nid not in open_review:
            ensure_note_review_task(
                clinic_id=cid,
                note_id=nid,
                patient_id=str(note.get("patient_id") or "").strip() or None,
                status=str(note.get("status") or ""),
            )
            stats["created"][TASK_NOTE_REVIEW] += 1
    for ref in open_review:
        if ref not in should_review:
            resolve_system_task(cid, TASK_NOTE_REVIEW, ref)
            stats["resolved"][TASK_NOTE_REVIEW] += 1

    legal_rows = _fetch_all_rows(
        lambda: supabase.table("legal_requests")
        .select("id, patient_id, status, requesting_party_name")
        .eq("clinic_id", cid)
    )
    should_legal = {
        str(r.get("id") or "").strip(): r
        for r in legal_rows
        if str(r.get("id") or "").strip()
        and str(r.get("status") or "").strip().lower() not in LEGAL_TERMINAL_STATUSES
    }
    open_legal = _fetch_open_system_task_refs(cid, TASK_LEGAL_REQUEST)
    for rid, req in should_legal.items():
        if rid not in open_legal:
            ensure_legal_request_task(
                clinic_id=cid,
                request_id=rid,
                patient_id=str(req.get("patient_id") or "").strip() or None,
                requesting_party_name=str(req.get("requesting_party_name") or ""),
                status=str(req.get("status") or ""),
            )
            stats["created"][TASK_LEGAL_REQUEST] += 1
    for ref in open_legal:
        if ref not in should_legal:
            resolve_system_task(cid, TASK_LEGAL_REQUEST, ref)
            stats["resolved"][TASK_LEGAL_REQUEST] += 1

    return stats


def reconcile_system_tasks(clinic_id: Optional[str] = None) -> dict[str, Any]:
    clinic_ids = _list_clinic_ids(clinic_id)
    per_clinic: dict[str, Any] = {}
    totals = {
        "created": {t: 0 for t in SYSTEM_TASK_TYPES},
        "resolved": {t: 0 for t in SYSTEM_TASK_TYPES},
    }
    for cid in clinic_ids:
        try:
            stats = reconcile_system_tasks_for_clinic(cid)
            per_clinic[cid] = stats
            for key in ("created", "resolved"):
                for task_type in SYSTEM_TASK_TYPES:
                    totals[key][task_type] += stats[key][task_type]
        except Exception:
            traceback.print_exc()
            per_clinic[cid] = {"error": "reconcile failed"}
    return {
        "clinic_id": str(clinic_id or "").strip() or None,
        "clinics_processed": len(clinic_ids),
        "totals": totals,
        "by_clinic": per_clinic,
    }
