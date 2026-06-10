-- Allow 'waiting' status: room created but clinician not yet subscribed to signaling.
ALTER TABLE public.virtual_visits
  DROP CONSTRAINT IF EXISTS virtual_visits_status_check;

ALTER TABLE public.virtual_visits
  ADD CONSTRAINT virtual_visits_status_check
  CHECK (status IN ('waiting','pending','active','completed'));
