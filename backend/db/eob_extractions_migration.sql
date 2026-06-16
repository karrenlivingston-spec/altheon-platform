-- EOB extraction storage, clinic tasks, and document type extensions.
-- Run once in the Supabase SQL editor.

-- Extend patient_documents.document_type for EOB / Reduction Letter
ALTER TABLE public.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_document_type_check;

ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_document_type_check
  CHECK (
    document_type IN (
      'mri_report',
      'xray',
      'pdf_report',
      'photo',
      'prescription',
      'insurance_card',
      'id_document',
      'eob',
      'reduction_letter',
      'other'
    )
  );

-- Persistent clinic tasks (EOB resubmission, etc.)
CREATE TABLE IF NOT EXISTS public.clinic_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients (id) ON DELETE CASCADE,
  claim_id UUID REFERENCES public.insurance_claims (id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_tasks_clinic_status
  ON public.clinic_tasks (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_clinic_tasks_patient
  ON public.clinic_tasks (patient_id);

-- EOB financial extractions linked to uploaded documents
CREATE TABLE IF NOT EXISTS public.eob_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.patient_documents (id) ON DELETE CASCADE,
  claim_id UUID REFERENCES public.insurance_claims (id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.clinic_tasks (id) ON DELETE SET NULL,
  insurance_company TEXT,
  date_of_service DATE,
  total_billed NUMERIC(12, 2),
  total_allowed NUMERIC(12, 2),
  total_paid NUMERIC(12, 2),
  total_adjustment NUMERIC(12, 2),
  total_patient_responsibility NUMERIC(12, 2),
  denial_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  denial_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_resubmission BOOLEAN NOT NULL DEFAULT false,
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eob_extractions_patient
  ON public.eob_extractions (clinic_id, patient_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eob_extractions_document
  ON public.eob_extractions (document_id);

ALTER TABLE public.clinic_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eob_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_tasks_clinic_access ON public.clinic_tasks
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY eob_extractions_clinic_access ON public.eob_extractions
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
