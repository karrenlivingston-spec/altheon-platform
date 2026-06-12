-- Medical records export audit log. Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.record_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  note_ids jsonb NOT NULL DEFAULT '[]',
  recipient_email text NOT NULL,
  exported_by uuid,
  exported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_exports_clinic_id_idx
  ON public.record_exports (clinic_id);

CREATE INDEX IF NOT EXISTS record_exports_patient_id_idx
  ON public.record_exports (patient_id);
