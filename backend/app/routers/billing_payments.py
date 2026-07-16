"""Billing record payment endpoints (partial payments)."""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from app.db import supabase
from app.retry_utils import supabase_execute

router = APIRouter()


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


def recalculate_amount_paid_and_status(record_id: str) -> dict[str, Any]:
    """Sum billing_payments, set amount_paid_cents and status (paid/partial). Returns updated row."""
    pay_resp = _sb_execute(
        lambda: supabase.table("billing_payments")
        .select("amount_cents")
        .eq("billing_record_id", record_id)
        .execute()
    )
    paid_sum = sum(int(r.get("amount_cents") or 0) for r in (pay_resp.data or []))

    rec_resp = _sb_execute(
        lambda: supabase.table("billing_records")
        .select("id,total_billed_cents,status")
        .eq("id", record_id)
        .limit(1)
        .execute()
    )
    rows = rec_resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Billing record not found")
    rec = dict(rows[0])
    billed = int(rec.get("total_billed_cents") or 0)
    current_status = (str(rec.get("status") or "draft")).lower()

    upd: dict[str, Any] = {
        "amount_paid_cents": paid_sum,
        "updated_at": _now_iso(),
    }
    if current_status != "denied":
        if billed > 0 and paid_sum >= billed:
            upd["status"] = "paid"
        elif paid_sum > 0 and paid_sum < billed:
            upd["status"] = "partial"

    upd_resp = _sb_execute(
        lambda: supabase.table("billing_records")
        .update(upd)
        .eq("id", record_id)
        .execute()
    )
    out_rows = upd_resp.data or []
    if not out_rows:
        raise HTTPException(status_code=500, detail="Failed to update billing record")
    return dict(out_rows[0])


def _assert_record_in_clinic(record_id: str, clinic_id: str) -> None:
    chk = _sb_execute(
        lambda: supabase.table("billing_records")
        .select("id")
        .eq("id", record_id)
        .eq("clinic_id", clinic_id)
        .limit(1)
        .execute()
    )
    if not chk.data:
        raise HTTPException(status_code=404, detail="Billing record not found")


@router.post("/{record_id}/payments")
def create_billing_payment(
    record_id: str,
    clinic_id: str = Query(...),
    body: dict = Body(...),
):
    _assert_record_in_clinic(record_id, clinic_id)
    amount_cents = body.get("amount_cents")
    if amount_cents is None:
        raise HTTPException(status_code=400, detail="amount_cents is required")
    try:
        amount_int = int(amount_cents)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="amount_cents must be an integer")
    if amount_int <= 0:
        raise HTTPException(status_code=400, detail="amount_cents must be positive")

    payment_date = body.get("payment_date")
    if not payment_date:
        raise HTTPException(status_code=400, detail="payment_date is required")
    payment_date_s = str(payment_date).strip()[:10]

    row: dict[str, Any] = {
        "billing_record_id": record_id,
        "amount_cents": amount_int,
        "payment_date": payment_date_s,
        "payment_method": body.get("payment_method"),
        "note": body.get("note"),
    }
    try:
        ins = _sb_execute(lambda: supabase.table("billing_payments").insert(row).execute())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to insert payment")

    recalculate_amount_paid_and_status(record_id)
    full = _sb_execute(
        lambda: supabase.table("billing_records")
        .select("*")
        .eq("id", record_id)
        .limit(1)
        .execute()
    )
    fr = full.data or []
    if not fr:
        raise HTTPException(status_code=500, detail="Billing record not found after payment")
    return dict(fr[0])


@router.get("/{record_id}/payments")
def list_billing_payments(
    record_id: str,
    clinic_id: str = Query(...),
):
    _assert_record_in_clinic(record_id, clinic_id)
    try:
        resp = _sb_execute(
            lambda: supabase.table("billing_payments")
            .select("*")
            .eq("billing_record_id", record_id)
            .order("payment_date", desc=True)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return resp.data or []
