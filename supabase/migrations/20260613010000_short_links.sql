-- Short links: ย่อลิงก์ในระบบเอง (ใช้กับ Job Assign WhatsApp และอื่นๆ)
-- เก็บ target_url (มักเป็น signed URL ที่หมดอายุเองอยู่แล้ว) แล้ว redirect ผ่านหน้า #/r/:id

CREATE TABLE IF NOT EXISTS public.short_links (
  id text PRIMARY KEY,
  target_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทั้ง anon + authenticated (ผู้รับลิงก์ใน WhatsApp มักยังไม่ได้ login)
-- ปลอดภัยพอ: id สุ่ม ~7 ตัว เดายาก และ target เป็น signed URL ที่จำกัดเวลาอยู่แล้ว
CREATE POLICY short_links_read ON public.short_links
  FOR SELECT TO anon, authenticated USING (true);

-- เฉพาะ authenticated สร้างได้
CREATE POLICY short_links_insert ON public.short_links
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_short_links_created ON public.short_links(created_at);
