-- เก็บ "ชื่อสินค้าดิบที่พิมพ์ตอน import" แยกจาก product_name
-- (product_name จะถูก resolve ทับด้วยชื่อจาก data_master เมื่อเจอ SKU)
ALTER TABLE public.monthly_usage_item
  ADD COLUMN IF NOT EXISTS imported_name text;
