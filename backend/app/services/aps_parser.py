"""Kinvent Smart Mode (K-Deltas) force-plate PDF parser — Claude Haiku vision extraction."""

from __future__ import annotations

import base64
import json
import logging
import re
from datetime import date, datetime
from typing import Any, Optional

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"
_PDF_ZOOM = 2.0
_MAX_TOKENS = 8192
_CLAUDE_TIMEOUT_SEC = 120.0

ALLOWED_TEST_TYPES = frozenset(
    {"CMJ", "SJ", "SLCMJ", "DJ", "SLDJ", "RJT", "MULTIPLE_JUMPS", "K_PUSH"}
)
ALLOWED_METRIC_NAMES = frozenset(
    {
        "jump_height",
        "peak_force_relative",
        "peak_power_relative",
        "braking_rfd",
        "propulsive_rfd",
        "rsi",
        "peak_rfd",
        "number_of_jumps",
        "height_average",
        "duration",
        "fatigue_index",
        "pace",
        "average_power",
        "grip_strength",
        "shoulder_er_rom_0abd",
        "shoulder_ir_rom_90flex",
        "prone_knee_flexion_strength",
        "shoulder_er_strength_r1",
        "shoulder_ir_strength_r1",
        "hip_ir_strength",
        "knee_extension_strength_90",
        "hip_flexion_strength",
        "hip_extension_strength",
    }
)

_EXTRACTION_SYSTEM = """You extract structured jump-test data from Kinvent Smart Mode (K-Deltas) \
force-plate report images for a physical therapy clinic APS module.

You also extract structured isometric strength and ROM data from Kinvent K-Push device cards \
on the same report pages.

Return ONLY valid JSON — no markdown fences, no preamble, no commentary.

Read numeric values exactly as printed. Do not round, estimate, or infer missing values.
Distinguish Left-labeled values from Right-labeled values from combined/total values.
Include asymmetry_pct ONLY when the card explicitly shows a percentage labeled as asymmetry \
(e.g. "82.4% Asymmetry"). If uncertain about any value, omit that metric entirely rather than guessing.

K-Push (K_PUSH) cards report Peak Force (lbs) or Max Angle (degrees) per side, with an explicit \
asymmetry percentage when shown — same left/right split pattern as jump-test metrics."""

_USER_EXTRACTION_PROMPT = """Extract all test cards from these Kinvent report page images.

Return JSON with exactly this shape:
{
  "patient_name": string,
  "patient_dob": string,
  "session_date": string,
  "tests": [
    {
      "test_type": string,
      "metrics": [
        {
          "metric_name": string,
          "left_value": number or null,
          "right_value": number or null,
          "combined_value": number or null,
          "unit": string or null,
          "asymmetry_pct": number or null
        }
      ]
    }
  ],
  "unparsed_sections": []
}

test_type must be one of: CMJ, SJ, SLCMJ, DJ, SLDJ, RJT, MULTIPLE_JUMPS, K_PUSH
metric_name must be one of: jump_height, peak_force_relative, peak_power_relative, braking_rfd, \
propulsive_rfd, rsi, peak_rfd, number_of_jumps, height_average, duration, fatigue_index, pace, \
average_power, grip_strength, shoulder_er_rom_0abd, shoulder_ir_rom_90flex, \
prone_knee_flexion_strength, shoulder_er_strength_r1, shoulder_ir_strength_r1, hip_ir_strength, \
knee_extension_strength_90, hip_flexion_strength, hip_extension_strength

Use combined_value only for aggregate metrics without Left/Right split (e.g. Multiple Jumps, RJT).
Put any content you cannot confidently map into unparsed_sections as short text descriptions.

Jump-test cards (force plate): use test_type CMJ, SJ, SLCMJ, DJ, SLDJ, RJT, or MULTIPLE_JUMPS \
and the jump metric_name values listed above — unchanged from prior Kinvent jump extraction rules. \
Triple Hop Test cards report Total Distance per side with an asymmetry percentage — map these to \
test_type RJT, metric_name jump_height, unit inches, using the Left/Right distance values and the \
shown asymmetry_pct.

K-Push cards (isometric strength / ROM): use test_type K_PUSH for every K-Push device card. \
Each card maps to exactly one metric_name below. Read Left and Right values from the card; use \
unit "lbs" for Peak Force and "degrees" for Max Angle. Include asymmetry_pct when the card \
shows an explicit asymmetry percentage.

K_PUSH card label → metric_name mapping:
- "Grip Strength" (Peak Force) → grip_strength
- "Sitting External Rotator @0° Abduction (R1)" (Max Angle) → shoulder_er_rom_0abd
- "Sitting Internal Rotators @90° Flexion" (Max Angle) → shoulder_ir_rom_90flex
- "Prone Knee Flexion 90° Flexion" (Peak Force) → prone_knee_flexion_strength
- "External Rotators R1" (Peak Force) → shoulder_er_strength_r1
- "Internal Rotators R1" (Peak Force) → shoulder_ir_strength_r1
- "Sitting Internal Hip Rotation" (Peak Force) → hip_ir_strength
- "Sitting Knee Extension 90° Flexion" (Peak Force) → knee_extension_strength_90
- "Hip Flexion" (Peak Force) → hip_flexion_strength
- "Hip Extension" (Peak Force) → hip_extension_strength

Leave unmapped sections (e.g. Single-Leg Balance, Squat Analysis, Body Weight) in \
unparsed_sections — do not invent test_type or metric_name values for them."""


class ApsParseError(Exception):
    """Structured Kinvent PDF extraction failure."""

    def __init__(
        self,
        message: str,
        *,
        raw_response: str = "",
        parse_error: str = "",
    ) -> None:
        super().__init__(message)
        self.raw_response = raw_response
        self.parse_error = parse_error or message


def _parse_float(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _extract_json_object(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("expected JSON object")
    return data


def _rasterize_pdf_pages(pdf_bytes: bytes) -> list[str]:
    """Rasterize each PDF page to base64 PNG (Kinvent reports are flattened images)."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images: list[str] = []
    try:
        matrix = fitz.Matrix(_PDF_ZOOM, _PDF_ZOOM)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix)
            images.append(base64.standard_b64encode(pix.tobytes("png")).decode("ascii"))
    finally:
        doc.close()
    return images


def _call_claude_kinvent_extraction(page_images_b64: list[str]) -> str:
    """Send rasterized report pages to Claude Haiku (same SDK pattern as diagnostic_ocr)."""
    import os

    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise ApsParseError("ANTHROPIC_API_KEY is not configured")

    try:
        import anthropic
    except ImportError as exc:
        raise ApsParseError("anthropic package is not installed") from exc

    content: list[dict[str, Any]] = []
    total = len(page_images_b64)
    for idx, b64 in enumerate(page_images_b64):
        content.append(
            {
                "type": "text",
                "text": f"Kinvent report page {idx + 1} of {total}:",
            }
        )
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": b64,
                },
            }
        )
    content.append({"type": "text", "text": _USER_EXTRACTION_PROMPT})

    client = anthropic.Anthropic(api_key=api_key, timeout=_CLAUDE_TIMEOUT_SEC)
    message = client.messages.create(
        model=_CLAUDE_MODEL,
        max_tokens=_MAX_TOKENS,
        system=_EXTRACTION_SYSTEM,
        messages=[{"role": "user", "content": content}],
    )

    blocks = getattr(message, "content", None) or []
    parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            parts.append(str(block["text"]))
    raw = "".join(parts).strip()
    if not raw:
        raise ApsParseError("Claude returned an empty extraction response")
    return raw


def normalize_kinvent_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize Haiku JSON into the APS parser output shape."""
    tests_out: list[dict[str, Any]] = []
    for test in data.get("tests") or []:
        if not isinstance(test, dict):
            continue
        test_type = str(test.get("test_type") or "").strip().upper()
        if test_type not in ALLOWED_TEST_TYPES:
            logger.warning("APS parser: skipping unknown test_type %s", test_type)
            continue

        metrics_out: list[dict[str, Any]] = []
        for metric in test.get("metrics") or []:
            if not isinstance(metric, dict):
                continue
            metric_name = str(metric.get("metric_name") or "").strip().lower()
            if metric_name not in ALLOWED_METRIC_NAMES:
                logger.warning(
                    "APS parser: skipping unknown metric_name %s in %s",
                    metric_name,
                    test_type,
                )
                continue

            left_val = _parse_float(metric.get("left_value"))
            right_val = _parse_float(metric.get("right_value"))
            combined_val = _parse_float(metric.get("combined_value"))

            if left_val is None and right_val is None and combined_val is None:
                continue

            metrics_out.append(
                {
                    "metric_name": metric_name,
                    "left_value": left_val,
                    "right_value": right_val,
                    "combined_value": combined_val,
                    "unit": (str(metric.get("unit")).strip() if metric.get("unit") else None),
                    "asymmetry_pct": _parse_float(metric.get("asymmetry_pct")),
                }
            )

        if metrics_out:
            tests_out.append({"test_type": test_type, "metrics": metrics_out})

    unparsed = data.get("unparsed_sections") or []
    if not isinstance(unparsed, list):
        unparsed = [str(unparsed)]
    unparsed_out = [str(x).strip() for x in unparsed if str(x).strip()]

    return {
        "patient_name": str(data.get("patient_name") or "").strip(),
        "patient_dob": str(data.get("patient_dob") or "").strip(),
        "session_date": str(data.get("session_date") or "").strip(),
        "tests": tests_out,
        "unparsed_sections": unparsed_out,
    }


def parse_kinvent_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """
    Extract structured APS data from a Kinvent PDF via Claude Haiku vision.
    Raises ApsParseError on extraction/JSON failures (caller should not persist empty sessions).
    """
    page_images = _rasterize_pdf_pages(pdf_bytes)
    if not page_images:
        raise ApsParseError("PDF contains no pages")

    try:
        raw_response = _call_claude_kinvent_extraction(page_images)
    except ApsParseError:
        raise
    except Exception as exc:
        logger.exception("APS Claude vision extraction failed")
        raise ApsParseError(f"Claude extraction failed: {exc}") from exc

    try:
        payload = _extract_json_object(raw_response)
        normalized = normalize_kinvent_payload(payload)
    except Exception as exc:
        logger.warning("APS JSON parse failed: %s", exc)
        raise ApsParseError(
            "Failed to parse structured JSON from Claude response",
            raw_response=raw_response,
            parse_error=str(exc),
        ) from exc

    normalized["extraction_method"] = "claude_vision"
    normalized["page_count"] = len(page_images)
    normalized["llm_raw_response"] = raw_response
    return normalized


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
                    "combined_value": metric.get("combined_value"),
                    "unit": metric.get("unit"),
                    "asymmetry_pct": metric.get("asymmetry_pct"),
                }
            )
    return rows
