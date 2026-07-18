"""Unit tests for claim status reconciliation helpers (no live DB)."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from app.routers.billing import (
    _claim_status_check_eligibility_error,
    _normalize_payment_status_bucket,
    _reconcile_claim_fields_from_status_bucket,
)


def test_reconcile_payment_outcomes_go_to_claim_status_only():
    assert _reconcile_claim_fields_from_status_bucket("paid") == {
        "claim_status": "paid",
    }
    assert _reconcile_claim_fields_from_status_bucket("denied") == {
        "claim_status": "denied",
    }
    assert _reconcile_claim_fields_from_status_bucket("partial") == {
        "claim_status": "partially_paid",
    }


def test_reconcile_workflow_states_go_to_status_only():
    assert _reconcile_claim_fields_from_status_bucket("pending") == {
        "status": "pending",
    }
    assert _reconcile_claim_fields_from_status_bucket("submitted") == {
        "status": "submitted",
    }
    assert _reconcile_claim_fields_from_status_bucket("resubmitted") == {
        "status": "resubmitted",
    }


def test_normalize_partial_from_category_text():
    bucket = _normalize_payment_status_bucket("submitted", "Partial payment processed")
    assert bucket == "partial"


def test_eligibility_allows_missing_reference_number():
    claim = {
        "status": "submitted",
        "payer_id": "STEDITEST",
        "member_id": "MEM123",
        "first_treatment_date": "2026-05-20",
        "reference_number": None,
    }
    assert _claim_status_check_eligibility_error(claim) is None


def test_eligibility_blocks_draft():
    claim = {
        "status": "draft",
        "payer_id": "X",
        "member_id": "Y",
        "first_treatment_date": "2026-05-20",
    }
    assert _claim_status_check_eligibility_error(claim) == "Claim is still in draft"
