-- Storage bucket สำหรับรูป Monthly usage (Order B2B internal → Brand control)
-- เก็บรูปเป็นไฟล์จริง → ได้ public URL (ใช้แสดงผล + ใส่เป็นลิงก์ใน Excel export)

INSERT INTO storage.buckets (id, name, public)
VALUES ('monthly-usage-pictures', 'monthly-usage-pictures', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "mu_pictures_public_read" ON storage.objects;
CREATE POLICY "mu_pictures_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'monthly-usage-pictures');

DROP POLICY IF EXISTS "mu_pictures_auth_insert" ON storage.objects;
CREATE POLICY "mu_pictures_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'monthly-usage-pictures');

DROP POLICY IF EXISTS "mu_pictures_auth_update" ON storage.objects;
CREATE POLICY "mu_pictures_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'monthly-usage-pictures');

DROP POLICY IF EXISTS "mu_pictures_auth_delete" ON storage.objects;
CREATE POLICY "mu_pictures_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'monthly-usage-pictures');
