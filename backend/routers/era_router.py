"""ERA (835) remittance ingestion endpoints."""

from __future__ import annotations

import os
import secrets
import traceback
from typing import Any, Optional

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse

from app.services.era_ingestion import (
    extract_clinic_id,
    extract_transaction_id,
    ingest_era_transaction,
    list_era_claim_lines,
    poll_and_ingest_eras,
)
from routers.fee_schedule import ClinicUserDep

router = APIRouter(prefix="/era", tags=["ERA"])


def _require_era_cron_secret(
    x_intake_secret: Optional[str],
) -> Optional[JSONResponse]:
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    incoming = (x_intake_secret or "").strip()
    if not expected or not incoming or not secrets.compare_digest(incoming, expected):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return None


def _require_webhook_secret(
    x_era_webhook_secret: Optional[str],
) -> Optional[JSONResponse]:
    expected = (os.environ.get("STEDI_ERA_WEBHOOK_SECRET") or "").strip()
    if not expected:
        return None
    incoming = (x_era_webhook_secret or "").strip()
    if not incoming or not secrets.compare_digest(incoming, expected):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return None


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


@router.post("/webhook")
async def era_webhook(
    request: Request,
    x_era_webhook_secret: Optional[str] = Header(
        default=None, alias="X-Era-Webhook-Secret"
    ),
):
    """Receive Stedi ERA notification; persist era_files row and parse 835."""
    unauthorized = _require_webhook_secret(x_era_webhook_secret)
    if unauthorized is not None:
        return unauthorized

    try:
        body = await request.json()
    except Exception:
        body = {}

    payload = _as_dict(body)
    transaction_id = extract_transaction_id(payload)
    clinic_id = extract_clinic_id(payload)
    report835 = payload.get("report835") or payload.get("report_835")
    if not isinstance(report835, dict):
        nested = _as_dict(payload.get("payload"))
        report835 = nested.get("report835") or nested.get("report_835")
    if not isinstance(report835, dict):
        report835 = None

    try:
        result = ingest_era_transaction(
            stedi_file_id=transaction_id,
            clinic_id=clinic_id,
            source="webhook",
            webhook_payload=payload,
            report835=report835,
        )
        status_code = 200
        if result.get("error") and not result.get("skipped"):
            status_code = 200
        return JSONResponse(status_code=status_code, content=result)
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(
            status_code=200,
            content={
                "era_file_id": None,
                "stedi_file_id": transaction_id,
                "status": "failed",
                "skipped": False,
                "matched": 0,
                "needs_review": 0,
                "lines_total": 0,
                "error": str(exc)[:4000],
            },
        )


@router.post("/poll")
def era_poll(
    clinic_id: Optional[str] = Query(None),
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    """Cron fallback — poll Stedi for unin ingested 835 transactions."""
    unauthorized = _require_era_cron_secret(x_intake_secret)
    if unauthorized is not None:
        return unauthorized

    try:
        summary = poll_and_ingest_eras(clinic_id=clinic_id)
        return summary
    except Exception as exc:
        traceback.print_exc()
        return {
            "clinic_id": clinic_id,
            "polled": 0,
            "ingested": 0,
            "skipped": 0,
            "failed": 0,
            "results": [],
            "error": str(exc)[:4000],
        }


@router.get("/claim-lines")
def era_claim_lines_review_queue(
    clinic: ClinicUserDep,
    match_status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Review queue for unmatched ERA claim lines (future frontend)."""
    try:
        rows = list_era_claim_lines(
            clinic.clinic_id,
            match_status=match_status,
            limit=limit,
        )
        return {
            "items": rows,
            "count": len(rows),
            "match_status": match_status,
        }
    except Exception as exc:
        traceback.print_exc()
        return {
            "items": [],
            "count": 0,
            "match_status": match_status,
            "error": str(exc)[:4000],
        }
