CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(p_vendor_codes text[] DEFAULT NULL::text[], p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, vendor_code text, vendor_display_name text, spc_name text, order_day text, delivery_day text, trade_term text, rank_sales text, leadtime numeric, order_cycle numeric, store_name text, type_store text, min_store numeric, max_store numeric, stock_store numeric, stock_dc numeric, avg_sales_store numeric, moq numeric, po_cost numeric, po_cost_unit numeric, on_order_store numeric, unit_of_measure text, item_type text, buying_status text)
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
      AND (vm.trade_term IS NULL OR vm.trade_term != 'Consignment')
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
  -- *** FIX: Exclude Kokkok-FC type_store ***
  all_stores AS (
    SELECT DISTINCT mm.store_name AS as_store, mm.type_store AS as_type
    FROM minmax mm
    WHERE mm.store_name IS NOT NULL AND mm.store_name != ''
      AND (mm.type_store IS NULL OR mm.type_store != 'Kokkok-FC')
  ),
  minmax_stores AS (
    SELECT DISTINCT mm.item_id AS ms_sku, mm.store_name AS ms_store, mm.type_store AS ms_type
    FROM minmax mm
    WHERE mm.item_id IN (SELECT bi_sku FROM base_items)
      AND mm.store_name IS NOT NULL AND mm.store_name != ''
      AND (mm.type_store IS NULL OR mm.type_store != 'Kokkok-FC')
  ),
  no_minmax_items AS (
    SELECT bi.bi_sku AS ms_sku, ast.as_store AS ms_store, ast.as_type AS ms_type
    FROM base_items bi
    CROSS JOIN all_stores ast
    WHERE NOT EXISTS (SELECT 1 FROM minmax_stores ms WHERE ms.ms_sku = bi.bi_sku)
  ),
  all_store_items AS (
    SELECT * FROM minmax_stores
    UNION ALL
    SELECT * FROM no_minmax_items
  ),
  rank_data AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id AS rd_item, rs.final_rank AS rd_rank
    FROM rank_sales rs WHERE rs.item_id IN (SELECT bi_sku FROM base_items)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  minmax_agg AS (
    SELECT mm.item_id AS mm_item, mm.store_name AS mm_store,
      COALESCE(SUM(mm.min_val),0) AS mm_min,
      COALESCE(SUM(mm.max_val),0) AS mm_max
    FROM minmax mm
    WHERE mm.item_id IN (SELECT bi_sku FROM base_items)
      AND (mm.type_store IS NULL OR mm.type_store != 'Kokkok-FC')
    GROUP BY mm.item_id, mm.store_name
  ),
  stock_store_agg AS (
    SELECT s.item_id AS ss_item, s.company AS ss_store,
      COALESCE(SUM(s.quantity),0) AS ss_qty
    FROM stock s
    WHERE s.item_id IN (SELECT bi_sku FROM base_items)
      AND s.type_store != 'DC'
      AND (s.type_store IS NULL OR s.type_store != 'Kokkok-FC')
    GROUP BY s.item_id, s.company
  ),
  stock_dc_agg AS (
    SELECT s.item_id AS sdc_item,
      COALESCE(SUM(s.quantity),0) AS sdc_qty
    FROM stock s
    WHERE s.item_id IN (SELECT bi_sku FROM base_items)
      AND s.type_store = 'DC'
    GROUP BY s.item_id
  ),
  sales_store_agg AS (
    SELECT sw.id18 AS sl_item, sw.store_name AS sl_store,
      COALESCE(SUM(sw.avg_day),0) AS sl_avg
    FROM sales_by_week sw
    WHERE sw.id18 IN (SELECT bi_sku FROM base_items)
      AND (sw.type_store IS NULL OR sw.type_store != 'Kokkok-FC')
    GROUP BY sw.id18, sw.store_name
  ),
  cost_data AS (
    SELECT DISTINCT ON (pc.item_id) pc.item_id AS cd_item,
      COALESCE(pc.moq,1) AS cd_moq, COALESCE(pc.po_cost,0) AS cd_cost, COALESCE(pc.po_cost_unit,0) AS cd_unit
    FROM po_cost pc WHERE pc.item_id IN (SELECT bi_sku FROM base_items)
    ORDER BY pc.item_id, pc.created_at DESC
  ),
  order_store_agg AS (
    SELECT oo.sku_code AS os_item, oo.store_name AS os_store,
      COALESCE(SUM(oo.po_qty),0) AS os_qty
    FROM on_order oo
    WHERE oo.sku_code IN (SELECT bi_sku FROM base_items)
    GROUP BY oo.sku_code, oo.store_name
  )
  SELECT
    bi.bi_sku::text,
    bi.bi_barcode::text,
    bi.bi_name_la::text,
    bi.bi_name_en::text,
    bi.bi_vendor::text,
    bi.bi_vendor_display::text,
    COALESCE(fv.sn,'')::text,
    COALESCE(fv.od,'')::text,
    COALESCE(fv.dd,'')::text,
    COALESCE(fv.tt,'')::text,
    COALESCE(rd.rd_rank,'D')::text,
    COALESCE(fv.lt,0)::numeric,
    COALESCE(fv.oc,0)::numeric,
    asi.ms_store::text,
    asi.ms_type::text,
    COALESCE(ma.mm_min,0)::numeric,
    COALESCE(ma.mm_max,0)::numeric,
    COALESCE(ssa.ss_qty,0)::numeric,
    COALESCE(sdc.sdc_qty,0)::numeric,
    ROUND(COALESCE(sla.sl_avg,0)::numeric,4)::numeric,
    COALESCE(cd.cd_moq,1)::numeric,
    COALESCE(cd.cd_cost,0)::numeric,
    COALESCE(cd.cd_unit,0)::numeric,
    COALESCE(os.os_qty,0)::numeric,
    COALESCE(bi.bi_uom,'')::text,
    COALESCE(bi.bi_item_type,'')::text,
    COALESCE(bi.bi_buying,'')::text
  FROM all_store_items asi
  JOIN base_items bi ON bi.bi_sku = asi.ms_sku
  LEFT JOIN filtered_vendors fv ON bi.bi_vendor = fv.vc
  LEFT JOIN rank_data rd ON rd.rd_item = bi.bi_sku
  LEFT JOIN minmax_agg ma ON ma.mm_item = bi.bi_sku AND ma.mm_store = asi.ms_store
  LEFT JOIN stock_store_agg ssa ON ssa.ss_item = bi.bi_sku AND ssa.ss_store = asi.ms_store
  LEFT JOIN stock_dc_agg sdc ON sdc.sdc_item = bi.bi_sku
  LEFT JOIN sales_store_agg sla ON sla.sl_item = bi.bi_sku AND sla.sl_store = asi.ms_store
  LEFT JOIN cost_data cd ON cd.cd_item = bi.bi_sku
  LEFT JOIN order_store_agg os ON os.os_item = bi.bi_sku AND os.os_store = asi.ms_store
  ORDER BY bi.bi_vendor, bi.bi_sku, asi.ms_store;
$function$;