-- Standardized questionnaire tokens + responses. Run manually in Supabase SQL Editor.

ALTER TABLE public.clinical_notes
  ADD COLUMN IF NOT EXISTS body_region text;

CREATE TABLE IF NOT EXISTS public.questionnaire_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments (id) ON DELETE SET NULL,
  clinical_note_id uuid REFERENCES public.clinical_notes (id) ON DELETE SET NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  questionnaire_type text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS questionnaire_tokens_token_idx
  ON public.questionnaire_tokens (token);
CREATE INDEX IF NOT EXISTS questionnaire_tokens_note_type_idx
  ON public.questionnaire_tokens (clinical_note_id, questionnaire_type);

CREATE TABLE IF NOT EXISTS public.questionnaire_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments (id) ON DELETE SET NULL,
  clinical_note_id uuid REFERENCES public.clinical_notes (id) ON DELETE SET NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  questionnaire_type text NOT NULL,
  body_region text NOT NULL,
  responses jsonb NOT NULL,
  total_score integer,
  score_percentage numeric(5, 2),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questionnaire_responses_type_ck CHECK (
    questionnaire_type IN ('oswestry', 'ndi', 'lefs', 'quickdash')
  )
);

CREATE INDEX IF NOT EXISTS questionnaire_responses_patient_idx
  ON public.questionnaire_responses (patient_id);
CREATE INDEX IF NOT EXISTS questionnaire_responses_note_idx
  ON public.questionnaire_responses (clinical_note_id);
