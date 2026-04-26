from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from app.db import supabase
from app.routers import slots, appointments

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


@app.get("/")
def root():
    return {"status": "Altheon API is running"}


@app.get("/health")
def health():
    supabase.table("clinics").select("id").limit(1).execute()
    return {"status": "ok", "supabase": "connected"}
