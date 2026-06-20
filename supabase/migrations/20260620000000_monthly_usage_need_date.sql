-- Order B2B internal → Monthly usage: เพิ่ม "วันที่คาดว่าจะเบิก" (DATE Need)
-- ใช้ตอนกด Save เพื่อออกฟอร์ม Monthly Usage Request และ prefill ตอนเปิดแก้ไขเอกสารเดิม
ALTER TABLE public.monthly_usage_doc
  ADD COLUMN IF NOT EXISTS need_date date;
