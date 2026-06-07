-- SRR DC + D2S: อ่าน Min/Max จาก minmax TABLE แทน minmax_cal_documents (doc JSON)
-- เดิม SAR/OFS อ่าน table แล้ว แต่ SRR ยังอ่าน doc ล่าสุด → เห็นข้อมูลไม่ตรงกัน
-- (table = สะสมทุก save, doc = snapshot รอบเดียว)
-- เปลี่ยนเฉพาะ CTE ที่อ่าน min/max — logic อื่นคงเดิมทั้งหมด

-- ========== 1) get_srr_data (SRR DC) ==========
CREATE OR REPLACE FUNCTION public.get_srr_data(p_spc_names text[] DEFAULT NULL::text[], p_order_days text[] DEFAULT NULL::text[], p_vendor_codes text[] DEFAULT NULL::text[], p_item_types text[] DEFAULT NULL::text[], p_division_groups text[] DEFAULT NULL::text[], p_divisions text[] DEFAULT NULL::text[], p_departments text[] DEFAULT NULL::text[], p_sub_departments text[] DEFAULT NULL::text[], p_classes text[] DEFAULT NULL::text[], p_sub_classes text[] DEFAULT NULL::text[], p_sku_codes text[] DEFAULT NULL::text[], p_skip_default_filters boolean DEFAULT false)
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_kokkok_fc numeric, max_kokkok_fc numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_kokkok_fc numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_kokkok_fc numeric, avg_sales_udee numeric, on_order numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '240s'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, leadtime, order_cycle, supplier_currency, trade_term
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (p_skip_default_filters OR vendor_origin ILIKE '%lao%' OR vendor_origin ILIKE '%thai%')
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
      AND (p_skip_default_filters OR d.product_owner = 'Lanexang Green Property Sole Co.,Ltd')
      AND (p_skip_default_filters OR d.buying_status IS NULL OR d.buying_status <> 'Inactive')
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
  rs AS (SELECT DISTINCT ON (item_id) item_id, final_rank FROM rank_sales WHERE item_id IN (SELECT sku_code FROM sku_set) ORDER BY item_id, updated_at DESC),
  pc AS (SELECT DISTINCT ON (item_id, vendor) item_id, vendor, moq, po_cost, po_cost_unit FROM po_cost WHERE item_id IN (SELECT sku_code FROM sku_set) ORDER BY item_id, vendor, updated_at DESC),
  -- เปลี่ยนจาก doc JSON → minmax TABLE
  doc_rows AS (
    SELECT m.item_id AS sku, m.store_name,
      COALESCE(m.type_store,'')::text AS type_store,
      m.min_val, m.max_val
    FROM public.minmax m
    WHERE m.item_id IN (SELECT sku_code FROM sku_set)
  ),
  mm_agg AS (
    SELECT sku,
      SUM(min_val) FILTER (WHERE store_name ILIKE 'Jmart%' OR type_store = 'Jmart') AS min_jmart,
      SUM(max_val) FILTER (WHERE store_name ILIKE 'Jmart%' OR type_store = 'Jmart') AS max_jmart,
      SUM(min_val) FILTER (WHERE (store_name ILIKE 'Kokkok%' AND store_name NOT ILIKE '%Fc%' AND store_name NOT ILIKE '%FC%') OR type_store = 'Kokkok') AS min_kokkok,
      SUM(max_val) FILTER (WHERE (store_name ILIKE 'Kokkok%' AND store_name NOT ILIKE '%Fc%' AND store_name NOT ILIKE '%FC%') OR type_store = 'Kokkok') AS max_kokkok,
      SUM(min_val) FILTER (WHERE store_name ILIKE '%Kokkok%Fc%' OR store_name ILIKE '%Kokkok-FC%' OR type_store = 'Kokkok-Fc') AS min_kokkok_fc,
      SUM(max_val) FILTER (WHERE store_name ILIKE '%Kokkok%Fc%' OR store_name ILIKE '%Kokkok-FC%' OR type_store = 'Kokkok-Fc') AS max_kokkok_fc,
      SUM(min_val) FILTER (WHERE store_name ILIKE 'U-dee%' OR type_store = 'U-dee') AS min_udee,
      SUM(max_val) FILTER (WHERE store_name ILIKE 'U-dee%' OR type_store = 'U-dee') AS max_udee
    FROM doc_rows GROUP BY sku
  ),
  st_agg AS (
    SELECT item_id,
      SUM(COALESCE(quantity,0)) FILTER (WHERE type_store='DC')        AS stock_dc,
      SUM(COALESCE(quantity,0)) FILTER (WHERE type_store='Jmart')     AS stock_jmart,
      SUM(COALESCE(quantity,0)) FILTER (WHERE type_store='Kokkok')    AS stock_kokkok,
      SUM(COALESCE(quantity,0)) FILTER (WHERE type_store='Kokkok-Fc') AS stock_kokkok_fc,
      SUM(COALESCE(quantity,0)) FILTER (WHERE type_store='U-dee')     AS stock_udee
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set)
    GROUP BY item_id
  ),
  sw_agg AS (
    SELECT COALESCE(item_id, id18) AS item_id,
      SUM(avg_day) FILTER (WHERE type_store='Jmart')     AS v_jmart,
      SUM(avg_day) FILTER (WHERE type_store='Kokkok')    AS v_kokkok,
      SUM(avg_day) FILTER (WHERE type_store='Kokkok-Fc') AS v_kokkok_fc,
      SUM(avg_day) FILTER (WHERE type_store='U-dee')     AS v_udee
    FROM sales_by_week
    WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set)
    GROUP BY COALESCE(item_id, id18)
  ),
  oo AS (SELECT sku_code, SUM(COALESCE(po_qty,0)) AS on_order FROM on_order WHERE sku_code IN (SELECT sku_code FROM sku_set) GROUP BY sku_code)
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales, pc.moq, pc.po_cost, pc.po_cost_unit,
    mm_agg.min_jmart, mm_agg.max_jmart,
    mm_agg.min_kokkok, mm_agg.max_kokkok,
    mm_agg.min_kokkok_fc, mm_agg.max_kokkok_fc,
    mm_agg.min_udee, mm_agg.max_udee,
    st_agg.stock_dc, st_agg.stock_jmart, st_agg.stock_kokkok,
    st_agg.stock_kokkok_fc, st_agg.stock_udee,
    sw_agg.v_jmart AS avg_sales_jmart, sw_agg.v_kokkok AS avg_sales_kokkok,
    sw_agg.v_kokkok_fc AS avg_sales_kokkok_fc, sw_agg.v_udee AS avg_sales_udee,
    oo.on_order
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  LEFT JOIN rs     ON rs.item_id  = dm.sku_code
  LEFT JOIN pc     ON pc.item_id  = dm.sku_code AND pc.vendor = dm.vendor_code
  LEFT JOIN mm_agg ON mm_agg.sku  = dm.sku_code
  LEFT JOIN st_agg ON st_agg.item_id = dm.sku_code
  LEFT JOIN sw_agg ON sw_agg.item_id = dm.sku_code
  LEFT JOIN oo     ON oo.sku_code = dm.sku_code
$function$;

-- ========== 2) get_srr_d2s_data (SRR Direct / D2S) ==========
CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(
  p_spc_names text[] DEFAULT NULL,
  p_order_days text[] DEFAULT NULL,
  p_vendor_codes text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_sub_classes text[] DEFAULT NULL,
  p_sku_codes text[] DEFAULT NULL,
  p_skip_default_filters boolean DEFAULT false
)
RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, delivery_day text, trade_term text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, store_name text, type_store text, min_store numeric, max_store numeric, stock_store numeric, stock_dc numeric, avg_sales_store numeric, on_order_store numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '90s'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, delivery_day, trade_term, leadtime, order_cycle, supplier_currency
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (p_skip_default_filters OR vendor_origin ILIKE '%lao%' OR vendor_origin ILIKE '%thai%')
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
      AND (p_skip_default_filters OR d.product_owner = 'Lanexang Green Property Sole Co.,Ltd')
      AND (p_skip_default_filters OR d.buying_status IS NULL OR d.buying_status <> 'Inactive')
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
  store_universe AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, COALESCE(st.type_store,'') AS type_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL AND st.store_name <> ''
      AND (p_skip_default_filters OR st.type_store IS NULL OR st.type_store <> 'DC')
    ORDER BY st.store_name, st.created_at DESC
  ),
  rs AS (SELECT DISTINCT ON (item_id) item_id, final_rank FROM rank_sales WHERE item_id IN (SELECT sku_code FROM sku_set) ORDER BY item_id, updated_at DESC),
  pc AS (SELECT DISTINCT ON (item_id, vendor) item_id, vendor, moq, po_cost, po_cost_unit FROM po_cost WHERE item_id IN (SELECT sku_code FROM sku_set) ORDER BY item_id, vendor, updated_at DESC),
  -- เปลี่ยนจาก doc JSON → minmax TABLE
  mm AS (
    SELECT m.item_id, m.store_name,
      MAX(m.min_val) AS min_val, MAX(m.max_val) AS max_val
    FROM public.minmax m
    WHERE m.item_id IN (SELECT sku_code FROM sku_set) AND m.store_name IS NOT NULL
    GROUP BY m.item_id, m.store_name
  ),
  st_store AS (
    SELECT item_id, company AS store_name, SUM(COALESCE(quantity,0)) AS stock_store
    FROM stock
    WHERE item_id IN (SELECT sku_code FROM sku_set) AND company IS NOT NULL
      AND (p_skip_default_filters OR type_store IS NULL OR type_store <> 'DC')
    GROUP BY item_id, company
  ),
  st_dc AS (SELECT item_id, SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) GROUP BY item_id),
  sw AS (SELECT COALESCE(item_id, id18) AS item_id, store_name, AVG(avg_day) AS avg_sales_store FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND store_name IS NOT NULL GROUP BY COALESCE(item_id, id18), store_name),
  ship_map AS (
    SELECT DISTINCT ON (TRIM(split_part(ship_to, ':', 1))) TRIM(split_part(ship_to, ':', 1)) AS ship_clean, store_name AS canonical_store_name
    FROM store_type WHERE ship_to IS NOT NULL AND ship_to <> '' AND store_name IS NOT NULL
    ORDER BY TRIM(split_part(ship_to, ':', 1)), created_at DESC
  ),
  oo AS (
    SELECT o.sku_code, COALESCE(sm.canonical_store_name, TRIM(split_part(o.store_name, ':', 1))) AS store_name_canon, SUM(COALESCE(o.po_qty, 0)) AS on_order_store
    FROM on_order o
    LEFT JOIN ship_map sm ON sm.ship_clean = TRIM(split_part(o.store_name, ':', 1))
    WHERE o.sku_code IN (SELECT sku_code FROM sku_set) AND o.store_name IS NOT NULL
    GROUP BY o.sku_code, COALESCE(sm.canonical_store_name, TRIM(split_part(o.store_name, ':', 1)))
  )
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.delivery_day, vm.trade_term,
    vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales, pc.moq, pc.po_cost, pc.po_cost_unit,
    su.store_name, su.type_store,
    mm.min_val AS min_store, mm.max_val AS max_store,
    sts.stock_store, std.stock_dc, sw.avg_sales_store, oo.on_order_store
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  CROSS JOIN store_universe su
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code AND pc.vendor = dm.vendor_code
  LEFT JOIN mm ON mm.item_id = dm.sku_code AND mm.store_name = su.store_name
  LEFT JOIN st_store sts ON sts.item_id = dm.sku_code AND sts.store_name = su.store_name
  LEFT JOIN st_dc std ON std.item_id = dm.sku_code
  LEFT JOIN sw ON sw.item_id = dm.sku_code AND sw.store_name = su.store_name
  LEFT JOIN oo ON oo.sku_code = dm.sku_code AND oo.store_name_canon = su.store_name;
$function$;
