"""Staff tasks and task notifications."""

from __future__ import annotations

import os
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.services.system_tasks import reconcile_system_tasks
from app.dependencies.permissions import ALL_ROLES, require_role
from app.sms import send_sms
from app.utils.auth_users import get_user_email_by_id
from routers.fee_schedule import (
    _assert_user_has_clinic_access,
    _resolve_bearer_user_id,
)

router = APIRouter(dependencies=[Depends(require_role(*ALL_ROLES))])
cron_router = APIRouter()


def _verify_intake_secret(x_intake_secret: Optional[str]) -> None:
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="INTAKE_SECRET is not configured")
    provided = (x_intake_secret or "").strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid intake secret")


@cron_router.post("/reconcile-system-tasks")
def reconcile_system_tasks_endpoint(
    clinic_id: Optional[str] = Query(default=None),
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    _verify_intake_secret(x_intake_secret)
    return reconcile_system_tasks(clinic_id)

_ADMIN_ROLES = frozenset({"super_admin", "clinic_admin"})
_VALID_PRIORITIES = frozenset({"normal", "urgent"})
_VALID_SOURCES = frozenset({"manual", "aria", "system"})
_VALID_STATUSES = frozenset({"open", "acknowledged", "resolved"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _handle_supabase_error(response: Any, *, table: str = "unknown") -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        print(f"[tasks] Supabase error table={table} detail={detail}")
        raise HTTPException(status_code=500, detail=detail)


def load_clinic_staff_list(clinic_id: str) -> list[dict[str, Any]]:
    """Resolve clinic staff via clinic_users → auth.users email → clinicians.email."""
    cid = clinic_id.strip()
    try:
        clinic_users_resp = (
            supabase.table("clinic_users")
            .select("user_id, role")
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(clinic_users_resp, table="clinic_users")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    staff: list[dict[str, Any]] = []
    for cu in clinic_users_resp.data or []:
        if not isinstance(cu, dict):
            continue
        user_id = str(cu.get("user_id") or "").strip()
        if not user_id:
            continue
        try:
            email = get_user_email_by_id(user_id)
            if not email:
                continue
            clinician_resp = (
                supabase.table("clinicians")
                .select("first_name, last_name, phone")
                .eq("email", email)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(clinician_resp, table="clinicians")
            rows = clinician_resp.data or []
            if not rows:
                continue
            clinician_row = rows[0]
            staff.append(
                {
                    "user_id": user_id,
                    "role": cu.get("role"),
                    "first_name": clinician_row.get("first_name"),
                    "last_name": clinician_row.get("last_name"),
                    "phone": clinician_row.get("phone"),
                }
            )
        except HTTPException:
            raise
        except Exception:
            traceback.print_exc()
            continue
    return staff


def load_staff_profiles(clinic_id: str) -> dict[str, dict[str, Any]]:
    """Map auth user_id -> staff profile (names from clinicians via auth email)."""
    profiles: dict[str, dict[str, Any]] = {}
    try:
        for member in load_clinic_staff_list(clinic_id):
            uid = str(member.get("user_id") or "").strip()
            if uid:
                profiles[uid] = member
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return {}
    return profiles


def _staff_display_name(profile: Optional[dict[str, Any]]) -> str:
    if not profile:
        return "—"
    fn = str(profile.get("first_name") or "").strip()
    ln = str(profile.get("last_name") or "").strip()
    combined = f"{fn} {ln}".strip()
    return combined or "—"


def _patient_display_name(row: Optional[dict[str, Any]]) -> Optional[str]:
    if not row:
        return None
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    combined = f"{fn} {ln}".strip()
    return combined or None


def _clinic_admin_user_ids(clinic_id: str) -> list[str]:
    try:
        resp = (
            supabase.table("clinic_users")
            .select("user_id, role")
            .eq("clinic_id", clinic_id.strip())
            .in_("role", list(_ADMIN_ROLES))
            .execute()
        )
        _handle_supabase_error(resp, table="clinic_users")
    except Exception:
        traceback.print_exc()
        return []
    out: list[str] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        uid = str(row.get("user_id") or "").strip()
        if uid:
            out.append(uid)
    return out


def _load_patient_names(clinic_id: str, patient_ids: list[str]) -> dict[str, str]:
    ids = [pid for pid in patient_ids if pid]
    if not ids:
        return {}
    try:
        resp = (
            supabase.table("patients")
            .select("id, first_name, last_name")
            .eq("clinic_id", clinic_id.strip())
            .in_("id", ids)
            .execute()
        )
        _handle_supabase_error(resp, table="patients")
    except Exception:
        traceback.print_exc()
        return {}
    out: dict[str, str] = {}
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("id") or "").strip()
        name = _patient_display_name(row)
        if pid and name:
            out[pid] = name
    return out


def shape_task(row: dict[str, Any], profiles: dict[str, dict[str, Any]], patients: dict[str, str]) -> dict[str, Any]:
    assigned_to = str(row.get("assigned_to") or "").strip() or None
    created_by = str(row.get("created_by") or "").strip() or None
    acknowledged_by = str(row.get("acknowledged_by") or "").strip() or None
    resolved_by = str(row.get("resolved_by") or "").strip() or None
    patient_id = str(row.get("patient_id") or "").strip() or None
    return {
        "id": row.get("id"),
        "clinic_id": row.get("clinic_id"),
        "title": row.get("title"),
        "description": row.get("description"),
        "priority": row.get("priority"),
        "source": row.get("source"),
        "task_type": row.get("task_type"),
        "status": row.get("status"),
        "assigned_to": assigned_to,
        "assigned_to_name": _staff_display_name(profiles.get(assigned_to or "")),
        "created_by": created_by,
        "created_by_name": _staff_display_name(profiles.get(created_by or "")),
        "patient_id": patient_id,
        "patient_name": patients.get(patient_id or "") if patient_id else None,
        "acknowledged_at": row.get("acknowledged_at"),
        "acknowledged_by": acknowledged_by,
        "acknowledged_by_name": _staff_display_name(profiles.get(acknowledged_by or "")),
        "resolved_at": row.get("resolved_at"),
        "resolved_by": resolved_by,
        "resolved_by_name": _staff_display_name(profiles.get(resolved_by or "")),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _clinic_display_name(clinic_id: str) -> str:
    try:
        resp = (
            supabase.table("clinics")
            .select("name")
            .eq("id", clinic_id.strip())
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp, table="clinics")
        rows = resp.data or []
        if rows:
            return str(rows[0].get("name") or "your clinic").strip() or "your clinic"
    except Exception:
        traceback.print_exc()
    return "your clinic"


def create_task_notifications(
    clinic_id: str,
    task_id: str,
    notification_type: str,
    user_ids: list[str],
) -> None:
    deduped = list(dict.fromkeys(uid for uid in user_ids if uid))
    if not deduped:
        return
    rows = [
        {
            "clinic_id": clinic_id,
            "user_id": uid,
            "task_id": task_id,
            "notification_type": notification_type,
        }
        for uid in deduped
    ]
    try:
        resp = supabase.table("task_notifications").insert(rows).execute()
        _handle_supabase_error(resp, table="task_notifications")
    except Exception:
        traceback.print_exc()


def send_urgent_task_sms(
    clinic_id: str,
    title: str,
    *,
    assigned_to: Optional[str] = None,
    profiles: Optional[dict[str, dict[str, Any]]] = None,
) -> None:
    clinic_name = _clinic_display_name(clinic_id)
    message = (
        f"🚨 Urgent task created at {clinic_name}: {title.strip()}. "
        "Log in to Altheon to action."
    )
    staff = profiles if profiles is not None else load_staff_profiles(clinic_id)
    admin_ids = _clinic_admin_user_ids(clinic_id)
    target_ids = list(dict.fromkeys([*( [assigned_to] if assigned_to else []), *admin_ids]))
    for uid in target_ids:
        phone = str((staff.get(uid) or {}).get("phone") or "").strip()
        if not phone:
            continue
        try:
            send_sms(clinic_id, phone, message, message_type="task_urgent")
        except Exception:
            traceback.print_exc()


def create_task_record(
    clinic_id: str,
    *,
    title: str,
    description: Optional[str],
    priority: str,
    source: str,
    assigned_to: Optional[str],
    created_by: Optional[str],
    patient_id: Optional[str],
    notify: bool = True,
    notify_sms: bool = True,
) -> dict[str, Any]:
    cid = clinic_id.strip()
    pr = priority.strip().lower()
    if pr not in _VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail="priority must be normal or urgent")
    src = source.strip().lower()
    if src not in _VALID_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid source")

    insert_row: dict[str, Any] = {
        "clinic_id": cid,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "priority": pr,
        "source": src,
        "status": "open",
        "assigned_to": assigned_to.strip() if assigned_to else None,
        "created_by": created_by.strip() if created_by else None,
        "patient_id": patient_id.strip() if patient_id else None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    try:
        resp = supabase.table("tasks").insert(insert_row).execute()
        _handle_supabase_error(resp, table="tasks")
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create task")
    row = rows[0]
    task_id = str(row.get("id") or "").strip()
    if not task_id:
        raise HTTPException(status_code=500, detail="Failed to create task")

    if notify:
        admin_ids = _clinic_admin_user_ids(cid)
        notify_ids: list[str] = []
        if assigned_to and assigned_to.strip():
            notify_ids.append(assigned_to.strip())
        notify_ids.extend(admin_ids)
        create_task_notifications(cid, task_id, "task_created", notify_ids)

    profiles = load_staff_profiles(cid)
    if notify_sms and pr == "urgent":
        send_urgent_task_sms(
            cid,
            title,
            assigned_to=assigned_to.strip() if assigned_to else None,
            profiles=profiles,
        )

    patients = _load_patient_names(cid, [str(row.get("patient_id") or "")])
    return shape_task(row, profiles, patients)


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "normal"
    source: str = "manual"
    assigned_to: Optional[str] = None
    patient_id: Optional[str] = None


class TaskStatusUpdate(BaseModel):
    status: str


class MarkNotificationsReadBody(BaseModel):
    user_id: str = Field(..., min_length=1)


@router.get("/{clinic_id}/notifications")
def list_task_notifications(
    clinic_id: str,
    user_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    uid = user_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return {"unread_count": 0, "notifications": []}

    try:
        resp = (
            supabase.table("task_notifications")
            .select("id, clinic_id, user_id, task_id, notification_type, read_at, created_at")
            .eq("clinic_id", cid)
            .eq("user_id", uid)
            .is_("read_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp, table="task_notifications")
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    except Exception:
        traceback.print_exc()
        return {"unread_count": 0, "notifications": []}

    return {"unread_count": len(rows), "notifications": rows}


@router.post("/{clinic_id}/notifications/mark-read")
def mark_task_notifications_read(
    clinic_id: str,
    body: MarkNotificationsReadBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    uid = body.user_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        resp = (
            supabase.table("task_notifications")
            .update({"read_at": _now_iso()})
            .eq("clinic_id", cid)
            .eq("user_id", uid)
            .is_("read_at", "null")
            .execute()
        )
        _handle_supabase_error(resp, table="task_notifications")
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    updated = len(resp.data or [])
    return {"success": True, "marked_read": updated}


@router.get("/{clinic_id}")
def list_tasks(
    clinic_id: str,
    status: str = Query(default="all"),
    priority: str = Query(default="all"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    try:
        q = (
            supabase.table("tasks")
            .select("*")
            .eq("clinic_id", cid)
            .order("created_at", desc=True)
        )
        st = status.strip().lower()
        if st and st != "all":
            if st not in _VALID_STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status filter")
            q = q.eq("status", st)
        pr = priority.strip().lower()
        if pr and pr != "all":
            if pr not in _VALID_PRIORITIES:
                raise HTTPException(status_code=400, detail="Invalid priority filter")
            q = q.eq("priority", pr)
        resp = q.execute()
        _handle_supabase_error(resp, table="tasks")
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    profiles = load_staff_profiles(cid)
    patient_ids = [str(r.get("patient_id") or "") for r in rows]
    patients = _load_patient_names(cid, patient_ids)
    return [shape_task(r, profiles, patients) for r in rows]


@router.post("/{clinic_id}")
def create_task(
    clinic_id: str,
    body: TaskCreate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return create_task_record(
        cid,
        title=body.title,
        description=body.description,
        priority=body.priority,
        source=body.source,
        assigned_to=body.assigned_to,
        created_by=caller,
        patient_id=body.patient_id,
    )


@router.patch("/{clinic_id}/{task_id}")
def update_task_status(
    clinic_id: str,
    task_id: str,
    body: TaskStatusUpdate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    tid = task_id.strip()
    new_status = body.status.strip().lower()
    if new_status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be acknowledged or resolved")

    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    update_payload: dict[str, Any] = {
        "status": new_status,
        "updated_at": _now_iso(),
    }
    if new_status == "acknowledged":
        update_payload["acknowledged_at"] = _now_iso()
        update_payload["acknowledged_by"] = caller
    else:
        update_payload["resolved_at"] = _now_iso()
        update_payload["resolved_by"] = caller

    try:
        resp = (
            supabase.table("tasks")
            .update(update_payload)
            .eq("id", tid)
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(resp, table="tasks")
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    row = rows[0]

    notification_type = "task_acknowledged" if new_status == "acknowledged" else "task_resolved"
    create_task_notifications(cid, tid, notification_type, _clinic_admin_user_ids(cid))

    profiles = load_staff_profiles(cid)
    patients = _load_patient_names(cid, [str(row.get("patient_id") or "")])
    return shape_task(row, profiles, patients)
