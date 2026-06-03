-- Store AI-detected CPT codes on clinical notes. Run once in Supabase SQL Editor.

ALTER TABLE public.clinical_notes
ADD COLUMN IF NOT EXISTS cpt_codes_detected JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.clinical_notes.cpt_codes_detected IS
  'JSON array of CPT codes detected from SOAP note via Haiku (code, charge, modifiers, reason).';
