"""ERA (835) remittance ingestion — parse, claim matching, and persistence."""

from __future__ import annotations

import json
import os
import traceback
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

import httpx

from app.db import supabase
from app.retry_utils import supabase_execute

STEDI_835_REPORT_URL = (
    "https://healthcare.us.stedi.com/2024-04-01"
    "/change/medicalnetwork/reports/v2/{transaction_id}/835"
)
STEDI_POLLING_URL = (
    "https://core.us.stedi.com/2023-08-01/polling/transactions"
)

_DENIAL_REASON_CODES = frozenset(
    {
        "4",
        "5",
        "27",
        "29",
        "31",
        "32",
        "33",
        "34",
        "35",
        "96",
        "97",
        "109",
        "110",
        "204",
        "252",
        "253",
        "254",
        "256",
        "257",
    }
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _stedi_api_key() -> str:
    return os.getenv("STEDI_API_KEY", "").strip()


def _stedi_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": api_key,
        "Content-Type": "application/json",
    }


def _default_clinic_id() -> str:
    return (
        os.getenv("ERA_DEFAULT_CLINIC_ID")
        or os.getenv("DEFAULT_CLINIC_ID")
        or ""
    ).strip()


def _amount_to_cents(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return max(0, value)
    raw = str(value).strip()
    if not raw:
        return 0
    try:
        dec = Decimal(raw.replace(",", ""))
        cents = (dec * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return max(0, int(cents))
    except (InvalidOperation, ValueError, TypeError):
        try:
            return max(0, int(float(raw) * 100))
        except (TypeError, ValueError):
            return 0


def _service_date_to_iso(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    if len(raw) >= 10 and raw[4:5] == "-":
        return raw[:10]
    return None


def extract_transaction_id(payload: dict[str, Any]) -> str:
    return _extract_transaction_id(payload)


def extract_clinic_id(payload: dict[str, Any]) -> str:
    return _extract_clinic_id(payload)


def _extract_transaction_id(payload: dict[str, Any]) -> str:
    for key in ("transactionId", "transaction_id", "id"):
        val = str(payload.get(key) or "").strip()
        if val:
            return val
    nested = _as_dict(payload.get("payload"))
    for key in ("transactionId", "transaction_id", "id"):
        val = str(nested.get(key) or "").strip()
        if val:
            return val
    data = _as_dict(payload.get("data"))
    for key in ("transactionId", "transaction_id", "id"):
        val = str(data.get(key) or "").strip()
        if val:
            return val
    return ""


def _extract_clinic_id(payload: dict[str, Any]) -> str:
    for key in ("clinic_id", "clinicId"):
        val = str(payload.get(key) or "").strip()
        if val:
            return val
    nested = _as_dict(payload.get("payload"))
    for key in ("clinic_id", "clinicId"):
        val = str(nested.get(key) or "").strip()
        if val:
            return val
    return _default_clinic_id()


def _parse_adjustments(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(raw):
        if not isinstance(item, dict):
            continue
        group_code = str(
            item.get("adjustmentGroupCode")
            or item.get("groupCode")
            or item.get("group_code")
            or ""
        ).strip()
        reason_code = str(
            item.get("adjustmentReasonCode")
            or item.get("reasonCode")
            or item.get("reason_code")
            or ""
        ).strip()
        amount_cents = _amount_to_cents(
            item.get("adjustmentAmount")
            or item.get("amount")
            or item.get("amount_cents")
        )
        if not group_code and not reason_code and amount_cents == 0:
            continue
        out.append(
            {
                "group_code": group_code,
                "reason_code": reason_code,
                "amount_cents": amount_cents,
            }
        )
    return out


def _payment_info_dos(payment_info: dict[str, Any]) -> Optional[str]:
    for line in _as_list(payment_info.get("serviceLines")):
        if not isinstance(line, dict):
            continue
        dos = _service_date_to_iso(
            line.get("serviceDate")
            or line.get("serviceDateBegin")
            or line.get("service_date")
        )
        if dos:
            return dos
    claim_payment = _as_dict(payment_info.get("claimPaymentInfo"))
    return _service_date_to_iso(
        claim_payment.get("serviceDate")
        or claim_payment.get("statementFromDate")
    )


def _has_denial_adjustments(adjustments: list[dict[str, Any]]) -> bool:
    for adj in adjustments:
        reason = str(adj.get("reason_code") or "").strip()
        if reason in _DENIAL_REASON_CODES:
            return True
    return False


def derive_claim_status(
    billed_cents: int,
    paid_cents: int,
    adjustments: list[dict[str, Any]],
) -> str:
    if _has_denial_adjustments(adjustments):
        return "denied"
    if billed_cents > 0 and paid_cents >= billed_cents:
        return "paid"
    if paid_cents > 0:
        return "partially_paid"
    if billed_cents > 0 and paid_cents == 0:
        return "denied"
    return "partially_paid"


def parse_835_report(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse Stedi 835 JSON into era_claim_lines row payloads (without ids)."""
    lines: list[dict[str, Any]] = []
    transactions = _as_list(report.get("transactions"))
    if not transactions and report.get("detailInfo"):
        transactions = [report]

    for txn in transactions:
        if not isinstance(txn, dict):
            continue
        payer = _as_dict(txn.get("payer"))
        payer_name = str(
            payer.get("name")
            or payer.get("organizationName")
            or txn.get("payerName")
            or ""
        ).strip()

        detail_blocks = _as_list(txn.get("detailInfo"))
        if not detail_blocks:
            payment_infos = _as_list(txn.get("paymentInfo"))
            if payment_infos:
                detail_blocks = [{"paymentInfo": payment_infos}]

        for detail in detail_blocks:
            if not isinstance(detail, dict):
                continue
            for payment_info in _as_list(detail.get("paymentInfo")):
                if not isinstance(payment_info, dict):
                    continue
                claim_payment = _as_dict(payment_info.get("claimPaymentInfo"))
                pcn = str(
                    claim_payment.get("patientControlNumber")
                    or claim_payment.get("patient_control_number")
                    or ""
                ).strip()
                billed_cents = _amount_to_cents(
                    claim_payment.get("totalClaimChargeAmount")
                    or claim_payment.get("total_claim_charge_amount")
                )
                paid_cents = _amount_to_cents(
                    claim_payment.get("claimPaymentAmount")
                    or claim_payment.get("claim_payment_amount")
                )
                adjustments = _parse_adjustments(payment_info.get("claimAdjustments"))
                subscriber = _as_dict(payment_info.get("subscriber"))
                member_id = str(
                    subscriber.get("memberId")
                    or subscriber.get("member_id")
                    or ""
                ).strip()
                dos = _payment_info_dos(payment_info)
                line_payer = payer_name
                if not line_payer:
                    line_payer = str(
                        _as_dict(payment_info.get("payer")).get("name") or ""
                    ).strip()

                lines.append(
                    {
                        "patient_control_number": pcn or None,
                        "payer_name": line_payer or None,
                        "member_id": member_id or None,
                        "date_of_service": dos,
                        "billed_amount_cents": billed_cents,
                        "amount_paid_cents": paid_cents,
                        "adjustment_codes": adjustments,
                    }
                )
    return lines


def _find_existing_era_file(stedi_file_id: str) -> Optional[dict[str, Any]]:
    if not stedi_file_id:
        return None
    try:
        resp = supabase_execute(
            lambda: supabase.table("era_files")
            .select("id, clinic_id, status, stedi_file_id")
            .eq("stedi_file_id", stedi_file_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        traceback.print_exc()
        return None


def _insert_era_file(
    *,
    clinic_id: str,
    stedi_file_id: str,
    source: str,
    raw_payload: dict[str, Any],
) -> Optional[dict[str, Any]]:
    row = {
        "clinic_id": clinic_id,
        "source": source,
        "stedi_file_id": stedi_file_id,
        "status": "received",
        "raw_payload": raw_payload,
        "received_at": _now_iso(),
    }
    try:
        resp = supabase_execute(
            lambda: supabase.table("era_files").insert(row).execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        traceback.print_exc()
        return None


def _update_era_file(
    era_file_id: str,
    *,
    status: str,
    error_detail: Optional[str] = None,
    raw_payload: Optional[dict[str, Any]] = None,
) -> None:
    patch: dict[str, Any] = {"status": status}
    if error_detail is not None:
        patch["error_detail"] = error_detail[:4000]
    if raw_payload is not None:
        patch["raw_payload"] = raw_payload
    if status in ("processed", "failed"):
        patch["processed_at"] = _now_iso()
    try:
        supabase_execute(
            lambda: supabase.table("era_files")
            .update(patch)
            .eq("id", era_file_id)
            .execute()
        )
    except Exception:
        traceback.print_exc()


def fetch_stedi_835_report(transaction_id: str) -> dict[str, Any]:
    api_key = _stedi_api_key()
    if not api_key:
        raise RuntimeError("STEDI_API_KEY is not configured")
    url = STEDI_835_REPORT_URL.format(transaction_id=transaction_id)
    with httpx.Client(timeout=60.0) as client:
        response = client.get(url, headers=_stedi_headers(api_key))
    if response.status_code >= 400:
        detail = (response.text or "")[:2000]
        raise RuntimeError(
            f"Stedi 835 fetch failed ({response.status_code}): {detail}"
        )
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Stedi 835 response was not a JSON object")
    return data


def poll_stedi_transactions() -> list[dict[str, Any]]:
    api_key = _stedi_api_key()
    if not api_key:
        return []
    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.get(
                STEDI_POLLING_URL,
                headers=_stedi_headers(api_key),
            )
        if response.status_code >= 400:
            print(
                f"[era] Stedi polling failed ({response.status_code}): "
                f"{(response.text or '')[:500]}"
            )
            return []
        data = response.json()
    except Exception as exc:
        print(f"[era] Stedi polling error: {exc}")
        traceback.print_exc()
        return []

    items: list[dict[str, Any]] = []
    if isinstance(data, list):
        items = [x for x in data if isinstance(x, dict)]
    elif isinstance(data, dict):
        for key in ("items", "transactions", "data", "results"):
            block = data.get(key)
            if isinstance(block, list):
                items = [x for x in block if isinstance(x, dict)]
                break
    return items


def _is_835_transaction(item: dict[str, Any]) -> bool:
    txn_type = str(
        item.get("transactionType")
        or item.get("type")
        or item.get("documentType")
        or item.get("x12TransactionType")
        or ""
    ).upper()
    if "835" in txn_type:
        return True
    direction = str(item.get("direction") or "").lower()
    if direction and "835" in direction:
        return True
    return False


def _transaction_id_from_poll_item(item: dict[str, Any]) -> str:
    for key in ("transactionId", "transaction_id", "id"):
        val = str(item.get(key) or "").strip()
        if val:
            return val
    return ""


def _match_claim_by_pcn(
    clinic_id: str,
    patient_control_number: str,
) -> Optional[dict[str, Any]]:
    pcn = str(patient_control_number or "").strip()
    if not pcn:
        return None
    try:
        resp = supabase_execute(
            lambda: supabase.table("insurance_claims")
            .select(
                "id, clinic_id, payer_name, member_id, first_treatment_date, "
                "total_amount, amount_paid_cents, claim_status, status"
            )
            .eq("clinic_id", clinic_id)
            .execute()
        )
    except Exception:
        traceback.print_exc()
        return None

    matches: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        claim_id = str(row.get("id") or "")
        if not claim_id:
            continue
        if claim_id[:20] == pcn or claim_id == pcn:
            matches.append(row)
    if len(matches) == 1:
        return matches[0]
    return None


def _normalize_payer(value: Any) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _match_claim_fallback(
    clinic_id: str,
    *,
    payer_name: Optional[str],
    member_id: Optional[str],
    date_of_service: Optional[str],
    billed_amount_cents: int,
) -> Optional[dict[str, Any]]:
    member = str(member_id or "").strip()
    dos = str(date_of_service or "")[:10]
    payer_norm = _normalize_payer(payer_name)
    if not member or not dos or billed_amount_cents <= 0:
        return None
    try:
        resp = supabase_execute(
            lambda: supabase.table("insurance_claims")
            .select(
                "id, clinic_id, payer_name, member_id, first_treatment_date, "
                "total_amount, amount_paid_cents, claim_status, status"
            )
            .eq("clinic_id", clinic_id)
            .eq("member_id", member)
            .eq("first_treatment_date", dos)
            .execute()
        )
    except Exception:
        traceback.print_exc()
        return None

    matches: list[dict[str, Any]] = []
    for row in resp.data or []:
        if not isinstance(row, dict):
            continue
        row_payer = _normalize_payer(row.get("payer_name"))
        if payer_norm and row_payer and payer_norm not in row_payer and row_payer not in payer_norm:
            continue
        total_cents = _amount_to_cents(row.get("total_amount"))
        if abs(total_cents - billed_amount_cents) > 1:
            continue
        matches.append(row)
    if len(matches) == 1:
        return matches[0]
    return None


def match_era_line_to_claim(
    clinic_id: str,
    line: dict[str, Any],
) -> tuple[Optional[str], str]:
    pcn = str(line.get("patient_control_number") or "").strip()
    claim = _match_claim_by_pcn(clinic_id, pcn)
    if claim:
        return str(claim.get("id") or ""), "matched"

    claim = _match_claim_fallback(
        clinic_id,
        payer_name=line.get("payer_name"),
        member_id=line.get("member_id"),
        date_of_service=line.get("date_of_service"),
        billed_amount_cents=int(line.get("billed_amount_cents") or 0),
    )
    if claim:
        return str(claim.get("id") or ""), "matched"
    return None, "needs_review"


def _update_matched_claim(
    claim_id: str,
    *,
    amount_paid_cents: int,
    claim_status: str,
) -> None:
    patch = {
        "amount_paid_cents": max(0, int(amount_paid_cents or 0)),
        "claim_status": claim_status,
    }
    try:
        supabase_execute(
            lambda: supabase.table("insurance_claims")
            .update(patch)
            .eq("id", claim_id)
            .execute()
        )
    except Exception:
        traceback.print_exc()


def process_era_file(
    era_file_id: str,
    clinic_id: str,
    report835: dict[str, Any],
) -> dict[str, Any]:
    """Parse 835, insert era_claim_lines, match claims, update era_files status."""
    result = {
        "era_file_id": era_file_id,
        "lines_total": 0,
        "matched": 0,
        "needs_review": 0,
        "status": "failed",
        "error": None,
    }
    _update_era_file(era_file_id, status="processing")
    try:
        parsed_lines = parse_835_report(report835)
        if not parsed_lines:
            raise RuntimeError("835 report contained no claim payment lines")

        result["lines_total"] = len(parsed_lines)
        for line in parsed_lines:
            claim_id, match_status = match_era_line_to_claim(clinic_id, line)
            row = {
                "era_file_id": era_file_id,
                "clinic_id": clinic_id,
                "insurance_claim_id": claim_id,
                "patient_control_number": line.get("patient_control_number"),
                "payer_name": line.get("payer_name"),
                "member_id": line.get("member_id"),
                "date_of_service": line.get("date_of_service"),
                "billed_amount_cents": line.get("billed_amount_cents"),
                "amount_paid_cents": line.get("amount_paid_cents"),
                "adjustment_codes": line.get("adjustment_codes") or [],
                "match_status": match_status,
            }
            ins = supabase_execute(
                lambda r=row: supabase.table("era_claim_lines").insert(r).execute()
            )
            if not (ins.data or []):
                raise RuntimeError("Failed to insert era_claim_lines row")

            if match_status == "matched" and claim_id:
                result["matched"] += 1
                status = derive_claim_status(
                    int(line.get("billed_amount_cents") or 0),
                    int(line.get("amount_paid_cents") or 0),
                    line.get("adjustment_codes") or [],
                )
                _update_matched_claim(
                    claim_id,
                    amount_paid_cents=int(line.get("amount_paid_cents") or 0),
                    claim_status=status,
                )
            else:
                result["needs_review"] += 1

        _update_era_file(
            era_file_id,
            status="processed",
            error_detail=None,
            raw_payload=report835,
        )
        result["status"] = "processed"
        return result
    except Exception as exc:
        err = str(exc)[:4000]
        traceback.print_exc()
        _update_era_file(era_file_id, status="failed", error_detail=err)
        result["error"] = err
        return result


def ingest_era_transaction(
    *,
    stedi_file_id: str,
    clinic_id: str,
    source: str,
    webhook_payload: dict[str, Any],
    report835: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Idempotent ERA ingest: era_files row + parse + match."""
    empty = {
        "era_file_id": None,
        "stedi_file_id": stedi_file_id,
        "status": "failed",
        "skipped": False,
        "matched": 0,
        "needs_review": 0,
        "lines_total": 0,
        "error": "unknown",
    }
    if not stedi_file_id:
        empty["error"] = "transactionId is required"
        return empty
    if not clinic_id:
        empty["error"] = "clinic_id is required (body or ERA_DEFAULT_CLINIC_ID)"
        return empty

    existing = _find_existing_era_file(stedi_file_id)
    if existing:
        return {
            "era_file_id": existing.get("id"),
            "stedi_file_id": stedi_file_id,
            "status": existing.get("status") or "received",
            "skipped": True,
            "matched": 0,
            "needs_review": 0,
            "lines_total": 0,
            "error": None,
        }

    era_row = _insert_era_file(
        clinic_id=clinic_id,
        stedi_file_id=stedi_file_id,
        source=source,
        raw_payload=webhook_payload,
    )
    if not era_row or not era_row.get("id"):
        empty["error"] = "Failed to create era_files row"
        return empty

    era_file_id = str(era_row["id"])
    try:
        report = report835 if isinstance(report835, dict) else None
        if report is None:
            report = fetch_stedi_835_report(stedi_file_id)
    except Exception as exc:
        err = str(exc)[:4000]
        _update_era_file(era_file_id, status="failed", error_detail=err)
        empty["era_file_id"] = era_file_id
        empty["error"] = err
        return empty

    processed = process_era_file(era_file_id, clinic_id, report)
    return {
        "era_file_id": era_file_id,
        "stedi_file_id": stedi_file_id,
        "status": processed.get("status") or "failed",
        "skipped": False,
        "matched": processed.get("matched") or 0,
        "needs_review": processed.get("needs_review") or 0,
        "lines_total": processed.get("lines_total") or 0,
        "error": processed.get("error"),
    }


def poll_and_ingest_eras(clinic_id: Optional[str] = None) -> dict[str, Any]:
    """Polling fallback — ingest unin ingested Stedi 835 transactions."""
    cid = (clinic_id or _default_clinic_id()).strip()
    summary = {
        "clinic_id": cid or None,
        "polled": 0,
        "ingested": 0,
        "skipped": 0,
        "failed": 0,
        "results": [],
    }
    if not cid:
        summary["error"] = "clinic_id is required (query or ERA_DEFAULT_CLINIC_ID)"
        return summary

    items = poll_stedi_transactions()
    summary["polled"] = len(items)
    for item in items:
        if not _is_835_transaction(item):
            continue
        txn_id = _transaction_id_from_poll_item(item)
        if not txn_id:
            continue
        result = ingest_era_transaction(
            stedi_file_id=txn_id,
            clinic_id=cid,
            source="poll",
            webhook_payload={"poll_item": item},
        )
        summary["results"].append(result)
        if result.get("skipped"):
            summary["skipped"] += 1
        elif result.get("status") == "processed":
            summary["ingested"] += 1
        else:
            summary["failed"] += 1
    return summary


def list_era_claim_lines(
    clinic_id: str,
    *,
    match_status: Optional[str] = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    try:
        q = (
            supabase.table("era_claim_lines")
            .select(
                "id, era_file_id, clinic_id, insurance_claim_id, "
                "patient_control_number, payer_name, member_id, date_of_service, "
                "billed_amount_cents, amount_paid_cents, adjustment_codes, "
                "match_status, created_at"
            )
            .eq("clinic_id", clinic_id)
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 500)))
        )
        if match_status:
            q = q.eq("match_status", match_status.strip())
        resp = supabase_execute(lambda: q.execute())
        return [r for r in (resp.data or []) if isinstance(r, dict)]
    except Exception:
        traceback.print_exc()
        return []
