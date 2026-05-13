CREATE OR REPLACE FUNCTION public.get_srr_data(
  p_spc_names text[] DEFAULT NULL::text[],
  p_order_days text[] DEFAULT NULL::text[],
  p_vendor_codes text[] DEFAULT NULL::text[],
  p_item_types text[] DEFAULT NULL::text[],
  p_division_groups text[] DEFAULT NULL::text[],
  p_divisions text[] DEFAULT NULL::text[],
  p_departments text[] DEFAULT NULL::text[],
  p_sub_departments text[] DEFAULT NULL::text[],
  p_classes text[] DEFAULT NULL::text[],
  p_sub_classes text[] DEFAULT NULL::text[],
  p_sku_codes text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_kokkok_fc numeric, max_kokkok_fc numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_kokkok_fc numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_kokkok_fc numeric, avg_sales_udee numeric, on_order numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '90s'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, leadtime, order_cycle, supplier_currency, trade_term
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (p_spc_names    IS NULL OR spc_name    = ANY(p_spc_names))
      AND (p_order_days   IS NULL OR order_day   = ANY(p_order_days))
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
      AND (p_sku_codes       IS NULL OR d.sku_code        = ANY(p_sku_codes))
      AND (p_item_types      IS NULL OR d.item_type       = ANY(p_item_types))
      AND (p_division_groups IS NULL OR d.division_group  = ANY(p_division_groups))
      AND (p_divisions       IS NULL OR d.division        = ANY(p_divisions))
      AND (p_departments     IS NULL OR d.department      = ANY(p_departments))
      AND (p_sub_departments IS NULL OR d.sub_department  = ANY(p_sub_departments))
      AND (p_classes         IS NULL OR d.class           = ANY(p_classes))
      AND (p_sub_classes     IS NULL OR d.sub_class       = ANY(p_sub_classes))
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
  mm_jmart AS (
    SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v
    FROM doc_rows WHERE store_name ILIKE 'Jmart%' OR type_store = 'Jmart'
    GROUP BY sku
  ),
  mm_kokkok AS (
    SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v
    FROM doc_rows WHERE (store_name ILIKE 'Kokkok%' AND store_name NOT ILIKE '%Fc%' AND store_name NOT ILIKE '%FC%')
       OR (type_store = 'Kokkok')
    GROUP BY sku
  ),
  mm_kokkok_fc AS (
    SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v
    FROM doc_rows WHERE store_name ILIKE '%Kokkok%Fc%' OR store_name ILIKE '%Kokkok-FC%' OR type_store = 'Kokkok-Fc'
    GROUP BY sku
  ),
  mm_udee AS (
    SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v
    FROM doc_rows WHERE store_name ILIKE 'U-dee%' OR type_store = 'U-dee'
    GROUP BY sku
  ),
  st_dc AS (
    SELECT item_id, SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  st_jmart AS (
    SELECT item_id, SUM(COALESCE(quantity,0)) AS qty
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Jmart'
    GROUP BY item_id
  ),
  st_kokkok AS (
    SELECT item_id, SUM(COALESCE(quantity,0)) AS qty
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok'
    GROUP BY item_id
  ),
  st_kokkok_fc AS (
    SELECT item_id, SUM(COALESCE(quantity,0)) AS qty
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok-Fc'
    GROUP BY item_id
  ),
  st_udee AS (
    SELECT item_id, SUM(COALESCE(quantity,0)) AS qty
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'U-dee'
    GROUP BY item_id
  ),
  sw_jmart AS (
    SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v
    FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Jmart'
    GROUP BY COALESCE(item_id, id18)
  ),
  sw_kokkok AS (
    SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v
    FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok'
    GROUP BY COALESCE(item_id, id18)
  ),
  sw_kokkok_fc AS (
    SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v
    FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok-Fc'
    GROUP BY COALESCE(item_id, id18)
  ),
  sw_udee AS (
    SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v
    FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'U-dee'
    GROUP BY COALESCE(item_id, id18)
  ),
  oo AS (
    SELECT sku_code, SUM(COALESCE(po_qty,0)) AS on_order
    FROM on_order WHERE sku_code IN (SELECT sku_code FROM sku_set)
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
    mm_jmart.min_v       AS min_jmart,    mm_jmart.max_v       AS max_jmart,
    mm_kokkok.min_v      AS min_kokkok,   mm_kokkok.max_v      AS max_kokkok,
    mm_kokkok_fc.min_v   AS min_kokkok_fc,mm_kokkok_fc.max_v   AS max_kokkok_fc,
    mm_udee.min_v        AS min_udee,     mm_udee.max_v        AS max_udee,
    st_dc.stock_dc,
    st_jmart.qty     AS stock_jmart,
    st_kokkok.qty    AS stock_kokkok,
    st_kokkok_fc.qty AS stock_kokkok_fc,
    st_udee.qty      AS stock_udee,
    sw_jmart.v       AS avg_sales_jmart,
    sw_kokkok.v      AS avg_sales_kokkok,
    sw_kokkok_fc.v   AS avg_sales_kokkok_fc,
    sw_udee.v        AS avg_sales_udee,
    oo.on_order
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code
  LEFT JOIN mm_jmart       ON mm_jmart.sku       = dm.sku_code
  LEFT JOIN mm_kokkok      ON mm_kokkok.sku      = dm.sku_code
  LEFT JOIN mm_kokkok_fc   ON mm_kokkok_fc.sku   = dm.sku_code
  LEFT JOIN mm_udee        ON mm_udee.sku        = dm.sku_code
  LEFT JOIN st_dc          ON st_dc.item_id      = dm.sku_code
  LEFT JOIN st_jmart       ON st_jmart.item_id   = dm.sku_code
  LEFT JOIN st_kokkok      ON st_kokkok.item_id  = dm.sku_code
  LEFT JOIN st_kokkok_fc   ON st_kokkok_fc.item_id = dm.sku_code
  LEFT JOIN st_udee        ON st_udee.item_id    = dm.sku_code
  LEFT JOIN sw_jmart       ON sw_jmart.item_id   = dm.sku_code
  LEFT JOIN sw_kokkok      ON sw_kokkok.item_id  = dm.sku_code
  LEFT JOIN sw_kokkok_fc   ON sw_kokkok_fc.item_id = dm.sku_code
  LEFT JOIN sw_udee        ON sw_udee.item_id    = dm.sku_code
  LEFT JOIN oo             ON oo.sku_code        = dm.sku_code;
$function$;