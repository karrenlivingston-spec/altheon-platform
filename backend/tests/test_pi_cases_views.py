"""Unit tests for PI cases list/deadlines/activity view extensions."""
from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import pi_cases as pi_cases_router

app = FastAPI()
app.include_router(pi_cases_router.router, prefix="/api")
client = TestClient(app)

CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50"
TODAY = date(2026, 6, 15)


def _case_row(
    *,
    case_id: str = "case-1",
    firm_name: str | None = "Smith Law",
    attorney_name: str | None = None,
    status: str = "treatment",
    records_due: str | None = None,
    hearing: str | None = None,
    est: float = 10000.0,
) -> dict:
    return {
        "id": case_id,
        "clinic_id": CLINIC_ID,
        "patient_id": "patient-1",
        "status": status,
        "firm_name": firm_name,
        "attorney_name": attorney_name,
        "insurance_carrier": "GEICO",
        "estimated_settlement": est,
        "records_due_date": records_due,
        "hearing_date": hearing,
        "updated_at": datetime(2026, 6, 10, tzinfo=timezone.utc).isoformat(),
        "patients": {"first_name": "Jane", "last_name": "Doe"},
    }


def _mock_resp(data: list) -> object:
    class Resp:
        error = None

        def __init__(self, payload: list) -> None:
            self.data = payload

    return Resp(data)


def test_firm_name_filter_case_insensitive():
    rows = [
        _case_row(case_id="a", firm_name="Smith Law"),
        _case_row(case_id="b", firm_name="Other Firm"),
    ]
    with patch.object(pi_cases_router, "supabase_execute") as mock_exec:
        mock_exec.return_value = _mock_resp(rows)
        res = client.get(
            f"/api/pi-cases?clinic_id={CLINIC_ID}&firm_name=smith%20law"
        )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["id"] == "a"


def test_deadlines_default_horizon_30_days():
    today = date(2026, 6, 15)
    rows = [
        _case_row(records_due="2026-07-01"),
        _case_row(case_id="far", records_due="2026-12-01"),
    ]
    horizon = today + timedelta(days=30)
    deadlines = pi_cases_router._build_pi_case_deadlines(rows, today, horizon=horizon)
    assert len(deadlines) == 1
    assert "Jane" in deadlines[0]["label"]


def test_deadlines_view_all_wider_horizon():
    today = date(2026, 6, 15)
    rows = [_case_row(records_due="2026-12-01")]
    horizon = today + timedelta(days=365)
    deadlines = pi_cases_router._build_pi_case_deadlines(rows, today, horizon=horizon)
    assert len(deadlines) == 1


def test_activity_view_all_higher_limit():
    rows = [_case_row(case_id=f"c{i}") for i in range(15)]
    with patch.object(pi_cases_router, "supabase_execute") as mock_exec:
        mock_exec.return_value = _mock_resp(rows)
        res = client.get(
            f"/api/pi-cases/activity?clinic_id={CLINIC_ID}&view_all=true&limit=15"
        )
    assert res.status_code == 200
    assert len(res.json()) == 15
