-- Logo ของแบรนด์ (แยกจาก logo_url ที่ใช้หัวเอกสารฟอร์ม) — แสดงในตารางเอกสาร Monthly usage
ALTER TABLE public.monthly_usage_doc
  ADD COLUMN IF NOT EXISTS brand_logo_url text;
