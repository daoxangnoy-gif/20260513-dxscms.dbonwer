-- ตารางลูกเก็บ UOM หลายบรรทัดต่อสินค้า DC(KR) — Raw data (Mainbarcode/Barcode/UOM/UOM Qty)
-- ใช้ตอน Take in/out เพื่อตัดสต็อกตาม UOM Qty (สแกน barcode → uom_qty → หน่วยฐาน)
CREATE TABLE IF NOT EXISTS public.dckr_item_uom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.dckr_item(id) ON DELETE CASCADE,
  main_barcode text,
  barcode text,
  uom text,
  uom_qty numeric,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dckr_item_uom_item_id_idx ON public.dckr_item_uom(item_id);
CREATE INDEX IF NOT EXISTS dckr_item_uom_barcode_idx ON public.dckr_item_uom(barcode);

ALTER TABLE public.dckr_item_uom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dckr_item_uom_authenticated_all" ON public.dckr_item_uom;
CREATE POLICY "dckr_item_uom_authenticated_all"
ON public.dckr_item_uom
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
