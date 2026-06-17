-- Monthly usage (Order B2B internal → tab Brand control → ปุ่ม Monthly usage)
-- โครงสร้าง: 1 Save = 1 doc (monthly_usage_doc) ที่มีหลายรายการ (monthly_usage_item)
-- doc ผูกกับ Brand (จาก List Brand) → label = "{brand} {branch} MU-0001"
-- picture เก็บเป็น base64 data URL ในคอลัมน์ text (ไม่ต้องตั้ง Storage bucket)

CREATE TABLE IF NOT EXISTS public.monthly_usage_doc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no integer NOT NULL UNIQUE,   -- รันเลขอัตโนมัติ
  doc_label text,                   -- "{brand} {branch} MU-0001"
  brand_id uuid,                    -- อ้างถึง brand (nullable)
  brand_name text,
  branch text,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monthly_usage_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.monthly_usage_doc(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  sku_code text,          -- ID = sku_code จาก data_master
  barcode text,           -- user คีย์เอง (รองรับทุกรหัส)
  barcode_unit text,      -- main_barcode จาก data_master (packing_size_qty = 1)
  product_name text,      -- ชื่อสินค้าจาก data_master
  uom text,               -- unit_of_measure จาก data_master (packing_size_qty = 1)
  monthly_qty numeric,    -- user คีย์เอง
  daily_qty numeric,      -- monthly_qty / 30
  picture text,           -- base64 data URL (import / paste / ถ่ายรูป)
  remark text,            -- user คีย์เอง
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_usage_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_usage_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY mu_doc_select ON public.monthly_usage_doc FOR SELECT TO authenticated USING (true);
CREATE POLICY mu_doc_insert ON public.monthly_usage_doc FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mu_doc_update ON public.monthly_usage_doc FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mu_doc_delete ON public.monthly_usage_doc FOR DELETE TO authenticated USING (true);

CREATE POLICY mu_item_select ON public.monthly_usage_item FOR SELECT TO authenticated USING (true);
CREATE POLICY mu_item_insert ON public.monthly_usage_item FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mu_item_update ON public.monthly_usage_item FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mu_item_delete ON public.monthly_usage_item FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_mu_item_doc ON public.monthly_usage_item(doc_id);
CREATE INDEX IF NOT EXISTS idx_mu_doc_no ON public.monthly_usage_doc(doc_no);
