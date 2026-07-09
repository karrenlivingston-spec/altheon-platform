"""APS confidence-tier rule engine and next-test recommendations (v1, not diagnostic)."""

from __future__ import annotations

from typing import Any, Optional

# ---------------------------------------------------------------------------
# CLINICALLY-TUNABLE — pending Dr. West sign-off
# ---------------------------------------------------------------------------
ASYMMETRY_NOTABLE_THRESHOLD_PCT = 15  # flag as notable above this
ASYMMETRY_HIGH_CONFIDENCE_MIN_METRICS = 2  # concordant metrics needed for "high"
HIGH_CONFIDENCE_MAJORITY_FRACTION = 0.60  # dominant cluster must be >= 60% of notable findings

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

# Metrics whose NEXT_TEST_BY_METRIC entry recommends K-Push (maps to test_type K_PUSH).
_K_PUSH_RECOMMENDING_METRICS = frozenset(
    {
        "braking_rfd",
        "propulsive_rfd",
        "peak_power_relative",
        "peak_force_relative",
        "peak_rfd",
    }
)

_PRIOR_K_PUSH_RECOMMENDATION = (
    "K-Push testing for this region has already been performed in a prior "
    "session — review those findings rather than repeating this test."
)

_DOMINANT_SIDE_K_PUSH: dict[str, str] = {
    "left": "left hip extensors/knee extensors",
    "right": "right hip extensors/knee extensors",
}


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def is_combined_only_metric(row: dict[str, Any]) -> bool:
    """True when the metric is an aggregate with no left/right split."""
    left = _safe_float(row.get("left_value"))
    right = _safe_float(row.get("right_value"))
    combined = _safe_float(row.get("combined_value"))
    if left is not None or right is not None:
        return False
    return combined is not None


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


def _finding_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("test_type") or ""),
        str(row.get("metric_name") or ""),
        str(row.get("left_value")),
    )


def _cluster_notable_by_side(
    notable: list[dict[str, Any]],
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Group notable split metrics by deficient side; return sideless rows separately."""
    clusters: dict[str, list[dict[str, Any]]] = {"left": [], "right": []}
    sideless: list[dict[str, Any]] = []
    for row in notable:
        side = deficient_side(row.get("left_value"), row.get("right_value"))
        if side:
            clusters[side].append(row)
        else:
            sideless.append(row)
    return clusters, sideless


def _session_confidence_tier(
    notable: list[dict[str, Any]],
) -> tuple[Optional[str], Optional[str]]:
    """
    Derive session-level tier from the largest same-side cluster among notable findings.
    Returns (tier, dominant_side).
    """
    if not notable:
        return None, None
    if len(notable) == 1:
        side = deficient_side(notable[0].get("left_value"), notable[0].get("right_value"))
        return "moderate", side

    clusters, _sideless = _cluster_notable_by_side(notable)
    left_count = len(clusters["left"])
    right_count = len(clusters["right"])
    sided_total = left_count + right_count

    if sided_total == 0:
        return "moderate", None

    if len(notable) == 2 and left_count == 1 and right_count == 1:
        return "low", None

    if left_count >= right_count:
        dominant_side = "left"
        dominant_count = left_count
    else:
        dominant_side = "right"
        dominant_count = right_count

    minority_count = sided_total - dominant_count

    if dominant_count >= ASYMMETRY_HIGH_CONFIDENCE_MIN_METRICS:
        if dominant_count / len(notable) >= HIGH_CONFIDENCE_MAJORITY_FRACTION:
            return "high", dominant_side

    if left_count > 0 and right_count > 0 and dominant_count <= minority_count:
        return "low", None

    if left_count > 0 and right_count > 0:
        if dominant_count / len(notable) < HIGH_CONFIDENCE_MAJORITY_FRACTION:
            return "low", None

    return "moderate", dominant_side


def _outlier_rows_for_summary(
    notable: list[dict[str, Any]],
    tier: Optional[str],
    dominant_side: Optional[str],
) -> list[dict[str, Any]]:
    if not notable or not tier:
        return []
    if tier == "high" and dominant_side:
        return [
            row
            for row in notable
            if deficient_side(row.get("left_value"), row.get("right_value"))
            not in (None, dominant_side)
        ]
    if tier == "low":
        clusters, _sideless = _cluster_notable_by_side(notable)
        if len(notable) == 2 and len(clusters["left"]) == 1 and len(clusters["right"]) == 1:
            return list(notable)
        if dominant_side:
            minority_side = "right" if dominant_side == "left" else "left"
            return list(clusters[minority_side])
        left_count = len(clusters["left"])
        right_count = len(clusters["right"])
        if left_count > 0 and right_count > 0:
            if left_count <= right_count:
                return list(clusters["left"])
            return list(clusters["right"])
    return []


def build_session_summary(notable: list[dict[str, Any]]) -> dict[str, Any]:
    """Structured session summary from notable findings (shared by rules + GET assembly)."""
    tier, dominant_side = _session_confidence_tier(notable)
    clusters, _sideless = _cluster_notable_by_side(notable)

    dominant_cluster_size = 0
    summary_dominant_side: Optional[str] = None
    if tier == "high" and dominant_side:
        summary_dominant_side = dominant_side
        dominant_cluster_size = len(clusters[dominant_side])

    outlier_rows = _outlier_rows_for_summary(notable, tier, dominant_side)

    return {
        "overall_tier": tier,
        "total_notable_findings": len(notable),
        "dominant_side": summary_dominant_side,
        "dominant_cluster_size": dominant_cluster_size,
        "outlier_count": len(outlier_rows),
        "outlier_findings": [
            {
                "test_type": str(row.get("test_type") or ""),
                "metric_name": str(row.get("metric_name") or ""),
            }
            for row in outlier_rows
        ],
    }


def build_session_summary_from_findings(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Rebuild session_summary from persisted scored findings."""
    notable = [row for row in findings if row.get("is_notable")]
    return build_session_summary(notable)


def _dominant_cluster_prefix(dominant_side: str, dominant_count: int, total_notable: int) -> str:
    muscles = _DOMINANT_SIDE_K_PUSH.get(dominant_side, f"{dominant_side}-side musculature")
    return (
        f"{dominant_count} of {total_notable} tested metrics point to a {dominant_side}-side "
        f"deficit — recommend K-Push testing on the {muscles} to confirm. "
    )


def _outlier_note(row: dict[str, Any]) -> str:
    return (
        f"Note: {row.get('test_type')} {row.get('metric_name')} showed the opposite pattern "
        "and should be reviewed alongside the dominant finding, not discarded. "
    )


def _recommendation_for_metric(
    metric_name: str,
    confidence_tier: Optional[str],
    *,
    row: dict[str, Any],
    dominant_side: Optional[str],
    is_outlier: bool,
    dominant_count: int,
    total_notable: int,
    prior_test_types: frozenset[str] = frozenset(),
) -> Optional[str]:
    base = NEXT_TEST_BY_METRIC.get(metric_name)
    if not base:
        return None
    if "K_PUSH" in prior_test_types and metric_name in _K_PUSH_RECOMMENDING_METRICS:
        base = _PRIOR_K_PUSH_RECOMMENDATION
    if confidence_tier == "low":
        return LOW_CONFIDENCE_PREFIX + base
    if confidence_tier == "high" and dominant_side:
        prefix = _dominant_cluster_prefix(dominant_side, dominant_count, total_notable)
        if is_outlier:
            return prefix + _outlier_note(row) + base
        return prefix + base
    return base


def apply_aps_rules(
    findings: list[dict[str, Any]],
    *,
    prior_test_types: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """
    Score findings and return findings plus structured session_summary.
    """
    out: list[dict[str, Any]] = []
    for row in findings:
        item = dict(row)
        if is_combined_only_metric(item):
            item["is_notable"] = False
        else:
            asym = _safe_float(item.get("asymmetry_pct"))
            item["is_notable"] = asym is not None and asym >= ASYMMETRY_NOTABLE_THRESHOLD_PCT
        item["confidence_tier"] = None
        item["recommended_next_test"] = None
        out.append(item)

    notable = [r for r in out if r.get("is_notable")]
    session_tier, dominant_side = _session_confidence_tier(notable)
    session_summary = build_session_summary(notable)

    outlier_keys: set[tuple[str, str, str]] = set()
    for item in session_summary.get("outlier_findings") or []:
        for row in notable:
            if (
                str(row.get("test_type") or "") == item.get("test_type")
                and str(row.get("metric_name") or "") == item.get("metric_name")
            ):
                outlier_keys.add(_finding_key(row))

    dominant_count = int(session_summary.get("dominant_cluster_size") or 0)
    total_notable = len(notable)

    for row in out:
        if not row.get("is_notable"):
            continue
        row["confidence_tier"] = session_tier
        row["recommended_next_test"] = _recommendation_for_metric(
            str(row.get("metric_name") or ""),
            session_tier,
            row=row,
            dominant_side=dominant_side if session_tier == "high" else None,
            is_outlier=_finding_key(row) in outlier_keys,
            dominant_count=dominant_count,
            total_notable=total_notable,
            prior_test_types=prior_test_types,
        )

    return {"findings": out, "session_summary": session_summary}
