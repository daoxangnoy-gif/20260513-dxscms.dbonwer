-- 1) get_srr_effective_vendors
CREATE OR REPLACE FUNCTION public.get_srr_effective_vendors(
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_po_groups text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_sub_classes text[] DEFAULT NULL,
  p_skip_default_filters boolean DEFAULT false
)
RETURNS TABLE(vendor_code text, spc_name text, order_day text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH dm_filt AS (
    SELECT DISTINCT d.vendor_code
    FROM data_master d
    WHERE d.vendor_code IS NOT NULL
      AND (p_skip_default_filters OR d.product_owner = 'Lanexang Green Property Sole Co.,Ltd')
      AND (p_skip_default_filters OR d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND (p_item_types      IS NULL OR d.item_type      = ANY(p_item_types))
      AND (p_buying_statuses IS NULL OR d.buying_status  = ANY(p_buying_statuses))
      AND (p_po_groups       IS NULL OR d.po_group       = ANY(p_po_groups))
      AND (p_division_groups IS NULL OR d.division_group = ANY(p_division_groups))
      AND (p_divisions       IS NULL OR d.division       = ANY(p_divisions))
      AND (p_departments     IS NULL OR d.department     = ANY(p_departments))
      AND (p_sub_departments IS NULL OR d.sub_department = ANY(p_sub_departments))
      AND (p_classes         IS NULL OR d.class          = ANY(p_classes))
      AND (p_sub_classes     IS NULL OR d.sub_class      = ANY(p_sub_classes))
  )
  SELECT DISTINCT ON (vm.vendor_code)
    vm.vendor_code,
    COALESCE(vm.spc_name,'')  AS spc_name,
    COALESCE(vm.order_day,'') AS order_day
  FROM vendor_master vm
  WHERE vm.vendor_code IS NOT NULL
    AND vm.vendor_code IN (SELECT vendor_code FROM dm_filt)
  ORDER BY vm.vendor_code, vm.updated_at DESC;
$function$;

-- 2) get_srr_hierarchy_options
CREATE OR REPLACE FUNCTION public.get_srr_hierarchy_options(
  p_skip_default_filters boolean DEFAULT false
)
RETURNS TABLE(division_group text, division text, department text, sub_department text, class text, sub_class text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
    COALESCE(division_group, '') AS division_group,
    COALESCE(division, '')       AS division,
    COALESCE(department, '')     AS department,
    COALESCE(sub_department, '') AS sub_department,
    COALESCE(class, '')          AS class,
    COALESCE(sub_class, '')      AS sub_class
  FROM data_master
  WHERE vendor_code IS NOT NULL
    AND (p_skip_default_filters OR product_owner = 'Lanexang Green Property Sole Co.,Ltd')
    AND (p_skip_default_filters OR buying_status IS NULL OR buying_status <> 'Inactive');
$function$;

-- 3) get_srr_data
CREATE OR REPLACE FUNCTION public.get_srr_data(
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
RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, vendor_code text, vendor_display_name text, vendor_current_status text, spc_name text, order_day text, leadtime numeric, order_cycle numeric, supplier_currency text, item_type text, buying_status text, po_group text, division_group text, division text, department text, sub_department text, class text, sub_class text, rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric, min_jmart numeric, max_jmart numeric, min_kokkok numeric, max_kokkok numeric, min_kokkok_fc numeric, max_kokkok_fc numeric, min_udee numeric, max_udee numeric, stock_dc numeric, stock_jmart numeric, stock_kokkok numeric, stock_kokkok_fc numeric, stock_udee numeric, avg_sales_jmart numeric, avg_sales_kokkok numeric, avg_sales_kokkok_fc numeric, avg_sales_udee numeric, on_order numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '90s'
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
  latest_doc AS (SELECT data FROM minmax_cal_documents ORDER BY created_at DESC LIMIT 1),
  doc_rows AS (
    SELECT (r->>'sku_code')::text AS sku, (r->>'store_name')::text AS store_name,
      COALESCE(r->>'type_store','')::text AS type_store,
      NULLIF(r->>'min_final','')::numeric AS min_val, NULLIF(r->>'max_final','')::numeric AS max_val
    FROM latest_doc, jsonb_array_elements(data) r WHERE r->>'sku_code' IS NOT NULL
  ),
  mm_jmart AS (SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v FROM doc_rows WHERE store_name ILIKE 'Jmart%' OR type_store = 'Jmart' GROUP BY sku),
  mm_kokkok AS (SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v FROM doc_rows WHERE (store_name ILIKE 'Kokkok%' AND store_name NOT ILIKE '%Fc%' AND store_name NOT ILIKE '%FC%') OR (type_store = 'Kokkok') GROUP BY sku),
  mm_kokkok_fc AS (SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v FROM doc_rows WHERE store_name ILIKE '%Kokkok%Fc%' OR store_name ILIKE '%Kokkok-FC%' OR type_store = 'Kokkok-Fc' GROUP BY sku),
  mm_udee AS (SELECT sku, MAX(min_val) AS min_v, MAX(max_val) AS max_v FROM doc_rows WHERE store_name ILIKE 'U-dee%' OR type_store = 'U-dee' GROUP BY sku),
  st_dc AS (SELECT item_id, SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) GROUP BY item_id),
  st_jmart AS (SELECT item_id, SUM(COALESCE(quantity,0)) AS qty FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Jmart' GROUP BY item_id),
  st_kokkok AS (SELECT item_id, SUM(COALESCE(quantity,0)) AS qty FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok' GROUP BY item_id),
  st_kokkok_fc AS (SELECT item_id, SUM(COALESCE(quantity,0)) AS qty FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok-Fc' GROUP BY item_id),
  st_udee AS (SELECT item_id, SUM(COALESCE(quantity,0)) AS qty FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) AND type_store = 'U-dee' GROUP BY item_id),
  sw_jmart AS (SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Jmart' GROUP BY COALESCE(item_id, id18)),
  sw_kokkok AS (SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok' GROUP BY COALESCE(item_id, id18)),
  sw_kokkok_fc AS (SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'Kokkok-Fc' GROUP BY COALESCE(item_id, id18)),
  sw_udee AS (SELECT COALESCE(item_id, id18) AS item_id, AVG(avg_day) AS v FROM sales_by_week WHERE COALESCE(item_id, id18) IN (SELECT sku_code FROM sku_set) AND type_store = 'U-dee' GROUP BY COALESCE(item_id, id18)),
  oo AS (SELECT sku_code, SUM(COALESCE(po_qty,0)) AS on_order FROM on_order WHERE sku_code IN (SELECT sku_code FROM sku_set) GROUP BY sku_code)
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales, pc.moq, pc.po_cost, pc.po_cost_unit,
    mm_jmart.min_v AS min_jmart, mm_jmart.max_v AS max_jmart,
    mm_kokkok.min_v AS min_kokkok, mm_kokkok.max_v AS max_kokkok,
    mm_kokkok_fc.min_v AS min_kokkok_fc, mm_kokkok_fc.max_v AS max_kokkok_fc,
    mm_udee.min_v AS min_udee, mm_udee.max_v AS max_udee,
    st_dc.stock_dc, st_jmart.qty AS stock_jmart, st_kokkok.qty AS stock_kokkok,
    st_kokkok_fc.qty AS stock_kokkok_fc, st_udee.qty AS stock_udee,
    sw_jmart.v AS avg_sales_jmart, sw_kokkok.v AS avg_sales_kokkok,
    sw_kokkok_fc.v AS avg_sales_kokkok_fc, sw_udee.v AS avg_sales_udee,
    oo.on_order
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code AND pc.vendor = dm.vendor_code
  LEFT JOIN mm_jmart ON mm_jmart.sku = dm.sku_code
  LEFT JOIN mm_kokkok ON mm_kokkok.sku = dm.sku_code
  LEFT JOIN mm_kokkok_fc ON mm_kokkok_fc.sku = dm.sku_code
  LEFT JOIN mm_udee ON mm_udee.sku = dm.sku_code
  LEFT JOIN st_dc ON st_dc.item_id = dm.sku_code
  LEFT JOIN st_jmart ON st_jmart.item_id = dm.sku_code
  LEFT JOIN st_kokkok ON st_kokkok.item_id = dm.sku_code
  LEFT JOIN st_kokkok_fc ON st_kokkok_fc.item_id = dm.sku_code
  LEFT JOIN st_udee ON st_udee.item_id = dm.sku_code
  LEFT JOIN sw_jmart ON sw_jmart.item_id = dm.sku_code
  LEFT JOIN sw_kokkok ON sw_kokkok.item_id = dm.sku_code
  LEFT JOIN sw_kokkok_fc ON sw_kokkok_fc.item_id = dm.sku_code
  LEFT JOIN sw_udee ON sw_udee.item_id = dm.sku_code
  LEFT JOIN oo ON oo.sku_code = dm.sku_code;
$function$;

-- 4) get_srr_d2s_data
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
  latest_doc AS (SELECT data FROM minmax_cal_documents ORDER BY created_at DESC LIMIT 1),
  mm AS (
    SELECT (r->>'sku_code')::text AS item_id, (r->>'store_name')::text AS store_name,
      MAX(NULLIF(r->>'min_final','')::numeric) AS min_val, MAX(NULLIF(r->>'max_final','')::numeric) AS max_val
    FROM latest_doc, jsonb_array_elements(data) r
    WHERE r->>'sku_code' IS NOT NULL AND r->>'store_name' IS NOT NULL
    GROUP BY (r->>'sku_code')::text, (r->>'store_name')::text
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

-- 5) get_range_store_data — preserve existing body, only wrap hardcoded WHEREs
CREATE OR REPLACE FUNCTION public.get_range_store_data(
  p_skip_default_filters boolean DEFAULT false
)
RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text, packing_size_qty numeric, standard_price numeric, list_price numeric, item_status text, item_type text, buying_status text, division_group text, division text, department text, sub_department text, class text, gm_buyer_code text, buyer_code text, product_owner text, product_bu text, barcode_pack text, pack_qty numeric, barcode_box text, box_qty numeric, rank_sale text, avg_jmart numeric, avg_kokkok numeric, avg_kokkok_fc numeric, avg_udee numeric, avg_per_store jsonb, range_data jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s'
AS $function$
  WITH master AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
      dm.unit_of_measure, dm.packing_size_qty, dm.standard_price, dm.list_price,
      dm.item_status, dm.item_type, dm.buying_status,
      dm.division_group, dm.division, dm.department, dm.sub_department, dm.class,
      dm.gm_buyer_code, dm.buyer_code, dm.product_owner, dm.product_bu
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND (p_skip_default_filters OR dm.stock_unit_flag = 'Y')
      AND (p_skip_default_filters OR dm.product_owner ILIKE 'Lanexang%')
      AND (p_skip_default_filters OR COALESCE(dm.buying_status, '') <> 'Inactive')
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  pack_min AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, main_barcode AS barcode_pack, packing_size_qty AS pack_qty
    FROM data_master
    WHERE unit_of_measure = 'Pack' AND sku_code IS NOT NULL
    ORDER BY sku_code, packing_size_qty NULLS LAST
  ),
  box_min AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, main_barcode AS barcode_box, packing_size_qty AS box_qty
    FROM data_master
    WHERE unit_of_measure = 'Box' AND sku_code IS NOT NULL
    ORDER BY sku_code, packing_size_qty NULLS LAST
  ),
  rank_d AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IS NOT NULL
    ORDER BY item_id, created_at DESC
  ),
  sales_type AS (
    SELECT id18 AS sku,
      COALESCE(SUM(CASE WHEN type_store = 'Jmart' THEN avg_day END), 0) AS avg_jmart,
      COALESCE(SUM(CASE WHEN type_store = 'Kokkok' THEN avg_day END), 0) AS avg_kokkok,
      COALESCE(SUM(CASE WHEN type_store = 'Kokkok-FC' THEN avg_day END), 0) AS avg_kokkok_fc,
      COALESCE(SUM(CASE WHEN type_store = 'U-dee' THEN avg_day END), 0) AS avg_udee
    FROM sales_by_week WHERE id18 IS NOT NULL
    GROUP BY id18
  ),
  sales_store AS (
    SELECT id18 AS sku,
      jsonb_object_agg(store_name, total_avg) AS per_store
    FROM (
      SELECT id18, store_name, SUM(avg_day) AS total_avg
      FROM sales_by_week
      WHERE id18 IS NOT NULL AND store_name IS NOT NULL
      GROUP BY id18, store_name
    ) s
    GROUP BY id18
  ),
  range_d AS (
    SELECT sku_code AS sku,
      jsonb_object_agg(store_name, jsonb_build_object(
        'apply_yn', apply_yn,
        'min_display', min_display,
        'unit_picking_super', unit_picking_super,
        'unit_picking_mart', unit_picking_mart
      )) AS payload
    FROM range_store
    GROUP BY sku_code
  )
  SELECT
    m.sku_code, m.main_barcode, m.product_name_la, m.product_name_en,
    m.unit_of_measure, m.packing_size_qty, m.standard_price, m.list_price,
    m.item_status, m.item_type, m.buying_status,
    m.division_group, m.division, m.department, m.sub_department, m.class,
    m.gm_buyer_code, m.buyer_code, m.product_owner, m.product_bu,
    p.barcode_pack, p.pack_qty,
    b.barcode_box, b.box_qty,
    COALESCE(r.final_rank, '') AS rank_sale,
    COALESCE(st.avg_jmart, 0), COALESCE(st.avg_kokkok, 0),
    COALESCE(st.avg_kokkok_fc, 0), COALESCE(st.avg_udee, 0),
    COALESCE(ss.per_store, '{}'::jsonb) AS avg_per_store,
    COALESCE(rd.payload, '{}'::jsonb) AS range_data
  FROM master m
  LEFT JOIN pack_min p ON p.sku_code = m.sku_code
  LEFT JOIN box_min b ON b.sku_code = m.sku_code
  LEFT JOIN rank_d r ON r.item_id = m.sku_code
  LEFT JOIN sales_type st ON st.sku = m.sku_code
  LEFT JOIN sales_store ss ON ss.sku = m.sku_code
  LEFT JOIN range_d rd ON rd.sku = m.sku_code;
$function$;