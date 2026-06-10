-- MIGRATION 2 — Special test results per clinical note (junction table).
-- Run once in the Supabase SQL editor, after orthopedic_special_tests_migration.sql.

CREATE TABLE IF NOT EXISTS note_special_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES orthopedic_special_tests(id) ON DELETE CASCADE,
  result text CHECK (result IN ('Positive','Negative','Not Tested')) DEFAULT 'Not Tested',
  clinician_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(note_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_note_special_test_results_note_id
ON note_special_test_results(note_id);
