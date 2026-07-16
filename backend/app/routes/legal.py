import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import supabase
from app.retry_utils import supabase_execute

router = APIRouter()


class LegalRequestPayload(BaseModel):
    clinic_id: str
    attorney_name: str
    firm_name: str
    attorney_phone: str
    attorney_email: Optional[str] = None
    patient_name: str
    request_type: str
    notes: Optional[str] = None


def _send_legal_request_email(payload: LegalRequestPayload) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT")
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    clinic_email = os.getenv("CLINIC_EMAIL")

    required = [smtp_host, smtp_port, smtp_user, smtp_password, clinic_email]
    if not all(required):
        print("Warning: SMTP env vars missing; skipping legal request email notification.")
        return

    subject = f"Legal Request — {payload.patient_name} — {payload.request_type}"
    body = (
        "A new legal request was submitted.\n\n"
        "Attorney Details\n"
        f"- Name: {payload.attorney_name}\n"
        f"- Firm: {payload.firm_name}\n"
        f"- Phone: {payload.attorney_phone}\n"
        f"- Email: {payload.attorney_email or 'N/A'}\n\n"
        "Request Details\n"
        f"- Clinic ID: {payload.clinic_id}\n"
        f"- Patient Name: {payload.patient_name}\n"
        f"- Request Type: {payload.request_type}\n"
        f"- Notes: {payload.notes or 'N/A'}\n"
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_user
    message["To"] = clinic_email
    message.set_content(body)

    with smtplib.SMTP(smtp_host, int(smtp_port), timeout=30) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(message)


@router.post("/legal-request")
def create_legal_request(payload: LegalRequestPayload):
    insert_payload = {
        "clinic_id": payload.clinic_id,
        "attorney_name": payload.attorney_name,
        "firm_name": payload.firm_name,
        "attorney_phone": payload.attorney_phone,
        "attorney_email": payload.attorney_email,
        "patient_name": payload.patient_name,
        "request_type": payload.request_type,
        "requesting_party_name": payload.attorney_name,
        "requesting_party_type": "attorney",
        "request_date": datetime.now(timezone.utc).date().isoformat(),
        "request_method": "email",
        "documents_requested": [],
        "notes": payload.notes,
        "status": "received",
        "source": "ai",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        insert_resp = supabase_execute(
            lambda: supabase.table("legal_requests")
            .insert(insert_payload)
            .execute()
        )
        rows = insert_resp.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create legal request")
        request_id = rows[0].get("id")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        _send_legal_request_email(payload)
    except Exception as exc:
        print(f"Warning: failed to send legal request email: {exc}")

    return {
        "success": True,
        "request_id": request_id,
        "message": "Legal request logged. Clinic has been notified.",
    }
