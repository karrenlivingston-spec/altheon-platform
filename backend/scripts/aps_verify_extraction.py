#!/usr/bin/env python3
"""Manual APS Kinvent PDF extraction verification.

Usage:
  set ANTHROPIC_API_KEY=...
  set APS_SHARPE_PDF=C:\\path\\to\\sharpe.pdf
  set APS_WEST_PDF=C:\\path\\to\\west.pdf
  python scripts/aps_verify_extraction.py

Prints full JSON and rules tiering for each file.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.aps_parser import flatten_findings, parse_kinvent_pdf
from app.services.aps_rules import apply_aps_rules


def _run(path: str, label: str) -> None:
    print(f"\n{'=' * 60}\n{label}: {path}\n{'=' * 60}")
    with open(path, "rb") as f:
        data = f.read()
    parsed = parse_kinvent_pdf(data)
    print(json.dumps(parsed, indent=2, default=str))
    findings = apply_aps_rules(flatten_findings(parsed))
    notable = [f for f in findings if f.get("is_notable")]
    print(f"\nNotable findings ({len(notable)}):")
    for f in notable:
        print(
            f"  {f['test_type']} {f['metric_name']}: "
            f"asym={f['asymmetry_pct']}% tier={f['confidence_tier']}"
        )

    combined_metrics = []
    for test in parsed.get("tests") or []:
        for metric in test.get("metrics") or []:
            if metric.get("combined_value") is not None and metric.get("left_value") is None:
                combined_metrics.append(
                    f"  {test['test_type']} {metric['metric_name']}: "
                    f"combined_value={metric['combined_value']} "
                    f"(left={metric.get('left_value')}, right={metric.get('right_value')})"
                )
    if combined_metrics:
        print("\nCombined-only metrics:")
        for line in combined_metrics:
            print(line)


def main() -> None:
    sharpe = (os.environ.get("APS_SHARPE_PDF") or "").strip()
    west = (os.environ.get("APS_WEST_PDF") or "").strip()
    if not sharpe and not west:
        print("Set APS_SHARPE_PDF and/or APS_WEST_PDF to PDF file paths.")
        sys.exit(1)
    if sharpe:
        _run(sharpe, "SHARPE")
    if west:
        _run(west, "WEST")


if __name__ == "__main__":
    main()
