
CREATE OR REPLACE FUNCTION public.get_srr_data(p_vendor_codes text[] DEFAULT NULL::text[], p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, vendor_code text, vendor_display_name text, spc_name text, order_day text, rank_sales text, leadtime numeric, order_cycle numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_udee numeric, moq numeric, po_cost numeric, po_cost_unit numeric, on_order numeric, unit_of_measure text, item_type text, buying_status text)
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
    ORDER BY vm.vendor_code, vm.created_at DESC
  ),
  base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
      dm.vendor_code, dm.vendor_display_name, dm.unit_of_measure,
      dm.item_type, dm.buying_status
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
  minmax_agg AS (
    SELECT mm.item_id,
      COALESCE(SUM(CASE WHEN mm.type_store='Jmart' THEN mm.min_val END),0) AS min_jmart,
      COALESCE(SUM(CASE WHEN mm.type_store='Jmart' THEN mm.max_val END),0) AS max_jmart,
      COALESCE(SUM(CASE WHEN mm.type_store='Kokkok' THEN mm.min_val END),0) AS min_kokkok,
      COALESCE(SUM(CASE WHEN mm.type_store='Kokkok' THEN mm.max_val END),0) AS max_kokkok,
      COALESCE(SUM(CASE WHEN mm.type_store='U-dee' THEN mm.min_val END),0) AS min_udee,
      COALESCE(SUM(CASE WHEN mm.type_store='U-dee' THEN mm.max_val END),0) AS max_udee
    FROM minmax mm WHERE mm.item_id IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY mm.item_id
  ),
  stock_agg AS (
    SELECT s.item_id,
      COALESCE(SUM(CASE WHEN s.type_store='DC' THEN s.quantity END),0) AS stock_dc,
      COALESCE(SUM(CASE WHEN s.type_store='Jmart' THEN s.quantity END),0) AS stock_jmart,
      COALESCE(SUM(CASE WHEN s.type_store='Kokkok' THEN s.quantity END),0) AS stock_kokkok,
      COALESCE(SUM(CASE WHEN s.type_store='U-dee' THEN s.quantity END),0) AS stock_udee
    FROM stock s WHERE s.item_id IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY s.item_id
  ),
  sales_agg AS (
    SELECT sw.id18 AS item_id,
      COALESCE(AVG(CASE WHEN sw.type_store='Jmart' AND sw.avg_day!=0 THEN sw.avg_day END),0) AS avg_jmart,
      COALESCE(AVG(CASE WHEN sw.type_store='Kokkok' AND sw.avg_day!=0 THEN sw.avg_day END),0) AS avg_kokkok,
      COALESCE(AVG(CASE WHEN sw.type_store='U-dee' AND sw.avg_day!=0 THEN sw.avg_day END),0) AS avg_udee
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
    COALESCE(rd.final_rank,'')::text AS rank_sales,
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
    COALESCE(bi.buying_status,'')::text AS buying_status
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
