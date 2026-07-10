#!/usr/bin/env python3
"""One-off seed for Dr. West STTPDN exercise protocol phases.

Usage (Render Shell or local with env vars):
  python scripts/seed_exercise_protocols.py

Inserts the 5-phase rehab/performance library for clinic STTPDN.
Safe to delete after running once. Re-run skips if phases already exist
unless EXERCISE_PROTOCOLS_FORCE=1.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import supabase

STTPDN_CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50"

PHASES: list[dict] = [
    {
        "name": "Phase 1 — Neuromuscular Re-education",
        "phase_number": 1,
        "exercises": [
            "ARP-assisted isometric Bulgarian split squat",
            "wall sits with abduction",
            "Spanish squats",
            "single-leg RDL holds",
            "heel raise isometrics",
            "Copenhagen planks",
            "Pallof press holds",
            "farmer carries",
        ],
    },
    {
        "name": "Phase 2 — Controlled Dynamic Strength",
        "phase_number": 2,
        "exercises": [
            "dynamic Bulgarian split squats",
            "eccentric step-downs",
            "reverse lunges to knee drive",
            "cable hip rotation",
            "lateral band walks",
            "single-leg press",
        ],
    },
    {
        "name": "Phase 3 — Landing Mechanics",
        "phase_number": 3,
        "exercises": [
            "snap downs",
            "box landings",
            "single-leg step-offs",
            "lateral stick landings",
            "single-leg medicine ball catches",
            "BOSU perturbation training",
        ],
    },
    {
        "name": "Phase 4 — Reactive Strength",
        "phase_number": 4,
        "exercises": [
            "pogo jumps",
            "hurdle hops",
            "drop jumps",
            "split squat jumps",
            "skater bounds",
            "continuous countermovement jumps",
        ],
    },
    {
        "name": "Phase 5 — Tennis-Specific Performance",
        "phase_number": 5,
        "exercises": [
            "forehand/backhand bounds",
            "open and closed stance push-offs",
            "serve loading drills",
            "tennis reaction drills",
            "repeated single-leg CMJ practice",
            "progressive single-leg drop jump exposure",
        ],
    },
]


def _already_seeded() -> bool:
    resp = (
        supabase.table("exercise_protocols")
        .select("id")
        .eq("clinic_id", STTPDN_CLINIC_ID)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def main() -> None:
    force = (os.environ.get("EXERCISE_PROTOCOLS_FORCE") or "").strip() == "1"
    if _already_seeded() and not force:
        print(
            f"Exercise protocols already exist for clinic {STTPDN_CLINIC_ID}; "
            "skipping (set EXERCISE_PROTOCOLS_FORCE=1 to re-seed)."
        )
        return

    if force and _already_seeded():
        supabase.table("exercise_protocols").delete().eq(
            "clinic_id", STTPDN_CLINIC_ID
        ).execute()
        print(f"Cleared existing protocols for clinic {STTPDN_CLINIC_ID}")

    for phase in PHASES:
        ins = (
            supabase.table("exercise_protocols")
            .insert(
                {
                    "clinic_id": STTPDN_CLINIC_ID,
                    "name": phase["name"],
                    "phase_number": phase["phase_number"],
                    "description": None,
                    "created_by_clinician_id": None,
                }
            )
            .execute()
        )
        rows = ins.data or []
        if not rows:
            raise RuntimeError(f"Failed to insert protocol: {phase['name']}")
        protocol_id = rows[0]["id"]

        exercise_rows = [
            {
                "protocol_id": protocol_id,
                "exercise_name": name,
                "sets": None,
                "reps": None,
                "frequency": None,
                "notes": None,
                "sort_order": idx,
            }
            for idx, name in enumerate(phase["exercises"])
        ]
        supabase.table("protocol_exercises").insert(exercise_rows).execute()
        print(
            f"Seeded {phase['name']} ({len(exercise_rows)} exercises, id={protocol_id})"
        )

    print("Done.")


if __name__ == "__main__":
    main()
