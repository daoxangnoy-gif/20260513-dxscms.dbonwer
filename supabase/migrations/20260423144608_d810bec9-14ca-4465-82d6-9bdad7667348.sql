-- 1) Normalize vendor field to code only (split on first '-')
UPDATE public.po_cost
SET vendor = split_part(vendor, '-', 1)
WHERE vendor IS NOT NULL AND vendor LIKE '%-%';

-- 2) Trim whitespace
UPDATE public.po_cost
SET vendor = trim(vendor)
WHERE vendor IS NOT NULL;

UPDATE public.po_cost
SET item_id = trim(item_id)
WHERE item_id IS NOT NULL;

-- 3) Deduplicate: keep latest row per (item_id, vendor)
DELETE FROM public.po_cost a
USING public.po_cost b
WHERE a.id < b.id
  AND COALESCE(a.item_id,'') = COALESCE(b.item_id,'')
  AND COALESCE(a.vendor,'') = COALESCE(b.vendor,'');

-- 4) Add unique constraint for upsert support
ALTER TABLE public.po_cost
DROP CONSTRAINT IF EXISTS po_cost_item_vendor_unique;

ALTER TABLE public.po_cost
ADD CONSTRAINT po_cost_item_vendor_unique UNIQUE (item_id, vendor);

-- 5) Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_po_cost_item_vendor ON public.po_cost (item_id, vendor);