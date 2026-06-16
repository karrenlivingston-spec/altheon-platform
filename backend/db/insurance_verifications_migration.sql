-- Insurance eligibility verifications (Stedi 270/271).
-- Run once in the Supabase SQL editor before using POST /billing/insurance-verification.

CREATE TABLE IF NOT EXISTS public.insurance_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  payer_id VARCHAR(50) NOT NULL,
  member_id VARCHAR(100),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  eligible BOOLEAN NOT NULL DEFAULT false,
  plan_name TEXT,
  copay NUMERIC(10, 2),
  deductible NUMERIC(10, 2),
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_insurance_verifications_clinic_patient
  ON public.insurance_verifications (clinic_id, patient_id, verified_at DESC);

ALTER TABLE public.insurance_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_verifications_clinic_access" ON public.insurance_verifications;
CREATE POLICY "insurance_verifications_clinic_access" ON public.insurance_verifications
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
