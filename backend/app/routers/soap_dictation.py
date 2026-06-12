"""Ambient scribe / SOAP dictation (ElevenLabs Scribe + Claude).

Required environment variables:
- ELEVENLABS_API_KEY — ElevenLabs Scribe API for audio transcription
- ANTHROPIC_API_KEY — Anthropic API for Claude Haiku SOAP structuring
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.db import supabase

logger = logging.getLogger(__name__)

router = APIRouter()

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"

_SPECIAL_TESTS_SYSTEM = """You are a clinical data extraction assistant. Extract any orthopedic \
special test results mentioned in the following physical therapy \
session transcript. Return ONLY valid JSON, no markdown, no preamble.

Format:
{
  "special_tests": [
    {
      "test_name": "Lachman Test",
      "result": "Positive",
      "clinician_notes": "end feel soft"
    }
  ]
}

Only include tests that were explicitly mentioned with a result \
(positive, negative, normal, abnormal). \
Map "normal" and "intact" to "Negative". \
Map "abnormal", "present", "elicited" to "Positive". \
If no tests are mentioned, return { "special_tests": [] }."""

_SOAP_SYSTEM = """You are a clinical documentation assistant. You will receive a transcript of a \
conversation between a clinician and a patient. Extract the clinical content and \
structure it into a SOAP note with four clearly labeled sections: Subjective, \
Objective, Assessment, and Plan. Be concise and clinical. Do not include anything \
that was not said in the transcript. If a section cannot be determined from the \
transcript, return an empty string for that field."""

_SOAP_MERGE_SYSTEM = """You are a physical therapy documentation assistant. \
Return ONLY valid JSON with keys subjective, objective, assessment, plan. \
No markdown, no preamble."""

_SOAP_FIELDS = ("subjective", "objective", "assessment", "plan")


def _parse_soap_sections(raw: str) -> dict[str, str]:
    """Split model output on Subjective:/Objective:/Assessment:/Plan: headers."""
    out: dict[str, str] = {
        "subjective": "",
        "objective": "",
        "assessment": "",
        "plan": "",
    }
    text = (raw or "").strip()
    if not text:
        return out

    # Strip optional markdown code fence
    fence = re.match(r"^```(?:\w*)?\s*\n?([\s\S]*?)\n?```\s*$", text)
    if fence:
        text = fence.group(1).strip()

    # Allow markdown: e.g. "### Subjective:", "**Subjective:**" (colon may be inside bold).
    pattern = re.compile(
        r"(?im)^\s*"
        r"(?:#{1,6}\s+)?"
        r"(?:\*\*)?"
        r"(Subjective|Objective|Assessment|Plan)"
        r"\s*:"
        r"(?:\*\*)?"
        r"\s*",
    )
    matches = list(pattern.finditer(text))
    if not matches:
        # Headings like "### Subjective" with body on following lines (no colon on header line).
        heading_pat = re.compile(
            r"(?im)^\s*(?:#{1,6}\s+)(?:\*\*)?(Subjective|Objective|Assessment|Plan)(?:\*\*)?\s*$",
        )
        matches = list(heading_pat.finditer(text))
    if not matches:
        return out

    for i, m in enumerate(matches):
        label = m.group(1).strip().lower()
        start = m.end()
        chunk = text[start : matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        chunk = chunk.strip()
        if label in out:
            out[label] = chunk
    return out


def _claude_soap_from_transcript(transcript: str) -> str:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed") from exc

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=_CLAUDE_MODEL,
        max_tokens=4096,
        system=_SOAP_SYSTEM,
        messages=[
            {"role": "user", "content": f"Transcript: {transcript}"},
        ],
    )

    blocks = getattr(message, "content", None) or []
    text_parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            text_parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            text_parts.append(str(block["text"]))
    return "".join(text_parts).strip()


def _fetch_clinical_note(note_id: str) -> Optional[dict[str, Any]]:
    if not note_id:
        return None
    try:
        resp = (
            supabase.table("clinical_notes")
            .select("id,status,subjective,objective,assessment,plan")
            .eq("id", note_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        logger.exception("failed to fetch note for SOAP merge note_id=%s", note_id)
        return None


def _note_has_soap_content(note: dict[str, Any]) -> bool:
    for field in _SOAP_FIELDS:
        if str(note.get(field) or "").strip():
            return True
    return False


def _should_merge_soap(note: Optional[dict[str, Any]]) -> bool:
    if not note:
        return False
    status = str(note.get("status") or "").strip().lower()
    if status == "signed":
        return False
    return _note_has_soap_content(note)


def _soap_sections_from_json_payload(payload: dict[str, Any]) -> dict[str, str]:
    return {
        field: str(payload.get(field) or "").strip()
        for field in _SOAP_FIELDS
    }


def _claude_merge_soap_from_transcript(
    transcript: str,
    existing: dict[str, str],
) -> dict[str, str]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed") from exc

    user_content = (
        "You are a physical therapy documentation assistant.\n"
        "A clinician has already documented the following SOAP note for this session:\n\n"
        "EXISTING NOTE:\n"
        f"Subjective: {existing.get('subjective', '')}\n"
        f"Objective: {existing.get('objective', '')}\n"
        f"Assessment: {existing.get('assessment', '')}\n"
        f"Plan: {existing.get('plan', '')}\n\n"
        "The clinician has now recorded an additional portion of the session covering "
        "a different body region or complaint. Here is the new transcript:\n\n"
        "NEW TRANSCRIPT:\n"
        f"{transcript}\n\n"
        "Generate an updated, merged SOAP note that combines BOTH the existing note "
        "content AND the new transcript findings into one cohesive note. Do not drop "
        "any information from the existing note. Add the new findings naturally. "
        "Return JSON with keys: subjective, objective, assessment, plan."
    )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=_CLAUDE_MODEL,
        max_tokens=4096,
        system=_SOAP_MERGE_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
    )

    blocks = getattr(message, "content", None) or []
    text_parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            text_parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            text_parts.append(str(block["text"]))
    raw = "".join(text_parts).strip()
    payload = _extract_json_payload(raw)
    return _soap_sections_from_json_payload(payload)


_POSITIVE_SYNONYMS = frozenset({"positive", "abnormal", "present", "elicited"})
_NEGATIVE_SYNONYMS = frozenset({"negative", "normal", "intact"})


def _normalize_test_result(raw: Any) -> Optional[str]:
    v = str(raw or "").strip().lower()
    if v in _POSITIVE_SYNONYMS:
        return "Positive"
    if v in _NEGATIVE_SYNONYMS:
        return "Negative"
    return None


def _extract_json_payload(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    return json.loads(text)


def _claude_extract_special_tests(transcript: str) -> list[dict[str, Any]]:
    """Second Haiku call: structured special test extraction.

    Never raises — any failure (API, malformed JSON) is logged and an empty
    list is returned so SOAP generation is unaffected.
    """
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        return []

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=2048,
            system=_SPECIAL_TESTS_SYSTEM,
            messages=[{"role": "user", "content": transcript}],
        )
        blocks = getattr(message, "content", None) or []
        text_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                text_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                text_parts.append(str(block["text"]))
        raw = "".join(text_parts).strip()
        payload = _extract_json_payload(raw)
    except Exception:
        logger.exception("special test extraction failed")
        return []

    tests = payload.get("special_tests")
    if not isinstance(tests, list):
        logger.warning("special test extraction: unexpected payload shape")
        return []

    out: list[dict[str, Any]] = []
    for item in tests:
        if not isinstance(item, dict):
            continue
        name = str(item.get("test_name") or "").strip()
        result = _normalize_test_result(item.get("result"))
        if not name or not result:
            continue
        out.append(
            {
                "test_name": name,
                "result": result,
                "clinician_notes": str(item.get("clinician_notes") or "").strip(),
            }
        )
    return out


def _match_special_tests(
    extracted: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Map extracted test names to orthopedic_special_tests rows (case-insensitive)."""
    if not extracted:
        return []
    try:
        resp = (
            supabase.table("orthopedic_special_tests")
            .select("id,test_name")
            .execute()
        )
        rows = resp.data or []
    except Exception:
        logger.exception("special test catalog lookup failed")
        return []

    # First occurrence wins for duplicate names across regions (e.g. Valgus Stress Test).
    by_name: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("test_name") or "").strip().lower()
        if key and key not in by_name:
            by_name[key] = row

    matched: list[dict[str, Any]] = []
    for item in extracted:
        row = by_name.get(item["test_name"].lower())
        if not row:
            continue
        matched.append(
            {
                "test_id": str(row.get("id") or ""),
                "test_name": str(row.get("test_name") or item["test_name"]),
                "result": item["result"],
                "clinician_notes": item["clinician_notes"] or None,
            }
        )
    return matched


def _upsert_note_special_tests(
    note_id: str, matched: list[dict[str, Any]]
) -> None:
    if not note_id or not matched:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "note_id": note_id,
            "test_id": m["test_id"],
            "result": m["result"],
            "clinician_notes": m["clinician_notes"],
            "updated_at": now,
        }
        for m in matched
    ]
    try:
        supabase.table("note_special_test_results").upsert(
            rows, on_conflict="note_id,test_id"
        ).execute()
    except Exception:
        logger.exception(
            "auto-save of special test results failed note_id=%s", note_id
        )


def _elevenlabs_transcribe_file(tmp_path: str) -> str:
    eleven_key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    if not eleven_key:
        raise HTTPException(
            status_code=500,
            detail="ELEVENLABS_API_KEY is not configured",
        )

    try:
        with open(tmp_path, "rb") as fp:
            resp = requests.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": eleven_key},
                data={"model_id": "scribe_v1"},
                files={
                    "file": (
                        Path(tmp_path).name,
                        fp,
                        "application/octet-stream",
                    ),
                },
                timeout=300,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ElevenLabs transcription failed: {exc}",
        ) from exc

    if not resp.ok:
        raise HTTPException(
            status_code=500,
            detail=(
                f"ElevenLabs transcription failed: HTTP {resp.status_code} "
                f"{resp.text[:2000]}"
            ),
        )

    try:
        payload = resp.json()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ElevenLabs returned invalid JSON: {exc}",
        ) from exc

    transcript = str(payload.get("text") or "").strip()
    if not transcript:
        raise HTTPException(
            status_code=500,
            detail="ElevenLabs returned an empty transcript",
        )
    return transcript


async def _transcribe_upload(audio: UploadFile) -> str:
    suffix = Path(audio.filename or "audio").suffix
    if not suffix or len(suffix) > 10:
        suffix = ".bin"

    tmp_path: str | None = None
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty audio upload")

        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)

        return _elevenlabs_transcribe_file(tmp_path)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@router.post("/soap-dictation/transcribe")
async def transcribe_only(
    audio: UploadFile = File(..., description="Recorded audio"),
    clinic_id: str = Form(default=""),
):
    """Transcribe audio with ElevenLabs Scribe; returns transcript text only."""
    _ = (clinic_id or "").strip()
    transcript = await _transcribe_upload(audio)
    return {"transcript": transcript}


@router.post("/soap-dictation/transcribe-and-generate")
async def transcribe_and_generate(
    audio: UploadFile = File(..., description="Recorded session audio"),
    clinic_id: str = Form(...),
    patient_id: str = Form(default=""),
    note_id: str = Form(default=""),
):
    """Transcribe audio with ElevenLabs Scribe, then structure into SOAP with Claude Haiku."""
    _ = clinic_id.strip()
    _ = (patient_id or "").strip()
    nid = (note_id or "").strip()

    transcript = await _transcribe_upload(audio)

    existing_note = _fetch_clinical_note(nid) if nid else None
    merge_existing = _should_merge_soap(existing_note)

    try:
        if merge_existing and existing_note:
            sections = _claude_merge_soap_from_transcript(
                transcript,
                {
                    "subjective": str(existing_note.get("subjective") or ""),
                    "objective": str(existing_note.get("objective") or ""),
                    "assessment": str(existing_note.get("assessment") or ""),
                    "plan": str(existing_note.get("plan") or ""),
                },
            )
        else:
            soap_raw = _claude_soap_from_transcript(transcript)
            sections = _parse_soap_sections(soap_raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Claude SOAP generation failed: {exc}",
        ) from exc

    # Second Haiku pass: orthopedic special test extraction. Best-effort —
    # never blocks SOAP generation.
    matched: list[dict[str, Any]] = []
    try:
        extracted = _claude_extract_special_tests(transcript)
        matched = _match_special_tests(extracted)
        if nid:
            _upsert_note_special_tests(nid, matched)
    except Exception:
        logger.exception("special test pipeline failed")
        matched = []

    return {
        "transcript": transcript,
        "subjective": sections["subjective"],
        "objective": sections["objective"],
        "assessment": sections["assessment"],
        "plan": sections["plan"],
        "auto_populated_special_tests": [m["test_name"] for m in matched],
        # Full matched payload so the frontend can save results once the
        # note draft exists (the scribe runs before the note is created).
        "special_test_results": matched,
        "status": "success",
    }
