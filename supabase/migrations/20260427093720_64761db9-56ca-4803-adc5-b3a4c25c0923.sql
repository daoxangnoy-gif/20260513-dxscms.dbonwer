-- Update get_srr_data: remove packing_size_qty = 1 filter from base SKU query
DROP FUNCTION IF EXISTS public.get_srr_data(text[],text[],text[],text[]);

CREATE OR REPLACE FUNCTION public.get_srr_data(p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_vendor_codes text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_kokkok_fc numeric, max_kokkok_fc numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_kokkok_fc numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_kokkok_fc numeric, avg_sales_udee numeric, on_order numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, leadtime, order_cycle, supplier_currency, trade_term
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (p_spc_names  IS NULL OR spc_name  = ANY(p_spc_names))
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
      AND d.vendor_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
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
  latest_doc AS (
    SELECT data
    FROM minmax_cal_documents
    ORDER BY created_at DESC
    LIMIT 1
  ),
  doc_rows AS (
    SELECT
      (r->>'sku_code')::text AS sku,
      (r->>'store_name')::text AS store_name,
      COALESCE(r->>'type_store','')::text AS type_store,
      NULLIF(r->>'min_final','')::numeric AS min_val,
      NULLIF(r->>'max_final','')::numeric AS max_val
    FROM latest_doc, jsonb_array_elements(data) r
    WHERE r->>'sku_code' IS NOT NULL
  ),
  mm AS (
    SELECT
      sku AS item_id,
      SUM(CASE WHEN UPPER(type_store) = 'JMART' THEN COALESCE(min_val,0) END) AS min_jmart,
      SUM(CASE WHEN UPPER(type_store) = 'JMART' THEN COALESCE(max_val,0) END) AS max_jmart,
      SUM(CASE WHEN UPPER(type_store) = 'KOKKOK' THEN COALESCE(min_val,0) END) AS min_kokkok,
      SUM(CASE WHEN UPPER(type_store) = 'KOKKOK' THEN COALESCE(max_val,0) END) AS max_kokkok,
      SUM(CASE WHEN UPPER(type_store) = 'KOKKOK-FC' THEN COALESCE(min_val,0) END) AS min_kokkok_fc,
      SUM(CASE WHEN UPPER(type_store) = 'KOKKOK-FC' THEN COALESCE(max_val,0) END) AS max_kokkok_fc,
      SUM(CASE WHEN UPPER(type_store) = 'U-DEE' THEN COALESCE(min_val,0) END) AS min_udee,
      SUM(CASE WHEN UPPER(type_store) = 'U-DEE' THEN COALESCE(max_val,0) END) AS max_udee
    FROM doc_rows
    WHERE sku IN (SELECT sku_code FROM sku_set)
    GROUP BY sku
  ),
  st AS (
    SELECT item_id,
      SUM(CASE WHEN UPPER(type_store)='DC' THEN COALESCE(quantity,0) END) AS stock_dc,
      SUM(CASE WHEN UPPER(type_store)='JMART' THEN COALESCE(quantity,0) END) AS stock_jmart,
      SUM(CASE WHEN UPPER(type_store)='KOKKOK' THEN COALESCE(quantity,0) END) AS stock_kokkok,
      SUM(CASE WHEN UPPER(type_store)='KOKKOK-FC' THEN COALESCE(quantity,0) END) AS stock_kokkok_fc,
      SUM(CASE WHEN UPPER(type_store)='U-DEE' THEN COALESCE(quantity,0) END) AS stock_udee
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  sw AS (
    SELECT COALESCE(item_id, id18) AS item_id,
      SUM(CASE WHEN UPPER(type_store)='JMART' THEN COALESCE(avg_day,0) END) AS avg_sales_jmart,
      SUM(CASE WHEN UPPER(type_store)='KOKKOK' THEN COALESCE(avg_day,0) END) AS avg_sales_kokkok,
      SUM(CASE WHEN UPPER(type_store)='KOKKOK-FC' THEN COALESCE(avg_day,0) END) AS avg_sales_kokkok_fc,
      SUM(CASE WHEN UPPER(type_store)='U-DEE' THEN COALESCE(avg_day,0) END) AS avg_sales_udee
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
    mm.min_jmart, mm.max_jmart, mm.min_kokkok, mm.max_kokkok, mm.min_kokkok_fc, mm.max_kokkok_fc, mm.min_udee, mm.max_udee,
    st.stock_dc, st.stock_jmart, st.stock_kokkok, st.stock_kokkok_fc, st.stock_udee,
    sw.avg_sales_jmart, sw.avg_sales_kokkok, sw.avg_sales_kokkok_fc, sw.avg_sales_udee,
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

-- Update get_srr_d2s_data: remove packing_size_qty = 1 filter
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
      AND d.vendor_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND (p_item_types IS NULL OR d.item_type = ANY(p_item_types))
    ORDER BY d.sku_code, d.updated_at DESC
  ),
  sku_set AS (SELECT sku_code FROM dm),
  store_universe AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, COALESCE(st.type_store,'') AS type_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL
      AND st.store_name <> ''
      AND (st.type_store IS NULL OR st.type_store <> 'DC')
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
  latest_doc AS (
    SELECT data
    FROM minmax_cal_documents
    ORDER BY created_at DESC
    LIMIT 1
  ),
  mm AS (
    SELECT
      (r->>'sku_code')::text AS item_id,
      (r->>'store_name')::text AS store_name,
      MAX(NULLIF(r->>'min_final','')::numeric) AS min_val,
      MAX(NULLIF(r->>'max_final','')::numeric) AS max_val
    FROM latest_doc, jsonb_array_elements(data) r
    WHERE r->>'sku_code' IS NOT NULL
      AND r->>'store_name' IS NOT NULL
    GROUP BY (r->>'sku_code')::text, (r->>'store_name')::text
  ),
  st_store AS (
    SELECT item_id, company AS store_name, SUM(COALESCE(quantity,0)) AS stock_store
    FROM stock
    WHERE item_id IN (SELECT sku_code FROM sku_set)
      AND company IS NOT NULL
      AND (type_store IS NULL OR type_store <> 'DC')
    GROUP BY item_id, company
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
  ship_map AS (
    SELECT DISTINCT ON (TRIM(split_part(ship_to, ':', 1)))
      TRIM(split_part(ship_to, ':', 1)) AS ship_clean,
      store_name AS canonical_store_name
    FROM store_type
    WHERE ship_to IS NOT NULL AND ship_to <> ''
      AND store_name IS NOT NULL
    ORDER BY TRIM(split_part(ship_to, ':', 1)), created_at DESC
  ),
  oo AS (
    SELECT
      o.sku_code,
      COALESCE(sm.canonical_store_name, TRIM(split_part(o.store_name, ':', 1))) AS store_name_canon,
      SUM(COALESCE(o.po_qty, 0)) AS on_order_store
    FROM on_order o
    LEFT JOIN ship_map sm ON sm.ship_clean = TRIM(split_part(o.store_name, ':', 1))
    WHERE o.sku_code IN (SELECT sku_code FROM sku_set)
      AND o.store_name IS NOT NULL
    GROUP BY o.sku_code, COALESCE(sm.canonical_store_name, TRIM(split_part(o.store_name, ':', 1)))
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
  LEFT JOIN mm  ON mm.item_id  = dm.sku_code AND mm.store_name = su.store_name
  LEFT JOIN st_store sts ON sts.item_id = dm.sku_code AND sts.store_name = su.store_name
  LEFT JOIN st_dc std ON std.item_id = dm.sku_code
  LEFT JOIN sw  ON sw.item_id  = dm.sku_code AND sw.store_name = su.store_name
  LEFT JOIN oo  ON oo.sku_code = dm.sku_code AND oo.store_name_canon = su.store_name;
$function$;