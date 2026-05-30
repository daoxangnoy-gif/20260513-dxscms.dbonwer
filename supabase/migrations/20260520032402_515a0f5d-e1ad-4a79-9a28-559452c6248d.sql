
-- Add attachment_url to document_movements (one image per movement/point)
ALTER TABLE public.document_movements
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- Public storage bucket for movement attachments (jpg/png — one per point)
INSERT INTO storage.buckets (id, name, public)
VALUES ('movement-attachments', 'movement-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies: public read, authenticated write/update/delete
DROP POLICY IF EXISTS "movement_attachments_public_read" ON storage.objects;
CREATE POLICY "movement_attachments_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'movement-attachments');

DROP POLICY IF EXISTS "movement_attachments_auth_insert" ON storage.objects;
CREATE POLICY "movement_attachments_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'movement-attachments');

DROP POLICY IF EXISTS "movement_attachments_auth_update" ON storage.objects;
CREATE POLICY "movement_attachments_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'movement-attachments');

DROP POLICY IF EXISTS "movement_attachments_auth_delete" ON storage.objects;
CREATE POLICY "movement_attachments_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'movement-attachments');

-- Allow authenticated users to UPDATE document_movements (needed to set attachment_url)
DROP POLICY IF EXISTS "auth_update_document_movements" ON public.document_movements;
CREATE POLICY "auth_update_document_movements"
  ON public.document_movements FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
