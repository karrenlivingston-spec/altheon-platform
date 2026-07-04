"""Unit and optional integration tests for APS parser (vision) and rules engine."""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.aps_parser import (
    ApsParseError,
    flatten_findings,
    normalize_kinvent_payload,
    parse_kinvent_pdf,
)
from app.services.aps_rules import (
    apply_aps_rules,
    build_session_summary_from_findings,
    deficient_side,
)
from tests.fixtures.aps_sharpe_structured import (
    ISOLATED_SINGLE_NOTABLE,
    SHARPE_STRUCTURED,
)
from tests.fixtures.aps_west_structured import WEST_STRUCTURED


class TestApsRulesSharpe(unittest.TestCase):
    def test_sharpe_full_report_disagreeing_findings_tier_low(self):
        """Full Sharpe PDF: CMJ braking_rfd (left weaker) + SJ propulsive_rfd (right weaker) -> LOW."""
        parsed = normalize_kinvent_payload(SHARPE_STRUCTURED)
        result = apply_aps_rules(flatten_findings(parsed))
        findings = result["findings"]
        summary = result["session_summary"]
        notable = [f for f in findings if f["is_notable"]]
        self.assertEqual(len(notable), 2)

        braking = next(
            f for f in notable if f["test_type"] == "CMJ" and f["metric_name"] == "braking_rfd"
        )
        propulsive = next(
            f for f in notable if f["test_type"] == "SJ" and f["metric_name"] == "propulsive_rfd"
        )
        self.assertEqual(deficient_side(braking["left_value"], braking["right_value"]), "left")
        self.assertEqual(deficient_side(propulsive["left_value"], propulsive["right_value"]), "right")
        self.assertAlmostEqual(braking["asymmetry_pct"], 82.4)
        self.assertAlmostEqual(propulsive["asymmetry_pct"], 20.7)

        # Two disagreeing notable findings -> LOW (not MODERATE from the old partial fixture).
        self.assertTrue(all(f["confidence_tier"] == "low" for f in notable))
        self.assertEqual(summary["overall_tier"], "low")
        self.assertEqual(summary["total_notable_findings"], 2)
        self.assertIsNone(summary["dominant_side"])
        self.assertEqual(summary["dominant_cluster_size"], 0)
        self.assertEqual(summary["outlier_count"], 2)
        outlier_keys = {
            (o["test_type"], o["metric_name"]) for o in summary["outlier_findings"]
        }
        self.assertEqual(
            outlier_keys,
            {("CMJ", "braking_rfd"), ("SJ", "propulsive_rfd")},
        )

    def test_isolated_single_notable_finding_produces_moderate(self):
        """One notable finding in an otherwise normal session still tiers as MODERATE."""
        parsed = normalize_kinvent_payload(ISOLATED_SINGLE_NOTABLE)
        result = apply_aps_rules(flatten_findings(parsed))
        findings = result["findings"]
        summary = result["session_summary"]
        notable = [f for f in findings if f["is_notable"]]
        self.assertEqual(len(notable), 1)
        self.assertEqual(notable[0]["confidence_tier"], "moderate")
        self.assertNotEqual(notable[0]["confidence_tier"], "high")
        self.assertNotEqual(notable[0]["confidence_tier"], "low")
        self.assertEqual(summary["overall_tier"], "moderate")
        self.assertEqual(summary["total_notable_findings"], 1)
        self.assertIsNone(summary["dominant_side"])
        self.assertEqual(summary["outlier_count"], 0)


class TestApsRulesWest(unittest.TestCase):
    def test_west_right_side_cluster_is_high_with_outliers_flagged(self):
        parsed = normalize_kinvent_payload(WEST_STRUCTURED)
        result = apply_aps_rules(flatten_findings(parsed))
        findings = result["findings"]
        summary = result["session_summary"]
        notable = [f for f in findings if f["is_notable"]]
        self.assertEqual(len(notable), 8)
        self.assertTrue(all(f["confidence_tier"] == "high" for f in notable))

        right_cluster = [
            f
            for f in notable
            if deficient_side(f["left_value"], f["right_value"]) == "right"
        ]
        left_outliers = [
            f
            for f in notable
            if deficient_side(f["left_value"], f["right_value"]) == "left"
        ]
        self.assertEqual(len(right_cluster), 6)
        self.assertEqual(len(left_outliers), 2)

        for f in right_cluster:
            self.assertIn("6 of 8 tested metrics", f["recommended_next_test"])
            self.assertIn("right-side deficit", f["recommended_next_test"])
            self.assertNotIn("opposite pattern", f["recommended_next_test"])

        for f in left_outliers:
            self.assertIn("opposite pattern", f["recommended_next_test"])

        self.assertEqual(summary["overall_tier"], "high")
        self.assertEqual(summary["total_notable_findings"], 8)
        self.assertEqual(summary["dominant_side"], "right")
        self.assertEqual(summary["dominant_cluster_size"], 6)
        self.assertEqual(summary["outlier_count"], 2)
        outlier_keys = {
            (o["test_type"], o["metric_name"]) for o in summary["outlier_findings"]
        }
        self.assertEqual(
            outlier_keys,
            {("SLCMJ", "braking_rfd"), ("SLDJ", "jump_height")},
        )

    def test_session_summary_from_persisted_findings(self):
        parsed = normalize_kinvent_payload(WEST_STRUCTURED)
        result = apply_aps_rules(flatten_findings(parsed))
        summary = build_session_summary_from_findings(result["findings"])
        self.assertEqual(summary["overall_tier"], "high")
        self.assertEqual(summary["dominant_cluster_size"], 6)


class TestCombinedOnlyMetrics(unittest.TestCase):
    def test_combined_value_preserved_and_not_notable(self):
        payload = {
            "patient_name": "Test",
            "patient_dob": "",
            "session_date": "07/03/2026",
            "tests": [
                {
                    "test_type": "CMJ",
                    "metrics": [
                        {
                            "metric_name": "jump_height",
                            "left_value": None,
                            "right_value": None,
                            "combined_value": 10.4,
                            "unit": "cm",
                            "asymmetry_pct": None,
                        }
                    ],
                }
            ],
            "unparsed_sections": [],
        }
        parsed = normalize_kinvent_payload(payload)
        metric = parsed["tests"][0]["metrics"][0]
        self.assertIsNone(metric["left_value"])
        self.assertIsNone(metric["right_value"])
        self.assertAlmostEqual(metric["combined_value"], 10.4)

        result = apply_aps_rules(flatten_findings(parsed))
        jump = result["findings"][0]
        self.assertFalse(jump["is_notable"])
        self.assertIsNone(jump["confidence_tier"])


class TestApsParserMocked(unittest.TestCase):
    def test_parse_kinvent_pdf_uses_claude_json(self):
        fake_raw = json.dumps(SHARPE_STRUCTURED)

        with patch(
            "app.services.aps_parser._rasterize_pdf_pages",
            return_value=["fakeb64"],
        ), patch(
            "app.services.aps_parser._call_claude_kinvent_extraction",
            return_value=fake_raw,
        ):
            parsed = parse_kinvent_pdf(b"%PDF-1.4 fake")

        self.assertEqual(parsed["patient_name"], "Sharpe Dr.")
        cmj = next(t for t in parsed["tests"] if t["test_type"] == "CMJ")
        braking = next(m for m in cmj["metrics"] if m["metric_name"] == "braking_rfd")
        self.assertAlmostEqual(braking["left_value"], 2.40)
        self.assertAlmostEqual(braking["right_value"], 13.6)
        self.assertAlmostEqual(braking["asymmetry_pct"], 82.4)

    def test_json_parse_failure_raises_aps_parse_error(self):
        with patch(
            "app.services.aps_parser._rasterize_pdf_pages",
            return_value=["fakeb64"],
        ), patch(
            "app.services.aps_parser._call_claude_kinvent_extraction",
            return_value="not valid json at all",
        ):
            with self.assertRaises(ApsParseError) as ctx:
                parse_kinvent_pdf(b"%PDF-1.4 fake")
        self.assertIn("not valid json", ctx.exception.raw_response)


@unittest.skipUnless(
    os.environ.get("APS_RUN_INTEGRATION") == "1",
    "Set APS_RUN_INTEGRATION=1 to run live Kinvent PDF extraction tests",
)
class TestApsIntegrationRealPdfs(unittest.TestCase):
    """Optional live tests against real Kinvent PDFs + Anthropic API."""

    def _load_pdf(self, env_var: str) -> bytes:
        path = (os.environ.get(env_var) or "").strip()
        if not path or not os.path.isfile(path):
            self.skipTest(f"{env_var} not set or file missing")
        with open(path, "rb") as f:
            return f.read()

    def test_sharpe_real_pdf_extraction(self):
        pdf = self._load_pdf("APS_SHARPE_PDF")
        parsed = parse_kinvent_pdf(pdf)
        print("\n--- SHARPE EXTRACTION ---")
        print(json.dumps(parsed, indent=2, default=str))

        self.assertTrue(parsed.get("patient_name"))
        self.assertTrue(parsed.get("tests"))
        cmj = next((t for t in parsed["tests"] if t["test_type"] == "CMJ"), None)
        self.assertIsNotNone(cmj)
        by_name = {m["metric_name"]: m for m in cmj["metrics"]}
        self.assertIn("peak_force_relative", by_name)
        pf = by_name["peak_force_relative"]
        self.assertAlmostEqual(pf["left_value"], 0.897, places=2)
        self.assertAlmostEqual(pf["right_value"], 0.839, places=2)
        self.assertAlmostEqual(pf["asymmetry_pct"], 6.5, places=1)

        braking = by_name.get("braking_rfd")
        self.assertIsNotNone(braking)
        self.assertAlmostEqual(braking["left_value"], 2.40, places=2)
        self.assertAlmostEqual(braking["right_value"], 13.6, places=1)
        self.assertAlmostEqual(braking["asymmetry_pct"], 82.4, places=1)

        jump_height = by_name.get("jump_height")
        if jump_height and jump_height.get("combined_value") is not None:
            self.assertIsNone(jump_height.get("left_value"))
            self.assertIsNone(jump_height.get("right_value"))

        result = apply_aps_rules(flatten_findings(parsed))
        findings = result["findings"]
        notable = [f for f in findings if f["is_notable"]]
        self.assertGreaterEqual(len(notable), 2)
        self.assertTrue(all(f["confidence_tier"] == "low" for f in notable))
        self.assertEqual(result["session_summary"]["overall_tier"], "low")

    def test_west_real_pdf_extraction(self):
        pdf = self._load_pdf("APS_WEST_PDF")
        parsed = parse_kinvent_pdf(pdf)
        print("\n--- WEST EXTRACTION ---")
        print(json.dumps(parsed, indent=2, default=str))

        self.assertTrue(parsed.get("tests"))
        sldj = next((t for t in parsed["tests"] if t["test_type"] == "SLDJ"), None)
        self.assertIsNotNone(sldj)
        peak_rfd = next(
            (m for m in sldj["metrics"] if m["metric_name"] == "peak_rfd"),
            None,
        )
        if peak_rfd:
            self.assertAlmostEqual(peak_rfd["left_value"], 4685, delta=50)
            self.assertAlmostEqual(peak_rfd["right_value"], 1440, delta=50)
            self.assertAlmostEqual(peak_rfd["asymmetry_pct"], 69.3, delta=2.0)

        result = apply_aps_rules(flatten_findings(parsed))
        notable = [f for f in result["findings"] if f["is_notable"]]
        self.assertTrue(all(f["confidence_tier"] == "high" for f in notable))
        self.assertEqual(result["session_summary"]["overall_tier"], "high")


if __name__ == "__main__":
    unittest.main()
