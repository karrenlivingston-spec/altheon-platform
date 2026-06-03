-- Fee schedule: CPT library, modifier rules, per-clinic pricing.
-- Run once in the Supabase SQL editor.

-- Master CPT code library (Altheon-managed, shared across all clinics)
CREATE TABLE IF NOT EXISTS public.cpt_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category VARCHAR(100),
  default_units INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed with common PT/chiro/dry needling codes
INSERT INTO public.cpt_codes (code, description, category, default_units) VALUES
  ('97010', 'Hot or cold packs', 'Physical Medicine', 1),
  ('97012', 'Mechanical traction', 'Physical Medicine', 1),
  ('97014', 'Electrical stimulation (unattended)', 'Physical Medicine', 1),
  ('97018', 'Paraffin bath', 'Physical Medicine', 1),
  ('97022', 'Whirlpool', 'Physical Medicine', 1),
  ('97032', 'Electrical stimulation (attended)', 'Physical Medicine', 1),
  ('97035', 'Ultrasound', 'Physical Medicine', 1),
  ('97110', 'Therapeutic exercises', 'Physical Medicine', 1),
  ('97112', 'Neuromuscular reeducation', 'Physical Medicine', 1),
  ('97116', 'Gait training', 'Physical Medicine', 1),
  ('97120', 'Therapeutic intervention', 'Physical Medicine', 1),
  ('97124', 'Massage', 'Physical Medicine', 1),
  ('97140', 'Manual therapy', 'Physical Medicine', 1),
  ('97150', 'Therapeutic procedure, group', 'Physical Medicine', 1),
  ('97530', 'Therapeutic activities', 'Physical Medicine', 1),
  ('97535', 'Self-care/home management training', 'Physical Medicine', 1),
  ('97542', 'Wheelchair management', 'Physical Medicine', 1),
  ('97750', 'Physical performance test', 'Physical Medicine', 1),
  ('97760', 'Orthotic management and training', 'Physical Medicine', 1),
  ('97763', 'Orthotic/prosthetic management', 'Physical Medicine', 1),
  ('98940', 'Chiropractic manipulative treatment, 1-2 regions', 'Chiropractic', 1),
  ('98941', 'Chiropractic manipulative treatment, 3-4 regions', 'Chiropractic', 1),
  ('98942', 'Chiropractic manipulative treatment, 5 regions', 'Chiropractic', 1),
  ('20560', 'Dry needling, 1-2 muscles', 'Dry Needling', 1),
  ('20561', 'Dry needling, 3+ muscles', 'Dry Needling', 1),
  ('99213', 'Office visit, established patient, low complexity', 'Evaluation', 1),
  ('99214', 'Office visit, established patient, moderate complexity', 'Evaluation', 1),
  ('97161', 'PT evaluation, low complexity', 'Evaluation', 1),
  ('97162', 'PT evaluation, moderate complexity', 'Evaluation', 1),
  ('97163', 'PT evaluation, high complexity', 'Evaluation', 1),
  ('97164', 'PT re-evaluation', 'Evaluation', 1)
ON CONFLICT (code) DO NOTHING;

-- Modifier rules table (common modifiers pre-configured)
CREATE TABLE IF NOT EXISTS public.modifier_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_code VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  trigger_condition TEXT,
  applies_to_cpt VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS modifier_rules_modifier_code_key
  ON public.modifier_rules (modifier_code);

INSERT INTO public.modifier_rules (modifier_code, description, trigger_condition, applies_to_cpt) VALUES
  ('25', 'Significant, separately identifiable E&M service', 'billed_with_em', NULL),
  ('59', 'Distinct procedural service', 'distinct_service', NULL),
  ('GP', 'Services delivered under outpatient PT plan of care', 'always_pt', NULL),
  ('GN', 'Services delivered under outpatient SLP plan of care', 'always_slp', NULL),
  ('GO', 'Services delivered under outpatient OT plan of care', 'always_ot', NULL),
  ('KX', 'Requirements specified in the medical policy have been met', 'therapy_cap', NULL),
  ('52', 'Reduced services', 'reduced', NULL),
  ('76', 'Repeat procedure by same physician', 'repeat_same', NULL),
  ('XS', 'Separate structure', 'separate_structure', NULL),
  ('XU', 'Unusual non-overlapping service', 'non_overlapping', NULL)
ON CONFLICT (modifier_code) DO NOTHING;

-- Clinic fee schedules (per-clinic pricing for CPT codes)
CREATE TABLE IF NOT EXISTS public.clinic_fee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  cpt_code VARCHAR(10) NOT NULL REFERENCES public.cpt_codes (code) ON DELETE CASCADE,
  charge NUMERIC(10, 2) NOT NULL,
  modifiers TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (clinic_id, cpt_code)
);

CREATE INDEX IF NOT EXISTS idx_clinic_fee_schedules_clinic_id
  ON public.clinic_fee_schedules (clinic_id);

ALTER TABLE public.cpt_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_fee_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cpt_codes_read" ON public.cpt_codes;
CREATE POLICY "cpt_codes_read" ON public.cpt_codes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "modifier_rules_read" ON public.modifier_rules;
CREATE POLICY "modifier_rules_read" ON public.modifier_rules
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "fee_schedule_clinic_access" ON public.clinic_fee_schedules;
CREATE POLICY "fee_schedule_clinic_access" ON public.clinic_fee_schedules
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
