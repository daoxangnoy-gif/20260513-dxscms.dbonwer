-- เก็บ Vendor code override ที่ผู้ใช้คีย์/Import ในแท็บ SCM Control → PO
-- key = sku (ต่อ 1 สินค้า 1 override) — sync ทุก user/เครื่อง
CREATE TABLE IF NOT EXISTS public.po_vendor_override (
  sku text PRIMARY KEY,
  vendor_code text,
  vendor_name text,
  vendor_currency text,
  vendor_origin text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.po_vendor_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_vendor_override_authenticated_all" ON public.po_vendor_override;
CREATE POLICY "po_vendor_override_authenticated_all"
ON public.po_vendor_override
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
