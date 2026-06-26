-- ตารางเก็บข้อมูลสินค้า DC(KR) Control → tab Data
-- เก็บถาวรใน Supabase (ทุก user เห็นชุดเดียวกัน) — เก็บ field เป็น text เพื่อรองรับการคีย์เองได้ทุกแบบ
CREATE TABLE IF NOT EXISTS public.dckr_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_key text,
  sku_code text,
  barcode_unit text,
  barcode_pack text,
  barcode_box text,
  product_name_la text,
  product_name_en text,
  pack_qty text,
  box_qty text,
  cost text,
  found boolean NOT NULL DEFAULT false,   -- พบใน data_master หรือไม่ → Remark SKU (true=Data odoo, false=Data คีเอง)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

ALTER TABLE public.dckr_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dckr_item_authenticated_all" ON public.dckr_item;
CREATE POLICY "dckr_item_authenticated_all"
ON public.dckr_item
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
