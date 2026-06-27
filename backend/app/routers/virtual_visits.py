"""Virtual visit rooms — WebRTC session lifecycle and patient SMS/email links."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase
from app.sms import send_sms
from app.utils.email import send_email
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

FRONTEND_URL = (os.getenv("FRONTEND_URL") or "https://www.altheon.app").rstrip("/")
EASTERN = ZoneInfo("America/New_York")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _fetch_visit_by_room(room_id: str) -> dict[str, Any]:
    rid = (room_id or "").strip()
    if not rid:
        raise HTTPException(status_code=404, detail="Visit not found")
    try:
        resp = (
            supabase.table("virtual_visits")
            .select("*")
            .eq("room_id", rid)
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
        raise HTTPException(status_code=404, detail="Visit not found")
    return rows[0]


def _clinic_name(clinic_id: str) -> str:
    branding = _fetch_clinic_branding(clinic_id)
    return branding["display_name"]


def _fetch_clinic_branding(clinic_id: str) -> dict[str, str | None]:
    """Clinic display name and optional branded email sender fields.

    email_from / email_from_name are added manually on clinics; fall back to env
    defaults in send_email() when absent.
    """
    defaults: dict[str, str | None] = {
        "display_name": "Clinic",
        "email_from": None,
        "email_from_name": None,
    }
    cid = (clinic_id or "").strip()
    if not cid:
        return defaults
    try:
        resp = (
            supabase.table("clinics")
            .select("name, brand_name, email_from, email_from_name")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            display = (
                str(row.get("brand_name") or "").strip()
                or str(row.get("name") or "").strip()
                or "Clinic"
            )
            email_from = str(row.get("email_from") or "").strip() or None
            email_from_name = str(row.get("email_from_name") or "").strip() or None
            return {
                "display_name": display,
                "email_from": email_from,
                "email_from_name": email_from_name,
            }
    except Exception:
        pass
    return defaults


def _fetch_patient_email(patient_id: str) -> str | None:
    pid = (patient_id or "").strip()
    if not pid:
        return None
    try:
        resp = (
            supabase.table("patients")
            .select("email")
            .eq("id", pid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            email = str(rows[0].get("email") or "").strip()
            return email or None
    except Exception:
        pass
    return None


def _patient_first_name(patient_name: str, patient_id: str) -> str:
    name = (patient_name or "").strip()
    if name:
        return name.split()[0]
    pid = (patient_id or "").strip()
    if not pid:
        return "there"
    try:
        resp = (
            supabase.table("patients")
            .select("first_name")
            .eq("id", pid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            fn = str(rows[0].get("first_name") or "").strip()
            if fn:
                return fn
    except Exception:
        pass
    return "there"


def _format_appointment_datetime(appointment_id: str) -> str:
    aid = (appointment_id or "").strip()
    if not aid:
        return "your scheduled time"
    try:
        resp = (
            supabase.table("appointments")
            .select("start_time")
            .eq("id", aid)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return "your scheduled time"
        start_raw = str(rows[0].get("start_time") or "").strip()
        if not start_raw:
            return "your scheduled time"
        dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_e = dt.astimezone(EASTERN)
        day = dt_e.strftime("%A, %B %d, %Y")
        h12 = dt_e.hour % 12 or 12
        time_part = f"{h12}:{dt_e.minute:02d} {dt_e.strftime('%p')} ET"
        return f"{day} at {time_part}"
    except Exception:
        return "your scheduled time"


def _telehealth_invite_html(
    *,
    patient_first_name: str,
    clinic_name: str,
    appointment_datetime: str,
    video_link: str,
) -> str:
    return f"""<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #16a34a;">Your Telehealth Session is Ready</h2>
  <p>Hi {patient_first_name},</p>
  <p>Your virtual appointment with {clinic_name} is ready to begin.</p>
  <p><strong>Date & Time:</strong> {appointment_datetime}</p>
  <a href="{video_link}"
     style="display: inline-block; background-color: #16a34a; color: white;
            padding: 12px 24px; text-decoration: none; border-radius: 6px;
            font-size: 16px; margin: 16px 0;">
    Join Telehealth Session
  </a>
  <p>Or copy this link: {video_link}</p>
  <p style="color: #666; font-size: 14px;">
    If you have any issues joining, please contact your clinic directly.
  </p>
</body>
</html>"""


def _email_send_ok(result: dict[str, Any]) -> bool:
    if not isinstance(result, dict):
        return False
    if result.get("id"):
        return True
    return not result.get("statusCode") and not result.get("message")


class ClinicianReadyBody(BaseModel):
    delivery_method: Literal["sms", "email", "both"] = "sms"
    patient_email: Optional[str] = None


class CreateVisitBody(BaseModel):
    appointment_id: str
    clinic_id: str
    patient_id: str
    clinician_id: str
    patient_phone: str
    patient_name: str
    clinician_name: str


class JoinVisitBody(BaseModel):
    role: Literal["clinician", "patient"]
    name: str = Field(..., min_length=1)


@router.post("/create")
def create_virtual_visit(body: CreateVisitBody, clinic: ClinicUserDep):
    if body.clinic_id.strip() != clinic.clinic_id:
        raise HTTPException(status_code=403, detail="clinic_id does not match authenticated clinic")

    # SMS is deferred until the clinician's room has subscribed to the
    # signaling channel (POST /{room_id}/ready) to avoid a race where the
    # patient joins before the clinician is listening.
    metadata = {
        "clinician_name": body.clinician_name.strip(),
        "patient_name": body.patient_name.strip(),
        "patient_phone": _to_e164_us(body.patient_phone),
        "sms_sent": False,
        "email_sent": False,
        "joins": [],
    }

    try:
        insert_resp = (
            supabase.table("virtual_visits")
            .insert(
                {
                    "appointment_id": body.appointment_id.strip(),
                    "clinic_id": body.clinic_id.strip(),
                    "clinician_id": body.clinician_id.strip(),
                    "patient_id": body.patient_id.strip(),
                    "status": "waiting",
                    "session_metadata": metadata,
                }
            )
            .execute()
        )
        _handle_supabase_error(insert_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = insert_resp.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create virtual visit")

    row = rows[0]
    room_id = str(row.get("room_id") or "").strip()
    if not room_id:
        raise HTTPException(status_code=500, detail="Visit room_id missing")

    patient_url = f"{FRONTEND_URL}/visit/{room_id}"
    clinician_url = f"{FRONTEND_URL}/visit/{room_id}?role=clinician"

    return {
        "room_id": room_id,
        "clinician_join_url": clinician_url,
        "patient_join_url": patient_url,
        "video_link": patient_url,
    }


@router.post("/{room_id}/ready")
def clinician_ready(
    room_id: str,
    clinic: ClinicUserDep,
    body: ClinicianReadyBody = ClinicianReadyBody(),
):
    """Called by the clinician's room once the signaling channel is subscribed.

    Sends the patient invite via SMS, email, or both (idempotent per channel)
    and moves the visit out of 'waiting'.
    """
    row = _fetch_visit_by_room(room_id)
    visit_clinic = str(row.get("clinic_id") or "").strip()
    if visit_clinic != clinic.clinic_id:
        raise HTTPException(status_code=403, detail="Visit does not belong to this clinic")

    status = str(row.get("status") or "waiting")
    if status == "completed":
        raise HTTPException(status_code=409, detail="Visit already completed")

    meta = row.get("session_metadata") or {}
    if not isinstance(meta, dict):
        meta = {}

    delivery_method = body.delivery_method
    needs_sms = delivery_method in ("sms", "both")
    needs_email = delivery_method in ("email", "both")
    sms_sent_before = bool(meta.get("sms_sent"))
    email_sent_before = bool(meta.get("email_sent"))

    patient_url = f"{FRONTEND_URL}/visit/{room_id.strip()}"

    if needs_sms and sms_sent_before and not needs_email:
        return {
            "room_id": room_id.strip(),
            "video_link": patient_url,
            "sms_sent": True,
            "email_sent": False,
            "already_sent": True,
        }
    if needs_email and email_sent_before and not needs_sms:
        return {
            "room_id": room_id.strip(),
            "video_link": patient_url,
            "sms_sent": False,
            "email_sent": True,
            "already_sent": True,
        }
    if needs_sms and needs_email and sms_sent_before and email_sent_before:
        return {
            "room_id": room_id.strip(),
            "video_link": patient_url,
            "sms_sent": True,
            "email_sent": True,
            "already_sent": True,
        }

    patient_phone = str(meta.get("patient_phone") or "").strip()
    clinician_name = str(meta.get("clinician_name") or "your clinician").strip()
    patient_name = str(meta.get("patient_name") or "").strip()
    patient_id = str(row.get("patient_id") or "").strip()
    appointment_id = str(row.get("appointment_id") or "").strip()

    sms_ok = sms_sent_before if needs_sms else False
    if needs_sms and not sms_sent_before:
        sms_ok = False
        if patient_phone:
            sms_body = (
                f"Dr. {clinician_name} is ready for your virtual visit.\n"
                f"Join here: {patient_url}"
            )
            try:
                send_sms(
                    visit_clinic,
                    patient_phone,
                    sms_body,
                    patient_id=patient_id or None,
                    appointment_id=appointment_id or None,
                    message_type="virtual_visit_link",
                )
                sms_ok = True
            except Exception:
                sms_ok = False

    email_ok = email_sent_before if needs_email else False
    if needs_email and not email_sent_before:
        email_ok = False
        to_email = (body.patient_email or "").strip() or _fetch_patient_email(patient_id)
        if to_email:
            branding = _fetch_clinic_branding(visit_clinic)
            clinic_name = str(branding["display_name"] or "Clinic")
            patient_first_name = _patient_first_name(patient_name, patient_id)
            appointment_datetime = _format_appointment_datetime(appointment_id)
            html_body = _telehealth_invite_html(
                patient_first_name=patient_first_name,
                clinic_name=clinic_name,
                appointment_datetime=appointment_datetime,
                video_link=patient_url,
            )
            try:
                result = send_email(
                    to_email=to_email,
                    subject=f"Your Telehealth Session with {clinic_name}",
                    html_body=html_body,
                    from_email=branding.get("email_from"),
                    from_name=branding.get("email_from_name"),
                )
                email_ok = _email_send_ok(result)
            except Exception:
                email_ok = False

    if needs_sms:
        meta["sms_sent"] = sms_ok or sms_sent_before
    if needs_email:
        meta["email_sent"] = email_ok or email_sent_before
    meta["clinician_ready_at"] = _now_iso()

    update_payload: dict[str, Any] = {"session_metadata": meta}
    if status == "waiting":
        update_payload["status"] = "pending"

    try:
        upd = (
            supabase.table("virtual_visits")
            .update(update_payload)
            .eq("room_id", room_id.strip())
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if needs_sms and needs_email:
        if not sms_ok and not email_ok:
            raise HTTPException(
                status_code=502,
                detail="Could not send patient SMS or email",
            )
    elif needs_sms and not sms_ok:
        raise HTTPException(status_code=502, detail="Could not send patient SMS")
    elif needs_email and not email_ok:
        raise HTTPException(status_code=502, detail="Could not send patient email")

    return {
        "room_id": room_id.strip(),
        "video_link": patient_url,
        "sms_sent": bool(meta.get("sms_sent")) if needs_sms else False,
        "email_sent": bool(meta.get("email_sent")) if needs_email else False,
        "already_sent": False,
    }


@router.get("/clinician/active")
def list_active_clinician_visits(clinic: ClinicUserDep):
    try:
        resp = (
            supabase.table("virtual_visits")
            .select("*")
            .eq("clinic_id", clinic.clinic_id)
            .in_("status", ["waiting", "pending", "active"])
            .order("started_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    out: list[dict[str, Any]] = []
    for row in resp.data or []:
        meta = row.get("session_metadata") or {}
        if not isinstance(meta, dict):
            meta = {}
        out.append(
            {
                "id": str(row.get("id") or ""),
                "room_id": str(row.get("room_id") or ""),
                "appointment_id": row.get("appointment_id"),
                "clinician_id": row.get("clinician_id"),
                "patient_id": row.get("patient_id"),
                "status": str(row.get("status") or "pending"),
                "started_at": row.get("started_at"),
                "clinician_name": meta.get("clinician_name"),
                "patient_name": meta.get("patient_name"),
            }
        )
    return out


@router.get("/{room_id}/info")
def get_visit_info(room_id: str):
    row = _fetch_visit_by_room(room_id)
    status = str(row.get("status") or "pending")
    if status == "completed":
        raise HTTPException(status_code=410, detail="This visit has ended")

    meta = row.get("session_metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    clinic_id = str(row.get("clinic_id") or "").strip()

    return {
        "room_id": str(row.get("room_id") or room_id),
        "status": status,
        "clinician_name": meta.get("clinician_name") or "Clinician",
        "clinic_name": _clinic_name(clinic_id) if clinic_id else "Clinic",
        "started_at": row.get("started_at"),
    }


@router.post("/{room_id}/join")
def join_visit(room_id: str, body: JoinVisitBody):
    row = _fetch_visit_by_room(room_id)
    status = str(row.get("status") or "pending")
    if status == "completed":
        raise HTTPException(status_code=410, detail="This visit has ended")

    meta = row.get("session_metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    joins = meta.get("joins")
    if not isinstance(joins, list):
        joins = []

    joined_at = _now_iso()
    joins.append(
        {
            "role": body.role,
            "name": body.name.strip(),
            "joined_at": joined_at,
        }
    )
    meta["joins"] = joins

    update_payload: dict[str, Any] = {"session_metadata": meta}
    if status in ("waiting", "pending"):
        update_payload["status"] = "active"
        update_payload["started_at"] = joined_at

    try:
        upd = (
            supabase.table("virtual_visits")
            .update(update_payload)
            .eq("room_id", room_id.strip())
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "room_id": room_id.strip(),
        "role": body.role,
        "joined_at": joined_at,
    }


@router.post("/{room_id}/end")
def end_visit(room_id: str, clinic: ClinicUserDep):
    row = _fetch_visit_by_room(room_id)
    visit_clinic = str(row.get("clinic_id") or "").strip()
    if visit_clinic != clinic.clinic_id:
        raise HTTPException(status_code=403, detail="Visit does not belong to this clinic")

    status = str(row.get("status") or "pending")
    if status == "completed":
        raise HTTPException(status_code=409, detail="Visit already completed")

    ended_at = _now_iso()
    started = _parse_iso(row.get("started_at"))
    ended = _parse_iso(ended_at)
    duration_seconds = 0
    if started and ended:
        duration_seconds = max(0, int((ended - started).total_seconds()))

    meta = row.get("session_metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    meta["duration_seconds"] = duration_seconds
    meta["ended_at"] = ended_at

    try:
        upd = (
            supabase.table("virtual_visits")
            .update(
                {
                    "status": "completed",
                    "ended_at": ended_at,
                    "session_metadata": meta,
                }
            )
            .eq("room_id", room_id.strip())
            .execute()
        )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "room_id": room_id.strip(),
        "duration_seconds": duration_seconds,
    }
