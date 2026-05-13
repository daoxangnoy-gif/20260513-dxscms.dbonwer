-- ============ SRR DC ============
CREATE OR REPLACE FUNCTION public.get_srr_data(
  p_spc_names text[] DEFAULT NULL::text[],
  p_order_days text[] DEFAULT NULL::text[],
  p_vendor_codes text[] DEFAULT NULL::text[],
  p_item_types text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_udee numeric, on_order numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, leadtime, order_cycle, supplier_currency, trade_term
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (trade_term IS NULL OR trade_term <> 'Consignment')
      AND (p_spc_names IS NULL OR spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR order_day = ANY(p_order_days))
      AND (p_vendor_codes IS NULL OR vendor_code = ANY(p_vendor_codes))
    ORDER BY vendor_code, updated_at DESC
  ),
  dm AS (
    SELECT DISTINCT ON (d.sku_code)
      d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
      d.vendor_code, d.vendor_display_name, d.vendor_current_status,
      d.item_type, d.buying_status, d.po_group,
      d.division_group, d.division, d.department, d.sub_department, d.class, d.sub_class
    FROM data_master d
    JOIN vm ON vm.vendor_code = d.vendor_code
    WHERE d.sku_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND d.stock_unit_flag = 'Y'
      AND d.packing_size_qty = 1
      AND (p_item_types IS NULL OR d.item_type = ANY(p_item_types))
    ORDER BY d.sku_code, d.updated_at DESC
  ),
  sku_set AS (SELECT sku_code FROM dm),
  rs AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  pc AS (
    SELECT DISTINCT ON (item_id) item_id, moq, po_cost, po_cost_unit
    FROM po_cost WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  mm AS (
    SELECT item_id,
      MAX(CASE WHEN type_store='JMART' THEN min_val END) AS min_jmart,
      MAX(CASE WHEN type_store='JMART' THEN max_val END) AS max_jmart,
      MAX(CASE WHEN type_store='KOKKOK' THEN min_val END) AS min_kokkok,
      MAX(CASE WHEN type_store='KOKKOK' THEN max_val END) AS max_kokkok,
      MAX(CASE WHEN type_store='UDEE' THEN min_val END) AS min_udee,
      MAX(CASE WHEN type_store='UDEE' THEN max_val END) AS max_udee
    FROM minmax
    WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  st AS (
    SELECT item_id,
      SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc,
      SUM(CASE WHEN type_store='JMART' THEN COALESCE(quantity,0) END) AS stock_jmart,
      SUM(CASE WHEN type_store='KOKKOK' THEN COALESCE(quantity,0) END) AS stock_kokkok,
      SUM(CASE WHEN type_store='UDEE' THEN COALESCE(quantity,0) END) AS stock_udee
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  sw AS (
    SELECT COALESCE(item_id, id18) AS item_id,
      AVG(CASE WHEN type_store ILIKE 'Jmart%' THEN avg_day END) AS avg_sales_jmart,
      AVG(CASE WHEN type_store ILIKE 'Kokkok%' AND type_store NOT ILIKE '%Fc' THEN avg_day END) AS avg_sales_kokkok,
      AVG(CASE WHEN type_store ILIKE 'U-dee%' OR type_store ILIKE 'Udee%' THEN avg_day END) AS avg_sales_udee
    FROM sales_by_week
    WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set)
    GROUP BY COALESCE(item_id, id18)
  ),
  oo AS (
    SELECT sku_code, SUM(COALESCE(po_qty,0)) AS on_order
    FROM on_order
    WHERE sku_code IN (SELECT sku_code FROM sku_set)
    GROUP BY sku_code
  )
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales,
    pc.moq, pc.po_cost, pc.po_cost_unit,
    mm.min_jmart, mm.max_jmart, mm.min_kokkok, mm.max_kokkok, mm.min_udee, mm.max_udee,
    st.stock_dc, st.stock_jmart, st.stock_kokkok, st.stock_udee,
    sw.avg_sales_jmart, sw.avg_sales_kokkok, sw.avg_sales_udee,
    oo.on_order
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code
  LEFT JOIN mm ON mm.item_id = dm.sku_code
  LEFT JOIN st ON st.item_id = dm.sku_code
  LEFT JOIN sw ON sw.item_id = dm.sku_code
  LEFT JOIN oo ON oo.sku_code = dm.sku_code;
$function$;

-- ============ SRR DIRECT (D2S) ============
CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(
  p_spc_names text[] DEFAULT NULL::text[],
  p_order_days text[] DEFAULT NULL::text[],
  p_vendor_codes text[] DEFAULT NULL::text[],
  p_item_types text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, delivery_day text, trade_term text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, store_name text, type_store text, min_store numeric, max_store numeric, stock_store numeric, stock_dc numeric, avg_sales_store numeric, on_order_store numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, delivery_day, trade_term,
      leadtime, order_cycle, supplier_currency
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (trade_term IS NULL OR trade_term <> 'Consignment')
      AND (p_spc_names IS NULL OR spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR order_day = ANY(p_order_days))
      AND (p_vendor_codes IS NULL OR vendor_code = ANY(p_vendor_codes))
    ORDER BY vendor_code, updated_at DESC
  ),
  dm AS (
    SELECT DISTINCT ON (d.sku_code)
      d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
      d.vendor_code, d.vendor_display_name, d.vendor_current_status,
      d.item_type, d.buying_status, d.po_group,
      d.division_group, d.division, d.department, d.sub_department, d.class, d.sub_class
    FROM data_master d
    JOIN vm ON vm.vendor_code = d.vendor_code
    WHERE d.sku_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND d.stock_unit_flag = 'Y'
      AND d.packing_size_qty = 1
      AND (p_item_types IS NULL OR d.item_type = ANY(p_item_types))
    ORDER BY d.sku_code, d.updated_at DESC
  ),
  sku_set AS (SELECT sku_code FROM dm),
  -- ทุก Store จาก store_type ยกเว้น DC และ Kokkok-Fc
  store_universe AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, COALESCE(st.type_store,'') AS type_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL
      AND st.store_name <> ''
      AND (st.type_store IS NULL OR (st.type_store <> 'DC' AND st.type_store <> 'Kokkok-Fc'))
    ORDER BY st.store_name, st.created_at DESC
  ),
  rs AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  pc AS (
    SELECT DISTINCT ON (item_id) item_id, moq, po_cost, po_cost_unit
    FROM po_cost WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  mm AS (
    SELECT item_id, store_name,
      MAX(min_val) AS min_val,
      MAX(max_val) AS max_val
    FROM minmax
    WHERE item_id IN (SELECT sku_code FROM sku_set)
      AND store_name IS NOT NULL
    GROUP BY item_id, store_name
  ),
  st_store AS (
    SELECT item_id, type_store, SUM(COALESCE(quantity,0)) AS stock_store
    FROM stock
    WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id, type_store
  ),
  st_dc AS (
    SELECT item_id, SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  sw AS (
    SELECT COALESCE(item_id, id18) AS item_id, store_name, AVG(avg_day) AS avg_sales_store
    FROM sales_by_week
    WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set)
      AND store_name IS NOT NULL
    GROUP BY COALESCE(item_id, id18), store_name
  ),
  oo AS (
    SELECT sku_code, store_name, SUM(COALESCE(po_qty,0)) AS on_order_store
    FROM on_order
    WHERE sku_code IN (SELECT sku_code FROM sku_set)
      AND store_name IS NOT NULL
    GROUP BY sku_code, store_name
  )
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.delivery_day, vm.trade_term,
    vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales,
    pc.moq, pc.po_cost, pc.po_cost_unit,
    su.store_name, su.type_store,
    mm.min_val AS min_store, mm.max_val AS max_store,
    sts.stock_store, std.stock_dc,
    sw.avg_sales_store,
    oo.on_order_store
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  CROSS JOIN store_universe su
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code
  LEFT JOIN mm ON mm.item_id = dm.sku_code AND mm.store_name = su.store_name
  LEFT JOIN st_store sts ON sts.item_id = dm.sku_code AND sts.type_store = su.type_store
  LEFT JOIN st_dc std ON std.item_id = dm.sku_code
  LEFT JOIN sw ON sw.item_id = dm.sku_code AND sw.store_name = su.store_name
  LEFT JOIN oo ON oo.sku_code = dm.sku_code AND oo.store_name = su.store_name;
$function$;