-- Add optional sport field to patients (Performance Center / athlete context).
-- Run once in Supabase SQL Editor.

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS sport text;
