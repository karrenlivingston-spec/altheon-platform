-- Proactive claim status checks (Stedi 276/277 via claimstatus/v2).
-- Run once in the Supabase SQL editor before using POST /billing/claims/status/poll.

CREATE TABLE IF NOT EXISTS public.claim_status_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.insurance_claims (id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_bucket TEXT NOT NULL,
  category_code TEXT,
  category_text TEXT,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'manual',
  CONSTRAINT claim_status_checks_source_check CHECK (source IN ('manual', 'poll'))
);

CREATE INDEX IF NOT EXISTS idx_claim_status_checks_claim_checked
  ON public.claim_status_checks (claim_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_status_checks_clinic_checked
  ON public.claim_status_checks (clinic_id, checked_at DESC);

ALTER TABLE public.claim_status_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_status_checks_clinic_access" ON public.claim_status_checks;
CREATE POLICY "claim_status_checks_clinic_access" ON public.claim_status_checks
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
