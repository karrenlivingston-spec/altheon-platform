-- Clinic-level reference documents (Protocols section). Run once in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clinic_reference_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  storage_path TEXT NOT NULL,
  uploaded_by UUID,
  visibility TEXT NOT NULL DEFAULT 'clinical' CHECK (
    visibility IN ('clinical', 'admin_only')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinic_reference_documents_clinic_id_idx
  ON public.clinic_reference_documents (clinic_id);

CREATE INDEX IF NOT EXISTS clinic_reference_documents_created_at_idx
  ON public.clinic_reference_documents (created_at DESC);

CREATE INDEX IF NOT EXISTS clinic_reference_documents_category_idx
  ON public.clinic_reference_documents (clinic_id, category);

-- ---------------------------------------------------------------------------
-- RLS (clinic-scoped, matches patient_documents pattern)
-- ---------------------------------------------------------------------------

ALTER TABLE public.clinic_reference_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_reference_documents_clinic_access
  ON public.clinic_reference_documents;
CREATE POLICY clinic_reference_documents_clinic_access
  ON public.clinic_reference_documents
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket: clinic-documents (private)
-- Path convention: {clinic_id}/{document_id}_{filename}
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-documents',
  'clinic-documents',
  false,
  20971520,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS clinic_documents_storage_select ON storage.objects;
CREATE POLICY clinic_documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinic-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clinic_documents_storage_insert ON storage.objects;
CREATE POLICY clinic_documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clinic_documents_storage_delete ON storage.objects;
CREATE POLICY clinic_documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'clinic-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );
