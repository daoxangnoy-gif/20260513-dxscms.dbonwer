-- Order group ต่อ 1 item ของ Monthly usage — ใช้แยก/จัดกลุ่มออเดอร์ภายหลัง (คีย์ค่าเอง)
ALTER TABLE public.monthly_usage_item
  ADD COLUMN IF NOT EXISTS order_group text;
