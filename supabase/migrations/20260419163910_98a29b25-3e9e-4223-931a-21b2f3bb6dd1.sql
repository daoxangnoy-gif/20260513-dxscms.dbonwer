
-- Phase 1: Master + rank + pack info (lightweight, indexed)
CREATE OR REPLACE FUNCTION public.get_minmax_master()
RETURNS TABLE(
  sku_code text,
  product_name_la text,
  product_name_en text,
  main_barcode text,
  unit_of_measure text,
  rank_sale text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.product_name_la, dm.product_name_en, dm.main_barcode, dm.unit_of_measure
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  rank_d AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs WHERE rs.item_id IS NOT NULL
    ORDER BY rs.item_id, rs.created_at DESC
  )
  SELECT b.sku_code, b.product_name_la, b.product_name_en, b.main_barcode, b.unit_of_measure,
    COALESCE(r.final_rank, 'D')::text AS rank_sale
  FROM base b LEFT JOIN rank_d r ON r.item_id = b.sku_code;
$$;

-- Phase 2: avg sale per (sku, store) — narrow rows only
CREATE OR REPLACE FUNCTION public.get_minmax_sales_per_store()
RETURNS TABLE(sku_code text, store_name text, avg_sale numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  SELECT sw.id18 AS sku_code, sw.store_name,
    ROUND(COALESCE(SUM(sw.avg_day),0)::numeric, 4) AS avg_sale
  FROM sales_by_week sw
  WHERE sw.id18 IS NOT NULL AND sw.store_name IS NOT NULL
  GROUP BY sw.id18, sw.store_name;
$$;

-- Phase 3: range_store (apply_yn='Y') joined with store_type meta
CREATE OR REPLACE FUNCTION public.get_minmax_range_store()
RETURNS TABLE(
  sku_code text, store_name text,
  type_store text, size_store text,
  unit_picking_super numeric, unit_picking_mart numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH ry AS (
    SELECT rs.sku_code, rs.store_name,
      MAX(rs.unit_picking_super) AS unit_picking_super,
      MAX(rs.unit_picking_mart) AS unit_picking_mart
    FROM range_store rs
    WHERE rs.apply_yn = 'Y'
    GROUP BY rs.sku_code, rs.store_name
  ),
  sm AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, st.type_store, st.size_store
    FROM store_type st WHERE st.store_name IS NOT NULL
    ORDER BY st.store_name, st.created_at DESC
  )
  SELECT ry.sku_code, ry.store_name,
    COALESCE(sm.type_store,'')::text, COALESCE(sm.size_store,'')::text,
    COALESCE(ry.unit_picking_super, 1)::numeric,
    COALESCE(ry.unit_picking_mart, 1)::numeric
  FROM ry LEFT JOIN sm ON sm.store_name = ry.store_name;
$$;
