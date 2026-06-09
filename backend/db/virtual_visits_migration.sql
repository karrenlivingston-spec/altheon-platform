CREATE TABLE public.virtual_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  clinic_id uuid REFERENCES clinics(id) ON DELETE CASCADE,
  clinician_id uuid,
  patient_id uuid,
  room_id text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','completed')),
  started_at timestamptz,
  ended_at timestamptz,
  session_metadata jsonb DEFAULT '{}'
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS
  is_virtual boolean DEFAULT false;
