from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import re

from app.db import supabase
from app.routers import slots, appointments, next_available

load_dotenv()

app = FastAPI(title="Altheon API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(slots.router, prefix="/slots", tags=["slots"])
app.include_router(appointments.router, prefix="/appointments", tags=["appointments"])
app.include_router(next_available.router, prefix="/next-available", tags=["next-available"])


@app.get("/")
def root():
    return {"status": "Altheon API is running"}


@app.get("/health")
def health():
    supabase.table("clinics").select("id").limit(1).execute()
    return {"status": "ok", "supabase": "connected"}


@app.get("/patient-lookup")
def patient_lookup(phone: str, clinic_id: str):
    try:
        normalized_phone = re.sub(r"\D", "", phone)

        patient_resp = (
            supabase.table("patients")
            .select("id, first_name, last_name, phone")
            .execute()
        )
        patients = patient_resp.data or []
        patient = next(
            (
                row
                for row in patients
                if re.sub(r"\D", "", str(row.get("phone") or "")) == normalized_phone
            ),
            None,
        )
        if not patient:
            return {"found": False}

        access_resp = (
            supabase.table("patient_clinic_access")
            .select("patient_id")
            .eq("patient_id", patient["id"])
            .eq("clinic_id", clinic_id)
            .limit(1)
            .execute()
        )
        access_rows = access_resp.data or []
        if not access_rows:
            return {"found": False}
        appt_resp = (
            supabase.table("appointments")
            .select("start_time")
            .eq("patient_id", patient["id"])
            .eq("clinic_id", clinic_id)
            .eq("status", "confirmed")
            .order("start_time", desc=True)
            .limit(1)
            .execute()
        )
        appointments = appt_resp.data or []
        last_visit = None
        if appointments:
            start_time = appointments[0].get("start_time")
            if start_time:
                last_visit = start_time[:10]

        return {
            "found": True,
            "first_name": patient.get("first_name"),
            "last_name": patient.get("last_name"),
            "last_visit": last_visit,
        }
    except Exception:
        return {"found": False}
