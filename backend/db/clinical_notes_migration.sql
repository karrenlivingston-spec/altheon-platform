-- Clinical SOAP notes (PT/chiropractic documentation). Run once on existing DBs.

CREATE TABLE IF NOT EXISTS public.clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  supervising_pt_id uuid REFERENCES public.clinicians (id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments (id) ON DELETE SET NULL,
  note_type text NOT NULL DEFAULT 'daily_note',
  status text NOT NULL DEFAULT 'draft',
  subjective text,
  objective text,
  assessment text,
  plan text,
  ai_feedback text,
  ai_reviewed_at timestamptz,
  correction_notes text,
  signed_at timestamptz,
  signed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_notes_note_type_ck CHECK (
    note_type IN (
      'daily_note',
      'initial_evaluation',
      'progress_note',
      'discharge_note'
    )
  ),
  CONSTRAINT clinical_notes_status_ck CHECK (
    status IN (
      'draft',
      'ai_review_pending',
      'ready_for_review',
      'ai_flagged',
      'needs_correction',
      'signed'
    )
  )
);

CREATE INDEX IF NOT EXISTS clinical_notes_clinic_id_idx ON public.clinical_notes (clinic_id);
CREATE INDEX IF NOT EXISTS clinical_notes_patient_id_idx ON public.clinical_notes (patient_id);
CREATE INDEX IF NOT EXISTS clinical_notes_author_id_idx ON public.clinical_notes (author_id);
CREATE INDEX IF NOT EXISTS clinical_notes_created_at_idx ON public.clinical_notes (created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_notes_status_idx ON public.clinical_notes (status);

COMMENT ON TABLE public.clinical_notes IS 'SOAP clinical documentation with AI review and signing workflow.';

CREATE TRIGGER clinical_notes_set_updated_at
BEFORE UPDATE ON public.clinical_notes
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Optional (for API author_name on list endpoints): add display names to clinic_users if missing.
-- ALTER TABLE public.clinic_users ADD COLUMN IF NOT EXISTS first_name text;
-- ALTER TABLE public.clinic_users ADD COLUMN IF NOT EXISTS last_name text;
