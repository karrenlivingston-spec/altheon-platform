-- Appointment waitlist: patients waiting for a preferred slot.
CREATE TABLE IF NOT EXISTS public.appointment_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  requested_date date NOT NULL,
  requested_time time,
  clinician_id uuid REFERENCES public.clinicians (id) ON DELETE SET NULL,
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_waitlist_status_ck CHECK (
    status IN ('waiting', 'contacted', 'booked', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS appointment_waitlist_clinic_id_idx
  ON public.appointment_waitlist (clinic_id);
CREATE INDEX IF NOT EXISTS appointment_waitlist_clinic_status_idx
  ON public.appointment_waitlist (clinic_id, status);
CREATE INDEX IF NOT EXISTS appointment_waitlist_patient_id_idx
  ON public.appointment_waitlist (patient_id);
