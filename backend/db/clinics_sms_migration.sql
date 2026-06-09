-- Per-clinic SMS display name and Twilio Messaging Service SID.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.clinics
ADD COLUMN IF NOT EXISTS sms_display_name TEXT,
ADD COLUMN IF NOT EXISTS messaging_service_sid TEXT;

COMMENT ON COLUMN public.clinics.sms_display_name IS
  'Short name prepended to outbound patient SMS (e.g. "Vitality Sports & Wellness").';
COMMENT ON COLUMN public.clinics.messaging_service_sid IS
  'Twilio Messaging Service SID for this clinic; falls back to TWILIO_MESSAGING_SERVICE_SID env.';
