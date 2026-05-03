-- Altheon: multi-tenant healthcare practice management (PostgreSQL / Supabase)
-- UUID primary keys, FK constraints, indexes, and timestamps.

-- -----------------------------------------------------------------------------
-- Extensions (Supabase: gen_random_uuid is available on supported Postgres)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. clinics
-- Root tenant record for each healthcare practice (branding, contact, slug).
-- =============================================================================
CREATE TABLE public.clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  logo_url text,
  brand_color text,
  phone text,
  email text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinics_slug_key UNIQUE (slug)
);
CREATE INDEX clinics_created_at_idx ON public.clinics (created_at);

COMMENT ON TABLE public.clinics IS 'Root tenant record for each healthcare practice: branding, contact details, and public slug.';

CREATE TRIGGER clinics_set_updated_at
BEFORE UPDATE ON public.clinics
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 2. locations
-- Physical or logical sites belonging to a clinic (scheduling, timezone).
-- =============================================================================
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  timezone text NOT NULL DEFAULT 'UTC',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX locations_clinic_id_idx ON public.locations (clinic_id);
CREATE INDEX locations_is_active_idx ON public.locations (is_active) WHERE is_active = true;

COMMENT ON TABLE public.locations IS 'Sites under a clinic used for scheduling, contact, and timezone-aware operations.';

CREATE TRIGGER locations_set_updated_at
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 3. clinicians
-- Providers linked to a clinic and primary location (scheduling, routing).
-- =============================================================================
CREATE TABLE public.clinicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  title text,
  email text,
  phone text,
  bio text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinicians_location_id_idx ON public.clinicians (location_id);
CREATE INDEX clinicians_clinic_id_idx ON public.clinicians (clinic_id);
CREATE INDEX clinicians_is_active_idx ON public.clinicians (is_active) WHERE is_active = true;
CREATE INDEX clinicians_email_idx ON public.clinicians (email) WHERE email IS NOT NULL;

COMMENT ON TABLE public.clinicians IS 'Clinical staff tied to a clinic and a primary location for availability and routing.';

CREATE TRIGGER clinicians_set_updated_at
BEFORE UPDATE ON public.clinicians
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 4. patients
-- Person records independent of clinic; access is modeled via patient_clinic_access.
-- =============================================================================
CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  date_of_birth date,
  gender text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  insurance_carrier text,
  insurance_policy_number text,
  insurance_group_number text,
  primary_complaint text,
  referring_provider text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patients_email_idx ON public.patients (email) WHERE email IS NOT NULL;
CREATE INDEX patients_phone_idx ON public.patients (phone) WHERE phone IS NOT NULL;
CREATE INDEX patients_last_first_idx ON public.patients (last_name, first_name);
CREATE INDEX patients_dob_idx ON public.patients (date_of_birth) WHERE date_of_birth IS NOT NULL;

COMMENT ON TABLE public.patients IS 'Patient demographics; clinic relationships are granted through patient_clinic_access.';

CREATE TRIGGER patients_set_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 5. patient_clinic_access
-- Many-to-many: which patients are associated with which clinics.
-- =============================================================================
CREATE TABLE public.patient_clinic_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_clinic_access_unique UNIQUE (patient_id, clinic_id)
);

CREATE INDEX patient_clinic_access_patient_id_idx ON public.patient_clinic_access (patient_id);
CREATE INDEX patient_clinic_access_clinic_id_idx ON public.patient_clinic_access (clinic_id);

COMMENT ON TABLE public.patient_clinic_access IS 'Links patients to clinics they are allowed to use (multi-clinic patients).';

-- =============================================================================
-- 6. treatment_types
-- Billable or schedulable services defined per clinic (duration, evaluation flag).
-- =============================================================================
CREATE TABLE public.treatment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  requires_evaluation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX treatment_types_clinic_id_idx ON public.treatment_types (clinic_id);
CREATE INDEX treatment_types_clinic_name_idx ON public.treatment_types (clinic_id, name);

COMMENT ON TABLE public.treatment_types IS 'Clinic-specific catalog of treatments or visit types for scheduling and routing.';

CREATE TRIGGER treatment_types_set_updated_at
BEFORE UPDATE ON public.treatment_types
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 7. provider_routing_rules
-- Maps treatment types and keyword conditions to preferred clinicians with priority.
-- =============================================================================
CREATE TABLE public.provider_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  treatment_type_id uuid NOT NULL REFERENCES public.treatment_types (id) ON DELETE CASCADE,
  clinician_id uuid NOT NULL REFERENCES public.clinicians (id) ON DELETE CASCADE,
  condition_keywords text[] NOT NULL DEFAULT '{}',
  priority_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provider_routing_rules_clinic_id_idx ON public.provider_routing_rules (clinic_id);
CREATE INDEX provider_routing_rules_treatment_type_id_idx ON public.provider_routing_rules (treatment_type_id);
CREATE INDEX provider_routing_rules_clinician_id_idx ON public.provider_routing_rules (clinician_id);
CREATE INDEX provider_routing_rules_priority_idx ON public.provider_routing_rules (clinic_id, treatment_type_id, priority_order);

COMMENT ON TABLE public.provider_routing_rules IS 'Rules to assign or suggest clinicians based on treatment type and intake keywords.';

CREATE TRIGGER provider_routing_rules_set_updated_at
BEFORE UPDATE ON public.provider_routing_rules
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 8. appointments
-- Scheduled encounters linking patient, provider, location, and treatment type.
-- =============================================================================
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE RESTRICT,
  clinician_id uuid NOT NULL REFERENCES public.clinicians (id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE CASCADE,
  treatment_type_id uuid NOT NULL REFERENCES public.treatment_types (id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  source text DEFAULT 'manual' CHECK (source IN ('ai', 'manual', 'app')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_time_ck CHECK (end_time > start_time),
  CONSTRAINT appointments_status_ck CHECK (
    status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')
  )
);

CREATE INDEX appointments_clinic_id_idx ON public.appointments (clinic_id);
CREATE INDEX appointments_patient_id_idx ON public.appointments (patient_id);
CREATE INDEX appointments_clinician_id_idx ON public.appointments (clinician_id);
CREATE INDEX appointments_location_id_idx ON public.appointments (location_id);
CREATE INDEX appointments_treatment_type_id_idx ON public.appointments (treatment_type_id);
CREATE INDEX appointments_start_time_idx ON public.appointments (start_time);
CREATE INDEX appointments_status_idx ON public.appointments (status);
CREATE INDEX appointments_clinician_start_idx ON public.appointments (clinician_id, start_time);

COMMENT ON TABLE public.appointments IS 'Scheduled visits with lifecycle status, time range, and optional notes.';

CREATE TRIGGER appointments_set_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 9. clinical_intakes
-- Pre-visit clinical questionnaire tied to an appointment and patient snapshot.
-- =============================================================================
CREATE TABLE public.clinical_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  reason_for_visit text,
  symptoms text[] NOT NULL DEFAULT '{}',
  condition_type text,
  pain_level integer CHECK (pain_level IS NULL OR (pain_level >= 1 AND pain_level <= 10)),
  treatment_needs text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinical_intakes_clinic_id_idx ON public.clinical_intakes (clinic_id);
CREATE INDEX clinical_intakes_appointment_id_idx ON public.clinical_intakes (appointment_id);
CREATE INDEX clinical_intakes_patient_id_idx ON public.clinical_intakes (patient_id);
CREATE INDEX clinical_intakes_submitted_at_idx ON public.clinical_intakes (submitted_at);

COMMENT ON TABLE public.clinical_intakes IS 'Structured intake data collected before or for a specific appointment.';

-- =============================================================================
-- 10. membership_tiers
-- Subscription products per clinic (pricing in cents, billing cadence, visit rules).
-- =============================================================================
CREATE TABLE public.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  billing_cycle text NOT NULL,
  visits_included integer NOT NULL CHECK (visits_included >= 0),
  visits_roll_over boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_tiers_billing_cycle_ck CHECK (
    billing_cycle IN ('monthly', 'quarterly', 'annual')
  )
);

CREATE INDEX membership_tiers_clinic_id_idx ON public.membership_tiers (clinic_id);
CREATE INDEX membership_tiers_is_active_idx ON public.membership_tiers (clinic_id, is_active);

COMMENT ON TABLE public.membership_tiers IS 'Recurring membership plans per clinic: price, billing cadence, included visits, and rollover policy.';

CREATE TRIGGER membership_tiers_set_updated_at
BEFORE UPDATE ON public.membership_tiers
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 11. membership_tier_services
-- Which treatment types are covered by a membership tier (junction).
-- =============================================================================
CREATE TABLE public.membership_tier_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id uuid NOT NULL REFERENCES public.membership_tiers (id) ON DELETE CASCADE,
  treatment_type_id uuid NOT NULL REFERENCES public.treatment_types (id) ON DELETE CASCADE,
  CONSTRAINT membership_tier_services_tier_treatment_key UNIQUE (tier_id, treatment_type_id)
);

CREATE INDEX membership_tier_services_tier_id_idx ON public.membership_tier_services (tier_id);
CREATE INDEX membership_tier_services_treatment_type_id_idx ON public.membership_tier_services (treatment_type_id);

COMMENT ON TABLE public.membership_tier_services IS 'Maps membership tiers to billable/scheduled treatment types.';

-- =============================================================================
-- 12. patient_memberships
-- Enrollment of a patient in a tier at a clinic with usage and billing fields.
-- =============================================================================
CREATE TABLE public.patient_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES public.membership_tiers (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  billing_cycle_count integer NOT NULL DEFAULT 0 CHECK (billing_cycle_count >= 0),
  visits_included integer NOT NULL DEFAULT 0 CHECK (visits_included >= 0),
  visits_used integer NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
  visits_remaining integer NOT NULL DEFAULT 0 CHECK (visits_remaining >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  next_billing_date date,
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  upgrade_eligible boolean NOT NULL DEFAULT false,
  downgrade_eligible boolean NOT NULL DEFAULT false,
  pending_tier_change_id uuid REFERENCES public.membership_tiers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_memberships_status_ck CHECK (
    status IN ('active', 'paused', 'cancelled', 'expired')
  )
);

CREATE INDEX patient_memberships_patient_id_idx ON public.patient_memberships (patient_id);
CREATE INDEX patient_memberships_clinic_id_idx ON public.patient_memberships (clinic_id);
CREATE INDEX patient_memberships_tier_id_idx ON public.patient_memberships (tier_id);
CREATE INDEX patient_memberships_status_idx ON public.patient_memberships (status);
CREATE INDEX patient_memberships_next_billing_idx ON public.patient_memberships (next_billing_date)
  WHERE next_billing_date IS NOT NULL;
CREATE INDEX patient_memberships_pending_tier_change_idx ON public.patient_memberships (pending_tier_change_id)
  WHERE pending_tier_change_id IS NOT NULL;

COMMENT ON TABLE public.patient_memberships IS 'Patient subscription state per clinic and tier, visit counters, billing, and deferred tier changes.';

CREATE TRIGGER patient_memberships_set_updated_at
BEFORE UPDATE ON public.patient_memberships
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 13. membership_visit_log
-- Audit of visits consumed against a patient membership.
-- =============================================================================
CREATE TABLE public.membership_visit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.patient_memberships (id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments (id) ON DELETE SET NULL,
  treatment_type_id uuid REFERENCES public.treatment_types (id) ON DELETE SET NULL,
  logged_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX membership_visit_log_membership_id_idx ON public.membership_visit_log (membership_id);
CREATE INDEX membership_visit_log_appointment_id_idx ON public.membership_visit_log (appointment_id)
  WHERE appointment_id IS NOT NULL;
CREATE INDEX membership_visit_log_logged_at_idx ON public.membership_visit_log (logged_at);

COMMENT ON TABLE public.membership_visit_log IS 'Each row records one membership visit debit, optionally tied to an appointment or treatment type.';

-- =============================================================================
-- 14. legal_requests
-- Tracking of external records requests (attorney, insurance, court, etc.).
-- =============================================================================
CREATE TABLE public.legal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients (id) ON DELETE RESTRICT,
  requesting_party_name text NOT NULL,
  requesting_party_type text NOT NULL,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  request_method text NOT NULL,
  documents_requested text[] NOT NULL DEFAULT '{}',
  documents_prepared text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'received',
  send_date date,
  send_method text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_requests_party_type_ck CHECK (
    requesting_party_type IN ('attorney', 'insurance', 'court', 'other')
  ),
  CONSTRAINT legal_requests_method_ck CHECK (
    request_method IN ('email', 'mail', 'subpoena', 'formal_request')
  ),
  CONSTRAINT legal_requests_status_ck CHECK (
    status IN ('received', 'under_review', 'compiled', 'verified', 'sent')
  )
);

CREATE INDEX legal_requests_clinic_id_idx ON public.legal_requests (clinic_id);
CREATE INDEX legal_requests_patient_id_idx ON public.legal_requests (patient_id);
CREATE INDEX legal_requests_status_idx ON public.legal_requests (status);
CREATE INDEX legal_requests_request_date_idx ON public.legal_requests (request_date);

COMMENT ON TABLE public.legal_requests IS 'Compliance workflow for PHI/legal document requests and fulfillment tracking.';

CREATE TRIGGER legal_requests_set_updated_at
BEFORE UPDATE ON public.legal_requests
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- 15. voice_interaction_logs
-- Audit of voice channel interactions (calls, transcripts, intents, outcomes).
-- =============================================================================
CREATE TABLE public.voice_interaction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients (id) ON DELETE SET NULL,
  call_sid text,
  transcript text,
  intent_detected text,
  outcome text,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  success_flag boolean,
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voice_interaction_logs_clinic_id_idx ON public.voice_interaction_logs (clinic_id);
CREATE INDEX voice_interaction_logs_patient_id_idx ON public.voice_interaction_logs (patient_id);
CREATE INDEX voice_interaction_logs_call_sid_idx ON public.voice_interaction_logs (call_sid) WHERE call_sid IS NOT NULL;
CREATE INDEX voice_interaction_logs_created_at_idx ON public.voice_interaction_logs (created_at);

COMMENT ON TABLE public.voice_interaction_logs IS 'Append-only log of voice/IVR interactions for analytics and support (patient optional).';
