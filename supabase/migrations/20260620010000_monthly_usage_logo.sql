-- Order B2B internal → Monthly usage: เพิ่มโลโก้ต่อเอกสาร (มุมซ้ายบนของฟอร์ม Monthly Usage Request)
-- เก็บเป็น public URL ใน storage bucket เดียวกับรูปสินค้า (monthly-usage-pictures)
ALTER TABLE public.monthly_usage_doc
  ADD COLUMN IF NOT EXISTS logo_url text;
