-- Per-note therapy goals (short/long term with progress tracking).
CREATE TABLE IF NOT EXISTS public.note_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.clinical_notes (id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  goal_type text NOT NULL DEFAULT 'short_term',
  target_weeks integer,
  percent_met integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_goals_goal_type_ck CHECK (
    goal_type IN ('short_term', 'long_term')
  ),
  CONSTRAINT note_goals_percent_met_ck CHECK (
    percent_met >= 0 AND percent_met <= 100 AND percent_met % 5 = 0
  )
);

CREATE INDEX IF NOT EXISTS note_goals_note_id_idx ON public.note_goals (note_id);

CREATE TRIGGER note_goals_set_updated_at
BEFORE UPDATE ON public.note_goals
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
