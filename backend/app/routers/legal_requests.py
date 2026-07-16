"""Legal / medical records request workflow API (mounted under /api/legal-requests)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.retry_utils import supabase_execute
from app.services.system_tasks import (
    TASK_LEGAL_REQUEST,
    LEGAL_TERMINAL_STATUSES,
    ensure_legal_request_task,
    resolve_system_task,
)

router = APIRouter()

_KANBAN_STATUSES = (
    "received",
    "gathering_records",
    "provider_review",
    "ready",
    "delivered",
)
_ALL_STATUSES = _KANBAN_STATUSES + ("archived",)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _sb_execute(fn):
    """Run Supabase query with transient-failure retry (Render-safe)."""
    try:
        resp = supabase_execute(fn)
        _handle_supabase_error(resp)
        return resp
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    patient = out.pop("patients", None)
    if isinstance(patient, list):
        patient = patient[0] if patient else None
    if isinstance(patient, dict):
        out["patient_dob"] = patient.get("date_of_birth")
        out["patient_phone"] = patient.get("phone")
    else:
        out.setdefault("patient_dob", None)
        out.setdefault("patient_phone", None)
    out["documents_requested"] = list(out.get("documents_requested") or [])
    out["documents_prepared"] = list(out.get("documents_prepared") or [])
    return out


def _matches_search(row: dict[str, Any], search: str) -> bool:
    q = search.strip().lower()
    if not q:
        return True
    hay = " ".join(
        [
            str(row.get("patient_name") or ""),
            str(row.get("attorney_name") or ""),
            str(row.get("firm_name") or ""),
            str(row.get("requesting_party_name") or ""),
        ]
    ).lower()
    return q in hay


class LegalRequestCreate(BaseModel):
    clinic_id: str
    patient_id: Optional[str] = None
    patient_name: str
    requesting_party_name: str
    requesting_party_type: str
    request_date: str
    request_method: str
    documents_requested: list[str] = Field(default_factory=list)
    attorney_name: Optional[str] = None
    firm_name: Optional[str] = None
    attorney_phone: Optional[str] = None
    attorney_email: Optional[str] = None
    request_type: str
    notes: Optional[str] = None


class LegalRequestPatch(BaseModel):
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    requesting_party_name: Optional[str] = None
    requesting_party_type: Optional[str] = None
    request_date: Optional[str] = None
    request_method: Optional[str] = None
    documents_requested: Optional[list[str]] = None
    documents_prepared: Optional[list[str]] = None
    status: Optional[str] = None
    send_date: Optional[str] = None
    send_method: Optional[str] = None
    notes: Optional[str] = None
    attorney_name: Optional[str] = None
    firm_name: Optional[str] = None
    attorney_phone: Optional[str] = None
    attorney_email: Optional[str] = None
    request_type: Optional[str] = None


@router.get("/stats")
def get_legal_requests_stats(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    try:
        resp = _sb_execute(
            lambda: supabase.table("legal_requests")
            .select("id, status, request_date")
            .eq("clinic_id", cid)
            .neq("status", "archived")
            .execute()
        )
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
        today = date.today()
        overdue_cutoff = today - timedelta(days=30)

        counts = {s: 0 for s in _KANBAN_STATUSES}
        overdue = 0
        for r in rows:
            st = str(r.get("status") or "received").strip().lower()
            if st in counts:
                counts[st] += 1
            if st != "delivered":
                raw = r.get("request_date")
                if raw:
                    try:
                        rd = date.fromisoformat(str(raw)[:10])
                        if rd < overdue_cutoff:
                            overdue += 1
                    except ValueError:
                        pass

        return {
            "total": len(rows),
            "received": counts["received"],
            "gathering_records": counts["gathering_records"],
            "provider_review": counts["provider_review"],
            "ready": counts["ready"],
            "delivered": counts["delivered"],
            "overdue": overdue,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Legal request stats failed: {exc}"
        ) from exc


@router.get("")
def list_legal_requests(
    clinic_id: str = Query(..., min_length=1),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    cid = clinic_id.strip()
    try:
        q = (
            supabase.table("legal_requests")
            .select("*, patients(date_of_birth, phone)")
            .eq("clinic_id", cid)
            .order("updated_at", desc=True)
        )
        if status and str(status).strip():
            q = q.eq("status", str(status).strip().lower())
        else:
            q = q.neq("status", "archived")

        resp = _sb_execute(lambda: q.execute())
        rows = [_normalize_row(r) for r in (resp.data or []) if isinstance(r, dict)]

        if search and str(search).strip():
            rows = [r for r in rows if _matches_search(r, str(search))]

        return rows
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Legal requests list failed: {exc}"
        ) from exc


@router.post("")
def create_legal_request(body: LegalRequestCreate):
    cid = body.clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    payload: dict[str, Any] = {
        "clinic_id": cid,
        "patient_id": (body.patient_id or "").strip() or None,
        "patient_name": body.patient_name.strip(),
        "requesting_party_name": body.requesting_party_name.strip(),
        "requesting_party_type": body.requesting_party_type.strip().lower(),
        "request_date": body.request_date.strip()[:10],
        "request_method": body.request_method.strip().lower(),
        "documents_requested": body.documents_requested or [],
        "documents_prepared": [],
        "attorney_name": (body.attorney_name or "").strip() or None,
        "firm_name": (body.firm_name or "").strip() or None,
        "attorney_phone": (body.attorney_phone or "").strip() or None,
        "attorney_email": (body.attorney_email or "").strip() or None,
        "request_type": body.request_type.strip(),
        "notes": (body.notes or "").strip() or None,
        "status": "received",
        "source": "manual",
        "updated_at": _now_iso(),
    }

    try:
        resp = _sb_execute(
            lambda: supabase.table("legal_requests").insert(payload).execute()
        )
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create legal request")
        row = rows[0]
        ensure_legal_request_task(
            clinic_id=cid,
            request_id=str(row.get("id") or "").strip(),
            patient_id=str(row.get("patient_id") or "").strip() or None,
            requesting_party_name=str(row.get("requesting_party_name") or ""),
            status=str(row.get("status") or ""),
        )
        return _normalize_row(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Create legal request failed: {exc}"
        ) from exc


@router.patch("/{request_id}")
def update_legal_request(request_id: str, body: LegalRequestPatch):
    rid = request_id.strip()
    if not rid:
        raise HTTPException(status_code=400, detail="request_id is required")

    patch = body.model_dump(exclude_unset=True)
    if "status" in patch and patch["status"] is not None:
        st = str(patch["status"]).strip().lower()
        if st not in _ALL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {st}")
        patch["status"] = st

    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")

    patch["updated_at"] = _now_iso()

    try:
        resp = _sb_execute(
            lambda: supabase.table("legal_requests")
            .update(patch)
            .eq("id", rid)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Legal request not found")
        row = rows[0]
        if row.get("patient_id"):
            patient_resp = _sb_execute(
                lambda: supabase.table("patients")
                .select("date_of_birth, phone")
                .eq("id", row["patient_id"])
                .limit(1)
                .execute()
            )
            patient = (patient_resp.data or [{}])[0] if patient_resp.data else {}
            row["patient_dob"] = patient.get("date_of_birth")
            row["patient_phone"] = patient.get("phone")
        new_status = str(row.get("status") or "").strip().lower()
        if new_status in LEGAL_TERMINAL_STATUSES:
            resolve_system_task(
                str(row.get("clinic_id") or cid).strip() or cid,
                TASK_LEGAL_REQUEST,
                rid,
            )
        elif new_status:
            ensure_legal_request_task(
                clinic_id=str(row.get("clinic_id") or cid).strip() or cid,
                request_id=rid,
                patient_id=str(row.get("patient_id") or "").strip() or None,
                requesting_party_name=str(row.get("requesting_party_name") or ""),
                status=new_status,
            )
        return _normalize_row(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Update legal request failed: {exc}"
        ) from exc


@router.delete("/{request_id}")
def archive_legal_request(request_id: str):
    rid = request_id.strip()
    if not rid:
        raise HTTPException(status_code=400, detail="request_id is required")

    try:
        resp = _sb_execute(
            lambda: supabase.table("legal_requests")
            .update({"status": "archived", "updated_at": _now_iso()})
            .eq("id", rid)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Legal request not found")
        resolve_system_task(
            str((resp.data[0] or {}).get("clinic_id") or "").strip(),
            TASK_LEGAL_REQUEST,
            rid,
        )
        return {"success": True, "id": rid, "status": "archived"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Archive legal request failed: {exc}"
        ) from exc
