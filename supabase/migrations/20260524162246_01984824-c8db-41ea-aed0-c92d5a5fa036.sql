ALTER TABLE public.document_movements
  ADD COLUMN IF NOT EXISTS attachment_uploaded_by uuid;