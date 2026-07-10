-- Exercise protocols (clinic-authored rehab/performance phase libraries).
-- Run once in Supabase SQL Editor. Wrapped in a transaction; rollback-safe IF NOT EXISTS guards.

BEGIN;

CREATE TABLE IF NOT EXISTS public.exercise_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id),
  name text NOT NULL,
  phase_number int NOT NULL,
  description text,
  created_by_clinician_id uuid REFERENCES public.clinicians (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.protocol_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES public.exercise_protocols (id) ON DELETE CASCADE,
  exercise_name text NOT NULL,
  sets int,
  reps int,
  frequency text,
  notes text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS exercise_protocols_clinic_id_idx
  ON public.exercise_protocols (clinic_id);

CREATE INDEX IF NOT EXISTS protocol_exercises_protocol_id_idx
  ON public.protocol_exercises (protocol_id);

-- ---------------------------------------------------------------------------
-- RLS (clinic-scoped, matches clinic_reference_documents / fee_schedule pattern)
-- ---------------------------------------------------------------------------

ALTER TABLE public.exercise_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_exercises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exercise_protocols_clinic_access ON public.exercise_protocols;
CREATE POLICY exercise_protocols_clinic_access
  ON public.exercise_protocols
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS protocol_exercises_clinic_access ON public.protocol_exercises;
CREATE POLICY protocol_exercises_clinic_access
  ON public.protocol_exercises
  FOR ALL USING (
    protocol_id IN (
      SELECT id FROM public.exercise_protocols
      WHERE clinic_id IN (
        SELECT clinic_id FROM public.clinic_users
        WHERE user_id = auth.uid()
      )
    )
  );

COMMIT;
