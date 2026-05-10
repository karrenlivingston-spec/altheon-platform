-- PI referral milestones linked to pi_cases (run once on existing DBs).

CREATE TABLE IF NOT EXISTS public.pi_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_case_id uuid NOT NULL REFERENCES public.pi_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  referral_type text NOT NULL,
  referral_type_other text,
  status text NOT NULL DEFAULT 'pending',
  referral_date date,
  provider_specialist text,
  records_received boolean NOT NULL DEFAULT false,
  records_received_date date,
  follow_up_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pi_referrals_pi_case_id_idx ON public.pi_referrals (pi_case_id);
CREATE INDEX IF NOT EXISTS pi_referrals_clinic_id_idx ON public.pi_referrals (clinic_id);
CREATE INDEX IF NOT EXISTS pi_referrals_patient_id_idx ON public.pi_referrals (patient_id);

ALTER TABLE public.pi_cases
  ADD COLUMN IF NOT EXISTS attorney_request_pending boolean NOT NULL DEFAULT false;
