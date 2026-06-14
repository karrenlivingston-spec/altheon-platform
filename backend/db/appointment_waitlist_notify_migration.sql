-- Waitlist auto-notify v1: track when patients were SMS-notified of an open slot.
ALTER TABLE public.appointment_waitlist
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

ALTER TABLE public.appointment_waitlist
  DROP CONSTRAINT IF EXISTS appointment_waitlist_status_ck;

ALTER TABLE public.appointment_waitlist
  ADD CONSTRAINT appointment_waitlist_status_ck CHECK (
    status IN ('waiting', 'contacted', 'booked', 'cancelled', 'notified')
  );
