"""Ambient scribe / SOAP dictation (Whisper + Claude).

Required environment variables:
- OPENAI_API_KEY — OpenAI Whisper API for audio transcription
- ANTHROPIC_API_KEY — Anthropic API for Claude Haiku SOAP structuring
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

router = APIRouter()

_CLAUDE_MODEL = "claude-haiku-4-5-20251001"

_SOAP_SYSTEM = """You are a clinical documentation assistant. You will receive a transcript of a \
conversation between a clinician and a patient. Extract the clinical content and \
structure it into a SOAP note with four clearly labeled sections: Subjective, \
Objective, Assessment, and Plan. Be concise and clinical. Do not include anything \
that was not said in the transcript. If a section cannot be determined from the \
transcript, return an empty string for that field."""


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

    pattern = re.compile(
        r"(?im)^\s*(Subjective|Objective|Assessment|Plan)\s*:\s*",
    )
    matches = list(pattern.finditer(text))
    if not matches:
        return out

    for i, m in enumerate(matches):
        label = m.group(1).strip().lower()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end].strip()
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


@router.post("/soap-dictation/transcribe-and-generate")
async def transcribe_and_generate(
    audio: UploadFile = File(..., description="Recorded session audio"),
    clinic_id: str = Form(...),
    patient_id: str = Form(default=""),
):
    """Transcribe audio with Whisper, then structure into SOAP with Claude Haiku."""
    _ = clinic_id.strip()
    _ = (patient_id or "").strip()

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

        openai_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if not openai_key:
            raise HTTPException(
                status_code=500,
                detail="OPENAI_API_KEY is not configured",
            )

        try:
            from openai import OpenAI

            oai = OpenAI(api_key=openai_key)
            with open(tmp_path, "rb") as audio_file:
                transcription = oai.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Whisper transcription failed: {exc}",
            ) from exc

        transcript = str(getattr(transcription, "text", None) or "").strip()
        if not transcript:
            raise HTTPException(
                status_code=500,
                detail="Whisper returned an empty transcript",
            )

        try:
            soap_raw = _claude_soap_from_transcript(transcript)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Claude SOAP generation failed: {exc}",
            ) from exc

        sections = _parse_soap_sections(soap_raw)

        return {
            "transcript": transcript,
            "subjective": sections["subjective"],
            "objective": sections["objective"],
            "assessment": sections["assessment"],
            "plan": sections["plan"],
            "status": "success",
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
