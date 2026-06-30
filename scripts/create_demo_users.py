#!/usr/bin/env python3
"""One-off script to create demo Supabase auth users and clinic_users rows."""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env")
load_dotenv()

from app.db import supabase

CLINIC_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

DEMO_USERS = [
    {"email": "dr.chen@vitalitysportswellness.com", "password": "TempPass123!"},
    {"email": "dr.rivera@vitalitysportswellness.com", "password": "TempPass123!"},
]


def _extract_user_id(auth_res) -> str:
    user_obj = getattr(auth_res, "user", None)
    if user_obj is None and isinstance(auth_res, dict):
        user_obj = auth_res.get("user")
    uid = str(getattr(user_obj, "id", None) or "").strip()
    if not uid and isinstance(user_obj, dict):
        uid = str(user_obj.get("id") or "").strip()
    if not uid:
        raise RuntimeError("Auth user was created but no user id was returned")
    return uid


def main() -> None:
    user_ids: list[str] = []

    for spec in DEMO_USERS:
        email = spec["email"]
        print(f"Creating auth user: {email}")
        auth_res = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": spec["password"],
                "email_confirm": True,
            }
        )
        user_id = _extract_user_id(auth_res)
        print(f"  user_id={user_id}")
        user_ids.append(user_id)

    rows = [
        {"clinic_id": CLINIC_ID, "user_id": user_ids[0], "role": "clinician"},
        {"clinic_id": CLINIC_ID, "user_id": user_ids[1], "role": "clinician"},
    ]

    print("Inserting clinic_users rows...")
    result = supabase.table("clinic_users").insert(rows).execute()
    inserted = getattr(result, "data", None) or []
    print(f"  Inserted {len(inserted)} row(s):")
    for row in inserted:
        print(
            f"    clinic_id={row['clinic_id']} "
            f"user_id={row['user_id']} "
            f"role={row['role']}"
        )
    print("Done.")


if __name__ == "__main__":
    main()
