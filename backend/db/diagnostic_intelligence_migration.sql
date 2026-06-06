-- Diagnostic Intelligence Module (Phase 1). Run once in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.patient_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  uploaded_by UUID,
  document_type TEXT NOT NULL CHECK (
    document_type IN (
      'mri_report',
      'xray',
      'pdf_report',
      'photo',
      'insurance_card',
      'id_document',
      'other'
    )
  ),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  upload_source TEXT NOT NULL DEFAULT 'receptionist' CHECK (
    upload_source IN ('receptionist', 'aria', 'patient_portal')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_documents_patient_id_idx
  ON public.patient_documents (patient_id);
CREATE INDEX IF NOT EXISTS patient_documents_clinic_id_idx
  ON public.patient_documents (clinic_id);
CREATE INDEX IF NOT EXISTS patient_documents_created_at_idx
  ON public.patient_documents (created_at DESC);

CREATE TABLE IF NOT EXISTS public.diagnostic_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.patient_documents (id) ON DELETE CASCADE,
  clinician_summary TEXT,
  patient_explanation TEXT,
  red_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  soap_suggestions JSONB NOT NULL DEFAULT '{}'::jsonb,
  imaging_date DATE,
  body_part TEXT,
  modality TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'analyzed', 'reviewed')
  ),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostic_analyses_patient_id_idx
  ON public.diagnostic_analyses (patient_id);
CREATE INDEX IF NOT EXISTS diagnostic_analyses_clinic_id_idx
  ON public.diagnostic_analyses (clinic_id);
CREATE INDEX IF NOT EXISTS diagnostic_analyses_document_id_idx
  ON public.diagnostic_analyses (document_id);
CREATE INDEX IF NOT EXISTS diagnostic_analyses_status_idx
  ON public.diagnostic_analyses (status);

CREATE TABLE IF NOT EXISTS public.imaging_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.diagnostic_analyses (id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS imaging_timeline_patient_id_idx
  ON public.imaging_timeline (patient_id);
CREATE INDEX IF NOT EXISTS imaging_timeline_event_date_idx
  ON public.imaging_timeline (event_date DESC);

-- Short-lived tokens for public patient document upload (Aria SMS flow)
CREATE TABLE IF NOT EXISTS public.document_upload_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_upload_tokens_token_idx
  ON public.document_upload_tokens (token);

-- ---------------------------------------------------------------------------
-- RLS (clinic-scoped, matches fee_schedule / measurements pattern)
-- ---------------------------------------------------------------------------

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_upload_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_documents_clinic_access ON public.patient_documents;
CREATE POLICY patient_documents_clinic_access ON public.patient_documents
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS diagnostic_analyses_clinic_access ON public.diagnostic_analyses;
CREATE POLICY diagnostic_analyses_clinic_access ON public.diagnostic_analyses
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS imaging_timeline_clinic_access ON public.imaging_timeline;
CREATE POLICY imaging_timeline_clinic_access ON public.imaging_timeline
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

-- Tokens: no direct client access; backend service role only
DROP POLICY IF EXISTS document_upload_tokens_deny ON public.document_upload_tokens;
CREATE POLICY document_upload_tokens_deny ON public.document_upload_tokens
  FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- Storage bucket: patient-documents (private)
-- Path convention: {clinic_id}/{patient_id}/{document_id}_{filename}
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'patient-documents',
  'patient-documents',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS patient_documents_storage_select ON storage.objects;
CREATE POLICY patient_documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS patient_documents_storage_insert ON storage.objects;
CREATE POLICY patient_documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS patient_documents_storage_delete ON storage.objects;
CREATE POLICY patient_documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
