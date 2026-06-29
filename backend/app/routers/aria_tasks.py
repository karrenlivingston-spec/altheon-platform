"""Aria-triggered urgent task creation."""

from __future__ import annotations

import json
import os
import re
import traceback
from typing import Any, Optional

import anthropic
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.routers.tasks import create_task_record

router = APIRouter()

_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
_CLASSIFIER_PROMPT = (
    "You are a clinical task classifier for a physical therapy clinic. "
    "Given this call transcript summary, generate a short urgent task title "
    "(max 10 words) and a brief description of what requires urgent attention. "
    'Respond in JSON only: {"title": "...", "description": "..."}'
)


class AriaUrgentTaskBody(BaseModel):
    transcript_summary: str = Field(..., min_length=1)
    caller_phone: Optional[str] = None
    patient_id: Optional[str] = None


def _verify_intake_secret(x_intake_secret: Optional[str]) -> None:
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="INTAKE_SECRET is not configured")
    provided = (x_intake_secret or "").strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid intake secret")


def _extract_json_object(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("response is not a JSON object")
    return data


def _classify_urgent_task(transcript_summary: str) -> dict[str, str]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY is not configured")

    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=256,
            system=_CLASSIFIER_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": transcript_summary.strip(),
                }
            ],
        )
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Classification failed: {exc}") from exc

    parts = getattr(response, "content", None) or []
    raw = ""
    for part in parts:
        text = getattr(part, "text", None)
        if text:
            raw += text
        elif isinstance(part, dict) and part.get("text"):
            raw += str(part.get("text"))

    try:
        payload = _extract_json_object(raw)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail="Failed to parse classifier response") from exc

    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    if not title:
        title = "Urgent call follow-up required"
    if not description:
        description = transcript_summary.strip()
    words = title.split()
    if len(words) > 10:
        title = " ".join(words[:10])
    return {"title": title, "description": description}


@router.post("/urgent-task/{clinic_id}")
def create_aria_urgent_task(
    clinic_id: str,
    body: AriaUrgentTaskBody,
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    _verify_intake_secret(x_intake_secret)
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    classified = _classify_urgent_task(body.transcript_summary)
    description = classified["description"]
    if body.caller_phone and body.caller_phone.strip():
        description = f"{description}\n\nCaller phone: {body.caller_phone.strip()}"

    try:
        return create_task_record(
            cid,
            title=classified["title"],
            description=description,
            priority="urgent",
            source="aria",
            assigned_to=None,
            created_by=None,
            patient_id=body.patient_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
