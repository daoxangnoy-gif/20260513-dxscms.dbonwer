-- Order B2B internal → Monthly usage: แนบไฟล์ PDF ที่เซ็นแล้ว + ติดตามสถานะอัปโหลด
-- signed_pdf_url      = ลิงก์ไฟล์ล่าสุด
-- signed_uploaded_at  = วันที่/เวลาอัปล่าสุด
-- signed_count        = จำนวนครั้งที่อัป
ALTER TABLE public.monthly_usage_doc
  ADD COLUMN IF NOT EXISTS signed_pdf_url text,
  ADD COLUMN IF NOT EXISTS signed_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_count integer NOT NULL DEFAULT 0;
