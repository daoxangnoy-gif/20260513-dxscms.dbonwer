
-- Helper view for latest minmax doc as flat rows (sku x store)
CREATE OR REPLACE FUNCTION public.get_latest_minmax_flat()
RETURNS TABLE(
  sku_code text,
  store_name text,
  type_store text,
  min_val numeric,
  max_val numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH latest AS (
    SELECT id FROM public.minmax_cal_documents
    ORDER BY created_at DESC LIMIT 1
  )
  SELECT
    (r->>'sku_code')::text,
    (r->>'store_name')::text,
    COALESCE(r->>'type_store','')::text,
    NULLIF(r->>'min_final','')::numeric,
    NULLIF(r->>'max_final','')::numeric
  FROM public.minmax_cal_documents d,
       LATERAL jsonb_array_elements(d.data) r
  WHERE d.id IN (SELECT id FROM latest);
$$;


-- ===== get_srr_data (DC view) — read Min/Max from latest doc =====
CREATE OR REPLACE FUNCTION public.get_srr_data(p_vendor_codes text[] DEFAULT NULL::text[], p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, vendor_code text, vendor_display_name text, spc_name text, order_day text, rank_sales text, leadtime numeric, order_cycle numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_udee numeric, moq numeric, po_cost numeric, po_cost_unit numeric, on_order numeric, unit_of_measure text, item_type text, buying_status text, po_group text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  RETURN QUERY
  WITH filtered_vendors AS (
    SELECT DISTINCT ON (vm.vendor_code)
      vm.vendor_code AS vc, vm.spc_name AS sn, vm.order_day AS od,
      vm.leadtime AS lt, vm.order_cycle AS oc
    FROM vendor_master vm
    WHERE (p_spc_names IS NULL OR vm.spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR vm.order_day = ANY(p_order_days))
      AND vm.vendor_origin IN ('Laos', 'Thailand')
    ORDER BY vm.vendor_code, vm.created_at DESC
  ),
  base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
      dm.vendor_code, dm.vendor_display_name, dm.unit_of_measure,
      dm.item_type, dm.buying_status, dm.po_group
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
    FROM rank_sales rs WHERE rs.item_id IN (SELECT bi.sku_code FROM base_items bi)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  -- Use latest Min/Max document (per SKU x type_store)
  minmax_doc AS (
    SELECT mf.sku_code, mf.type_store, mf.min_val, mf.max_val
    FROM public.get_latest_minmax_flat() mf
  ),
  minmax_agg AS (
    SELECT md.sku_code AS item_id,
      COALESCE(SUM(CASE WHEN md.type_store='Jmart' THEN md.min_val END),0) AS min_jmart,
      COALESCE(SUM(CASE WHEN md.type_store='Jmart' THEN md.max_val END),0) AS max_jmart,
      COALESCE(SUM(CASE WHEN md.type_store IN ('Kokkok','Kokkok-FC') THEN md.min_val END),0) AS min_kokkok,
      COALESCE(SUM(CASE WHEN md.type_store IN ('Kokkok','Kokkok-FC') THEN md.max_val END),0) AS max_kokkok,
      COALESCE(SUM(CASE WHEN md.type_store='U-dee' THEN md.min_val END),0) AS min_udee,
      COALESCE(SUM(CASE WHEN md.type_store='U-dee' THEN md.max_val END),0) AS max_udee
    FROM minmax_doc md
    WHERE md.sku_code IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY md.sku_code
  ),
  stock_agg AS (
    SELECT s.item_id,
      COALESCE(SUM(CASE WHEN s.type_store='DC' THEN s.quantity END),0) AS stock_dc,
      COALESCE(SUM(CASE WHEN s.type_store='Jmart' THEN s.quantity END),0) AS stock_jmart,
      COALESCE(SUM(CASE WHEN s.type_store IN ('Kokkok','Kokkok-FC') THEN s.quantity END),0) AS stock_kokkok,
      COALESCE(SUM(CASE WHEN s.type_store='U-dee' THEN s.quantity END),0) AS stock_udee
    FROM stock s WHERE s.item_id IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY s.item_id
  ),
  sales_agg AS (
    SELECT sw.id18 AS item_id,
      COALESCE(SUM(CASE WHEN sw.type_store='Jmart' THEN sw.avg_day END),0) AS avg_jmart,
      COALESCE(SUM(CASE WHEN sw.type_store IN ('Kokkok','Kokkok-FC') THEN sw.avg_day END),0) AS avg_kokkok,
      COALESCE(SUM(CASE WHEN sw.type_store='U-dee' THEN sw.avg_day END),0) AS avg_udee
    FROM sales_by_week sw WHERE sw.id18 IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY sw.id18
  ),
  cost_data AS (
    SELECT DISTINCT ON (pc.item_id) pc.item_id,
      COALESCE(pc.moq,1) AS moq, COALESCE(pc.po_cost,0) AS po_cost, COALESCE(pc.po_cost_unit,0) AS po_cost_unit
    FROM po_cost pc WHERE pc.item_id IN (SELECT bi.sku_code FROM base_items bi)
    ORDER BY pc.item_id, pc.created_at DESC
  ),
  order_agg AS (
    SELECT oo.sku_code AS item_id, COALESCE(SUM(oo.po_qty),0) AS total_po_qty
    FROM on_order oo WHERE oo.sku_code IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY oo.sku_code
  )
  SELECT
    bi.sku_code, bi.main_barcode, bi.product_name_la, bi.product_name_en,
    bi.vendor_code, bi.vendor_display_name,
    COALESCE(fv.sn,'')::text AS spc_name, COALESCE(fv.od,'')::text AS order_day,
    COALESCE(rd.final_rank,'D')::text AS rank_sales,
    COALESCE(fv.lt,0) AS leadtime, COALESCE(fv.oc,0) AS order_cycle,
    COALESCE(mma.min_jmart,0), COALESCE(mma.max_jmart,0),
    COALESCE(mma.min_kokkok,0), COALESCE(mma.max_kokkok,0),
    COALESCE(mma.min_udee,0), COALESCE(mma.max_udee,0),
    COALESCE(sa.stock_dc,0), COALESCE(sa.stock_jmart,0),
    COALESCE(sa.stock_kokkok,0), COALESCE(sa.stock_udee,0),
    ROUND(COALESCE(sla.avg_jmart,0)::numeric,4), ROUND(COALESCE(sla.avg_kokkok,0)::numeric,4),
    ROUND(COALESCE(sla.avg_udee,0)::numeric,4),
    COALESCE(cd.moq,1), COALESCE(cd.po_cost,0), COALESCE(cd.po_cost_unit,0),
    COALESCE(oa.total_po_qty,0) AS on_order,
    COALESCE(bi.unit_of_measure,'')::text AS unit_of_measure,
    COALESCE(bi.item_type,'')::text AS item_type,
    COALESCE(bi.buying_status,'')::text AS buying_status,
    COALESCE(bi.po_group,'')::text AS po_group
  FROM base_items bi
  LEFT JOIN filtered_vendors fv ON bi.vendor_code = fv.vc
  LEFT JOIN rank_data rd ON rd.item_id = bi.sku_code
  LEFT JOIN minmax_agg mma ON mma.item_id = bi.sku_code
  LEFT JOIN stock_agg sa ON sa.item_id = bi.sku_code
  LEFT JOIN sales_agg sla ON sla.item_id = bi.sku_code
  LEFT JOIN cost_data cd ON cd.item_id = bi.sku_code
  LEFT JOIN order_agg oa ON oa.item_id = bi.sku_code
  ORDER BY bi.vendor_code, bi.sku_code;
END;
$function$;


-- ===== get_srr_d2s_data (Direct view) — read Min/Max from latest doc per store =====
CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(p_vendor_codes text[] DEFAULT NULL::text[], p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, vendor_code text, vendor_display_name text, spc_name text, order_day text, delivery_day text, trade_term text, rank_sales text, leadtime numeric, order_cycle numeric, store_name text, type_store text, min_store numeric, max_store numeric, stock_store numeric, stock_dc numeric, avg_sales_store numeric, moq numeric, po_cost numeric, po_cost_unit numeric, on_order_store numeric, unit_of_measure text, item_type text, buying_status text, po_group text)
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
      dm.unit_of_measure AS bi_uom, dm.item_type AS bi_item_type, dm.buying_status AS bi_buying,
      dm.po_group AS bi_po_group
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
  -- pull stores from latest minmax doc (per SKU)
  minmax_doc AS (
    SELECT mf.sku_code AS ms_sku, mf.store_name AS ms_store, mf.type_store AS ms_type,
           mf.min_val, mf.max_val
    FROM public.get_latest_minmax_flat() mf
    WHERE mf.type_store IS NULL OR mf.type_store != 'Kokkok-FC'
  ),
  store_items AS (
    SELECT DISTINCT md.ms_sku, md.ms_store, md.ms_type
    FROM minmax_doc md
    WHERE md.ms_sku IN (SELECT bi_sku FROM base_items)
      AND md.ms_store IS NOT NULL AND md.ms_store != ''
  ),
  rank_data AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id AS rd_item, rs.final_rank AS rd_rank
    FROM rank_sales rs WHERE rs.item_id IN (SELECT bi_sku FROM base_items)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  minmax_agg AS (
    SELECT md.ms_sku AS mm_item, md.ms_store AS mm_store,
      COALESCE(SUM(md.min_val),0) AS mm_min,
      COALESCE(SUM(md.max_val),0) AS mm_max
    FROM minmax_doc md
    GROUP BY md.ms_sku, md.ms_store
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
    COALESCE(bi.bi_buying,'')::text,
    COALESCE(bi.bi_po_group,'')::text
  FROM store_items asi
  JOIN base_items bi ON bi.bi_sku = asi.ms_sku
  LEFT JOIN filtered_vendors fv ON bi.bi_vendor = fv.vc
  LEFT JOIN rank_data rd ON rd.rd_item = bi.bi_sku
  LEFT JOIN minmax_agg ma ON ma.mm_item = bi.bi_sku AND ma.mm_store = asi.ms_store
  LEFT JOIN stock_dc_agg sdc ON sdc.sdc_item = bi.bi_sku
  LEFT JOIN stock_store_agg ssa ON ssa.ss_item = bi.bi_sku AND ssa.ss_store = asi.ms_store
  LEFT JOIN sales_store_agg sla ON sla.sl_item = bi.bi_sku AND sla.sl_store = asi.ms_store
  LEFT JOIN cost_data cd ON cd.cd_item = bi.bi_sku
  LEFT JOIN order_store_agg os ON os.os_item = bi.bi_sku AND os.os_store = asi.ms_store
  ORDER BY bi.bi_vendor, bi.bi_sku, asi.ms_store;
$function$;
