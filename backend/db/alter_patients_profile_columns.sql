-- Run once on existing Supabase/Postgres databases (adds profile fields to patients).
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS zip text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_carrier text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_policy_number text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_group_number text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS primary_complaint text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS referring_provider text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS notes text;
