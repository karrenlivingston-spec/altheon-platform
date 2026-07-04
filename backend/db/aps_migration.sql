-- APS (Athlete Performance Score) — Kinvent force-plate sessions and findings.
-- Run once in Supabase SQL Editor. Wrapped in a transaction; rollback-safe IF NOT EXISTS guards.

BEGIN;

CREATE TABLE IF NOT EXISTS public.aps_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinician_id uuid REFERENCES public.clinicians (id) ON DELETE SET NULL,
  session_date date NOT NULL,
  source_filename text,
  raw_extracted_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS aps_sessions_patient_id_idx
  ON public.aps_sessions (patient_id);

CREATE INDEX IF NOT EXISTS aps_sessions_clinic_id_idx
  ON public.aps_sessions (clinic_id);

CREATE TABLE IF NOT EXISTS public.aps_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aps_session_id uuid NOT NULL REFERENCES public.aps_sessions (id) ON DELETE CASCADE,
  test_type text NOT NULL,
  metric_name text NOT NULL,
  left_value numeric,
  right_value numeric,
  unit text,
  asymmetry_pct numeric,
  is_notable boolean NOT NULL DEFAULT false,
  confidence_tier text,
  recommended_next_test text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aps_findings_aps_session_id_idx
  ON public.aps_findings (aps_session_id);

COMMIT;
