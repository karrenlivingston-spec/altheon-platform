-- PI-specific fee schedule rates (nullable tier on existing clinic_fee_schedules rows).
-- Run once in the Supabase SQL editor after fee_schedule_migration.sql.
--
-- pi_charge holds the personal-injury billing rate for a CPT at a clinic.
-- It is optional per row: when NULL, PI billing modals do not auto-fill that CPT
-- (manual entry only — same behavior as before this column existed).

ALTER TABLE public.clinic_fee_schedules
  ADD COLUMN IF NOT EXISTS pi_charge NUMERIC(10, 2);

COMMENT ON COLUMN public.clinic_fee_schedules.pi_charge IS
  'Optional PI (personal injury) rate in dollars for this CPT at this clinic. NULL = no PI auto-fill.';
