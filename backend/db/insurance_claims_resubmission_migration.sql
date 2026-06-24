-- Resubmission workflow columns and insurance_claims status extension.
-- Run once in the Supabase SQL editor before deploying resubmit endpoint.
--
-- Inspect existing status constraint (optional):
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.insurance_claims'::regclass
--   AND contype = 'c';

ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS claim_number TEXT,
  ADD COLUMN IF NOT EXISTS resubmission_of UUID REFERENCES public.insurance_claims (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resubmission_reason TEXT,
  ADD COLUMN IF NOT EXISTS resubmission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE public.eob_extractions
  ADD COLUMN IF NOT EXISTS resubmission_submitted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resubmission_claim_id UUID REFERENCES public.insurance_claims (id) ON DELETE SET NULL;

ALTER TABLE public.clinic_tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.insurance_claims
  DROP CONSTRAINT IF EXISTS insurance_claims_status_check;

ALTER TABLE public.insurance_claims
  ADD CONSTRAINT insurance_claims_status_check
  CHECK (
    status IN (
      'draft',
      'submitted',
      'paid',
      'denied',
      'partial',
      'resubmitted',
      'accepted',
      'rejected',
      'pending'
    )
  );

CREATE INDEX IF NOT EXISTS idx_insurance_claims_resubmission_of
  ON public.insurance_claims (resubmission_of);

CREATE INDEX IF NOT EXISTS idx_eob_extractions_resubmission_claim
  ON public.eob_extractions (resubmission_claim_id);
