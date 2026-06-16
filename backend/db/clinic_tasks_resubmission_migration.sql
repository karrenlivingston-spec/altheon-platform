-- Resubmission workflow columns for clinic_tasks and eob_extractions.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.clinic_tasks
  ADD COLUMN IF NOT EXISTS resubmission_generated_at TIMESTAMPTZ;

ALTER TABLE public.eob_extractions
  ADD COLUMN IF NOT EXISTS resubmission_prepared BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clinic_tasks_eob_resubmission
  ON public.clinic_tasks (clinic_id, task_type, status)
  WHERE task_type = 'eob_resubmission';
