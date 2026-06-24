"""CPT code detection from SOAP notes via Claude Haiku + clinic fee schedule."""

from __future__ import annotations

import json
import os
import re
import traceback
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.db import supabase
from routers.fee_schedule import _assert_user_has_clinic_access, _resolve_bearer_user_id

router = APIRouter()

_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

_CPT_DETECTION_SYSTEM = """You are a medical billing assistant for a physical therapy and chiropractic clinic.
Your job is to read a clinical SOAP note and match the treatments described to CPT billing codes from the clinic's fee schedule.

Rules:
- Only return CPT codes that are present in the provided fee schedule
- Match based on treatment descriptions, procedures, and interventions mentioned in the note
- If multiple services are billed in the same visit, suggest appropriate modifiers (59, 25, XS, XU) when applicable
- Return ONLY valid JSON, no explanation text, no markdown

Return a JSON array like this:
[
  {
    "cpt_code": "97110",
    "description": "Therapeutic Exercise",
    "charge": 85.00,
    "modifiers": ["GP"],
    "reason": "Patient performed therapeutic exercises for strengthening"
  }
]

If no codes can be confidently matched, return an empty array: []"""


class CPTDetectionRequest(BaseModel):
    note_id: str = Field(..., min_length=1)
    clinic_id: str = Field(..., min_length=1)


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _extract_json_array(text: str) -> list[Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    bracket = re.search(r"\[[\s\S]*\]", text)
    if bracket:
        text = bracket.group(0)
    data = json.loads(text)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("cpt_codes", "codes", "items"):
            val = data.get(key)
            if isinstance(val, list):
                return val
    raise ValueError("response is not a JSON array")


def _format_modifiers(modifiers: Any) -> str:
    if modifiers is None:
        return "none"
    if isinstance(modifiers, list):
        parts = [str(m).strip() for m in modifiers if str(m).strip()]
        return ", ".join(parts) if parts else "none"
    s = str(modifiers).strip()
    return s if s else "none"


def _build_transcript(note: dict[str, Any]) -> str:
    parts = [
        f"Subjective: {note.get('subjective') or ''}",
        f"Objective: {note.get('objective') or ''}",
        f"Assessment: {note.get('assessment') or ''}",
        f"Plan: {note.get('plan') or ''}",
    ]
    return "\n\n".join(parts)


@router.post("/cpt-detection")
def detect_cpt_codes(
    request: CPTDetectionRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    raw = ""
    try:
        user_id = _resolve_bearer_user_id(authorization)
        clinic_id = request.clinic_id.strip()
        note_id = request.note_id.strip()
        _assert_user_has_clinic_access(user_id, clinic_id)

        note_resp = (
            supabase.table("clinical_notes")
            .select("id, clinic_id, subjective, objective, assessment, plan")
            .eq("id", note_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(note_resp)
        note_rows = note_resp.data or []
        if not note_rows:
            raise HTTPException(status_code=404, detail="Note not found")

        note = note_rows[0]
        if str(note.get("clinic_id") or "").strip() != clinic_id:
            raise HTTPException(status_code=403, detail="Note does not belong to this clinic")

        transcript = _build_transcript(note)
        if not any(
            (note.get(k) or "").strip()
            for k in ("subjective", "objective", "assessment", "plan")
        ):
            raise HTTPException(
                status_code=400,
                detail="Note has no SOAP content to analyze",
            )

        fee_resp = (
            supabase.table("clinic_fee_schedules")
            .select("cpt_code, charge, modifiers")
            .eq("clinic_id", clinic_id)
            .eq("is_active", True)
            .execute()
        )
        _handle_supabase_error(fee_resp)
        fee_schedule = fee_resp.data or []
        if not fee_schedule:
            # No fee schedule — detect codes from SOAP content only, without charge data
            fee_schedule_text = "(No fee schedule configured for this clinic — detect CPT codes based on clinical content only)"
            allowed_codes: set[str] = set()
        else:
            allowed_codes = {
                str(row.get("cpt_code") or "").strip().upper()
                for row in fee_schedule
                if isinstance(row, dict)
            }
            fee_schedule_text = "\n".join(
                [
                    f"- {row['cpt_code']}: charge ${row['charge']}, modifiers: {_format_modifiers(row.get('modifiers'))}"
                    for row in fee_schedule
                    if isinstance(row, dict) and row.get("cpt_code")
                ]
            )

        api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY is not configured",
            )

        try:
            import anthropic
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="anthropic package is not installed",
            ) from exc

        client = anthropic.Anthropic(api_key=api_key)
        user_message = (
            f"SOAP Note:\n{transcript}\n\n"
            f"Clinic Fee Schedule:\n{fee_schedule_text}\n\n"
            "Match the treatments in this note to CPT codes from the fee schedule above."
        )

        response = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=1000,
            system=_CPT_DETECTION_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )

        blocks = getattr(response, "content", None) or []
        text_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                text_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                text_parts.append(str(block["text"]))
        raw = "".join(text_parts).strip()

        detected_codes = _extract_json_array(raw)

        # If fee schedule exists, filter to known codes only; otherwise return all detected
        filtered: list[dict[str, Any]] = []
        for item in detected_codes:
            if not isinstance(item, dict):
                continue
            code = str(item.get("cpt_code") or "").strip().upper()
            if not code:
                continue
            if allowed_codes and code not in allowed_codes:
                continue
            filtered.append(item)

        upd = (
            supabase.table("clinical_notes")
            .update({"cpt_codes_detected": filtered})
            .eq("id", note_id)
            .execute()
        )
        _handle_supabase_error(upd)

        return {"success": True, "cpt_codes": filtered}

    except json.JSONDecodeError as exc:
        print(f"JSON parse error: {exc}")
        print(f"Raw Haiku response: {raw}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="AI returned invalid JSON") from exc
    except ValueError as exc:
        print(f"JSON parse error: {exc}")
        print(f"Raw Haiku response: {raw}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="AI returned invalid JSON") from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
