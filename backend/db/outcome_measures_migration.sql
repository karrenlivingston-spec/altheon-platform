-- Patient outcome measure tokens and results (NDI, ODI, QuickDASH).
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.outcome_measure_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  patient_id UUID REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics (id) ON DELETE CASCADE,
  form_type TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outcome_measure_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics (id) ON DELETE CASCADE,
  form_type TEXT NOT NULL,
  score NUMERIC,
  percentage NUMERIC,
  interpretation TEXT,
  answers JSONB,
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcome_measure_tokens_token
  ON public.outcome_measure_tokens (token);
CREATE INDEX IF NOT EXISTS idx_outcome_measure_tokens_patient_id
  ON public.outcome_measure_tokens (patient_id);
CREATE INDEX IF NOT EXISTS idx_outcome_measure_results_patient_id
  ON public.outcome_measure_results (patient_id);
CREATE INDEX IF NOT EXISTS idx_outcome_measure_results_clinic_id
  ON public.outcome_measure_results (clinic_id);
CREATE INDEX IF NOT EXISTS idx_outcome_measure_results_completed_at
  ON public.outcome_measure_results (completed_at DESC);

ALTER TABLE public.outcome_measure_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_measure_results ENABLE ROW LEVEL SECURITY;

-- Token rows are read via backend (service role). Direct anon SELECT if needed for token lookup:
DROP POLICY IF EXISTS "outcome_tokens_public_read" ON public.outcome_measure_tokens;
CREATE POLICY "outcome_tokens_public_read" ON public.outcome_measure_tokens
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "outcome_results_clinic_read" ON public.outcome_measure_results;
CREATE POLICY "outcome_results_clinic_read" ON public.outcome_measure_results
  FOR SELECT USING (clinic_id = '804e2fd2-1c5e-49ec-a036-3feedd1bad50');
