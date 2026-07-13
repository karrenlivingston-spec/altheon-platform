-- Neurological exam reference items + per-note results (SOAP notes).
-- Run once in Supabase SQL Editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.neuro_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('sensory', 'motor', 'reflex')),
  region text NOT NULL CHECK (region IN ('cervical', 'thoracic', 'lumbar')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.note_neuro_exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.clinical_notes (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.neuro_exam_items (id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('left', 'right', 'bilateral')),
  result text,
  clinician_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, item_id, side)
);

CREATE INDEX IF NOT EXISTS neuro_exam_items_category_region_idx
  ON public.neuro_exam_items (category, region, sort_order);

CREATE INDEX IF NOT EXISTS note_neuro_exam_results_note_id_idx
  ON public.note_neuro_exam_results (note_id);

CREATE INDEX IF NOT EXISTS note_neuro_exam_results_item_id_idx
  ON public.note_neuro_exam_results (item_id);

-- ---------------------------------------------------------------------------
-- Seed: standard basic neuro exam levels (pending clinician sign-off)
-- ---------------------------------------------------------------------------

INSERT INTO public.neuro_exam_items (name, category, region, sort_order) VALUES
-- Dermatomes (sensory)
('C5 Dermatome', 'sensory', 'cervical', 1),
('C6 Dermatome', 'sensory', 'cervical', 2),
('C7 Dermatome', 'sensory', 'cervical', 3),
('C8 Dermatome', 'sensory', 'cervical', 4),
('T1 Dermatome', 'sensory', 'cervical', 5),
('L2 Dermatome', 'sensory', 'lumbar', 6),
('L3 Dermatome', 'sensory', 'lumbar', 7),
('L4 Dermatome', 'sensory', 'lumbar', 8),
('L5 Dermatome', 'sensory', 'lumbar', 9),
('S1 Dermatome', 'sensory', 'lumbar', 10),
-- Myotomes (motor)
('C5 Myotome', 'motor', 'cervical', 11),
('C6 Myotome', 'motor', 'cervical', 12),
('C7 Myotome', 'motor', 'cervical', 13),
('C8 Myotome', 'motor', 'cervical', 14),
('T1 Myotome', 'motor', 'cervical', 15),
('L2 Myotome', 'motor', 'lumbar', 16),
('L3 Myotome', 'motor', 'lumbar', 17),
('L4 Myotome', 'motor', 'lumbar', 18),
('L5 Myotome', 'motor', 'lumbar', 19),
('S1 Myotome', 'motor', 'lumbar', 20),
-- Deep tendon reflexes
('Biceps Reflex', 'reflex', 'cervical', 21),
('Brachioradialis Reflex', 'reflex', 'cervical', 22),
('Triceps Reflex', 'reflex', 'cervical', 23),
('Patellar Reflex', 'reflex', 'lumbar', 24),
('Achilles Reflex', 'reflex', 'lumbar', 25);

-- ---------------------------------------------------------------------------
-- RLS (clinic-scoped via clinical_notes, matches note_special_test_results intent)
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_neuro_exam_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_neuro_exam_results_clinic_access
  ON public.note_neuro_exam_results;
CREATE POLICY note_neuro_exam_results_clinic_access
  ON public.note_neuro_exam_results
  FOR ALL USING (
    note_id IN (
      SELECT id FROM public.clinical_notes
      WHERE clinic_id IN (
        SELECT clinic_id FROM public.clinic_users
        WHERE user_id = auth.uid()
      )
    )
  );

COMMIT;
