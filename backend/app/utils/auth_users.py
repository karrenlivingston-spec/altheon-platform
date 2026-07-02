"""Auth user email lookups without supabase.auth.admin (Render IPv4 safe)."""

from __future__ import annotations

import os

import jwt as pyjwt
import requests


def _extract_bearer_token_from_header(authorization: str) -> str:
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return ""
    return parts[1].strip()


def get_email_from_token(authorization: str) -> str:
    """Extract email from Supabase JWT payload (no HTTP call)."""
    if not authorization:
        return ""
    token = _extract_bearer_token_from_header(authorization)
    if not token:
        return ""
    try:
        payload = pyjwt.decode(token, options={"verify_signature": False})
    except Exception:
        return ""
    email = str(payload.get("email") or "").strip()
    if not email:
        user_metadata = payload.get("user_metadata")
        if isinstance(user_metadata, dict):
            email = str(user_metadata.get("email") or "").strip()
    return email


def get_user_id_from_token(authorization: str) -> str:
    """Extract auth user UUID from Supabase JWT sub claim (no HTTP call)."""
    if not authorization:
        return ""
    token = _extract_bearer_token_from_header(authorization)
    if not token:
        return ""
    try:
        payload = pyjwt.decode(token, options={"verify_signature": False})
    except Exception:
        return ""
    return str(payload.get("sub") or "").strip()


def get_user_email_by_id(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        return ""
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not service_key:
        return ""
    url = f"{supabase_url}/auth/v1/admin/users/{uid}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            return str(resp.json().get("email") or "").strip()
    except Exception:
        pass
    return ""
