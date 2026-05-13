
CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(
  p_vendor_codes text[] DEFAULT NULL,
  p_spc_names text[] DEFAULT NULL,
  p_order_days text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL
)
RETURNS TABLE(
  sku_code text, main_barcode text, product_name_la text, product_name_en text,
  vendor_code text, vendor_display_name text, spc_name text, order_day text,
  delivery_day text, trade_term text, rank_sales text,
  leadtime numeric, order_cycle numeric,
  store_name text, type_store text,
  min_store numeric, max_store numeric, stock_store numeric, stock_dc numeric,
  avg_sales_store numeric, moq numeric, po_cost numeric, po_cost_unit numeric,
  on_order_store numeric, unit_of_measure text, item_type text, buying_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
  WITH filtered_vendors AS (
    SELECT DISTINCT ON (vm.vendor_code)
      vm.vendor_code AS vc, vm.spc_name AS sn, vm.order_day AS od,
      vm.delivery_day AS dd, vm.trade_term AS tt,
      vm.leadtime AS lt, vm.order_cycle AS oc
    FROM vendor_master vm
    WHERE (p_spc_names IS NULL OR vm.spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR vm.order_day = ANY(p_order_days))
      AND vm.vendor_origin IN ('Laos', 'Thailand')
    ORDER BY vm.vendor_code, vm.created_at DESC
  ),
  base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code AS bi_sku, dm.main_barcode AS bi_barcode,
      dm.product_name_la AS bi_name_la, dm.product_name_en AS bi_name_en,
      dm.vendor_code AS bi_vendor, dm.vendor_display_name AS bi_vendor_display,
      dm.unit_of_measure AS bi_uom, dm.item_type AS bi_item_type, dm.buying_status AS bi_buying
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND dm.packing_size_qty = 1
      AND dm.stock_unit_flag = 'Y'
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND dm.buying_status IN ('Active','Discontinue')
      AND (p_item_types IS NULL OR dm.item_type = ANY(p_item_types))
      AND (p_vendor_codes IS NULL OR dm.vendor_code = ANY(p_vendor_codes))
      AND dm.vendor_code IN (SELECT vc FROM filtered_vendors)
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  rank_data AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs WHERE rs.item_id IN (SELECT bi_sku FROM base_items)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  minmax_store AS (
    SELECT mm.item_id AS mm_item, mm.store_name AS mm_store, mm.type_store AS mm_type,
      COALESCE(SUM(mm.min_val),0) AS mm_min,
      COALESCE(SUM(mm.max_val),0) AS mm_max
    FROM minmax mm
    WHERE mm.item_id IN (SELECT bi_sku FROM base_items)
    GROUP BY mm.item_id, mm.store_name, mm.type_store
  ),
  stock_store AS (
    SELECT s.item_id AS ss_item, s.location AS ss_store, s.type_store AS ss_type,
      COALESCE(SUM(s.quantity),0) AS ss_qty
    FROM stock s
    WHERE s.item_id IN (SELECT bi_sku FROM base_items)
    GROUP BY s.item_id, s.location, s.type_store
  ),
  stock_dc_agg AS (
    SELECT s.item_id AS sdc_item,
      COALESCE(SUM(s.quantity),0) AS sdc_qty
    FROM stock s
    WHERE s.item_id IN (SELECT bi_sku FROM base_items)
      AND s.type_store = 'DC'
    GROUP BY s.item_id
  ),
  sales_store AS (
    SELECT sw.id18 AS sl_item, sw.store_name AS sl_store, sw.type_store AS sl_type,
      COALESCE(SUM(sw.avg_day),0) AS sl_avg
    FROM sales_by_week sw
    WHERE sw.id18 IN (SELECT bi_sku FROM base_items)
    GROUP BY sw.id18, sw.store_name, sw.type_store
  ),
  cost_data AS (
    SELECT DISTINCT ON (pc.item_id) pc.item_id AS cd_item,
      COALESCE(pc.moq,1) AS cd_moq, COALESCE(pc.po_cost,0) AS cd_cost, COALESCE(pc.po_cost_unit,0) AS cd_unit
    FROM po_cost pc WHERE pc.item_id IN (SELECT bi_sku FROM base_items)
    ORDER BY pc.item_id, pc.created_at DESC
  ),
  order_store AS (
    SELECT oo.sku_code AS os_item, oo.store_name AS os_store,
      COALESCE(SUM(oo.po_qty),0) AS os_qty
    FROM on_order oo
    WHERE oo.sku_code IN (SELECT bi_sku FROM base_items)
    GROUP BY oo.sku_code, oo.store_name
  ),
  store_items AS (
    SELECT DISTINCT bi_sku AS si_sku, ref.ref_store AS si_store, ref.ref_type AS si_type
    FROM base_items
    CROSS JOIN (
      SELECT DISTINCT mm_store AS ref_store, mm_type AS ref_type FROM minmax_store
      UNION
      SELECT DISTINCT ss_store, ss_type FROM stock_store WHERE ss_type != 'DC'
      UNION
      SELECT DISTINCT sl_store, sl_type FROM sales_store
    ) ref
    WHERE EXISTS (SELECT 1 FROM minmax_store WHERE mm_item = bi_sku AND mm_store = ref.ref_store)
    OR EXISTS (SELECT 1 FROM stock_store WHERE ss_item = bi_sku AND ss_store = ref.ref_store AND ss_type != 'DC')
    OR EXISTS (SELECT 1 FROM sales_store WHERE sl_item = bi_sku AND sl_store = ref.ref_store)
  )
  SELECT
    bi.bi_sku, bi.bi_barcode, bi.bi_name_la, bi.bi_name_en,
    bi.bi_vendor, bi.bi_vendor_display,
    COALESCE(fv.sn,'')::text,
    COALESCE(fv.od,'')::text,
    COALESCE(fv.dd,'')::text,
    COALESCE(fv.tt,'')::text,
    COALESCE(rd.final_rank,'D')::text,
    COALESCE(fv.lt,0),
    COALESCE(fv.oc,0),
    si.si_store::text,
    si.si_type::text,
    COALESCE(ms.mm_min,0),
    COALESCE(ms.mm_max,0),
    COALESCE(ss.ss_qty,0),
    COALESCE(sdc.sdc_qty,0),
    ROUND(COALESCE(sls.sl_avg,0)::numeric,4),
    COALESCE(cd.cd_moq,1),
    COALESCE(cd.cd_cost,0),
    COALESCE(cd.cd_unit,0),
    COALESCE(os.os_qty,0),
    COALESCE(bi.bi_uom,'')::text,
    COALESCE(bi.bi_item_type,'')::text,
    COALESCE(bi.bi_buying,'')::text
  FROM store_items si
  JOIN base_items bi ON bi.bi_sku = si.si_sku
  LEFT JOIN filtered_vendors fv ON bi.bi_vendor = fv.vc
  LEFT JOIN rank_data rd ON rd.item_id = bi.bi_sku
  LEFT JOIN minmax_store ms ON ms.mm_item = bi.bi_sku AND ms.mm_store = si.si_store
  LEFT JOIN stock_store ss ON ss.ss_item = bi.bi_sku AND ss.ss_store = si.si_store AND ss.ss_type != 'DC'
  LEFT JOIN stock_dc_agg sdc ON sdc.sdc_item = bi.bi_sku
  LEFT JOIN sales_store sls ON sls.sl_item = bi.bi_sku AND sls.sl_store = si.si_store
  LEFT JOIN cost_data cd ON cd.cd_item = bi.bi_sku
  LEFT JOIN order_store os ON os.os_item = bi.bi_sku AND os.os_store = si.si_store
  ORDER BY bi.bi_vendor, bi.bi_sku, si.si_store;
$function$;
