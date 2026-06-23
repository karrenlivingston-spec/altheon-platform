-- Real-time transcription and SOAP draft fields for virtual visits.
ALTER TABLE public.virtual_visits
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS soap_draft jsonb,
  ADD COLUMN IF NOT EXISTS recording_started_at timestamptz;

COMMENT ON COLUMN public.virtual_visits.transcript_status IS
  'idle | recording | processing | complete | failed';
