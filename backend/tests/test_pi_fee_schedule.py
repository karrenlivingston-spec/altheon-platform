"""Unit tests for PI fee schedule API (no live DB required)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.fee_schedule import ClinicUserContext, get_current_clinic_user, router

CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50"

app = FastAPI()
app.include_router(router, prefix="/api")
app.dependency_overrides[get_current_clinic_user] = lambda: ClinicUserContext(
    user_id="user-1",
    clinic_id=CLINIC_ID,
)
client = TestClient(app)
AUTH_HEADERS = {"Authorization": "Bearer fake-token", "Content-Type": "application/json"}


def test_get_fee_schedule_includes_pi_charge():
    rows = [
        {
            "id": "row-1",
            "cpt_code": "97110",
            "charge": 85.0,
            "pi_charge": None,
            "modifiers": [],
            "is_active": True,
        }
    ]
    cpt_map = {
        "97110": {
            "code": "97110",
            "description": "Therapeutic exercises",
            "category": "Physical Medicine",
        }
    }

    with patch("routers.fee_schedule._supabase_execute") as mock_exec:
        mock_exec.return_value = MagicMock(data=rows)
        with patch("routers.fee_schedule._load_cpt_map", return_value=cpt_map):
            res = client.get(
                f"/api/fee-schedule?clinic_id={CLINIC_ID}",
                headers=AUTH_HEADERS,
            )
    assert res.status_code == 200
    body = res.json()
    assert body[0]["pi_charge"] is None
    assert body[0]["charge"] == 85.0


def test_patch_pi_charge_only():
    existing = {
        "id": "row-1",
        "cpt_code": "97110",
        "charge": 85.0,
        "pi_charge": None,
        "modifiers": [],
        "is_active": True,
    }
    updated = {**existing, "pi_charge": 120.0}

    with patch("routers.fee_schedule._fetch_fee_schedule_by_id", return_value=existing):
        with patch("routers.fee_schedule._fetch_cpt_code_row") as mock_cpt:
            mock_cpt.return_value = {
                "code": "97110",
                "description": "Therapeutic exercises",
                "category": "PM",
            }
            with patch("routers.fee_schedule._supabase_execute") as mock_exec:
                mock_exec.return_value = MagicMock(data=[updated])
                res = client.patch(
                    f"/api/fee-schedule/row-1?clinic_id={CLINIC_ID}",
                    headers=AUTH_HEADERS,
                    json={"pi_charge": 120.0},
                )
    assert res.status_code == 200
    body = res.json()
    assert body["pi_charge"] == 120.0
    assert body["charge"] == 85.0


def test_get_pi_fee_schedule():
    rows = [{"cpt_code": "97110", "pi_charge": 120.0}]

    with patch("routers.fee_schedule._supabase_execute") as mock_exec:
        mock_exec.return_value = MagicMock(data=rows)
        res = client.get(
            f"/api/fee-schedule/pi?clinic_id={CLINIC_ID}",
            headers=AUTH_HEADERS,
        )
    assert res.status_code == 200
    assert res.json() == [{"cpt_code": "97110", "pi_charge": 120.0}]


def test_bulk_without_pi_charge_preserves():
    with patch("routers.fee_schedule._upsert_fee_schedule") as mock_upsert:
        mock_upsert.return_value = {"cpt_code": "97110", "charge": 85.0}
        res = client.post(
            f"/api/fee-schedule/bulk?clinic_id={CLINIC_ID}",
            headers=AUTH_HEADERS,
            json={"items": [{"cpt_code": "97110", "charge": 85.0, "modifiers": []}]},
        )
    assert res.status_code == 200
    mock_upsert.assert_called_once()
    assert mock_upsert.call_args.kwargs["update_pi_charge"] is False


def test_bulk_with_pi_charge():
    with patch("routers.fee_schedule._upsert_fee_schedule") as mock_upsert:
        mock_upsert.return_value = {
            "cpt_code": "97110",
            "charge": 85.0,
            "pi_charge": 120.0,
        }
        res = client.post(
            f"/api/fee-schedule/bulk?clinic_id={CLINIC_ID}",
            headers=AUTH_HEADERS,
            json={
                "items": [
                    {
                        "cpt_code": "97110",
                        "charge": 85.0,
                        "pi_charge": 120.0,
                        "modifiers": [],
                    }
                ]
            },
        )
    assert res.status_code == 200
    kwargs = mock_upsert.call_args.kwargs
    assert kwargs["update_pi_charge"] is True
    assert kwargs["pi_charge"] == 120.0
