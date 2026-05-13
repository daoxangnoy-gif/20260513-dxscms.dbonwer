
-- Create enriched view for po_cost: JOIN po_cost ↔ vendor_master ↔ data_master
-- Solves: missing master columns on export, UI flicker from 2-stage queries, race conditions in extrasMap merge
CREATE OR REPLACE VIEW public.po_cost_enriched AS
WITH pc AS (
  SELECT * FROM public.po_cost
),
vm AS (
  SELECT DISTINCT ON (vendor_code)
    vendor_code,
    UPPER(COALESCE(supplier_currency, '')) AS supplier_currency,
    COALESCE(vendor_name_en, vendor_name_la, '') AS vendor_name
  FROM public.vendor_master
  WHERE vendor_code IS NOT NULL
  ORDER BY vendor_code, updated_at DESC
),
-- Latest base master row per sku (for hierarchy/buyer/product name)
dm_base AS (
  SELECT DISTINCT ON (sku_code)
    sku_code,
    product_name_la,
    division_group, division, department, sub_department, class, sub_class,
    gm_buyer_code, header_buyer_code, buyer_code
  FROM public.data_master
  WHERE sku_code IS NOT NULL
  ORDER BY sku_code, updated_at DESC
),
-- Unit row: packing_size_qty = 1 → list_price, jmart_price, main_barcode_unit
dm_unit AS (
  SELECT DISTINCT ON (sku_code)
    sku_code,
    main_barcode AS main_barcode_unit,
    list_price,
    jmart_price
  FROM public.data_master
  WHERE sku_code IS NOT NULL
    AND packing_size_qty = 1
  ORDER BY sku_code, updated_at DESC
),
-- Pack row: packing_size_qty = po_cost.moq → main_barcode_pack
dm_pack AS (
  SELECT DISTINCT ON (pc.id)
    pc.id AS pc_id,
    d.main_barcode AS main_barcode_pack
  FROM pc
  JOIN public.data_master d
    ON d.sku_code = pc.item_id
   AND d.packing_size_qty = pc.moq
   AND pc.moq IS NOT NULL
  ORDER BY pc.id, d.updated_at DESC
)
SELECT
  pc.id,
  pc.item_id,
  pc.vendor              AS vendor_code,
  vm.vendor_name,
  vm.supplier_currency,
  pc.goodcode,
  pc.product_name        AS po_product_name,
  pc.moq,
  pc.po_cost,
  pc.po_cost_unit,
  pc.created_at,
  pc.updated_at,
  -- Master enrichment
  dm_base.product_name_la,
  dm_base.division_group,
  dm_base.division,
  dm_base.department,
  dm_base.sub_department,
  dm_base.class,
  dm_base.sub_class,
  dm_base.gm_buyer_code,
  dm_base.header_buyer_code,
  dm_base.buyer_code,
  dm_unit.main_barcode_unit,
  dm_unit.list_price,
  dm_unit.jmart_price,
  dm_pack.main_barcode_pack
FROM pc
LEFT JOIN vm      ON vm.vendor_code = pc.vendor
LEFT JOIN dm_base ON dm_base.sku_code = pc.item_id
LEFT JOIN dm_unit ON dm_unit.sku_code = pc.item_id
LEFT JOIN dm_pack ON dm_pack.pc_id = pc.id;

-- Helpful indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_data_master_sku_pack ON public.data_master (sku_code, packing_size_qty);
CREATE INDEX IF NOT EXISTS idx_po_cost_item_id ON public.po_cost (item_id);
CREATE INDEX IF NOT EXISTS idx_vendor_master_code ON public.vendor_master (vendor_code);
