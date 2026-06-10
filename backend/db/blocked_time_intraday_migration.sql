-- Optional intra-day time window for blocked_time (null = full day).
ALTER TABLE public.blocked_time
  ADD COLUMN IF NOT EXISTS start_time_of_day time,
  ADD COLUMN IF NOT EXISTS end_time_of_day time;
