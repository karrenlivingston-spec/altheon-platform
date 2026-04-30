from fastapi import APIRouter, Body, HTTPException, Query

from app.db import supabase

router = APIRouter()


@router.get("")
def get_legal_requests(clinic_id: str = Query(...)):
    result = (
        supabase.table("legal_requests")
        .select("*")
        .eq("clinic_id", clinic_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.patch("/{request_id}/status")
def update_legal_request_status(
    request_id: str,
    clinic_id: str = Query(...),
    body: dict = Body(...),
):
    status = body.get("status")
    if status not in ["pending", "in_progress", "completed"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = (
        supabase.table("legal_requests")
        .update({"status": status})
        .eq("id", request_id)
        .eq("clinic_id", clinic_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Legal request not found")
    return result.data[0]
