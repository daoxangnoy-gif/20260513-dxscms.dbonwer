-- Range Store: Remove stock_unit_flag = 'Y' filter from materialized view
-- เอาเงื่อนไข stock_unit_flag = 'Y' ออก เพื่อดึง SKU ครบถ้วนมากขึ้น

DROP MATERIALIZED VIEW IF EXISTS public.mv_range_store CASCADE;

CREATE MATERIALIZED VIEW public.mv_range_store AS
WITH master AS (
  SELECT DISTINCT ON (dm.sku_code)
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
    dm.unit_of_measure, dm.packing_size_qty, dm.standard_price, dm.list_price,
    dm.item_status, dm.item_type, dm.buying_status,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class,
    dm.gm_buyer_code, dm.buyer_code, dm.product_owner, dm.product_bu
  FROM data_master dm
  WHERE dm.sku_code IS NOT NULL
    AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
    AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
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
  COALESCE(st.avg_jmart, 0) AS avg_jmart,
  COALESCE(st.avg_kokkok, 0) AS avg_kokkok,
  COALESCE(st.avg_kokkok_fc, 0) AS avg_kokkok_fc,
  COALESCE(st.avg_udee, 0) AS avg_udee,
  COALESCE(ss.per_store, '{}'::jsonb) AS avg_per_store,
  COALESCE(rd.payload, '{}'::jsonb) AS range_data
FROM master m
LEFT JOIN pack_min p ON p.sku_code = m.sku_code
LEFT JOIN box_min b ON b.sku_code = m.sku_code
LEFT JOIN rank_d r ON r.item_id = m.sku_code
LEFT JOIN sales_type st ON st.sku = m.sku_code
LEFT JOIN sales_store ss ON ss.sku = m.sku_code
LEFT JOIN range_d rd ON rd.sku = m.sku_code;

CREATE UNIQUE INDEX idx_mv_range_store_sku ON public.mv_range_store(sku_code);
CREATE INDEX idx_mv_range_store_dept ON public.mv_range_store(department);
CREATE INDEX idx_mv_range_store_div ON public.mv_range_store(division);

REFRESH MATERIALIZED VIEW public.mv_range_store;

-- Recreate get_mv_range_store function (was dropped by CASCADE)
CREATE OR REPLACE FUNCTION public.get_mv_range_store()
RETURNS SETOF public.mv_range_store
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
  SELECT * FROM public.mv_range_store;
$$;

-- Recreate get_mv_range_store_filtered function (was dropped by CASCADE)
CREATE OR REPLACE FUNCTION public.get_mv_range_store_filtered(
  p_avg_stores text[] DEFAULT NULL,
  p_range_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL
)
RETURNS TABLE(
  sku_code text, main_barcode text, product_name_la text, product_name_en text,
  unit_of_measure text, packing_size_qty numeric, standard_price numeric, list_price numeric,
  item_status text, item_type text, buying_status text,
  division_group text, division text, department text, sub_department text, class text,
  gm_buyer_code text, buyer_code text, product_owner text, product_bu text,
  barcode_pack text, pack_qty numeric, barcode_box text, box_qty numeric,
  rank_sale text,
  avg_jmart numeric, avg_kokkok numeric, avg_kokkok_fc numeric, avg_udee numeric,
  avg_per_store jsonb, range_data jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_avg_stores text[];
  v_range_stores text[];
BEGIN
  IF p_type_stores IS NOT NULL AND array_length(p_type_stores, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT store_name) INTO v_avg_stores
    FROM public.store_type
    WHERE type_store = ANY(p_type_stores) AND store_name IS NOT NULL;
    v_range_stores := v_avg_stores;
  END IF;

  IF p_avg_stores IS NOT NULL AND array_length(p_avg_stores, 1) > 0 THEN
    v_avg_stores := p_avg_stores;
  END IF;
  IF p_range_stores IS NOT NULL AND array_length(p_range_stores, 1) > 0 THEN
    v_range_stores := p_range_stores;
  END IF;

  RETURN QUERY
  SELECT
    mv.sku_code, mv.main_barcode, mv.product_name_la, mv.product_name_en,
    mv.unit_of_measure, mv.packing_size_qty, mv.standard_price, mv.list_price,
    mv.item_status, mv.item_type, mv.buying_status,
    mv.division_group, mv.division, mv.department, mv.sub_department, mv.class,
    mv.gm_buyer_code, mv.buyer_code, mv.product_owner, mv.product_bu,
    mv.barcode_pack, mv.pack_qty, mv.barcode_box, mv.box_qty,
    mv.rank_sale,
    mv.avg_jmart, mv.avg_kokkok, mv.avg_kokkok_fc, mv.avg_udee,
    CASE
      WHEN v_avg_stores IS NULL THEN mv.avg_per_store
      ELSE COALESCE(
        (SELECT jsonb_object_agg(je.key, je.value)
         FROM jsonb_each(mv.avg_per_store) je
         WHERE je.key = ANY(v_avg_stores)),
        '{}'::jsonb
      )
    END AS avg_per_store,
    CASE
      WHEN v_range_stores IS NULL THEN mv.range_data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(je.key, je.value)
         FROM jsonb_each(mv.range_data) je
         WHERE je.key = ANY(v_range_stores)),
        '{}'::jsonb
      )
    END AS range_data
  FROM public.mv_range_store mv;
END;
$$;

-- Refresh function
CREATE OR REPLACE FUNCTION public.refresh_mv_range_store()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $$
DECLARE
  t0 timestamp := clock_timestamp();
  cnt integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_range_store;
  SELECT COUNT(*) INTO cnt FROM public.mv_range_store;
  RETURN format('Refreshed %s rows in %s ms', cnt, EXTRACT(MILLISECONDS FROM clock_timestamp() - t0)::int);
END;
$$;