-- Public intake (Aria / QR) — structured form rows from POST /intake
-- Run manually in Supabase SQL editor if not already applied.

CREATE TABLE IF NOT EXISTS public.intake_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients (id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments (id) ON DELETE SET NULL,
  patient_phone text,
  patient_first_name text,
  patient_last_name text,
  chief_complaint text NOT NULL DEFAULT '',
  pain_scale integer NOT NULL CHECK (pain_scale >= 1 AND pain_scale <= 10),
  symptom_duration text NOT NULL DEFAULT '',
  aggravating_factors text NOT NULL DEFAULT '',
  relieving_factors text NOT NULL DEFAULT '',
  medical_history_flags jsonb NOT NULL DEFAULT '{}',
  allergies text NOT NULL DEFAULT '',
  other_conditions text NOT NULL DEFAULT '',
  hobbies text NOT NULL DEFAULT '',
  previous_activities text NOT NULL DEFAULT '',
  goals text NOT NULL DEFAULT '',
  raw_transcript text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_forms_clinic_id_idx ON public.intake_forms (clinic_id);
CREATE INDEX IF NOT EXISTS intake_forms_patient_id_idx ON public.intake_forms (patient_id);
CREATE INDEX IF NOT EXISTS intake_forms_appointment_id_idx ON public.intake_forms (appointment_id);
CREATE INDEX IF NOT EXISTS intake_forms_created_at_idx ON public.intake_forms (created_at);
