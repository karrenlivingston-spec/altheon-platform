"""Clinical SOAP notes API (mounted under /api)."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.dependencies.permissions import (
    CLINICAL_ROLES,
    enforce_clinic_role_from_auth_header,
    require_role,
)

router = APIRouter(dependencies=[Depends(require_role(*CLINICAL_ROLES))])

_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

_SOAP_REVIEW_SYSTEM = """You are a clinical documentation reviewer for physical therapy \
and chiropractic notes. Review the submitted SOAP note and determine if it meets \
documentation standards.

Respond ONLY with valid JSON in this exact format:
{
  "passed": true/false,
  "feedback": "specific feedback string or empty string if passed"
}

A note PASSES if ALL of these are true:
- All four SOAP sections (Subjective, Objective, Assessment, Plan) are present and \
contain substantive content (not blank or single words)
- Objective section contains measurable data such as ROM measurements, strength \
grades (0-5), pain scores, or functional measures
- Assessment provides clinical reasoning that connects the subjective and objective \
findings
- Plan section contains specific interventions (not vague language like \
'continue treatment')

A note FAILS if any section is missing, blank, or lacks clinical specificity. \
List each specific issue in the feedback."""


_EXTRACT_MEASUREMENTS_SYSTEM = """You are a physical therapy documentation assistant. Extract any measurable clinical values from the transcript and return ONLY a JSON object with this exact structure:
{
  "body_part": "shoulder|cervical|hip|knee|lumbar|wrist_elbow or null",
  "pain_nrs": number or null (0-10),
  "rom": {
    "flexion": {"left_active": number|null, "left_passive": number|null, "right_active": number|null, "right_passive": number|null},
    "extension": {"left_active": number|null, "left_passive": number|null, "right_active": number|null, "right_passive": number|null},
    "abduction": {"left_active": number|null, "left_passive": number|null, "right_active": number|null, "right_passive": number|null}
  },
  "strength": {},
  "notes": "any other relevant clinical observations not captured above or null"
}
Return null for any value not mentioned in the transcript. Return ONLY the JSON, no preamble."""

_VALID_BODY_PARTS = frozenset(
    {"shoulder", "cervical", "hip", "knee", "lumbar", "wrist_elbow"}
)


def _default_rom_side() -> dict[str, Optional[float]]:
    return {
        "left_active": None,
        "left_passive": None,
        "right_active": None,
        "right_passive": None,
    }


def _default_extracted_measurements() -> dict[str, Any]:
    return {
        "body_part": None,
        "pain_nrs": None,
        "rom": {
            "flexion": _default_rom_side(),
            "extension": _default_rom_side(),
            "abduction": _default_rom_side(),
        },
        "strength": {},
        "notes": None,
    }


def _normalize_rom_motion(value: Any) -> dict[str, Optional[float]]:
    base = _default_rom_side()
    if not isinstance(value, dict):
        return base
    for key in base:
        raw = value.get(key)
        if raw is None:
            continue
        try:
            base[key] = float(raw)
        except (TypeError, ValueError):
            continue
    return base


def _normalize_extracted_measurements(data: Any) -> dict[str, Any]:
    out = _default_extracted_measurements()
    if not isinstance(data, dict):
        return out

    body_part = data.get("body_part")
    if body_part is not None:
        bp = str(body_part).strip().lower()
        if bp in _VALID_BODY_PARTS:
            out["body_part"] = bp

    pain = data.get("pain_nrs")
    if pain is not None:
        try:
            pain_nrs = int(float(pain))
            if 0 <= pain_nrs <= 10:
                out["pain_nrs"] = pain_nrs
        except (TypeError, ValueError):
            pass

    rom_in = data.get("rom")
    if isinstance(rom_in, dict):
        for motion in ("flexion", "extension", "abduction"):
            out["rom"][motion] = _normalize_rom_motion(rom_in.get(motion))

    strength = data.get("strength")
    if isinstance(strength, dict):
        out["strength"] = strength

    notes = data.get("notes")
    if notes is not None:
        note_text = str(notes).strip()
        out["notes"] = note_text or None

    return out


def _call_claude_extract_measurements(transcript: str) -> dict[str, Any]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        return _default_extracted_measurements()

    try:
        import anthropic
    except ImportError:
        return _default_extracted_measurements()

    text = (transcript or "").strip()
    if not text:
        return _default_extracted_measurements()

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=2048,
            system=_EXTRACT_MEASUREMENTS_SYSTEM,
            messages=[{"role": "user", "content": text}],
        )
        blocks = getattr(message, "content", None) or []
        raw_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                raw_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                raw_parts.append(str(block["text"]))
        raw = "".join(raw_parts).strip()
        if not raw:
            return _default_extracted_measurements()
        data = _extract_json_object(raw)
        return _normalize_extracted_measurements(data)
    except Exception:
        import traceback

        traceback.print_exc()
        return _default_extracted_measurements()


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_json_object(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    # Fallback: first {...} block
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    return json.loads(text)


def _call_claude_review_soap(
    subjective: str,
    objective: str,
    assessment: str,
    plan: str,
) -> tuple[bool, str]:
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

    user_msg = (
        f"Subjective: {subjective}\n"
        f"Objective: {objective}\n"
        f"Assessment: {assessment}\n"
        f"Plan: {plan}"
    )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=_ANTHROPIC_MODEL,
        max_tokens=2048,
        system=_SOAP_REVIEW_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )

    blocks = getattr(message, "content", None) or []
    text_parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            text_parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            text_parts.append(str(block["text"]))
    raw = "".join(text_parts).strip()

    try:
        data = _extract_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI review returned invalid JSON: {exc}",
        ) from exc

    passed = bool(data.get("passed"))
    feedback = data.get("feedback")
    if feedback is None:
        feedback = ""
    return passed, str(feedback)


def _patient_display_name(row: dict[str, Any]) -> str:
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "—"


def _clinician_display_name(row: Optional[dict[str, Any]]) -> str:
    """clinicians.first_name + " " + last_name, or "Unknown" when unmatched."""
    if not row:
        return "Unknown"
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    return f"{fn} {ln}".strip() or "Unknown"


def _load_clinic_users_map(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    """clinic_users rows keyed by id (clinical_notes.author_id / supervising_pt_id)."""
    by_id: dict[str, dict[str, Any]] = {}
    if not user_ids:
        return by_id

    try:
        resp = (
            supabase.table("clinic_users")
            .select("*")
            .in_("id", user_ids)
            .execute()
        )
        _handle_supabase_error(resp)
        for row in resp.data or []:
            if isinstance(row, dict) and row.get("id"):
                by_id[str(row["id"])] = row
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return by_id


def _load_clinicians_map(clinician_ids: list[str]) -> dict[str, dict[str, Any]]:
    """clinicians rows keyed by id (fallback via clinic_users.clinician_id when present)."""
    by_id: dict[str, dict[str, Any]] = {}
    if not clinician_ids:
        return by_id

    try:
        resp = (
            supabase.table("clinicians")
            .select("id,first_name,last_name")
            .in_("id", clinician_ids)
            .execute()
        )
        _handle_supabase_error(resp)
        for row in resp.data or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("id") or "").strip()
            if cid:
                by_id[cid] = row
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return by_id


def _resolve_clinic_user_name(
    row: Optional[dict[str, Any]],
    clinicians_by_id: dict[str, dict[str, Any]],
) -> str:
    """Display label for a clinic_users.id; Unknown only when the row is missing."""
    if not row:
        return "Unknown"
    fn = str(row.get("first_name") or "").strip()
    ln = str(row.get("last_name") or "").strip()
    combined = f"{fn} {ln}".strip()
    if combined:
        return combined
    single = str(row.get("name") or "").strip()
    if single:
        return single
    email = str(row.get("email") or "").strip()
    if email:
        return email
    clinician_id = str(row.get("clinician_id") or "").strip()
    if clinician_id:
        clinician_name = _clinician_display_name(clinicians_by_id.get(clinician_id))
        if clinician_name != "Unknown":
            return clinician_name
    return "—"


def _enrich_notes_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    patient_ids = list(
        {str(r["patient_id"]) for r in rows if r.get("patient_id")}
    )
    author_ids = list({str(r["author_id"]) for r in rows if r.get("author_id")})
    supervising_ids = list(
        {
            str(r["supervising_pt_id"])
            for r in rows
            if r.get("supervising_pt_id")
        }
    )

    patients_map: dict[str, dict[str, Any]] = {}
    try:
        if patient_ids:
            presp = (
                supabase.table("patients")
                .select("id,first_name,last_name")
                .in_("id", patient_ids)
                .execute()
            )
            _handle_supabase_error(presp)
            for pr in presp.data or []:
                if isinstance(pr, dict) and pr.get("id"):
                    patients_map[str(pr["id"])] = pr
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    clinic_user_ids = list({*author_ids, *supervising_ids})
    clinic_users_by_id = _load_clinic_users_map(clinic_user_ids)
    linked_clinician_ids = list(
        {
            str(cu.get("clinician_id") or "").strip()
            for cu in clinic_users_by_id.values()
            if str(cu.get("clinician_id") or "").strip()
        }
    )
    clinicians_by_id = _load_clinicians_map(linked_clinician_ids)

    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        pid = str(r.get("patient_id") or "")
        aid = str(r.get("author_id") or "")
        spid = str(r.get("supervising_pt_id") or "").strip()
        pt = patients_map.get(pid)
        item["patient_name"] = _patient_display_name(pt) if pt else "—"
        item["author_name"] = _resolve_clinic_user_name(
            clinic_users_by_id.get(aid), clinicians_by_id
        )
        if spid:
            item["supervising_pt_name"] = _resolve_clinic_user_name(
                clinic_users_by_id.get(spid), clinicians_by_id
            )
        out.append(item)
    return out


_AI_PIPELINE_STATUSES = frozenset(
    {
        "ai_review_pending",
        "ready_for_review",
        "ai_flagged",
        "needs_correction",
    }
)
_NEEDS_REVIEW_STATUSES = frozenset(
    {"ready_for_review", "needs_correction", "ai_flagged"}
)


def _patient_pt_id(patient_id: str) -> str:
    tail = str(patient_id or "").replace("-", "")[-6:].upper()
    return f"PT-{tail}" if tail else "—"


def _is_ai_generated(row: dict[str, Any]) -> bool:
    if row.get("ai_reviewed_at"):
        return True
    return str(row.get("status") or "") in _AI_PIPELINE_STATUSES


def _review_status_label(row: dict[str, Any]) -> Optional[str]:
    st = str(row.get("status") or "")
    if st in _NEEDS_REVIEW_STATUSES:
        return "needs_review"
    if st == "signed":
        return "reviewed"
    return None


def _signature_status_label(row: dict[str, Any]) -> str:
    if row.get("signed_at") or str(row.get("status") or "") == "signed":
        return "signed"
    return "not_signed"


def _trend_pct(current: int, previous: int) -> Optional[float]:
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


def _created_in_range(row: dict[str, Any], start: date, end: date) -> bool:
    raw = row.get("created_at")
    if not raw:
        return False
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        d = dt.date()
        return start <= d <= end
    except ValueError:
        return False


def _load_appointments_map(appointment_ids: list[str]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    ids = [i for i in appointment_ids if i]
    if not ids:
        return by_id
    try:
        resp = (
            supabase.table("appointments")
            .select("id,start_time,clinician_id")
            .in_("id", ids)
            .execute()
        )
        _handle_supabase_error(resp)
        for row in resp.data or []:
            if isinstance(row, dict) and row.get("id"):
                by_id[str(row["id"])] = row
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return by_id


def _enrich_notes_for_list(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched = _enrich_notes_rows(rows)
    appt_ids = list(
        {str(r.get("appointment_id") or "") for r in enriched if r.get("appointment_id")}
    )
    appt_map = _load_appointments_map(appt_ids)
    out: list[dict[str, Any]] = []
    for item in enriched:
        shaped = dict(item)
        pid = str(item.get("patient_id") or "")
        shaped["patient_pt_id"] = _patient_pt_id(pid)
        appt_id = str(item.get("appointment_id") or "")
        appt = appt_map.get(appt_id)
        shaped["visit_date"] = (
            appt.get("start_time") if appt else item.get("created_at")
        )
        shaped["body_region"] = item.get("body_region")
        shaped["clinician_name"] = (
            item.get("supervising_pt_name")
            or item.get("author_name")
            or "—"
        )
        shaped["ai_generated"] = _is_ai_generated(item)
        shaped["review_status"] = _review_status_label(item)
        shaped["signature_status"] = _signature_status_label(item)
        shaped["attorney_requested"] = False
        shaped["attorney_request_date"] = None
        out.append(shaped)
    return out


def _fetch_clinic_notes_rows(clinic_id: str) -> list[dict[str, Any]]:
    resp = (
        supabase.table("clinical_notes")
        .select("*")
        .eq("clinic_id", clinic_id)
        .execute()
    )
    _handle_supabase_error(resp)
    return [r for r in (resp.data or []) if isinstance(r, dict)]


@router.get("/clinical-notes/stats")
def get_clinical_notes_stats(clinic_id: str = Query(..., min_length=1)):
    cid = clinic_id.strip()
    try:
        today = date.today()
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)

        rows = _fetch_clinic_notes_rows(cid)

        def in_last_month(r: dict[str, Any]) -> bool:
            return _created_in_range(r, last_month_start, last_month_end)

        total = len(rows)
        ai_generated = sum(1 for r in rows if _is_ai_generated(r))
        needs_review = sum(
            1 for r in rows if str(r.get("status") or "") in _NEEDS_REVIEW_STATUSES
        )
        provider_signed = sum(
            1 for r in rows if str(r.get("status") or "") == "signed"
        )
        attorney_requested = 0

        total_last = sum(1 for r in rows if in_last_month(r))
        ai_last = sum(1 for r in rows if in_last_month(r) and _is_ai_generated(r))
        review_last = sum(
            1
            for r in rows
            if in_last_month(r)
            and str(r.get("status") or "") in _NEEDS_REVIEW_STATUSES
        )
        signed_last = sum(
            1
            for r in rows
            if in_last_month(r) and str(r.get("status") or "") == "signed"
        )
        attorney_last = 0

        completed = provider_signed

        # Insights
        ai_reviewed_rows = [r for r in rows if r.get("ai_reviewed_at")]
        ai_passed = sum(
            1
            for r in ai_reviewed_rows
            if str(r.get("status") or "") not in ("ai_flagged", "needs_correction")
        )
        ai_acceptance_rate = (
            round((ai_passed / len(ai_reviewed_rows)) * 100, 1)
            if ai_reviewed_rows
            else 0.0
        )

        turnaround_days: list[float] = []
        for r in rows:
            if not r.get("signed_at") or not r.get("ai_reviewed_at"):
                continue
            try:
                signed = datetime.fromisoformat(
                    str(r["signed_at"]).replace("Z", "+00:00")
                )
                reviewed = datetime.fromisoformat(
                    str(r["ai_reviewed_at"]).replace("Z", "+00:00")
                )
                delta = (signed - reviewed).total_seconds() / 86400
                if delta >= 0:
                    turnaround_days.append(delta)
            except ValueError:
                continue
        review_turnaround_days = (
            round(sum(turnaround_days) / len(turnaround_days), 1)
            if turnaround_days
            else 0.0
        )

        signed_within_48h = 0
        signed_total = 0
        for r in rows:
            if str(r.get("status") or "") != "signed" or not r.get("signed_at"):
                continue
            signed_total += 1
            try:
                created = datetime.fromisoformat(
                    str(r.get("created_at") or "").replace("Z", "+00:00")
                )
                signed = datetime.fromisoformat(
                    str(r["signed_at"]).replace("Z", "+00:00")
                )
                if (signed - created).total_seconds() <= 48 * 3600:
                    signed_within_48h += 1
            except ValueError:
                continue
        signature_compliance_48h_pct = (
            round((signed_within_48h / signed_total) * 100, 1)
            if signed_total
            else 0.0
        )

        ai_by_type: dict[str, int] = {}
        for r in rows:
            if not _is_ai_generated(r):
                continue
            nt = str(r.get("note_type") or "other")
            ai_by_type[nt] = ai_by_type.get(nt, 0) + 1
        ai_type_total = sum(ai_by_type.values()) or 1
        top_ai_types = sorted(
            [
                {
                    "note_type": k,
                    "count": v,
                    "pct": round((v / ai_type_total) * 100, 1),
                }
                for k, v in ai_by_type.items()
            ],
            key=lambda x: -x["count"],
        )[:5]

        daily_counts: list[int] = []
        for offset in range(29, -1, -1):
            d = today - timedelta(days=offset)
            daily_counts.append(
                sum(1 for r in rows if _created_in_range(r, d, d))
            )

        return {
            "total_notes": total,
            "ai_generated": ai_generated,
            "ai_generated_pct": round((ai_generated / total * 100) if total else 0),
            "needs_review": needs_review,
            "provider_signed": provider_signed,
            "provider_signed_pct": round(
                (provider_signed / total * 100) if total else 0
            ),
            "attorney_requested": attorney_requested,
            "completed": completed,
            "tab_counts": {
                "all": total,
                "needs_review": needs_review,
                "ai_generated": ai_generated,
                "provider_signed": provider_signed,
                "attorney_requested": attorney_requested,
                "completed": completed,
            },
            "trends": {
                "total": _trend_pct(total, total_last),
                "ai_generated": _trend_pct(ai_generated, ai_last),
                "needs_review": _trend_pct(needs_review, review_last),
                "provider_signed": _trend_pct(provider_signed, signed_last),
                "attorney_requested": _trend_pct(attorney_requested, attorney_last),
            },
            "insights": {
                "ai_acceptance_rate": ai_acceptance_rate,
                "ai_acceptance_trend": None,
                "ai_daily_counts": daily_counts,
                "top_ai_note_types": top_ai_types,
                "review_turnaround_days": review_turnaround_days,
                "review_turnaround_trend": None,
                "signature_compliance_48h_pct": signature_compliance_48h_pct,
                "signature_compliance_trend": None,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Clinical notes stats failed: {exc}"
        ) from exc


def _note_matches_filters(
    row: dict[str, Any],
    *,
    review_status: Optional[str],
    signature_status: Optional[str],
    ai_generated: Optional[bool],
    attorney_requested: Optional[bool],
    note_type: Optional[str],
    clinician_id: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
    search: Optional[str],
    enriched: Optional[dict[str, Any]] = None,
) -> bool:
    item = enriched or row
    if review_status:
        rs = str(review_status).strip().lower()
        label = _review_status_label(row)
        if rs == "needs_review" and label != "needs_review":
            return False
        if rs == "reviewed" and label != "reviewed":
            return False
    if signature_status:
        ss = str(signature_status).strip().lower()
        label = _signature_status_label(row)
        if ss == "signed" and label != "signed":
            return False
        if ss in ("not_signed", "unsigned") and label != "not_signed":
            return False
    if ai_generated is not None:
        if _is_ai_generated(row) != ai_generated:
            return False
    if attorney_requested is not None:
        if bool(attorney_requested) is True:
            return False
    if note_type and str(note_type).strip().lower() not in ("", "all"):
        if str(row.get("note_type") or "").lower() != str(note_type).strip().lower():
            return False
    if clinician_id and str(clinician_id).strip():
        cid = str(clinician_id).strip()
        if str(row.get("supervising_pt_id") or "") != cid and str(
            row.get("author_id") or ""
        ) != cid:
            return False
    if date_from:
        try:
            start = date.fromisoformat(str(date_from)[:10])
            if not _created_in_range(row, start, date.max):
                raw = row.get("created_at")
                if raw:
                    dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                    if dt.date() < start:
                        return False
        except ValueError:
            pass
    if date_to:
        try:
            end = date.fromisoformat(str(date_to)[:10])
            raw = row.get("created_at")
            if raw:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if dt.date() > end:
                    return False
        except ValueError:
            pass
    if search and str(search).strip():
        q = str(search).strip().lower()
        hay = " ".join(
            [
                str(item.get("patient_name") or ""),
                str(item.get("note_type") or ""),
                str(item.get("clinician_name") or ""),
                str(item.get("patient_pt_id") or ""),
            ]
        ).lower()
        if q not in hay and q not in hay.replace("_", " "):
            return False
    return True


@router.get("/clinical-notes")
def list_clinical_notes(
    clinic_id: str = Query(..., min_length=1),
    author_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    review_status: Optional[str] = Query(default=None),
    signature_status: Optional[str] = Query(default=None),
    ai_generated: Optional[bool] = Query(default=None),
    attorney_requested: Optional[bool] = Query(default=None),
    note_type: Optional[str] = Query(default=None),
    clinician_id: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
):
    cid = clinic_id.strip()
    try:
        q = supabase.table("clinical_notes").select("*").eq("clinic_id", cid)
        if status and str(status).strip():
            q = q.eq("status", str(status).strip())
        if author_id and str(author_id).strip():
            resolved = _author_id_for_clinical_notes_filter(
                cid, str(author_id).strip()
            )
            q = q.eq("author_id", resolved)
        if note_type and str(note_type).strip().lower() not in ("", "all", "other"):
            q = q.eq("note_type", str(note_type).strip().lower())
        if clinician_id and str(clinician_id).strip():
            q = q.eq("supervising_pt_id", str(clinician_id).strip())
        if date_from:
            q = q.gte("created_at", f"{str(date_from)[:10]}T00:00:00")
        if date_to:
            q = q.lte("created_at", f"{str(date_to)[:10]}T23:59:59")
        resp = q.order("created_at", desc=True).execute()
        _handle_supabase_error(resp)
        raw_rows = [r for r in (resp.data or []) if isinstance(r, dict)]

        enriched_all = _enrich_notes_for_list(raw_rows)
        paired = list(zip(raw_rows, enriched_all))
        filtered_pairs = [
            (raw, enr)
            for raw, enr in paired
            if _note_matches_filters(
                raw,
                review_status=review_status,
                signature_status=signature_status,
                ai_generated=ai_generated,
                attorney_requested=attorney_requested,
                note_type=note_type,
                clinician_id=None if clinician_id else None,
                date_from=None,
                date_to=None,
                search=search,
                enriched=enr,
            )
        ]
        if clinician_id and str(clinician_id).strip():
            cid_filter = str(clinician_id).strip()
            filtered_pairs = [
                (raw, enr)
                for raw, enr in filtered_pairs
                if str(raw.get("supervising_pt_id") or "") == cid_filter
                or str(raw.get("author_id") or "") == cid_filter
            ]

        total_count = len(filtered_pairs)
        start = (page - 1) * page_size
        page_pairs = filtered_pairs[start : start + page_size]
        notes = [enr for _, enr in page_pairs]

        return {
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
            "notes": notes,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Clinical notes list failed: {exc}"
        ) from exc


_PATCHABLE_STATUSES = frozenset({"draft", "ai_flagged", "needs_correction"})
_BLOCKED_PATCH_STATUSES = frozenset(
    {"ai_review_pending", "ready_for_review", "signed"}
)


class CreateClinicalNoteBody(BaseModel):
    patient_id: str
    clinic_id: str
    author_id: str
    supervising_pt_id: Optional[str] = None
    appointment_id: Optional[str] = None
    note_type: Optional[str] = None
    body_region: Optional[str] = None
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None


class PatchClinicalNoteBody(BaseModel):
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    supervising_pt_id: Optional[str] = None
    note_type: Optional[str] = None
    body_region: Optional[str] = None


class SignNoteBody(BaseModel):
    signed_by: str = Field(..., min_length=1)


class RequestCorrectionBody(BaseModel):
    correction_notes: str = Field(..., min_length=1)


_NOTE_TYPES = frozenset(
    {
        "daily_note",
        "initial_evaluation",
        "progress_note",
        "discharge_note",
    }
)


def _validate_note_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.strip().lower()
    if v not in _NOTE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid note_type; allowed: {sorted(_NOTE_TYPES)}",
        )
    return v


def _resolve_clinic_users_pk(
    raw_id: str,
    clinic_id: str,
    *,
    not_found_detail: str,
) -> str:
    """Map Supabase auth user_id or clinic_users.id to clinic_users.id for this clinic."""
    key = raw_id.strip()
    cid = clinic_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Invalid clinic user reference")

    try:
        by_id = (
            supabase.table("clinic_users")
            .select("id")
            .eq("id", key)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(by_id)
        rows = by_id.data or []
        if rows:
            rid = str(rows[0].get("id") or "").strip()
            if rid:
                return rid

        by_uid = (
            supabase.table("clinic_users")
            .select("id")
            .eq("user_id", key)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(by_uid)
        rows = by_uid.data or []
        if rows:
            rid = str(rows[0].get("id") or "").strip()
            if rid:
                return rid
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    raise HTTPException(status_code=404, detail=not_found_detail)


@router.post("/clinical-notes")
def create_clinical_note(
    body: CreateClinicalNoteBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    patient_id = body.patient_id.strip()
    clinic_id = body.clinic_id.strip()
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)
    author_id = body.author_id.strip()
    if not patient_id or not clinic_id or not author_id:
        raise HTTPException(
            status_code=400,
            detail="patient_id, clinic_id, and author_id are required",
        )

    nt = _validate_note_type(body.note_type)

    resolved_author = _resolve_clinic_users_pk(
        author_id,
        clinic_id,
        not_found_detail="Author not found in clinic users",
    )

    row: dict[str, Any] = {
        "patient_id": patient_id,
        "clinic_id": clinic_id,
        "author_id": resolved_author,
        "status": "draft",
    }
    if nt:
        row["note_type"] = nt
    if body.supervising_pt_id is not None:
        s = body.supervising_pt_id.strip()
        if s:
            row["supervising_pt_id"] = _resolve_clinic_users_pk(
                s,
                clinic_id,
                not_found_detail="Supervising PT not found in clinic users",
            )
    if body.appointment_id is not None:
        a = body.appointment_id.strip()
        if a:
            row["appointment_id"] = a
    if body.body_region is not None:
        br = body.body_region.strip()
        if br:
            row["body_region"] = br.lower()
    for key in ("subjective", "objective", "assessment", "plan"):
        val = getattr(body, key)
        if val is not None:
            row[key] = val

    try:
        ins = supabase.table("clinical_notes").insert(row).execute()
        _handle_supabase_error(ins)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Insert returned no row")
    return rows[0]


class ExtractMeasurementsBody(BaseModel):
    transcript: str = ""
    appointment_id: str = ""
    clinic_id: str = ""
    patient_id: str = ""


# NOTE: must be registered before GET /clinical-notes/{note_id} so the literal
# "extract-measurements" segment is not captured as a note_id.
@router.post("/clinical-notes/extract-measurements")
def extract_measurements_from_transcript(
    body: ExtractMeasurementsBody,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    clinic_id = body.clinic_id.strip()
    if not clinic_id:
        raise HTTPException(status_code=400, detail="clinic_id is required")
    enforce_clinic_role_from_auth_header(authorization, clinic_id, *CLINICAL_ROLES)

    try:
        return _call_claude_extract_measurements(body.transcript)
    except HTTPException:
        raise
    except Exception:
        import traceback

        traceback.print_exc()
        return _default_extracted_measurements()


# NOTE: must be registered before GET /clinical-notes/{note_id} so the literal
# "special-tests" segment is not captured as a note_id.
@router.get("/clinical-notes/special-tests")
def list_special_tests_catalog():
    """All orthopedic special tests grouped by region, then subcategory.

    Seed/reference data (not PHI) — no auth required. Null subcategories are
    grouped under "General". Ordering follows seed insertion order (created_at)
    so regions appear in the clinical sequence cervical → functional movement.
    """
    try:
        resp = (
            supabase.table("orthopedic_special_tests")
            .select("id,region,subcategory,test_name")
            .order("created_at")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    regions: list[dict[str, Any]] = []
    region_index: dict[str, dict[str, Any]] = {}

    for row in resp.data or []:
        region = str(row.get("region") or "").strip()
        if not region:
            continue
        subcategory = str(row.get("subcategory") or "").strip() or "General"

        region_entry = region_index.get(region)
        if region_entry is None:
            region_entry = {"region": region, "subcategories": [], "_idx": {}}
            region_index[region] = region_entry
            regions.append(region_entry)

        sub_entry = region_entry["_idx"].get(subcategory)
        if sub_entry is None:
            sub_entry = {"subcategory": subcategory, "tests": []}
            region_entry["_idx"][subcategory] = sub_entry
            region_entry["subcategories"].append(sub_entry)

        sub_entry["tests"].append(
            {
                "id": str(row.get("id") or ""),
                "test_name": str(row.get("test_name") or ""),
            }
        )

    for region_entry in regions:
        region_entry.pop("_idx", None)

    return {"regions": regions}


_SPECIAL_TEST_RESULTS = frozenset({"Positive", "Negative", "Not Tested"})


class SpecialTestResultIn(BaseModel):
    test_id: str = Field(..., min_length=1)
    result: str = Field(default="Not Tested")
    clinician_notes: Optional[str] = None


class SaveSpecialTestsBody(BaseModel):
    results: list[SpecialTestResultIn] = Field(default_factory=list)


def _fetch_note_for_clinic(note_id: str, clinic_id: str) -> dict[str, Any]:
    nid = note_id.strip()
    cid = clinic_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")
    if not cid:
        raise HTTPException(status_code=400, detail="clinic_id is required")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("id,clinic_id")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows or str(rows[0].get("clinic_id") or "").strip() != cid:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return rows[0]


@router.post("/clinical-notes/{note_id}/special-tests")
def save_note_special_tests(
    note_id: str,
    body: SaveSpecialTestsBody,
    clinic_id: str = Query(..., min_length=1),
):
    _fetch_note_for_clinic(note_id, clinic_id)

    nid = note_id.strip()
    rows: list[dict[str, Any]] = []
    for item in body.results:
        result = (item.result or "Not Tested").strip()
        if result not in _SPECIAL_TEST_RESULTS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid result '{result}'; "
                    f"allowed: {sorted(_SPECIAL_TEST_RESULTS)}"
                ),
            )
        notes = (item.clinician_notes or "").strip() or None
        rows.append(
            {
                "note_id": nid,
                "test_id": item.test_id.strip(),
                "result": result,
                "clinician_notes": notes,
                "updated_at": _now_iso(),
            }
        )

    if not rows:
        return {"saved": True, "count": 0}

    try:
        resp = (
            supabase.table("note_special_test_results")
            .upsert(rows, on_conflict="note_id,test_id")
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"saved": True, "count": len(resp.data or rows)}


@router.get("/clinical-notes/{note_id}/special-tests")
def get_note_special_tests(
    note_id: str,
    clinic_id: str = Query(..., min_length=1),
):
    _fetch_note_for_clinic(note_id, clinic_id)

    try:
        resp = (
            supabase.table("note_special_test_results")
            .select(
                "test_id,result,clinician_notes,"
                "orthopedic_special_tests(test_name,region,subcategory)"
            )
            .eq("note_id", note_id.strip())
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    results: list[dict[str, Any]] = []
    for row in resp.data or []:
        test = row.get("orthopedic_special_tests") or {}
        if not isinstance(test, dict):
            test = {}
        results.append(
            {
                "test_id": str(row.get("test_id") or ""),
                "test_name": str(test.get("test_name") or ""),
                "region": str(test.get("region") or ""),
                "subcategory": str(test.get("subcategory") or "") or "General",
                "result": str(row.get("result") or "Not Tested"),
                "clinician_notes": str(row.get("clinician_notes") or ""),
            }
        )

    return {"results": results}


_GOAL_TYPES = frozenset({"short_term", "long_term"})

_SUGGEST_GOALS_SYSTEM = """You are a physical therapy documentation assistant. Based on the \
assessment text, suggest 2-4 measurable therapy goals.

Respond ONLY with a valid JSON array (no markdown):
[
  {"description": "goal text", "goal_type": "short_term" or "long_term", "target_weeks": number or null}
]"""


def _validate_percent_met(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="percent_met must be an integer") from exc
    if n < 0 or n > 100 or n % 5 != 0:
        raise HTTPException(
            status_code=400,
            detail="percent_met must be 0-100 in steps of 5",
        )
    return n


def _shape_goal_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "note_id": str(row.get("note_id") or ""),
        "description": str(row.get("description") or ""),
        "goal_type": str(row.get("goal_type") or "short_term"),
        "target_weeks": row.get("target_weeks"),
        "percent_met": int(row.get("percent_met") or 0),
    }


def _call_claude_suggest_goals(assessment_text: str) -> list[dict[str, Any]]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        return []

    try:
        import anthropic
    except ImportError:
        return []

    text = (assessment_text or "").strip()
    if not text:
        return []

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=2048,
            system=_SUGGEST_GOALS_SYSTEM,
            messages=[{"role": "user", "content": f"Assessment:\n{text}"}],
        )
        blocks = getattr(message, "content", None) or []
        raw_parts: list[str] = []
        for block in blocks:
            if hasattr(block, "text"):
                raw_parts.append(str(block.text))
            elif isinstance(block, dict) and block.get("text"):
                raw_parts.append(str(block["text"]))
        raw = "".join(raw_parts).strip()
        if not raw:
            return []
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
        if fence:
            raw = fence.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            brace = re.search(r"\[[\s\S]*\]", raw)
            if not brace:
                return []
            data = json.loads(brace.group(0))
        if isinstance(data, dict) and "goals" in data:
            data = data["goals"]
        if not isinstance(data, list):
            return []
        out: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            desc = str(item.get("description") or "").strip()
            if not desc:
                continue
            gt = str(item.get("goal_type") or "short_term").strip().lower()
            if gt not in _GOAL_TYPES:
                gt = "short_term"
            tw = item.get("target_weeks")
            target_weeks: Optional[int] = None
            if tw is not None:
                try:
                    target_weeks = int(tw)
                except (TypeError, ValueError):
                    target_weeks = None
            out.append(
                {
                    "description": desc,
                    "goal_type": gt,
                    "target_weeks": target_weeks,
                }
            )
        return out[:4]
    except Exception:
        import traceback

        traceback.print_exc()
        return []


class CreateNoteGoalBody(BaseModel):
    description: str = ""
    goal_type: str = "short_term"
    target_weeks: Optional[int] = None


class PatchNoteGoalBody(BaseModel):
    description: Optional[str] = None
    goal_type: Optional[str] = None
    target_weeks: Optional[int] = None
    percent_met: Optional[int] = None


class SuggestGoalsBody(BaseModel):
    assessment_text: str = ""


@router.get("/clinical-notes/{note_id}/goals")
def list_note_goals(note_id: str):
    try:
        resp = (
            supabase.table("note_goals")
            .select("id,note_id,description,goal_type,target_weeks,percent_met")
            .eq("note_id", note_id.strip())
            .order("created_at")
            .execute()
        )
        _handle_supabase_error(resp)
        return [_shape_goal_row(r) for r in resp.data or [] if isinstance(r, dict)]
    except HTTPException:
        raise
    except Exception:
        import traceback

        traceback.print_exc()
        return []


@router.post("/clinical-notes/{note_id}/goals", status_code=201)
def create_note_goal(note_id: str, body: CreateNoteGoalBody):
    nid = note_id.strip()
    gt = (body.goal_type or "short_term").strip().lower()
    if gt not in _GOAL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid goal_type")

    try:
        note_resp = (
            supabase.table("clinical_notes")
            .select("id")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(note_resp)
        if not (note_resp.data or []):
            raise HTTPException(status_code=404, detail="Clinical note not found")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    row = {
        "note_id": nid,
        "description": (body.description or "").strip() or "New goal",
        "goal_type": gt,
        "target_weeks": body.target_weeks,
        "percent_met": 0,
        "updated_at": _now_iso(),
    }
    try:
        ins = supabase.table("note_goals").insert(row).execute()
        _handle_supabase_error(ins)
        rows = ins.data or []
        if not rows:
            raise HTTPException(status_code=400, detail="Failed to create goal")
        return _shape_goal_row(rows[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/clinical-notes/{note_id}/goals/{goal_id}")
def patch_note_goal(note_id: str, goal_id: str, body: PatchNoteGoalBody):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "goal_type" in data:
        gt = str(data["goal_type"] or "").strip().lower()
        if gt not in _GOAL_TYPES:
            raise HTTPException(status_code=400, detail="Invalid goal_type")
        data["goal_type"] = gt
    if "percent_met" in data and data["percent_met"] is not None:
        data["percent_met"] = _validate_percent_met(data["percent_met"])
    data["updated_at"] = _now_iso()

    try:
        upd = (
            supabase.table("note_goals")
            .update(data)
            .eq("id", goal_id.strip())
            .eq("note_id", note_id.strip())
            .execute()
        )
        _handle_supabase_error(upd)
        rows = upd.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Goal not found")
        return _shape_goal_row(rows[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/clinical-notes/{note_id}/goals/{goal_id}")
def delete_note_goal(note_id: str, goal_id: str):
    try:
        dele = (
            supabase.table("note_goals")
            .delete()
            .eq("id", goal_id.strip())
            .eq("note_id", note_id.strip())
            .execute()
        )
        _handle_supabase_error(dele)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/clinical-notes/{note_id}/suggest-goals")
def suggest_note_goals(note_id: str, body: SuggestGoalsBody):
    nid = note_id.strip()
    try:
        note_resp = (
            supabase.table("clinical_notes")
            .select("id")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(note_resp)
        if not (note_resp.data or []):
            raise HTTPException(status_code=404, detail="Clinical note not found")
    except HTTPException:
        raise
    except Exception:
        import traceback

        traceback.print_exc()
        return []

    try:
        suggestions = _call_claude_suggest_goals(body.assessment_text)
        return suggestions
    except Exception:
        import traceback

        traceback.print_exc()
        return []


@router.get("/clinical-notes/{note_id}")
def get_clinical_note(note_id: str):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return rows[0]


@router.patch("/clinical-notes/{note_id}")
def patch_clinical_note(note_id: str, body: PatchClinicalNoteBody):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    st = str(crows[0].get("status") or "").strip().lower()
    if st in _BLOCKED_PATCH_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit note while status is '{st}'",
        )
    if st not in _PATCHABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit note while status is '{st}'",
        )

    payload = body.model_dump(exclude_unset=True)
    if "note_type" in payload:
        payload["note_type"] = _validate_note_type(payload["note_type"])
    if "body_region" in payload and payload["body_region"] is not None:
        br = str(payload["body_region"]).strip()
        payload["body_region"] = br.lower() if br else None

    data = {k: v for k, v in payload.items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    data["updated_at"] = _now_iso()

    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    try:
        full_resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(full_resp)
        full_rows = full_resp.data or []
        saved = full_rows[0] if full_rows else urows[0]
    except HTTPException:
        saved = urows[0]
    except Exception:
        saved = urows[0]

    return saved


@router.post("/clinical-notes/{note_id}/submit")
def submit_clinical_note(note_id: str):
    nid = note_id.strip()
    if not nid:
        raise HTTPException(status_code=400, detail="Invalid note_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    note = rows[0]
    subjective = str(note.get("subjective") or "")
    objective = str(note.get("objective") or "")
    assessment = str(note.get("assessment") or "")
    plan = str(note.get("plan") or "")

    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured",
        )
    try:
        import anthropic  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="anthropic package is not installed",
        ) from exc

    pending_update = {
        "status": "ai_review_pending",
        "updated_at": _now_iso(),
    }
    try:
        upd_p = (
            supabase.table("clinical_notes")
            .update(pending_update)
            .eq("id", nid)
            .execute()
        )
        _handle_supabase_error(upd_p)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        passed, feedback = _call_claude_review_soap(
            subjective, objective, assessment, plan
        )
    except HTTPException as exc:
        fail_update = {
            "status": "ai_flagged",
            "ai_feedback": (exc.detail if isinstance(exc.detail, str) else str(exc.detail)),
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        try:
            supabase.table("clinical_notes").update(fail_update).eq("id", nid).execute()
        except Exception:
            pass
        raise
    except Exception as exc:
        fail_update = {
            "status": "ai_flagged",
            "ai_feedback": f"Automated review failed: {exc}",
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        try:
            supabase.table("clinical_notes").update(fail_update).eq("id", nid).execute()
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if passed:
        final_update: dict[str, Any] = {
            "status": "ready_for_review",
            "ai_feedback": None,
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    else:
        final_update = {
            "status": "ai_flagged",
            "ai_feedback": feedback,
            "ai_reviewed_at": _now_iso(),
            "updated_at": _now_iso(),
        }

    try:
        upd_f = (
            supabase.table("clinical_notes")
            .update(final_update)
            .eq("id", nid)
            .execute()
        )
        _handle_supabase_error(upd_f)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    out_rows = upd_f.data or []
    if not out_rows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return out_rows[0]


@router.post("/clinical-notes/{note_id}/sign")
def sign_clinical_note(note_id: str, body: SignNoteBody):
    nid = note_id.strip()
    signed_by = body.signed_by.strip()
    if not nid or not signed_by:
        raise HTTPException(status_code=400, detail="note_id and signed_by are required")

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status,clinic_id")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    note_row = crows[0]
    st = str(note_row.get("status") or "").strip().lower()
    if st not in ("ready_for_review", "ai_flagged"):
        raise HTTPException(
            status_code=409,
            detail=f"Note must be in ready_for_review or ai_flagged status to sign (current: {st or 'unknown'})",
        )

    clinic_id_note = str(note_row.get("clinic_id") or "").strip()
    if not clinic_id_note:
        raise HTTPException(status_code=500, detail="Clinical note missing clinic_id")

    resolved_signed_by = _resolve_clinic_users_pk(
        signed_by,
        clinic_id_note,
        not_found_detail="Signing user not found in clinic users",
    )

    data = {
        "status": "signed",
        "signed_at": _now_iso(),
        "signed_by": resolved_signed_by,
        "signed_despite_ai_flag": st == "ai_flagged",
        "updated_at": _now_iso(),
    }
    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return urows[0]


@router.post("/clinical-notes/{note_id}/request-correction")
def request_correction(note_id: str, body: RequestCorrectionBody):
    nid = note_id.strip()
    notes = body.correction_notes.strip()
    if not nid or not notes:
        raise HTTPException(
            status_code=400,
            detail="note_id and correction_notes are required",
        )

    try:
        cur = (
            supabase.table("clinical_notes")
            .select("id,status")
            .eq("id", nid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(cur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    crows = cur.data or []
    if not crows:
        raise HTTPException(status_code=404, detail="Clinical note not found")

    st = str(crows[0].get("status") or "").strip().lower()
    if st != "ready_for_review":
        raise HTTPException(
            status_code=409,
            detail="Note must be in ready_for_review status to request correction",
        )

    data = {
        "status": "needs_correction",
        "correction_notes": notes,
        "updated_at": _now_iso(),
    }
    try:
        upd = supabase.table("clinical_notes").update(data).eq("id", nid).execute()
        _handle_supabase_error(upd)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    urows = upd.data or []
    if not urows:
        raise HTTPException(status_code=404, detail="Clinical note not found")
    return urows[0]


def _author_id_for_clinical_notes_filter(clinic_id: str, author_id: str) -> str:
    """clinical_notes.author_id stores clinic_users.id; accept Supabase auth user_id too."""
    key = author_id.strip()
    cid = clinic_id.strip()
    if not key or not cid:
        return key
    try:
        return _resolve_clinic_users_pk(
            key,
            cid,
            not_found_detail="Author not found in clinic users",
        )
    except HTTPException:
        return key


@router.get("/clinics/{clinic_id}/clinical-notes")
def list_clinic_clinical_notes(
    clinic_id: str,
    status: Optional[str] = Query(default=None),
    author_id: Optional[str] = Query(default=None),
):
    cid = clinic_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Invalid clinic_id")

    try:
        q = supabase.table("clinical_notes").select("*").eq("clinic_id", cid)
        if status is not None and str(status).strip():
            q = q.eq("status", str(status).strip())
        if author_id is not None and str(author_id).strip():
            resolved_author = _author_id_for_clinical_notes_filter(cid, str(author_id).strip())
            q = q.eq("author_id", resolved_author)
        resp = q.order("created_at", desc=True).execute()
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    return _enrich_notes_rows(rows)


@router.get("/patients/{patient_id}/clinical-notes")
def list_patient_clinical_notes(patient_id: str):
    pid = patient_id.strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Invalid patient_id")

    try:
        resp = (
            supabase.table("clinical_notes")
            .select("*")
            .eq("patient_id", pid)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = [r for r in (resp.data or []) if isinstance(r, dict)]
    return _enrich_notes_rows(rows)
