-- 1) Remove duplicates first (keep the latest updated_at row per item_id+vendor)
DELETE FROM public.po_cost a
USING public.po_cost b
WHERE a.item_id IS NOT DISTINCT FROM b.item_id
  AND a.vendor  IS NOT DISTINCT FROM b.vendor
  AND a.updated_at < b.updated_at;

-- 2) Create unique index to enable fast ON CONFLICT and fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS po_cost_item_vendor_uniq
  ON public.po_cost (item_id, vendor);

-- 3) Helper indexes for filter/select queries
CREATE INDEX IF NOT EXISTS po_cost_item_id_idx ON public.po_cost (item_id);
CREATE INDEX IF NOT EXISTS po_cost_vendor_idx  ON public.po_cost (vendor);