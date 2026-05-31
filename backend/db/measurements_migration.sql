-- Measurements (ROM, strength, functional outcomes) per appointment.
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments (id) ON DELETE RESTRICT,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE RESTRICT,
  body_part TEXT NOT NULL,
  rom JSONB DEFAULT '[]',
  strength JSONB DEFAULT '[]',
  functional_outcomes JSONB DEFAULT '[]',
  pain_nrs INTEGER CHECK (pain_nrs >= 0 AND pain_nrs <= 10),
  notes TEXT,
  recorded_by UUID REFERENCES public.clinic_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_appointment_id
  ON public.measurements (appointment_id);
CREATE INDEX IF NOT EXISTS idx_measurements_clinic_id
  ON public.measurements (clinic_id);
CREATE INDEX IF NOT EXISTS idx_measurements_patient_id
  ON public.measurements (patient_id);

ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_measurements_access" ON public.measurements;
CREATE POLICY "clinic_measurements_access" ON public.measurements
  FOR ALL USING (clinic_id = '804e2fd2-1c5e-49ec-a036-3feedd1bad50');
