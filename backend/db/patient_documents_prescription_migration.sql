-- Add 'prescription' to patient_documents.document_type CHECK constraint.
-- Run once in the Supabase SQL editor.

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
      'other'
    )
  );
