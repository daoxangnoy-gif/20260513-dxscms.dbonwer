-- Vendor Quotation (Data Control → PO Cost → tab "Vendor Quotation")
-- เก็บไฟล์ใบเสนอราคาของแต่ละ vendor (รูป / PDF / Excel) แนบไว้ดูร่วมกันทุก User
-- + RPC นับจำนวน SKU ต่อ vendor แยกตามสถานะ (Active / Discontinue / Inactive)

-- 1) ตารางเก็บ metadata ของไฟล์ที่แนบ
CREATE TABLE IF NOT EXISTS public.vendor_quotation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code text NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_quotation ENABLE ROW LEVEL SECURITY;

CREATE POLICY vq_select ON public.vendor_quotation FOR SELECT TO authenticated USING (true);
CREATE POLICY vq_insert ON public.vendor_quotation FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vq_update ON public.vendor_quotation FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vq_delete ON public.vendor_quotation FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_vq_vendor ON public.vendor_quotation(vendor_code);

-- 2) Storage bucket สำหรับไฟล์ใบเสนอราคา (public อ่านได้ผ่าน public URL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-quotations', 'vendor-quotations', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "vq_files_public_read" ON storage.objects;
CREATE POLICY "vq_files_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vendor-quotations');

DROP POLICY IF EXISTS "vq_files_auth_insert" ON storage.objects;
CREATE POLICY "vq_files_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-quotations');

DROP POLICY IF EXISTS "vq_files_auth_update" ON storage.objects;
CREATE POLICY "vq_files_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vendor-quotations');

DROP POLICY IF EXISTS "vq_files_auth_delete" ON storage.objects;
CREATE POLICY "vq_files_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vendor-quotations');

-- 3) RPC: นับจำนวน SKU ต่อ vendor แยกตาม buying_status (จาก data_master ของ SKU ใน po_cost)
CREATE OR REPLACE FUNCTION public.get_vendor_quotation_counts()
RETURNS TABLE (vendor_code text, active_count bigint, discon_count bigint, inactive_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pce.vendor_code,
    count(*) FILTER (WHERE dm.buying_status = 'Active')        AS active_count,
    count(*) FILTER (WHERE dm.buying_status ILIKE 'discon%')   AS discon_count,
    count(*) FILTER (WHERE dm.buying_status = 'Inactive')      AS inactive_count
  FROM po_cost_enriched pce
  LEFT JOIN LATERAL (
    SELECT buying_status FROM data_master d WHERE d.sku_code = pce.item_id LIMIT 1
  ) dm ON true
  WHERE pce.vendor_code IS NOT NULL
  GROUP BY pce.vendor_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_vendor_quotation_counts() TO authenticated, anon;
