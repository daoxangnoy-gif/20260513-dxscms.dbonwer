
CREATE OR REPLACE FUNCTION public.get_srr_data(
  p_vendor_codes text[] DEFAULT NULL::text[],
  p_spc_names text[] DEFAULT NULL::text[],
  p_order_days text[] DEFAULT NULL::text[],
  p_item_types text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  sku_code text, main_barcode text, product_name_la text, product_name_en text,
  vendor_code text, vendor_display_name text, spc_name text, order_day text,
  rank_sales text, leadtime numeric, order_cycle numeric,
  min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric,
  min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric,
  stock_kokkok numeric, stock_udee numeric, avg_sales_jmart numeric,
  avg_sales_kokkok numeric, avg_sales_udee numeric, moq numeric,
  po_cost numeric, po_cost_unit numeric, on_order numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code,
      dm.main_barcode,
      dm.product_name_la,
      dm.product_name_en,
      dm.vendor_code,
      dm.vendor_display_name
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND dm.packing_size_qty = 1
      AND dm.stock_unit_flag = 'Y'
      AND dm.buying_status = 'Active'
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (p_item_types IS NULL OR dm.item_type = ANY(p_item_types))
      AND (p_vendor_codes IS NULL OR dm.vendor_code = ANY(p_vendor_codes))
      AND (
        (p_spc_names IS NULL AND p_order_days IS NULL)
        OR dm.vendor_code IN (
          SELECT vm.vendor_code FROM vendor_master vm
          WHERE (p_spc_names IS NULL OR vm.spc_name = ANY(p_spc_names))
            AND (p_order_days IS NULL OR vm.order_day = ANY(p_order_days))
        )
      )
    ORDER BY dm.sku_code, dm.created_at DESC
  )
  SELECT
    bi.sku_code,
    bi.main_barcode,
    bi.product_name_la,
    bi.product_name_en,
    bi.vendor_code,
    bi.vendor_display_name,
    COALESCE(vm.spc_name, '')::text AS spc_name,
    COALESCE(vm.order_day, '')::text AS order_day,
    COALESCE(rd.final_rank, '')::text AS rank_sales,
    COALESCE(vm.leadtime, 0) AS leadtime,
    COALESCE(vm.order_cycle, 0) AS order_cycle,
    COALESCE(mm.min_jmart, 0) AS min_jmart,
    COALESCE(mm.max_jmart, 0) AS max_jmart,
    COALESCE(mm.min_kokkok, 0) AS min_kokkok,
    COALESCE(mm.max_kokkok, 0) AS max_kokkok,
    COALESCE(mm.min_udee, 0) AS min_udee,
    COALESCE(mm.max_udee, 0) AS max_udee,
    COALESCE(st.stock_dc, 0) AS stock_dc,
    COALESCE(st.stock_jmart, 0) AS stock_jmart,
    COALESCE(st.stock_kokkok, 0) AS stock_kokkok,
    COALESCE(st.stock_udee, 0) AS stock_udee,
    ROUND(COALESCE(sl.avg_jmart, 0)::numeric, 4) AS avg_sales_jmart,
    ROUND(COALESCE(sl.avg_kokkok, 0)::numeric, 4) AS avg_sales_kokkok,
    ROUND(COALESCE(sl.avg_udee, 0)::numeric, 4) AS avg_sales_udee,
    COALESCE(pc.moq, 1) AS moq,
    COALESCE(pc.po_cost, 0) AS po_cost,
    COALESCE(pc.po_cost_unit, 0) AS po_cost_unit,
    COALESCE(oo.total_po_qty, 0) AS on_order
  FROM base_items bi
  LEFT JOIN LATERAL (
    SELECT vm2.spc_name, vm2.order_day, vm2.leadtime, vm2.order_cycle
    FROM vendor_master vm2 WHERE vm2.vendor_code = bi.vendor_code LIMIT 1
  ) vm ON true
  LEFT JOIN LATERAL (
    SELECT rs.final_rank FROM rank_sales rs
    WHERE rs.item_id = bi.sku_code ORDER BY rs.created_at DESC LIMIT 1
  ) rd ON true
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN m.type_store = 'Jmart' THEN m.min_val ELSE 0 END) AS min_jmart,
      SUM(CASE WHEN m.type_store = 'Jmart' THEN m.max_val ELSE 0 END) AS max_jmart,
      SUM(CASE WHEN m.type_store = 'Kokkok' THEN m.min_val ELSE 0 END) AS min_kokkok,
      SUM(CASE WHEN m.type_store = 'Kokkok' THEN m.max_val ELSE 0 END) AS max_kokkok,
      SUM(CASE WHEN m.type_store = 'U-dee' THEN m.min_val ELSE 0 END) AS min_udee,
      SUM(CASE WHEN m.type_store = 'U-dee' THEN m.max_val ELSE 0 END) AS max_udee
    FROM minmax m WHERE m.item_id = bi.sku_code
  ) mm ON true
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN s.type_store = 'DC' THEN s.quantity ELSE 0 END) AS stock_dc,
      SUM(CASE WHEN s.type_store = 'Jmart' THEN s.quantity ELSE 0 END) AS stock_jmart,
      SUM(CASE WHEN s.type_store = 'Kokkok' THEN s.quantity ELSE 0 END) AS stock_kokkok,
      SUM(CASE WHEN s.type_store = 'U-dee' THEN s.quantity ELSE 0 END) AS stock_udee
    FROM stock s WHERE s.item_id = bi.sku_code
  ) st ON true
  LEFT JOIN LATERAL (
    SELECT
      AVG(CASE WHEN sw.type_store = 'Jmart' AND sw.avg_day != 0 THEN sw.avg_day END) AS avg_jmart,
      AVG(CASE WHEN sw.type_store = 'Kokkok' AND sw.avg_day != 0 THEN sw.avg_day END) AS avg_kokkok,
      AVG(CASE WHEN sw.type_store = 'U-dee' AND sw.avg_day != 0 THEN sw.avg_day END) AS avg_udee
    FROM sales_by_week sw WHERE sw.id18 = bi.sku_code
  ) sl ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(pc2.moq, 1) AS moq, COALESCE(pc2.po_cost, 0) AS po_cost, COALESCE(pc2.po_cost_unit, 0) AS po_cost_unit
    FROM po_cost pc2 WHERE pc2.item_id = bi.sku_code ORDER BY pc2.created_at DESC LIMIT 1
  ) pc ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(o.po_qty), 0) AS total_po_qty
    FROM on_order o WHERE o.sku_code = bi.sku_code
  ) oo ON true
  ORDER BY bi.vendor_code, bi.sku_code;
END;
$function$;
