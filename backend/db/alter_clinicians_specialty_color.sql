-- Optional columns for clinic onboarding / UI (run on Supabase if not already present).
ALTER TABLE public.clinicians ADD COLUMN IF NOT EXISTS specialty text;
ALTER TABLE public.clinicians ADD COLUMN IF NOT EXISTS color text;
