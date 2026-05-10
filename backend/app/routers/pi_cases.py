"""PI case tracking and referral milestones (API routes under /api)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.db import supabase

router = APIRouter()


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
    date_of_accident: Optional[str] = None
    claim_number: Optional[str] = None
    attorney_name: Optional[str] = None
    attorney_email: Optional[str] = None
    attorney_phone: Optional[str] = None
    insurance_carrier: Optional[str] = None
    notes: Optional[str] = None


class PatchPiCaseBody(BaseModel):
    date_of_accident: Optional[str] = None
    claim_number: Optional[str] = None
    attorney_name: Optional[str] = None
    attorney_email: Optional[str] = None
    attorney_phone: Optional[str] = None
    insurance_carrier: Optional[str] = None
    status: Optional[str] = None
    attorney_request_pending: Optional[bool] = None
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
    if not patient_id or not clinic_id:
        raise HTTPException(status_code=400, detail="patient_id and clinic_id are required")

    try:
        dup = (
            supabase.table("pi_cases")
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
        "status": "open",
    }
    optional = (
        "date_of_accident",
        "claim_number",
        "attorney_name",
        "attorney_email",
        "attorney_phone",
        "insurance_carrier",
        "notes",
    )
    for key in optional:
        val = getattr(body, key)
        if val is not None and str(val).strip() != "":
            row[key] = val

    try:
        ins = supabase.table("pi_cases").insert(row).execute()
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
        resp = (
            supabase.table("pi_cases")
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
        rresp = (
            supabase.table("pi_referrals")
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
        "insurance_carrier",
        "status",
        "attorney_request_pending",
        "notes",
    }
    data = {k: v for k, v in payload.items() if k in allowed}
    if not data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    data["updated_at"] = _now_iso()

    try:
        upd = supabase.table("pi_cases").update(data).eq("id", case_id).execute()
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
        cresp = (
            supabase.table("pi_cases")
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
        ins = supabase.table("pi_referrals").insert(row).execute()
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
        upd = (
            supabase.table("pi_referrals")
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
        dele = (
            supabase.table("pi_referrals")
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
        cases_resp = (
            supabase.table("pi_cases")
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
            rresp = (
                supabase.table("pi_referrals")
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
            presp = (
                supabase.table("patients")
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
