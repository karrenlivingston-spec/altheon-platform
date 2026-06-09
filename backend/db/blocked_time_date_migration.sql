-- Store blocked time as calendar dates (no timestamptz UTC shift).
ALTER TABLE public.blocked_time
  ALTER COLUMN start_time TYPE date
  USING (start_time AT TIME ZONE 'America/New_York')::date;

ALTER TABLE public.blocked_time
  ALTER COLUMN end_time TYPE date
  USING (end_time AT TIME ZONE 'America/New_York')::date;
