-- Order B2B internal → ปุ่ม Order
-- เอารายการจาก Monthly Usage ของแบรนด์มาเป็นตัวตั้ง (read-only) แล้วคีย์เฉพาะ Order Qty
-- กฎ: 1 Brand = 1 Order Doc (ถ้ามีแล้วให้แก้ไขเอกสารเดิม)

CREATE TABLE IF NOT EXISTS public.order_doc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no integer NOT NULL UNIQUE,   -- รันเลขอัตโนมัติ
  doc_label text,                   -- "{stamp} - {brand} (Order)"
  brand_id uuid,                    -- อ้างถึง brand (nullable)
  brand_name text,
  branch text,
  source_doc_id uuid,               -- monthly_usage_doc ที่เอามาเป็นตัวตั้ง
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.order_doc(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  sku_code text,          -- ID = sku_code จาก data_master
  barcode text,
  barcode_unit text,      -- main_barcode จาก data_master
  product_name text,
  uom text,
  monthly_qty numeric,    -- snapshot จาก Monthly Usage (อ้างอิง, read-only)
  order_qty numeric,      -- user คีย์เอง
  picture text,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_doc_select ON public.order_doc FOR SELECT TO authenticated USING (true);
CREATE POLICY order_doc_insert ON public.order_doc FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY order_doc_update ON public.order_doc FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_doc_delete ON public.order_doc FOR DELETE TO authenticated USING (true);

CREATE POLICY order_item_select ON public.order_item FOR SELECT TO authenticated USING (true);
CREATE POLICY order_item_insert ON public.order_item FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY order_item_update ON public.order_item FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_item_delete ON public.order_item FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_order_item_doc ON public.order_item(doc_id);
CREATE INDEX IF NOT EXISTS idx_order_doc_no ON public.order_doc(doc_no);
