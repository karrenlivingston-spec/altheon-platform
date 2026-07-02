"""Auth user email lookups without supabase.auth.admin (Render IPv4 safe)."""

from __future__ import annotations

import os

import jwt as pyjwt
import requests


def get_email_from_token(authorization: str) -> str:
    if not authorization:
        return ""
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        return ""
    try:
        payload = pyjwt.decode(token, options={"verify_signature": False})
    except Exception:
        return ""
    email = payload.get("email", "")
    return str(email or "").strip()


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
