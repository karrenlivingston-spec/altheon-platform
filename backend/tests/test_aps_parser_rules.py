"""Unit tests for APS Kinvent parser and confidence-tier rules."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.aps_parser import flatten_findings, parse_kinvent_text
from app.services.aps_rules import apply_aps_rules
from tests.fixtures.aps_sharpe_sample import SHARPE_KINVENT_TEXT
from tests.fixtures.aps_west_sample import WEST_KINVENT_TEXT


class TestApsParserSharpe(unittest.TestCase):
    def test_sharpe_extracts_cmj_metrics(self):
        parsed = parse_kinvent_text(SHARPE_KINVENT_TEXT)
        self.assertEqual(parsed["patient_name"], "Sharpe Dr.")
        self.assertEqual(parsed["patient_dob"], "12/28/1988")
        self.assertEqual(parsed["session_date"], "07/03/2026")

        cmj = next(t for t in parsed["tests"] if t["test_type"] == "CMJ")
        by_name = {m["metric_name"]: m for m in cmj["metrics"]}

        self.assertAlmostEqual(by_name["jump_height"]["left_value"], 22.0)
        self.assertAlmostEqual(by_name["jump_height"]["right_value"], 22.5)
        self.assertAlmostEqual(by_name["jump_height"]["asymmetry_pct"], 2.2)

        self.assertAlmostEqual(by_name["peak_force_relative"]["left_value"], 0.897)
        self.assertAlmostEqual(by_name["peak_force_relative"]["right_value"], 0.839)
        self.assertAlmostEqual(by_name["peak_force_relative"]["asymmetry_pct"], 6.5)

        self.assertAlmostEqual(by_name["peak_power_relative"]["left_value"], 45.2)
        self.assertAlmostEqual(by_name["peak_power_relative"]["right_value"], 42.5)
        self.assertAlmostEqual(by_name["peak_power_relative"]["asymmetry_pct"], 6.1)

        self.assertAlmostEqual(by_name["braking_rfd"]["left_value"], 1250.0)
        self.assertAlmostEqual(by_name["braking_rfd"]["right_value"], 680.0)
        self.assertAlmostEqual(by_name["braking_rfd"]["asymmetry_pct"], 82.4)

        self.assertAlmostEqual(by_name["propulsive_rfd"]["left_value"], 890.0)
        self.assertAlmostEqual(by_name["propulsive_rfd"]["right_value"], 850.0)
        self.assertAlmostEqual(by_name["propulsive_rfd"]["asymmetry_pct"], 4.5)

        self.assertAlmostEqual(by_name["rsi"]["left_value"], 1.85)
        self.assertAlmostEqual(by_name["rsi"]["right_value"], 1.8)
        self.assertAlmostEqual(by_name["rsi"]["asymmetry_pct"], 2.7)

        self.assertAlmostEqual(by_name["peak_rfd"]["left_value"], 4200.0)
        self.assertAlmostEqual(by_name["peak_rfd"]["right_value"], 4100.0)
        self.assertAlmostEqual(by_name["peak_rfd"]["asymmetry_pct"], 2.4)


class TestApsRulesSharpe(unittest.TestCase):
    def test_sharpe_braking_rfd_is_moderate_not_high(self):
        parsed = parse_kinvent_text(SHARPE_KINVENT_TEXT)
        findings = apply_aps_rules(flatten_findings(parsed))
        braking = next(f for f in findings if f["metric_name"] == "braking_rfd")
        self.assertTrue(braking["is_notable"])
        self.assertEqual(braking["confidence_tier"], "moderate")
        self.assertNotEqual(braking["confidence_tier"], "high")

        peak_force = next(f for f in findings if f["metric_name"] == "peak_force_relative")
        self.assertFalse(peak_force["is_notable"])
        self.assertIsNone(peak_force["confidence_tier"])


class TestApsParserWest(unittest.TestCase):
    def test_west_parses_sldj_and_dj(self):
        parsed = parse_kinvent_text(WEST_KINVENT_TEXT)
        types = {t["test_type"] for t in parsed["tests"]}
        self.assertIn("CMJ", types)
        self.assertIn("SLDJ", types)
        self.assertIn("DJ", types)

        sldj = next(t for t in parsed["tests"] if t["test_type"] == "SLDJ")
        braking = next(m for m in sldj["metrics"] if m["metric_name"] == "braking_rfd")
        self.assertGreater(braking["asymmetry_pct"], 40)


class TestApsRulesWest(unittest.TestCase):
    def test_west_notable_same_side_is_high(self):
        parsed = parse_kinvent_text(WEST_KINVENT_TEXT)
        findings = apply_aps_rules(flatten_findings(parsed))
        notable = [f for f in findings if f["is_notable"]]
        self.assertGreaterEqual(len(notable), 2)
        self.assertTrue(all(f["confidence_tier"] == "high" for f in notable))
        sides = {
            "left" if f["left_value"] < f["right_value"] else "right"
            for f in notable
            if f["left_value"] is not None and f["right_value"] is not None
        }
        self.assertEqual(len(sides), 1)


if __name__ == "__main__":
    unittest.main()
