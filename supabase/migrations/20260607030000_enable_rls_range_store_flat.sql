-- ปิดช่องโหว่ CRITICAL: range_store_flat ไม่มี RLS → anon key อ่าน/เขียนได้
-- ตารางนี้เป็น cache ที่เขียนผ่าน function SECURITY DEFINER เท่านั้น (bypass RLS)
-- frontend ไม่แตะตรงๆ → เปิด RLS ปลอดภัย ไม่กระทบระบบ
-- ให้สิทธิ์ authenticated อ่านได้ (เผื่อ debug/admin), anon เข้าไม่ได้

ALTER TABLE public.range_store_flat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_range_store_flat ON public.range_store_flat;
CREATE POLICY auth_read_range_store_flat
  ON public.range_store_flat
  FOR SELECT
  TO authenticated
  USING (true);
