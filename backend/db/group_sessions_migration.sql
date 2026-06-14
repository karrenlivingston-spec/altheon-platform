  -- Group sessions: shared clinician slots with multiple patient attendees.
  CREATE TABLE IF NOT EXISTS public.group_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
    clinician_id uuid NOT NULL REFERENCES public.clinicians (id) ON DELETE RESTRICT,
    location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE CASCADE,
    treatment_type_id uuid NOT NULL REFERENCES public.treatment_types (id) ON DELETE RESTRICT,
    title text,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    capacity integer NOT NULL DEFAULT 6,
    status text NOT NULL DEFAULT 'scheduled',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT group_sessions_time_ck CHECK (end_time > start_time),
    CONSTRAINT group_sessions_status_ck CHECK (
      status IN ('scheduled', 'completed', 'cancelled')
    ),
    CONSTRAINT group_sessions_capacity_ck CHECK (capacity > 0)
  );

  CREATE TABLE IF NOT EXISTS public.group_session_attendees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_session_id uuid NOT NULL REFERENCES public.group_sessions (id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'booked',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT group_session_attendees_status_ck CHECK (
      status IN ('booked', 'checked_in', 'no_show', 'cancelled')
    ),
    CONSTRAINT group_session_attendees_session_patient_key UNIQUE (group_session_id, patient_id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_sessions_clinic_time
    ON public.group_sessions (clinic_id, start_time);

  CREATE INDEX IF NOT EXISTS idx_group_session_attendees_session
    ON public.group_session_attendees (group_session_id);

  CREATE TRIGGER group_sessions_set_updated_at
  BEFORE UPDATE ON public.group_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
