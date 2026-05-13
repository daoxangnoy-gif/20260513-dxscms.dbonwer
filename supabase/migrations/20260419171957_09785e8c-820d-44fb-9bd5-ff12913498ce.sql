-- All-in-one RPC: returns calculated min/max rows directly
-- Replaces 3 separate RPCs (master, sales, range) with single optimized query
-- Filters to apply_yn='Y' SKUs only (~116K rows instead of 530K combined)
CREATE OR REPLACE FUNCTION public.get_minmax_calc_all(p_n_factor numeric DEFAULT 3)
 RETURNS TABLE(
   sku_code text,
   product_name_la text,
   product_name_en text,
   main_barcode text,
   unit_of_measure text,
   store_name text,
   type_store text,
   size_store text,
   unit_pick numeric,
   avg_sale numeric,
   rank_sale text,
   rank_factor integer,
   min_cal numeric,
   max_cal numeric,
   is_default_min boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
  WITH range_y AS (
    SELECT rs.sku_code, rs.store_name,
      MAX(rs.unit_picking_super) AS ups,
      MAX(rs.unit_picking_mart) AS upm
    FROM range_store rs
    WHERE rs.apply_yn = 'Y'
    GROUP BY rs.sku_code, rs.store_name
  ),
  apply_skus AS (
    SELECT DISTINCT sku_code FROM range_y
  ),
  master AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.product_name_la, dm.product_name_en, dm.main_barcode, dm.unit_of_measure
    FROM data_master dm
    WHERE dm.sku_code IN (SELECT sku_code FROM apply_skus)
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  store_meta AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, st.type_store, st.size_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL
    ORDER BY st.store_name, st.created_at DESC
  ),
  sales_per_store AS (
    SELECT sw.id18 AS sku, sw.store_name, COALESCE(SUM(sw.avg_day),0) AS avg_sale
    FROM sales_by_week sw
    WHERE sw.id18 IN (SELECT sku_code FROM apply_skus)
      AND sw.store_name IS NOT NULL
    GROUP BY sw.id18, sw.store_name
  ),
  rank_d AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs
    WHERE rs.item_id IN (SELECT sku_code FROM apply_skus)
    ORDER BY rs.item_id, rs.created_at DESC
  )
  SELECT
    m.sku_code,
    m.product_name_la,
    m.product_name_en,
    m.main_barcode,
    m.unit_of_measure,
    ry.store_name,
    COALESCE(sm.type_store, '')::text,
    COALESCE(sm.size_store, '')::text,
    COALESCE(
      CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.ups ELSE ry.upm END
    , 1)::numeric AS unit_pick,
    ROUND(COALESCE(sps.avg_sale,0)::numeric, 4) AS avg_sale,
    COALESCE(rd.final_rank, 'D')::text AS rank_sale,
    CASE COALESCE(rd.final_rank,'D')
      WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
    END::int AS rank_factor,
    CASE
      WHEN COALESCE(sps.avg_sale, 0) = 0 THEN 3
      ELSE CEIL(COALESCE(sps.avg_sale,0) * (
        CASE COALESCE(rd.final_rank,'D')
          WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
        END))
    END::numeric AS min_cal,
    CASE
      WHEN COALESCE(sps.avg_sale,0) = 0 THEN
        CASE
          WHEN COALESCE(
            CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.ups ELSE ry.upm END
          , 1) <= 1 THEN 6
          ELSE 3 + COALESCE(
            CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.ups ELSE ry.upm END
          , 1)
        END
      ELSE
        CEIL(
          (CEIL(COALESCE(sps.avg_sale,0) * (
            CASE COALESCE(rd.final_rank,'D')
              WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
            END)) + COALESCE(sps.avg_sale,0) * p_n_factor)
          / NULLIF(COALESCE(
              CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.ups ELSE ry.upm END
            , 1), 0)
        ) * COALESCE(
              CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.ups ELSE ry.upm END
            , 1)
    END::numeric AS max_cal,
    (COALESCE(sps.avg_sale,0) = 0) AS is_default_min
  FROM master m
  JOIN range_y ry ON ry.sku_code = m.sku_code
  LEFT JOIN store_meta sm ON sm.store_name = ry.store_name
  LEFT JOIN sales_per_store sps ON sps.sku = m.sku_code AND sps.store_name = ry.store_name
  LEFT JOIN rank_d rd ON rd.item_id = m.sku_code
  ORDER BY m.sku_code, ry.store_name;
$function$;