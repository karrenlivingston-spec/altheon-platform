"""Clinician profile lookups for the logged-in user."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.db import supabase
from app.utils.auth_users import get_email_from_token

router = APIRouter()


@router.get("/me")
def get_my_clinician(request: Request):
    authorization = request.headers.get("Authorization")
    email = get_email_from_token(authorization or "")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    resp = (
        supabase.table("clinicians")
        .select("id, first_name, last_name, email")
        .eq("email", email)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Clinician not found")
    return resp.data[0]
