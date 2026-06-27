import os

import requests

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "info@altheon.app")
RESEND_FROM_NAME = os.getenv("RESEND_FROM_NAME", "Altheon")


def send_email(
    to_email: str,
    subject: str,
    html_body: str,
    from_email: str | None = None,
    from_name: str | None = None,
) -> dict:
    """
    Send an email via Resend API.
    from_email and from_name allow per-clinic override for branded sending.
    Uses requests library (not httpx).
    """
    sender_email = from_email or RESEND_FROM_EMAIL
    sender_name = from_name or RESEND_FROM_NAME

    response = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        },
    )
    return response.json()
