-- Optimized RPC for Range Store: aggregates everything server-side in 1 call
CREATE OR REPLACE FUNCTION public.get_range_store_data()
RETURNS TABLE(
  sku_code text,
  main_barcode text,
  product_name_la text,
  product_name_en text,
  unit_of_measure text,
  packing_size_qty numeric,
  standard_price numeric,
  list_price numeric,
  item_status text,
  item_type text,
  buying_status text,
  division_group text,
  division text,
  department text,
  sub_department text,
  class text,
  gm_buyer_code text,
  buyer_code text,
  product_owner text,
  product_bu text,
  barcode_pack text,
  pack_qty numeric,
  barcode_box text,
  box_qty numeric,
  rank_sale text,
  avg_jmart numeric,
  avg_kokkok numeric,
  avg_kokkok_fc numeric,
  avg_udee numeric,
  avg_per_store jsonb,
  range_data jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
  WITH master AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
      dm.unit_of_measure, dm.packing_size_qty, dm.standard_price, dm.list_price,
      dm.item_status, dm.item_type, dm.buying_status,
      dm.division_group, dm.division, dm.department, dm.sub_department, dm.class,
      dm.gm_buyer_code, dm.buyer_code, dm.product_owner, dm.product_bu
    FROM data_master dm
    WHERE dm.stock_unit_flag = 'Y' AND dm.sku_code IS NOT NULL
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
$$;