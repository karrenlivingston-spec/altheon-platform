-- Adds clinic scoping on patients rows (run once on existing databases).
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics (id);

CREATE INDEX IF NOT EXISTS patients_clinic_id_idx ON public.patients (clinic_id);
