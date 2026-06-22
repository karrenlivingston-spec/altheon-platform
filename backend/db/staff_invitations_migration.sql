-- Staff invitations for clinic RBAC onboarding.
-- Run manually in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('clinic_admin', 'clinician', 'front_desk')
  ),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_clinic_id
  ON public.staff_invitations (clinic_id);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token
  ON public.staff_invitations (token);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_email
  ON public.staff_invitations (lower(email));
