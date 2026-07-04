"""APS confidence-tier rule engine and next-test recommendations (v1, not diagnostic)."""

from __future__ import annotations

from typing import Any, Optional

# ---------------------------------------------------------------------------
# CLINICALLY-TUNABLE — pending Dr. West sign-off
# ---------------------------------------------------------------------------
ASYMMETRY_NOTABLE_THRESHOLD_PCT = 15  # flag as notable above this
ASYMMETRY_HIGH_CONFIDENCE_MIN_METRICS = 2  # concordant metrics needed for "high"

# DRAFT — built from Dr. West's clinical notes, pending his review before relied
# upon. Edit freely; do not treat as validated protocol.
NEXT_TEST_BY_METRIC: dict[str, str] = {
    "braking_rfd": (
        "K-Push: hip extension, knee extension (bilateral); confirm with single-leg CMJ"
    ),
    "propulsive_rfd": (
        "K-Push: knee extension, hip extension, plantarflexion; confirm with single-leg squat jump"
    ),
    "peak_power_relative": (
        "K-Push: hip abduction, knee extension; confirm with single-leg drop jump"
    ),
    "peak_force_relative": (
        "K-Push: hip abduction, knee extension; confirm with single-leg drop jump"
    ),
    "rsi": "Confirm with single-leg drop jump and balance assessment",
    "jump_height": (
        "No isolated K-Push mapping; correlate with strength testing before concluding "
        "a physical limitation (per Dr. West: rule out effort, confidence, apprehension first)"
    ),
    "peak_rfd": (
        "K-Push: hip extension, knee extension (bilateral); confirm with single-leg CMJ"
    ),
}

LOW_CONFIDENCE_PREFIX = (
    "Findings are inconsistent across tests — repeat testing before proceeding. "
)


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def deficient_side(left_value: Any, right_value: Any) -> Optional[str]:
    """Return 'left' if left is lower, 'right' if right is lower, else None."""
    left = _safe_float(left_value)
    right = _safe_float(right_value)
    if left is None or right is None:
        return None
    if left < right:
        return "left"
    if right < left:
        return "right"
    return None


def _session_confidence_tier(notable: list[dict[str, Any]]) -> Optional[str]:
    """Derive session-level tier from cross-metric agreement among notable findings."""
    if not notable:
        return None
    if len(notable) == 1:
        return "moderate"

    sides: list[str] = []
    for row in notable:
        side = deficient_side(row.get("left_value"), row.get("right_value"))
        if side:
            sides.append(side)

    if len(sides) < ASYMMETRY_HIGH_CONFIDENCE_MIN_METRICS:
        return "moderate"

    if len(set(sides)) == 1:
        return "high"
    return "low"


def _recommendation_for_metric(metric_name: str, confidence_tier: Optional[str]) -> Optional[str]:
    base = NEXT_TEST_BY_METRIC.get(metric_name)
    if not base:
        return None
    if confidence_tier == "low":
        return LOW_CONFIDENCE_PREFIX + base
    return base


def apply_aps_rules(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Mutate and return finding dicts with is_notable, confidence_tier,
    recommended_next_test populated.
    """
    out: list[dict[str, Any]] = []
    for row in findings:
        item = dict(row)
        asym = _safe_float(item.get("asymmetry_pct"))
        item["is_notable"] = asym is not None and asym >= ASYMMETRY_NOTABLE_THRESHOLD_PCT
        item["confidence_tier"] = None
        item["recommended_next_test"] = None
        out.append(item)

    notable = [r for r in out if r.get("is_notable")]
    session_tier = _session_confidence_tier(notable)

    for row in out:
        if not row.get("is_notable"):
            continue
        row["confidence_tier"] = session_tier
        row["recommended_next_test"] = _recommendation_for_metric(
            str(row.get("metric_name") or ""),
            session_tier,
        )

    return out
