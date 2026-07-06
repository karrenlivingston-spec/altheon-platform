"""Clinic-level reference documents (Protocols) — upload, list, download, delete."""

from __future__ import annotations

import re
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile

from app.db import supabase
from app.dependencies.permissions import (
    ADMIN_ROLES,
    CLINICAL_ROLES,
    enforce_clinic_role_from_auth_header,
)

router = APIRouter()

_BUCKET = "clinic-documents"
_MAX_BYTES = 20 * 1024 * 1024
_ALLOWED_MIME = frozenset({"application/pdf"})
_VALID_VISIBILITY = frozenset({"clinical", "admin_only"})


def _handle_supabase_error(response: Any) -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        raise HTTPException(status_code=500, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _storage_path(clinic_id: str, doc_id: str, file_name: str) -> str:
    safe_name = re.sub(r"[^\w.\-]+", "_", file_name or "file").strip("_") or "file"
    return f"{clinic_id}/{doc_id}_{safe_name}"


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


def _signed_file_url(path: str, expires_in: int = 3600) -> str:
    try:
        res = supabase.storage.from_(_BUCKET).create_signed_url(path, expires_in)
        if isinstance(res, dict):
            url = str(res.get("signedURL") or res.get("signed_url") or "").strip()
            if url:
                return url
        signed = getattr(res, "signed_url", None) or getattr(res, "signedURL", None)
        url = str(signed or "").strip()
        if url:
            return url
    except Exception:
        traceback.print_exc()
    raise HTTPException(status_code=500, detail="Could not create signed download URL")


def _resolve_clinic_user_pk(user_id: str, clinic_id: str) -> Optional[str]:
    try:
        resp = (
            supabase.table("clinic_users")
            .select("id")
            .eq("user_id", user_id)
            .eq("clinic_id", clinic_id)
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
        return None
    pk = str(rows[0].get("id") or "").strip()
    return pk or None


def _shape_document_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "clinic_id": row.get("clinic_id"),
        "title": row.get("title"),
        "category": row.get("category"),
        "storage_path": row.get("storage_path"),
        "uploaded_by": row.get("uploaded_by"),
        "visibility": row.get("visibility"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _get_document_or_404(doc_id: str, clinic_id: str) -> dict[str, Any]:
    try:
        resp = (
            supabase.table("clinic_reference_documents")
            .select("*")
            .eq("id", doc_id)
            .eq("clinic_id", clinic_id)
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
        raise HTTPException(status_code=404, detail="Document not found")
    return dict(rows[0])


@router.post("/clinic-documents")
async def upload_clinic_document(
    file: UploadFile = File(...),
    clinic_id: str = Form(...),
    title: str = Form(...),
    category: Optional[str] = Form(default=None),
    visibility: str = Form(default="clinical"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *ADMIN_ROLES,
    )
    cid = auth.clinic_id

    doc_title = (title or "").strip()
    if not doc_title:
        raise HTTPException(status_code=400, detail="title is required")

    vis = (visibility or "clinical").strip().lower()
    if vis not in _VALID_VISIBILITY:
        raise HTTPException(
            status_code=400,
            detail="visibility must be one of: clinical, admin_only",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 20MB limit")

    mime = (file.content_type or "").split(";")[0].strip().lower()
    file_name = (file.filename or "document.pdf").strip()
    if not file_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    if mime and mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {mime}")

    doc_id = str(uuid.uuid4())
    path = _storage_path(cid, doc_id, file_name)
    _upload_to_storage(path, raw, mime or "application/pdf")

    uploaded_by = _resolve_clinic_user_pk(auth.user_id, cid)
    now = _now_iso()
    category_val = (category or "").strip() or None

    try:
        ins = (
            supabase.table("clinic_reference_documents")
            .insert(
                {
                    "id": doc_id,
                    "clinic_id": cid,
                    "title": doc_title,
                    "category": category_val,
                    "storage_path": path,
                    "uploaded_by": uploaded_by,
                    "visibility": vis,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            .execute()
        )
        _handle_supabase_error(ins)
    except HTTPException:
        try:
            supabase.storage.from_(_BUCKET).remove([path])
        except Exception:
            traceback.print_exc()
        raise
    except Exception as exc:
        try:
            supabase.storage.from_(_BUCKET).remove([path])
        except Exception:
            traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ins.data or []
    if not rows:
        try:
            supabase.storage.from_(_BUCKET).remove([path])
        except Exception:
            traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to create document record")

    return _shape_document_row(dict(rows[0]))


@router.get("/clinic-documents")
def list_clinic_documents(
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *CLINICAL_ROLES,
    )
    cid = auth.clinic_id

    try:
        resp = (
            supabase.table("clinic_reference_documents")
            .select(
                "id, clinic_id, title, category, storage_path, "
                "uploaded_by, visibility, created_at, updated_at"
            )
            .eq("clinic_id", cid)
            .order("created_at", desc=True)
            .execute()
        )
        _handle_supabase_error(resp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return [_shape_document_row(dict(row)) for row in (resp.data or [])]


@router.get("/clinic-documents/{doc_id}/download")
def download_clinic_document(
    doc_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *CLINICAL_ROLES,
    )
    cid = auth.clinic_id
    did = doc_id.strip()
    if not did:
        raise HTTPException(status_code=400, detail="Invalid document id")

    doc = _get_document_or_404(did, cid)
    path = str(doc.get("storage_path") or "").strip()
    if not path:
        raise HTTPException(status_code=500, detail="Document has no storage path")

    signed_url = _signed_file_url(path)
    return {
        "document_id": did,
        "signed_url": signed_url,
        "expires_in": 3600,
    }


@router.delete("/clinic-documents/{doc_id}")
def delete_clinic_document(
    doc_id: str,
    clinic_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    auth = enforce_clinic_role_from_auth_header(
        authorization,
        clinic_id,
        *ADMIN_ROLES,
    )
    cid = auth.clinic_id
    did = doc_id.strip()
    if not did:
        raise HTTPException(status_code=400, detail="Invalid document id")

    doc = _get_document_or_404(did, cid)
    path = str(doc.get("storage_path") or "").strip()

    if path:
        try:
            supabase.storage.from_(_BUCKET).remove([path])
        except Exception:
            traceback.print_exc()

    try:
        dele = (
            supabase.table("clinic_reference_documents")
            .delete()
            .eq("id", did)
            .eq("clinic_id", cid)
            .execute()
        )
        _handle_supabase_error(dele)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"success": True, "document_id": did}
