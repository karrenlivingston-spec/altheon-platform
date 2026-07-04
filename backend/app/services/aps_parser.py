"""Kinvent Smart Mode (K-Deltas) force-plate PDF text parser for APS v1."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any, Optional

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# Test card title keywords -> normalized test_type
TEST_CARD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"SLCMJ\s*-\s*Single\s+Leg\s+Counter\s+Movement\s+Jump", re.I), "SLCMJ"),
    (re.compile(r"SLDJ\s*-\s*Single\s+Leg\s+Drop\s+Jump", re.I), "SLDJ"),
    (re.compile(r"CMJ\s*-\s*Counter\s+Movement\s+Jump", re.I), "CMJ"),
    (re.compile(r"SJ\s*-\s*Squat\s+Jump", re.I), "SJ"),
    (re.compile(r"DJ\s*-\s*Drop\s+Jump", re.I), "DJ"),
    (re.compile(r"RJT\s*-\s*10/5\s+Repetitive\s+Jumps\s+Test", re.I), "RJT"),
    (re.compile(r"Multiple\s+Jumps", re.I), "MULTIPLE_JUMPS"),
]

# Bilateral metric label patterns -> (metric_name, default_unit)
BILATERAL_METRIC_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"Jump\s+height(?:\s*\([^)]*\))?", re.I), "jump_height", "cm"),
    (re.compile(r"Peak\s+Force\s*-\s*Relative", re.I), "peak_force_relative", "kg/kg"),
    (re.compile(r"Peak\s+Power\s*-\s*Relative", re.I), "peak_power_relative", "W/kg"),
    (
        re.compile(r"Braking\s*-\s*Deceleration\s+RFD", re.I),
        "braking_rfd",
        "kg/s",
    ),
    (re.compile(r"Propulsive\s+RFD", re.I), "propulsive_rfd", "kg/s"),
    (re.compile(r"\bRSI\b", re.I), "rsi", ""),
    (re.compile(r"Peak\s+RFD", re.I), "peak_rfd", "kg/s"),
]

AGGREGATE_METRIC_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"Number\s+of\s+Jumps", re.I), "number_of_jumps", "count"),
    (re.compile(r"Height\s+Average", re.I), "height_average", "cm"),
    (re.compile(r"\bDuration\b", re.I), "duration", "s"),
    (re.compile(r"Fatigue\s+Index", re.I), "fatigue_index", "%"),
    (re.compile(r"\bPace\b", re.I), "pace", ""),
    (re.compile(r"Average\s+Power", re.I), "average_power", "W"),
]

_NUM = r"([\d.]+)"
_UNIT_GROUP = r"(cm|kg/kg|W/kg|kg/s|m/s|W|%|s)?"


def _parse_float(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _extract_header_fields(text: str) -> tuple[str, str, str]:
    patient_name = ""
    patient_dob = ""
    session_date = ""

    dob_m = re.search(r"\b(\d{1,2}/\d{1,2}/\d{4})\b", text[:800])
    if dob_m:
        patient_dob = dob_m.group(1)

    session_m = re.search(
        r"Session\s+\w+\s+(\d{1,2}/\d{1,2}/\d{4})(?:\s+\d{1,2}:\d{2})?",
        text,
        re.I,
    )
    if session_m:
        session_date = session_m.group(1)

    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    for i, line in enumerate(lines[:12]):
        if re.match(r"Session\s+", line, re.I):
            break
        if re.match(r"\d{1,2}/\d{1,2}/\d{4}", line):
            continue
        if not patient_name and len(line) > 1:
            patient_name = line
            if i + 1 < len(lines) and re.match(r"\d{1,2}/\d{1,2}/\d{4}", lines[i + 1]):
                patient_dob = lines[i + 1]
            break

    return patient_name, patient_dob, session_date


def _split_test_sections(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Return recognized test sections and unrecognized text blocks."""
    matches: list[tuple[int, int, str]] = []
    for pattern, test_type in TEST_CARD_PATTERNS:
        for m in pattern.finditer(text):
            matches.append((m.start(), m.end(), test_type))

    if not matches:
        return [], [text]

    matches.sort(key=lambda x: x[0])
    deduped: list[tuple[int, int, str]] = []
    last_start = -1
    for start, end, test_type in matches:
        if start <= last_start:
            continue
        deduped.append((start, end, test_type))
        last_start = start

    sections: list[dict[str, Any]] = []
    unparsed: list[str] = []

    for idx, (start, end, test_type) in enumerate(deduped):
        next_start = deduped[idx + 1][0] if idx + 1 < len(deduped) else len(text)
        body = text[end:next_start].strip()
        sections.append({"test_type": test_type, "body": body})

    prefix = text[: deduped[0][0]].strip()
    if prefix:
        unparsed.append(prefix)

    return sections, unparsed


def _chunk_before_next_metric(chunk: str, current_pattern: re.Pattern[str]) -> str:
    earliest = len(chunk)
    all_patterns = [p for p, _, _ in BILATERAL_METRIC_PATTERNS] + [
        p for p, _, _ in AGGREGATE_METRIC_PATTERNS
    ]
    for pat in all_patterns:
        if pat.pattern == current_pattern.pattern:
            continue
        m = pat.search(chunk)
        if m and m.start() < earliest:
            earliest = m.start()
    return chunk[:earliest]


def _parse_lr_values(chunk: str) -> tuple[Optional[float], Optional[float], Optional[str]]:
    left_m = re.search(
        rf"Left\s*\n?\s*{_NUM}\s*{_UNIT_GROUP}",
        chunk,
        re.I,
    )
    right_m = re.search(
        rf"Right\s*\n?\s*{_NUM}\s*{_UNIT_GROUP}",
        chunk,
        re.I,
    )
    left_val = _parse_float(left_m.group(1) if left_m else None)
    right_val = _parse_float(right_m.group(1) if right_m else None)
    unit = ""
    for m in (left_m, right_m):
        if m and m.group(2):
            unit = m.group(2).strip()
    return left_val, right_val, unit


def _parse_bilateral_metrics(body: str) -> list[dict[str, Any]]:
    metrics: list[dict[str, Any]] = []
    for pattern, metric_name, default_unit in BILATERAL_METRIC_PATTERNS:
        m = pattern.search(body)
        if not m:
            continue
        chunk = _chunk_before_next_metric(body[m.end() :], pattern)
        left_val, right_val, unit = _parse_lr_values(chunk)
        asym_m = re.search(rf"{_NUM}\s*%\s*Asymmetry", chunk, re.I)
        asym = _parse_float(asym_m.group(1) if asym_m else None)
        if left_val is None and right_val is None and asym is None:
            logger.warning("APS parser: metric label %s found but no values parsed", metric_name)
            continue
        metrics.append(
            {
                "metric_name": metric_name,
                "left_value": left_val,
                "right_value": right_val,
                "unit": unit or default_unit or None,
                "asymmetry_pct": asym,
            }
        )
    return metrics


def _parse_aggregate_metrics(body: str) -> list[dict[str, Any]]:
    metrics: list[dict[str, Any]] = []
    for pattern, metric_name, default_unit in AGGREGATE_METRIC_PATTERNS:
        m = pattern.search(body)
        if not m:
            continue
        chunk = _chunk_before_next_metric(body[m.end() :], pattern)
        val_m = re.search(rf"{_NUM}", chunk)
        val = _parse_float(val_m.group(1) if val_m else None)
        if val is None:
            continue
        metrics.append(
            {
                "metric_name": metric_name,
                "left_value": None,
                "right_value": val,
                "unit": default_unit or None,
                "asymmetry_pct": None,
            }
        )
    return metrics


def _parse_test_section(test_type: str, body: str) -> dict[str, Any]:
    if test_type in {"MULTIPLE_JUMPS", "RJT"}:
        metrics = _parse_aggregate_metrics(body)
        if not metrics:
            metrics = _parse_bilateral_metrics(body)
    else:
        metrics = _parse_bilateral_metrics(body)
        if not metrics:
            metrics = _parse_aggregate_metrics(body)
    return {"test_type": test_type, "metrics": metrics}


def parse_kinvent_text(text: str) -> dict[str, Any]:
    """Parse normalized Kinvent report text into structured APS data."""
    normalized = _normalize_text(text)
    patient_name, patient_dob, session_date = _extract_header_fields(normalized)
    sections, unparsed_prefix = _split_test_sections(normalized)

    tests: list[dict[str, Any]] = []
    unparsed_sections: list[str] = list(unparsed_prefix)

    for section in sections:
        test_type = str(section["test_type"])
        body = str(section["body"])
        parsed = _parse_test_section(test_type, body)
        if parsed["metrics"]:
            tests.append(parsed)
        else:
            unparsed_sections.append(f"{test_type}: {body[:500]}")
            logger.warning("APS parser: unrecognized or empty test card: %s", test_type)

    return {
        "patient_name": patient_name,
        "patient_dob": patient_dob,
        "session_date": session_date,
        "tests": tests,
        "unparsed_sections": unparsed_sections,
    }


def parse_kinvent_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """Extract text from a Kinvent PDF and parse structured jump-test data."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages = [page.get_text() for page in doc]
    finally:
        doc.close()
    full_text = "\n".join(pages)
    result = parse_kinvent_text(full_text)
    result["raw_text"] = full_text
    return result


def parse_session_date(raw: str) -> date:
    """Parse MM/DD/YYYY from Kinvent header; fall back to today if missing."""
    s = (raw or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return date.today()


def flatten_findings(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten parsed tests[] into rows suitable for aps_findings + rules engine."""
    rows: list[dict[str, Any]] = []
    for test in parsed.get("tests") or []:
        test_type = str(test.get("test_type") or "")
        for metric in test.get("metrics") or []:
            if not isinstance(metric, dict):
                continue
            rows.append(
                {
                    "test_type": test_type,
                    "metric_name": metric.get("metric_name"),
                    "left_value": metric.get("left_value"),
                    "right_value": metric.get("right_value"),
                    "unit": metric.get("unit"),
                    "asymmetry_pct": metric.get("asymmetry_pct"),
                }
            )
    return rows
