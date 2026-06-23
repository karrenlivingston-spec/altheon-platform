-- Track how SOAP fields were populated on clinical notes.
ALTER TABLE clinical_notes
  ADD COLUMN IF NOT EXISTS soap_source TEXT DEFAULT 'manual';
-- values: manual | ai_scribe | virtual_visit_transcript
