-- Audit flag when a supervising PT signs despite AI review feedback.
ALTER TABLE public.clinical_notes
ADD COLUMN IF NOT EXISTS signed_despite_ai_flag boolean NOT NULL DEFAULT false;
