"""PI case tracking and referral milestones (API routes under /api)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db import supabase
from app.retry_utils import supabase_execute

router = APIRouter()

_BOARD_STATUSES = (
    "intake_open",
    "treatment",
    "records_requested",
    "settlement_negotiation",
    "closed_settled",
)
_CLOSED_STATUSES = frozenset({"closed", "settled", "closed_settled"})
_LEGACY_STATUS_MAP = {
    "open": "intake_open",
    "in_treatment": "treatment",
    "pending_settlement": "settlement_negotiation",
    "settled": "closed_settled",
    "closed": "closed_settled",
}


def _normalize_status(raw: str | None) -> str:
    s = (raw or "intake_open").strip().lower()
    return _LEGACY_STATUS_MAP.get(s, s)


def _patient_pt_id(patient_id: str) -> str:
    pid = (patient_id or "").strip()
    if not pid:
        return ""
    return f"PT-{pid.replace('-', '')[-6:].upper()}"


def _format_us_date(value: Any) -> Optional[str]:
    d = _parse_date_only(value)
    if not d:
        return None
    return d.strftime("%m/%d/%Y")


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fetch_cases_with_patients(clinic_id: str) -> list[dict[str, Any]]:
    resp = supabase_execute(
            lambda: supabase.table("pi_cases")
            .select("*, patients(first_name, last_name, phone)")
            .eq("clinic_id", clinic_id)
            .order("updated_at", desc=True)
            .execute()
        )
    _handle_supabase_error(resp)
    return [r for r in (resp.data or []) if isinstance(r, dict)]


def _shape_board_case(row: dict[str, Any], today: date) -> dict[str, Any]:
    patient = row.get("patients") or {}
    if isinstance(patient, list):
        patient = patient[0] if patient else {}
    pid = str(row.get("patient_id") or "")
    first = str(patient.get("first_name") or "")
    last = str(patient.get("last_name") or "")
    status = _normalize_status(str(row.get("status") or ""))
    updated = _parse_utc_dt(row.get("updated_at"))
    days_in_status = 0
    if updated:
        days_in_status = max(0, (datetime.now(timezone.utc) - updated).days)

    due = _parse_date_only(row.get("records_due_date"))
    is_overdue = False
    days_overdue = 0
    if due and status not in _CLOSED_STATUSES:
        if due < today:
            is_overdue = True
            days_overdue = (today - due).days

    tags = list(row.get("case_tags") or [])
    if not tags and status == "intake_open":
        tags = ["New"]
    elif not tags and status == "treatment":
        tags = ["Active"]
    elif not tags and status == "settlement_negotiation":
        tags = ["Negotiating"]

    return {
        "id": str(row.get("id") or ""),
        "patient_id": pid,
        "patient_name": f"{first} {last}".strip() or "—",
        "patient_pt_id": _patient_pt_id(pid),
        "insurance_carrier": row.get("insurance_carrier"),
        "firm_name": row.get("firm_name"),
        "attorney_name": row.get("attorney_name"),
        "date_of_accident": _format_us_date(row.get("date_of_accident")),
        "estimated_settlement": _safe_float(row.get("estimated_settlement")),
        "demand_amount": _safe_float(row.get("demand_amount")),
        "settled_amount": _safe_float(row.get("settled_amount")),
        "records_due_date": (
            str(row.get("records_due_date") or "")[:10] or None
        ),
        "hearing_date": str(row.get("hearing_date") or "")[:10] or None,
        "status": status,
        "attorney_request_pending": bool(row.get("attorney_request_pending")),
        "case_tags": tags,
        "days_in_status": days_in_status,
        "is_overdue": is_overdue,
        "days_overdue": days_overdue,
        "claim_number": row.get("claim_number"),
        "attorney_email": row.get("attorney_email"),
        "attorney_phone": row.get("attorney_phone"),
        "records_requested_date": row.get("records_requested_date"),
        "settlement_date": row.get("settlement_date"),
        "notes": row.get("notes"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_utc_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_date_only(value: Any) -> Optional[date]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
        if not m:
            return None
        return date(int(m[1]), int(m[2]), int(m[3]))


class CreatePiCaseBody(BaseModel):
    patient_id: str
    clinic_id: str
    insurance_carrier: str
    status: Optional[str] = "intake_open"
    date_of_accident: Optional[str] = None
    claim_number: Optional[str] = None
    attorney_name: Optional[str] = None
    attorney_email: Optional[str] = None
    attorney_phone: Optional[str] = None
    firm_name: Optional[str] = None
    estimated_settlement: Optional[float] = None
    notes: Optional[str] = None


class PatchPiCaseBody(BaseModel):
    date_of_accident: Optional[str] = None
    claim_number: Optional[str] = None
    attorney_name: Optional[str] = None
    attorney_email: Optional[str] = None
    attorney_phone: Optional[str] = None
    firm_name: Optional[str] = None
    insurance_carrier: Optional[str] = None
    status: Optional[str] = None
    attorney_request_pending: Optional[bool] = None
    records_requested_date: Optional[str] = None
    records_due_date: Optional[str] = None
    hearing_date: Optional[str] = None
    settlement_date: Optional[str] = None
    estimated_settlement: Optional[float] = None
    demand_amount: Optional[float] = None
    settled_amount: Optional[float] = None
    case_tags: Optional[list[str]] = None
    notes: Optional[str] = None


class CreateReferralBody(BaseModel):
    referral_type: str = Field(..., min_length=1)
    referral_type_other: Optional[str] = None
    referral_date: Optional[str] = None
    provider_specialist: Optional[str] = None
    notes: Optional[str] = None


class PatchReferralBody(BaseModel):
    referral_type: Optional[str] = None
    referral_type_other: Optional[str] = None
    status: Optional[str] = None
    referral_date: Optional[str] = None
    provider_specialist: Optional[str] = None
    records_received: Optional[bool] = None
    records_received_date: Optional[str] = None
    follow_up_status: Optional[str] = None
    notes: Optional[str] = None


@router.post("/pi-cases")
def create_pi_case(body: CreatePiCaseBody):
    patient_id = body.patient_id.strip()
    clinic_id = body.clinic_id.strip()
    carrier = body.insurance_carrier.strip()
    if not patient_id or not clinic_id:
        raise HTTPException(status_code=400, detail="patient_id and clinic_id are required")
    if not carrier:
        raise HTTPException(status_code=400, detail="insurance_carrier is required")

    try:
        dup = supabase_execute(
                    lambda: supabase.table("pi_cases")
                    .select("id")
                    .eq("patient_id", patient_id)
                    .eq("clinic_id", clinic_id)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(dup)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if dup.data:
        raise HTTPException(
            status_code=409,
            detail="A PI case already exists for this patient and clinic",
        )

    row: dict[str, Any] = {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "status": _normalize_status(body.status or "intake_open"),
        "insurance_carrier": carrier,
    }
    optional = (
        "date_of_accident",
        "claim_number",
        "attorney_name",
        "attorney_email",
        "attorney_phone",
        "firm_name",
        "notes",
    )
    for key in optional:
        val = getattr(body, key)
        if val is not None and str(val).strip() != "":
            row[key] = val
    if body.estimated_settlement is not None:
        row["estimated_settlement"] = body.estimated_settlement

    try:
        ins = supabase_execute(
                    lambda: supabase.table("pi_cases").insert(row).execute()
                )
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create PI case")
    return rows[0]


@router.get("/patients/{patient_id}/pi-case")
def get_patient_pi_case(patient_id: str):
    pid = patient_id.strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Invalid patient_id")

    try:
        resp = supabase_execute(
                    lambda: supabase.table("pi_cases")
                    .select("*")
                    .eq("patient_id", pid)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = resp.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="No PI case found for this patient")

    case = crows[0]
    case_id = str(case.get("id") or "").strip()
    if not case_id:
        raise HTTPException(status_code=500, detail="Invalid case record")

    try:
        rresp = supabase_execute(
                    lambda: supabase.table("pi_referrals")
                    .select("*")
                    .eq("pi_case_id", case_id)
                    .order("created_at", desc=False)
                    .execute()
                )
        _handle_supabase_error(rresp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    case_out = dict(case)
    case_out["pi_referrals"] = rresp.data or []
    return case_out


@router.patch("/pi-cases/{case_id}")
def patch_pi_case_api(case_id: str, body: PatchPiCaseBody):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")

    allowed = {
        "date_of_accident",
        "claim_number",
        "attorney_name",
        "attorney_email",
        "attorney_phone",
        "firm_name",
        "insurance_carrier",
        "status",
        "attorney_request_pending",
        "records_requested_date",
        "records_due_date",
        "hearing_date",
        "settlement_date",
        "estimated_settlement",
        "demand_amount",
        "settled_amount",
        "case_tags",
        "notes",
    }
    data = {k: v for k, v in payload.items() if k in allowed}
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    if "status" in data and data["status"] is not None:
        data["status"] = _normalize_status(str(data["status"]))

    data["updated_at"] = _now_iso()

    try:
        upd = supabase_execute(
                    lambda: supabase.table("pi_cases").update(data).eq("id", case_id).execute()
                )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="PI case not found")
    return rows[0]


@router.post("/pi-cases/{case_id}/referrals")
def create_referral(case_id: str, body: CreateReferralBody):
    try:
        cresp = supabase_execute(
                    lambda: supabase.table("pi_cases")
                    .select("id, patient_id, clinic_id")
                    .eq("id", case_id)
                    .limit(1)
                    .execute()
                )
        _handle_supabase_error(cresp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cresp.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="PI case not found")

    parent = crows[0]
    patient_id = str(parent.get("patient_id") or "").strip()
    clinic_id = str(parent.get("clinic_id") or "").strip()
    if not patient_id or not clinic_id:
        raise HTTPException(status_code=500, detail="Parent case missing patient or clinic")

    row: dict[str, Any] = {
        "pi_case_id": case_id,
        "patient_id": patient_id,
        "clinic_id": clinic_id,
        "referral_type": body.referral_type.strip(),
        "status": "pending",
        "records_received": False,
    }
    if body.referral_type_other is not None:
        row["referral_type_other"] = body.referral_type_other
    if body.referral_date is not None:
        row["referral_date"] = body.referral_date
    if body.provider_specialist is not None:
        row["provider_specialist"] = body.provider_specialist
    if body.notes is not None:
        row["notes"] = body.notes

    try:
        ins = supabase_execute(
                    lambda: supabase.table("pi_referrals").insert(row).execute()
                )
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    ins_rows = ins.data or []
    if not ins_rows:
        raise HTTPException(status_code=500, detail="Failed to create referral")
    return ins_rows[0]


@router.patch("/pi-referrals/{referral_id}")
def patch_referral(referral_id: str, body: PatchReferralBody):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")

    allowed = {
        "referral_type",
        "referral_type_other",
        "status",
        "referral_date",
        "provider_specialist",
        "records_received",
        "records_received_date",
        "follow_up_status",
        "notes",
    }
    data = {k: v for k, v in payload.items() if k in allowed}
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if data.get("records_received") is True and "records_received_date" not in data:
        data["records_received_date"] = datetime.now(timezone.utc).date().isoformat()

    data["updated_at"] = _now_iso()

    try:
        upd = supabase_execute(
                    lambda: supabase.table("pi_referrals")
                    .update(data)
                    .eq("id", referral_id)
                    .execute()
                )
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Referral not found")
    return rows[0]


@router.delete("/pi-referrals/{referral_id}", status_code=204)
def delete_referral(referral_id: str):
    try:
        dele = supabase_execute(
                    lambda: supabase.table("pi_referrals")
                    .delete()
                    .eq("id", referral_id)
                    .execute()
                )
        _handle_supabase_error(dele)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/clinics/{clinic_id}/pi-alerts")
def list_pi_alerts(clinic_id: str):
    try:
        cases_resp = supabase_execute(
                    lambda: supabase.table("pi_cases")
                    .select("*")
                    .eq("clinic_id", clinic_id)
                    .execute()
                )
        _handle_supabase_error(cases_resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    cases = [c for c in (cases_resp.data or []) if isinstance(c, dict)]
    if not cases:
        return []

    case_ids = [str(c.get("id")) for c in cases if c.get("id")]
    patient_ids = list(
        {str(c.get("patient_id")) for c in cases if c.get("patient_id")}
    )

    refs_by_case: dict[str, list[dict[str, Any]]] = {cid: [] for cid in case_ids}
    try:
        if case_ids:
            rresp = supabase_execute(
                            lambda: supabase.table("pi_referrals")
                            .select("*")
                            .eq("clinic_id", clinic_id)
                            .execute()
                        )
            _handle_supabase_error(rresp)
            for r in rresp.data or []:
                if not isinstance(r, dict):
                    continue
                pcid = str(r.get("pi_case_id") or "")
                if pcid in refs_by_case:
                    refs_by_case[pcid].append(r)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    patients_by_id: dict[str, dict[str, Any]] = {}
    try:
        if patient_ids:
            presp = supabase_execute(
                            lambda: supabase.table("patients")
                            .select("id, first_name, last_name")
                            .in_("id", patient_ids)
                            .execute()
                        )
            _handle_supabase_error(presp)
            for pr in presp.data or []:
                if isinstance(pr, dict) and pr.get("id"):
                    patients_by_id[str(pr["id"])] = pr
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    pending_cutoff = now - timedelta(days=7)
    record_cutoff_date = (now.date() - timedelta(days=30))

    out: list[dict[str, Any]] = []

    for case in cases:
        cid = str(case.get("id") or "")
        pid = str(case.get("patient_id") or "")
        alerts: list[dict[str, Any]] = []

        if case.get("attorney_request_pending") is True:
            alerts.append(
                {
                    "type": "attorney_request_pending",
                    "message": "Attorney request is pending for this case.",
                }
            )

        for ref in refs_by_case.get(cid, []):
            rid = str(ref.get("id") or "")
            rtype = str(ref.get("referral_type") or "")
            st = str(ref.get("status") or "").strip().lower()
            created = _parse_utc_dt(ref.get("created_at"))
            if st == "pending" and created and created < pending_cutoff:
                alerts.append(
                    {
                        "type": "referral_pending_stale",
                        "referral_id": rid,
                        "referral_type": rtype or None,
                        "message": (
                            f"Referral ({rtype or 'unknown'}) has been pending for over 7 days."
                        ),
                    }
                )

            rec_ok = ref.get("records_received")
            if rec_ok is True:
                pass
            else:
                rd = _parse_date_only(ref.get("referral_date"))
                if rd is not None and rd < record_cutoff_date:
                    alerts.append(
                        {
                            "type": "records_not_received_overdue",
                            "referral_id": rid,
                            "referral_type": rtype or None,
                            "message": (
                                f"Records not received for {rtype or 'referral'}; "
                                f"referral date is over 30 days ago."
                            ),
                        }
                    )

        if not alerts:
            continue

        pt = patients_by_id.get(pid, {})
        fn = str(pt.get("first_name") or "").strip()
        ln = str(pt.get("last_name") or "").strip()
        patient_name = f"{fn} {ln}".strip() or "Unknown"

        out.append(
            {
                "case_id": cid,
                "patient_id": pid,
                "patient_name": patient_name,
                "alerts": alerts,
            }
        )

    return out


@router.get("/pi-cases/stats")
def get_pi_cases_stats(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    today = datetime.now(timezone.utc).date()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    now = datetime.now(timezone.utc)
    month_start = date(today.year, today.month, 1)
    year_start = date(today.year, 1, 1)
    if today.month == 1:
        last_month_start = date(today.year - 1, 12, 1)
        last_month_end = date(today.year, 1, 1) - timedelta(days=1)
    else:
        last_month_start = date(today.year, today.month - 1, 1)
        last_month_end = month_start - timedelta(days=1)

    try:
        rows = _fetch_cases_with_patients(cid)
        open_cases = 0
        new_this_week = 0
        records_requested = 0
        records_overdue = 0
        records_outstanding = 0
        amount_at_risk = 0.0
        est_settlement_value = 0.0
        settlement_change_this_month = 0.0
        closed_ytd = 0
        closed_last_month = 0

        for r in rows:
            status = _normalize_status(str(r.get("status") or ""))
            is_closed = status in _CLOSED_STATUSES
            created = _parse_utc_dt(r.get("created_at"))
            updated = _parse_utc_dt(r.get("updated_at"))
            est = _safe_float(r.get("estimated_settlement")) or 0.0
            due = _parse_date_only(r.get("records_due_date"))

            if not is_closed:
                open_cases += 1
                est_settlement_value += est
            if created and created >= week_ago and not is_closed:
                new_this_week += 1
            if r.get("attorney_request_pending") is True:
                records_requested += 1
            if (
                r.get("records_requested_date")
                and not is_closed
            ):
                records_outstanding += 1
            if due and due < today and not is_closed:
                records_overdue += 1
                amount_at_risk += est
            if updated and updated.date() >= month_start and not is_closed:
                settlement_change_this_month += est
            if is_closed and updated and updated.date() >= year_start:
                closed_ytd += 1
            if (
                is_closed
                and updated
                and last_month_start <= updated.date() <= last_month_end
            ):
                closed_last_month += 1

        return {
            "open_cases": open_cases,
            "new_this_week": new_this_week,
            "records_requested": records_requested,
            "records_overdue": records_overdue,
            "records_outstanding": records_outstanding,
            "amount_at_risk": round(amount_at_risk, 2),
            "est_settlement_value": round(est_settlement_value, 2),
            "settlement_change_this_month": round(settlement_change_this_month, 2),
            "closed_ytd": closed_ytd,
            "closed_vs_last_month": closed_ytd - closed_last_month,
            "status_counts": {
                s: sum(
                    1
                    for r in rows
                    if _normalize_status(str(r.get("status") or "")) == s
                )
                for s in _BOARD_STATUSES
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pi-cases/board")
def get_pi_cases_board(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    today = datetime.now(timezone.utc).date()
    try:
        rows = _fetch_cases_with_patients(cid)
        board: dict[str, list[dict[str, Any]]] = {s: [] for s in _BOARD_STATUSES}
        for r in rows:
            shaped = _shape_board_case(r, today)
            st = shaped["status"]
            if st not in board:
                st = "intake_open"
            board[st].append(shaped)
        return board
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pi-cases")
def list_pi_cases_api(
    clinic_id: str = Query(..., min_length=1),
    patient_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    cid = clinic_id.strip()
    today = datetime.now(timezone.utc).date()
    try:
        q = (
            supabase.table("pi_cases")
            .select("*, patients(first_name, last_name, phone)")
            .eq("clinic_id", cid)
            .order("updated_at", desc=True)
        )
        if patient_id and patient_id.strip():
            q = q.eq("patient_id", patient_id.strip())
        resp = supabase_execute(
                    lambda: q.execute()
                )
        _handle_supabase_error(resp)
        rows = [_shape_board_case(r, today) for r in (resp.data or [])]
        if search and search.strip():
            qstr = search.strip().lower()
            rows = [
                r
                for r in rows
                if qstr in (r.get("patient_name") or "").lower()
                or qstr in (r.get("insurance_carrier") or "").lower()
                or qstr in (r.get("firm_name") or "").lower()
                or qstr in (r.get("attorney_name") or "").lower()
            ]
        return rows
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pi-cases/activity")
def get_pi_cases_activity(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
):
    cid = clinic_id.strip()
    today = datetime.now(timezone.utc).date()
    try:
        rows = _fetch_cases_with_patients(cid)
        activities: list[dict[str, Any]] = []
        for r in rows:
            shaped = _shape_board_case(r, today)
            name = shaped["patient_name"]
            carrier = str(shaped.get("insurance_carrier") or "—")
            updated = _parse_utc_dt(r.get("updated_at"))
            ts_label = ""
            if updated:
                ts_label = updated.astimezone(timezone.utc).strftime("%b %d, %Y %I:%M %p")

            if shaped.get("is_overdue"):
                activities.append(
                    {
                        "description": f"Records request overdue for {name}",
                        "tag": carrier,
                        "timestamp": ts_label,
                        "type": "overdue",
                        "sort_ts": updated,
                    }
                )
            elif shaped.get("attorney_request_pending"):
                activities.append(
                    {
                        "description": f"Attorney records request pending for {name}",
                        "tag": carrier,
                        "timestamp": ts_label,
                        "type": "upload",
                        "sort_ts": updated,
                    }
                )
            elif shaped["status"] == "closed_settled" and shaped.get("settled_amount"):
                activities.append(
                    {
                        "description": f"Case settled for {name}",
                        "tag": carrier,
                        "timestamp": ts_label,
                        "type": "settlement",
                        "sort_ts": updated,
                    }
                )
            elif shaped.get("hearing_date"):
                activities.append(
                    {
                        "description": f"Hearing scheduled for {name}",
                        "tag": carrier,
                        "timestamp": ts_label,
                        "type": "hearing",
                        "sort_ts": updated,
                    }
                )
            else:
                activities.append(
                    {
                        "description": f"Case updated — {shaped['status'].replace('_', ' ')}",
                        "tag": carrier,
                        "timestamp": ts_label,
                        "type": "update",
                        "sort_ts": updated,
                    }
                )

        activities.sort(
            key=lambda x: x.get("sort_ts") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        out = []
        for a in activities[:limit]:
            item = {k: v for k, v in a.items() if k != "sort_ts"}
            out.append(item)
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pi-cases/deadlines")
def get_pi_cases_deadlines(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(default=6, ge=1, le=30),
):
    cid = clinic_id.strip()
    today = datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=30)
    try:
        rows = _fetch_cases_with_patients(cid)
        deadlines: list[dict[str, Any]] = []
        for r in rows:
            shaped = _shape_board_case(r, today)
            if shaped["status"] in _CLOSED_STATUSES:
                continue
            name = shaped["patient_name"]
            carrier = str(shaped.get("insurance_carrier") or "—")

            for field, dtype, label_tpl in (
                ("records_due_date", "records", "Records due for {name}"),
                ("hearing_date", "hearing", "Hearing for {name}"),
            ):
                d = _parse_date_only(r.get(field))
                if not d:
                    continue
                if d > horizon and d >= today:
                    continue
                days_until = (d - today).days
                is_overdue = d < today
                deadlines.append(
                    {
                        "date": d.strftime("%b %d").replace(" 0", " "),
                        "label": label_tpl.format(name=name),
                        "subtitle": carrier,
                        "days_until": days_until,
                        "is_overdue": is_overdue,
                        "type": dtype,
                        "sort_date": d,
                    }
                )

        deadlines.sort(key=lambda x: x["sort_date"])
        return [
            {k: v for k, v in d.items() if k != "sort_date"}
            for d in deadlines[:limit]
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pi-cases/top-attorneys")
def get_pi_cases_top_attorneys(
    clinic_id: str = Query(..., min_length=1),
    limit: int = Query(default=5, ge=1, le=20),
):
    cid = clinic_id.strip()
    try:
        rows = _fetch_cases_with_patients(cid)
        by_firm: dict[str, dict[str, Any]] = {}
        for r in rows:
            firm = str(r.get("firm_name") or r.get("attorney_name") or "Unknown").strip()
            if not firm:
                firm = "Unknown"
            est = _safe_float(r.get("estimated_settlement")) or 0.0
            bucket = by_firm.setdefault(
                firm, {"firm_name": firm, "case_count": 0, "total_value": 0.0}
            )
            bucket["case_count"] += 1
            bucket["total_value"] += est
        out = sorted(by_firm.values(), key=lambda x: -x["total_value"])[:limit]
        for item in out:
            item["total_value"] = round(item["total_value"], 2)
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
