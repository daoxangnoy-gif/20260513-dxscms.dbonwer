
-- Add new columns
ALTER TABLE public.payment_overdue
  ADD COLUMN IF NOT EXISTS paid_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'overdue',
  ADD COLUMN IF NOT EXISTS document_url text,
  ADD COLUMN IF NOT EXISTS document_name text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Make payment-overdue bucket private
UPDATE storage.buckets SET public = false WHERE id = 'payment-overdue';

-- Create docs bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-overdue-docs', 'payment-overdue-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Drop old policies if any
DROP POLICY IF EXISTS "auth_read_payment_overdue_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_insert_payment_overdue_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_payment_overdue_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_payment_overdue_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_payment_overdue_docs_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_insert_payment_overdue_docs_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_payment_overdue_docs_storage" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_payment_overdue_docs_storage" ON storage.objects;

-- Read: any authenticated user can read (for signed urls)
CREATE POLICY "auth_read_payment_overdue_storage"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('payment-overdue','payment-overdue-docs'));

-- Insert: must upload to own folder
CREATE POLICY "auth_insert_payment_overdue_storage"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('payment-overdue','payment-overdue-docs')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Update: own folder
CREATE POLICY "auth_update_payment_overdue_storage"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('payment-overdue','payment-overdue-docs')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Delete: own folder
CREATE POLICY "auth_delete_payment_overdue_storage"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('payment-overdue','payment-overdue-docs')
  AND auth.uid()::text = (storage.foldername(name))[1]
);
