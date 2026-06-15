-- Billing Fee Schedule — schema reference + optional clinic seed
-- Run fee_schedule_migration.sql first if clinic_fee_schedules does not exist yet.
--
-- The billing UI uses public.clinic_fee_schedules (per-clinic rates) joined to
-- public.cpt_codes (shared CPT library). Field mapping:
--   cpt_code      → cpt_code
--   description   → cpt_codes.description
--   default_rate  → clinic_fee_schedules.charge (dollars)

-- Optional: seed common PT / dry needling codes for one clinic.
-- Replace the clinic_id below before running.

INSERT INTO public.clinic_fee_schedules (clinic_id, cpt_code, charge)
VALUES
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '97110', 85.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '97140', 75.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '97161', 150.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '97162', 175.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '97163', 200.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '20560', 65.00),
  ('804e2fd2-1c5e-49ec-a036-3feedd1bad50', '20561', 85.00)
ON CONFLICT (clinic_id, cpt_code) DO UPDATE
SET
  charge = EXCLUDED.charge,
  is_active = true,
  updated_at = now();
