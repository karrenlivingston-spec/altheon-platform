"""Unit tests for ERA 835 parsing and claim status derivation."""

from __future__ import annotations

import json
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.services.era_ingestion import (
    derive_claim_status,
    parse_835_report,
)

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_835.json"


def test_parse_sample_835_fixture():
    report = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    lines = parse_835_report(report)
    assert len(lines) == 2
    matched_line = next(
        l for l in lines if l.get("patient_control_number") == "MATCH-PCN-001"
    )
    assert matched_line["billed_amount_cents"] == 15000
    assert matched_line["amount_paid_cents"] == 12000
    assert matched_line["member_id"] == "MEMBER12345"
    assert matched_line["date_of_service"] == "2026-05-20"
    assert len(matched_line["adjustment_codes"]) == 1
    assert matched_line["adjustment_codes"][0]["group_code"] == "CO"


def test_derive_claim_status_partial():
    status = derive_claim_status(
        15000,
        12000,
        [{"group_code": "CO", "reason_code": "45", "amount_cents": 3000}],
    )
    assert status == "partially_paid"


def test_derive_claim_status_paid():
    status = derive_claim_status(10000, 10000, [])
    assert status == "paid"


def test_derive_claim_status_denied():
    status = derive_claim_status(
        10000,
        0,
        [{"group_code": "PR", "reason_code": "96", "amount_cents": 10000}],
    )
    assert status == "denied"
