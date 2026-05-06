-- Lawyer / PI contact fields on patients (run in Supabase SQL editor)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS lawyer_name text,
  ADD COLUMN IF NOT EXISTS law_firm text,
  ADD COLUMN IF NOT EXISTS lawyer_phone text,
  ADD COLUMN IF NOT EXISTS lawyer_email text;
