"""Diagnostic Intelligence — document upload, OCR, Claude analysis, imaging timeline."""

from __future__ import annotations

import json
import os
import re
import secrets
import traceback
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel, Field

from app.db import supabase
from app.sms import send_sms
from routers.diagnostic_ocr import ALLOWED_MIME, MAX_BYTES, extract_text_from_bytes
from routers.fee_schedule import ClinicUserDep

router = APIRouter()

_BUCKET = "patient-documents"
_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
_TOKEN_TTL_HOURS = 48

_VALID_DOC_TYPES = frozenset(
    {
        "mri_report",
        "xray",
        "pdf_report",
        "photo",
        "insurance_card",
        "id_document",
        "other",
    }
)

_ANALYSIS_SYSTEM = """You are a clinical AI assistant analyzing a medical document for a licensed clinician.

Return ONLY valid JSON with exactly these fields:
{
  "clinician_summary": "Technical clinical summary for the treating clinician",
  "patient_explanation": "Plain language explanation suitable for patient and family",
  "red_flags": ["array of urgent findings requiring immediate attention, empty array if none"],
  "soap_suggestions": {
    "subjective": "Suggested subjective section text based on findings",
    "objective": "Suggested objective findings text",
    "assessment": "Suggested assessment text",
    "plan": "Suggested plan text"
  },
  "body_part": "Identified body part or region",
  "modality": "MRI | Xray | CT | Report | Photo | Other",
  "imaging_date": "YYYY-MM-DD or null if not found"
}"""


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assert_patient_in_clinic(patient_id: str, clinic_id: str) -> None:
    access = (
        supabase.table("patient_clinic_access")
        .select("id")
        .eq("patient_id", patient_id)
        .eq("clinic_id", clinic_id)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(access)
    if not access.data:
        raise HTTPException(status_code=404, detail="Patient not found in clinic")


def _resolve_clinic_user_pk(user_id: str, clinic_id: str) -> Optional[str]:
    resp = (
        supabase.table("clinic_users")
        .select("id")
        .eq("user_id", user_id)
        .eq("clinic_id", clinic_id)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(resp)
    rows = resp.data or []
    if not rows:
        return None
    return str(rows[0].get("id") or "").strip() or None


def _to_e164_us(phone: str) -> str:
    d = "".join(c for c in (phone or "") if c.isdigit())
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    p = (phone or "").strip()
    return p if p.startswith("+") else f"+{d}"


def _storage_path(clinic_id: str, patient_id: str, doc_id: str, file_name: str) -> str:
    safe_name = re.sub(r"[^\w.\-]+", "_", file_name or "file").strip("_") or "file"
    return f"{clinic_id}/{patient_id}/{doc_id}_{safe_name}"


def _upload_to_storage(path: str, data: bytes, content_type: str) -> None:
    try:
        supabase.storage.from_(_BUCKET).upload(
            path,
            data,
            file_options={"content-type": content_type, "upsert": "false"},
        )
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}") from exc


def _download_from_storage(path: str) -> bytes:
    try:
        return supabase.storage.from_(_BUCKET).download(path)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Storage download failed: {exc}") from exc


def _signed_file_url(path: str, expires_in: int = 3600) -> str:
    try:
        res = supabase.storage.from_(_BUCKET).create_signed_url(path, expires_in)
        if isinstance(res, dict):
            return str(res.get("signedURL") or res.get("signed_url") or "")
        signed = getattr(res, "signed_url", None) or getattr(res, "signedURL", None)
        return str(signed or "")
    except Exception:
        traceback.print_exc()
        return ""


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


def _call_claude_analysis(extracted_text: str) -> dict[str, Any]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed") from exc

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=_ANTHROPIC_MODEL,
        max_tokens=2048,
        system=_ANALYSIS_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"Document text:\n{extracted_text[:120000]}",
            }
        ],
    )
    blocks = getattr(message, "content", None) or []
    parts: list[str] = []
    for block in blocks:
        if hasattr(block, "text"):
            parts.append(str(block.text))
        elif isinstance(block, dict) and block.get("text"):
            parts.append(str(block["text"]))
    raw = "".join(parts).strip()
    return _extract_json_object(raw)


def _parse_imaging_date(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in ("null", "none", ""):
        return None
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def _run_document_analysis(
    *,
    document_id: str,
    patient_id: str,
    clinic_id: str,
    storage_path: str,
    mime_type: str,
    file_name: str,
) -> None:
    try:
        data = _download_from_storage(storage_path)
        extracted = extract_text_from_bytes(data, mime_type, file_name)
        if not extracted.strip():
            extracted = "(No extractable text — image or scanned document may require manual review.)"

        ai = _call_claude_analysis(extracted)
        red_flags = ai.get("red_flags") if isinstance(ai.get("red_flags"), list) else []
        red_flags = [str(x).strip() for x in red_flags if str(x).strip()]
        soap = ai.get("soap_suggestions")
        if not isinstance(soap, dict):
            soap = {}

        imaging_date = _parse_imaging_date(ai.get("imaging_date"))
        status = "pending" if red_flags else "analyzed"

        ins = (
            supabase.table("diagnostic_analyses")
            .insert(
                {
                    "patient_id": patient_id,
                    "clinic_id": clinic_id,
                    "document_id": document_id,
                    "clinician_summary": str(ai.get("clinician_summary") or "").strip(),
                    "patient_explanation": str(ai.get("patient_explanation") or "").strip(),
                    "red_flags": red_flags,
                    "soap_suggestions": soap,
                    "imaging_date": imaging_date,
                    "body_part": str(ai.get("body_part") or "").strip() or None,
                    "modality": str(ai.get("modality") or "").strip() or None,
                    "status": status,
                }
            )
            .execute()
        )
        _handle_supabase_error(ins)
        rows = ins.data or []
        if not rows:
            return
        analysis_id = str(rows[0]["id"])
        event_date = imaging_date or date.today().isoformat()
        summary = str(ai.get("clinician_summary") or "").strip()
        if len(summary) > 200:
            summary = summary[:197] + "..."

        supabase.table("imaging_timeline").insert(
            {
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "analysis_id": analysis_id,
                "event_date": event_date,
                "summary": summary or "Diagnostic analysis completed",
            }
        ).execute()
    except Exception:
        traceback.print_exc()


def _create_document_record(
    *,
    patient_id: str,
    clinic_id: str,
    uploaded_by: Optional[str],
    document_type: str,
    file_name: str,
    storage_path: str,
    upload_source: str,
) -> dict[str, Any]:
    ins = (
        supabase.table("patient_documents")
        .insert(
            {
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "uploaded_by": uploaded_by,
                "document_type": document_type,
                "file_name": file_name,
                "file_url": storage_path,
                "upload_source": upload_source,
            }
        )
        .execute()
    )
    _handle_supabase_error(ins)
    rows = ins.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create document record")
    return rows[0]


@router.post("/patients/{patient_id}/documents/upload")
async def upload_patient_document(
    patient_id: str,
    background_tasks: BackgroundTasks,
    user: ClinicUserDep,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    upload_source: str = Form(default="receptionist"),
):
    pid = patient_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    doc_type = document_type.strip().lower()
    if doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document_type")

    src = (upload_source or "receptionist").strip().lower()
    if src not in ("receptionist", "aria", "patient_portal"):
        src = "receptionist"

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 20MB limit")

    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime and mime not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {mime}")

    doc_id = str(uuid.uuid4())
    file_name = (file.filename or "upload").strip()
    path = _storage_path(cid, pid, doc_id, file_name)
    _upload_to_storage(path, raw, mime or "application/octet-stream")

    clinic_user_pk = _resolve_clinic_user_pk(user.user_id, cid)
    row = _create_document_record(
        patient_id=pid,
        clinic_id=cid,
        uploaded_by=clinic_user_pk,
        document_type=doc_type,
        file_name=file_name,
        storage_path=path,
        upload_source=src,
    )
    document_id = str(row["id"])

    background_tasks.add_task(
        _run_document_analysis,
        document_id=document_id,
        patient_id=pid,
        clinic_id=cid,
        storage_path=path,
        mime_type=mime,
        file_name=file_name,
    )

    return {
        "document_id": document_id,
        "status": "uploaded",
        "analysis_status": "analyzing",
    }


@router.get("/patients/{patient_id}/documents")
def list_patient_documents(
    patient_id: str,
    user: ClinicUserDep,
):
    pid = patient_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    resp = (
        supabase.table("patient_documents")
        .select("*")
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .order("created_at", desc=True)
        .execute()
    )
    _handle_supabase_error(resp)
    out = []
    for row in resp.data or []:
        item = dict(row)
        path = str(item.get("file_url") or "")
        if path:
            item["signed_url"] = _signed_file_url(path)
        out.append(item)
    return out


@router.post("/patients/{patient_id}/documents/{document_id}/analyze")
def analyze_patient_document(
    patient_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    user: ClinicUserDep,
):
    pid = patient_id.strip()
    did = document_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    doc_resp = (
        supabase.table("patient_documents")
        .select("*")
        .eq("id", did)
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(doc_resp)
    rows = doc_resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = rows[0]
    path = str(doc.get("file_url") or "")
    background_tasks.add_task(
        _run_document_analysis,
        document_id=did,
        patient_id=pid,
        clinic_id=cid,
        storage_path=path,
        mime_type="application/octet-stream",
        file_name=str(doc.get("file_name") or ""),
    )
    return {"status": "analyzing", "document_id": did}


@router.get("/patients/{patient_id}/diagnostics")
def list_patient_diagnostics(
    patient_id: str,
    user: ClinicUserDep,
):
    pid = patient_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    resp = (
        supabase.table("diagnostic_analyses")
        .select("*, patient_documents(file_name, document_type, created_at)")
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .order("created_at", desc=True)
        .execute()
    )
    _handle_supabase_error(resp)
    return resp.data or []


@router.get("/patients/{patient_id}/imaging-timeline")
def get_imaging_timeline(
    patient_id: str,
    user: ClinicUserDep,
):
    pid = patient_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    resp = (
        supabase.table("imaging_timeline")
        .select("*, diagnostic_analyses(modality, body_part, status)")
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .order("event_date", desc=True)
        .execute()
    )
    _handle_supabase_error(resp)
    return resp.data or []


class ReviewAnalysisBody(BaseModel):
    pass


@router.patch("/patients/{patient_id}/diagnostics/{analysis_id}/review")
def review_diagnostic_analysis(
    patient_id: str,
    analysis_id: str,
    user: ClinicUserDep,
):
    pid = patient_id.strip()
    aid = analysis_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    upd = (
        supabase.table("diagnostic_analyses")
        .update(
            {
                "status": "reviewed",
                "reviewed_by": user.user_id,
                "reviewed_at": _now_iso(),
            }
        )
        .eq("id", aid)
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .execute()
    )
    _handle_supabase_error(upd)
    rows = upd.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return rows[0]


def _create_upload_token(patient_id: str, clinic_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=_TOKEN_TTL_HOURS)
    supabase.table("document_upload_tokens").insert(
        {
            "token": token,
            "patient_id": patient_id,
            "clinic_id": clinic_id,
            "expires_at": expires.isoformat(),
        }
    ).execute()
    return token


def _validate_upload_token(token: str) -> dict[str, str]:
    tok = token.strip()
    if not tok:
        raise HTTPException(status_code=400, detail="Invalid token")

    resp = (
        supabase.table("document_upload_tokens")
        .select("*")
        .eq("token", tok)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(resp)
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Upload link expired or invalid")

    row = rows[0]
    if row.get("used_at"):
        raise HTTPException(status_code=410, detail="Upload link already used")

    exp_raw = row.get("expires_at")
    if exp_raw:
        exp = datetime.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=410, detail="Upload link expired")

    return {
        "patient_id": str(row.get("patient_id") or ""),
        "clinic_id": str(row.get("clinic_id") or ""),
        "token": tok,
    }


@router.post("/patients/{patient_id}/documents/send-upload-link")
def send_document_upload_link(
    patient_id: str,
    user: ClinicUserDep,
):
    """Aria / staff: SMS patient a secure pre-appointment document upload link."""
    pid = patient_id.strip()
    cid = user.clinic_id
    _assert_patient_in_clinic(pid, cid)

    pt = (
        supabase.table("patients")
        .select("id, first_name, phone")
        .eq("id", pid)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(pt)
    prow = (pt.data or [{}])[0]
    phone = str(prow.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Patient has no phone number on file")

    token = _create_upload_token(pid, cid)
    base = (os.environ.get("FRONTEND_URL") or "https://www.altheon.app").rstrip("/")
    link = f"{base}/upload-documents?token={token}"
    first = str(prow.get("first_name") or "there").strip() or "there"
    body = (
        f"Hi {first}! You can securely upload imaging or reports before your visit: {link} "
        "Questions? Reply or call your clinic."
    )

    send_sms(
        _to_e164_us(phone),
        body,
        patient_id=pid,
        message_type="document_upload_link",
    )
    return {"success": True, "token": token, "expires_hours": _TOKEN_TTL_HOURS}


@router.get("/public/document-upload/{token}")
def public_upload_info(token: str):
    ctx = _validate_upload_token(token)
    pt = (
        supabase.table("patients")
        .select("first_name")
        .eq("id", ctx["patient_id"])
        .limit(1)
        .execute()
    )
    _handle_supabase_error(pt)
    first = ""
    if pt.data:
        first = str((pt.data[0] or {}).get("first_name") or "").strip()

    clinic_name = "Your clinic"
    try:
        clinic_resp = (
            supabase.table("clinics")
            .select("brand_name, name")
            .eq("id", ctx["clinic_id"])
            .limit(1)
            .execute()
        )
        _handle_supabase_error(clinic_resp)
        if clinic_resp.data:
            crow = clinic_resp.data[0]
            clinic_name = (
                str(crow.get("brand_name") or crow.get("name") or "").strip()
                or clinic_name
            )
    except Exception:
        traceback.print_exc()

    return {
        "valid": True,
        "patient_first_name": first or "Patient",
        "clinic_name": clinic_name,
        "expires_hours": _TOKEN_TTL_HOURS,
    }


@router.post("/public/document-upload/{token}")
async def public_upload_document(
    token: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type: str = Form(default="other"),
):
    ctx = _validate_upload_token(token)
    pid = ctx["patient_id"]
    cid = ctx["clinic_id"]

    doc_type = document_type.strip().lower()
    if doc_type not in _VALID_DOC_TYPES:
        doc_type = "other"

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 20MB limit")

    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime and mime not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {mime}")

    doc_id = str(uuid.uuid4())
    file_name = (file.filename or "upload").strip()
    path = _storage_path(cid, pid, doc_id, file_name)
    _upload_to_storage(path, raw, mime or "application/octet-stream")

    row = _create_document_record(
        patient_id=pid,
        clinic_id=cid,
        uploaded_by=None,
        document_type=doc_type,
        file_name=file_name,
        storage_path=path,
        upload_source="aria",
    )
    document_id = str(row["id"])

    supabase.table("document_upload_tokens").update(
        {"used_at": _now_iso()}
    ).eq("token", ctx["token"]).execute()

    background_tasks.add_task(
        _run_document_analysis,
        document_id=document_id,
        patient_id=pid,
        clinic_id=cid,
        storage_path=path,
        mime_type=mime,
        file_name=file_name,
    )

    return {"success": True, "document_id": document_id, "analysis_status": "analyzing"}


# Aria voice agent tool endpoint (same secret as intake webhook)
@router.post("/patients/{patient_id}/documents/aria-send-upload-link")
def aria_send_upload_link(
    patient_id: str,
    clinic_id: str = Query(..., min_length=1),
    x_intake_secret: Optional[str] = Header(default=None, alias="X-Intake-Secret"),
):
    expected = (os.environ.get("INTAKE_SECRET") or "").strip()
    if not expected or x_intake_secret != expected:
        raise HTTPException(status_code=403, detail="Forbidden")

    pid = patient_id.strip()
    cid = clinic_id.strip()
    _assert_patient_in_clinic(pid, cid)

    pt = (
        supabase.table("patients")
        .select("id, first_name, phone")
        .eq("id", pid)
        .limit(1)
        .execute()
    )
    _handle_supabase_error(pt)
    prow = (pt.data or [{}])[0]
    phone = str(prow.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Patient has no phone number")

    token = _create_upload_token(pid, cid)
    base = (os.environ.get("FRONTEND_URL") or "https://www.altheon.app").rstrip("/")
    link = f"{base}/upload-documents?token={token}"
    first = str(prow.get("first_name") or "there").strip() or "there"
    body = (
        f"Hi {first}! I can help you share imaging before your appointment. "
        f"Upload securely here: {link}"
    )

    send_sms(_to_e164_us(phone), body, patient_id=pid, message_type="aria_document_upload")
    return {"success": True, "sms_sent": True}
