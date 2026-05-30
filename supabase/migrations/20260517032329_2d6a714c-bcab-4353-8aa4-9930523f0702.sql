
DROP FUNCTION IF EXISTS public.get_minmax_filter_options();
DROP FUNCTION IF EXISTS public.get_minmax_calc_all(numeric, text[], text[], text[], text[]);

CREATE OR REPLACE FUNCTION public.get_minmax_filter_options()
 RETURNS TABLE(item_types text[], buying_statuses text[], divisions text[], departments text[], sub_departments text[], classes text[], stores jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT
    (SELECT ARRAY_AGG(DISTINCT item_type ORDER BY item_type)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND (buying_status IS NULL OR buying_status <> 'Inactive')
        AND item_type IS NOT NULL AND item_type <> ''),
    (SELECT ARRAY_AGG(DISTINCT buying_status ORDER BY buying_status)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND buying_status IS NOT NULL AND buying_status <> ''),
    (SELECT ARRAY_AGG(DISTINCT division ORDER BY division)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND division IS NOT NULL AND division <> ''),
    (SELECT ARRAY_AGG(DISTINCT department ORDER BY department)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND department IS NOT NULL AND department <> ''),
    (SELECT ARRAY_AGG(DISTINCT sub_department ORDER BY sub_department)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND sub_department IS NOT NULL AND sub_department <> ''),
    (SELECT ARRAY_AGG(DISTINCT class ORDER BY class)
      FROM data_master
      WHERE product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND class IS NOT NULL AND class <> ''),
    (SELECT jsonb_agg(jsonb_build_object('store_name', store_name, 'type_store', COALESCE(type_store,'')))
      FROM (
        SELECT DISTINCT ON (store_name) store_name, type_store
        FROM store_type
        WHERE store_name IS NOT NULL
        ORDER BY store_name, created_at DESC
      ) s);
$function$;

CREATE OR REPLACE FUNCTION public.get_minmax_calc_all(
  p_n_factor numeric DEFAULT 3,
  p_store_names text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_sku_codes text[] DEFAULT NULL,
  p_barcodes text[] DEFAULT NULL
)
 RETURNS TABLE(
   sku_code text, product_name_la text, product_name_en text, main_barcode text, unit_of_measure text,
   store_name text, type_store text, size_store text,
   unit_pick numeric, avg_sale numeric, rank_sale text, rank_factor integer,
   min_cal numeric, max_cal numeric, is_default_min boolean,
   item_type text, buying_status text,
   division text, department text, sub_department text, class text,
   pack_qty numeric, box_qty numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
  WITH range_y AS (
    SELECT
      rsv.sku_code,
      (kv.key)::text AS store_name,
      rsv.pack_qty AS pack_qty,
      rsv.box_qty AS box_qty
    FROM public.range_store_view rsv,
         LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
    WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
  ),
  apply_skus AS (SELECT DISTINCT sku_code FROM range_y),
  master AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.product_name_la, dm.product_name_en, dm.main_barcode,
      dm.unit_of_measure, dm.item_type, dm.buying_status,
      dm.division, dm.department, dm.sub_department, dm.class
    FROM data_master dm
    WHERE dm.sku_code IN (SELECT sku_code FROM apply_skus)
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
      AND (p_item_types IS NULL OR dm.item_type = ANY(p_item_types))
      AND (p_buying_statuses IS NULL OR dm.buying_status = ANY(p_buying_statuses))
      AND (p_divisions IS NULL OR dm.division = ANY(p_divisions))
      AND (p_departments IS NULL OR dm.department = ANY(p_departments))
      AND (p_sub_departments IS NULL OR dm.sub_department = ANY(p_sub_departments))
      AND (p_classes IS NULL OR dm.class = ANY(p_classes))
      AND (p_sku_codes IS NULL OR dm.sku_code = ANY(p_sku_codes))
      AND (p_barcodes IS NULL OR dm.main_barcode = ANY(p_barcodes))
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  store_meta AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, st.type_store, st.size_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL
      AND (p_store_names IS NULL OR st.store_name = ANY(p_store_names))
      AND (p_type_stores IS NULL OR st.type_store = ANY(p_type_stores))
    ORDER BY st.store_name, st.created_at DESC
  ),
  sales_per_store AS (
    SELECT sw.id18 AS sku, sw.store_name, COALESCE(SUM(sw.avg_day),0) AS avg_sale
    FROM sales_by_week sw
    WHERE sw.id18 IN (SELECT sku_code FROM master)
      AND sw.store_name IS NOT NULL
    GROUP BY sw.id18, sw.store_name
  ),
  rank_d AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs
    WHERE rs.item_id IN (SELECT sku_code FROM master)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  mm_up AS (
    SELECT DISTINCT ON (mm.item_id, mm.store_name)
      mm.item_id, mm.store_name,
      NULLIF(mm.unit_pick, '')::numeric AS unit_pick
    FROM minmax mm
    WHERE mm.item_id IN (SELECT sku_code FROM master)
    ORDER BY mm.item_id, mm.store_name, mm.updated_at DESC
  )
  SELECT
    m.sku_code, m.product_name_la, m.product_name_en, m.main_barcode, m.unit_of_measure,
    ry.store_name,
    COALESCE(sm.type_store, '')::text,
    COALESCE(sm.size_store, '')::text,
    COALESCE(mu.unit_pick, 1)::numeric AS unit_pick,
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
          WHEN COALESCE(mu.unit_pick, 1) <= 1 THEN 6
          ELSE 3 + COALESCE(mu.unit_pick, 1)
        END
      ELSE
        CEIL(
          (CEIL(COALESCE(sps.avg_sale,0) * (
            CASE COALESCE(rd.final_rank,'D')
              WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
            END)) + COALESCE(sps.avg_sale,0) * p_n_factor)
          / NULLIF(COALESCE(mu.unit_pick, 1), 0)
        ) * COALESCE(mu.unit_pick, 1)
    END::numeric AS max_cal,
    (COALESCE(sps.avg_sale,0) = 0) AS is_default_min,
    COALESCE(m.item_type, '')::text AS item_type,
    COALESCE(m.buying_status, '')::text AS buying_status,
    COALESCE(m.division, '')::text AS division,
    COALESCE(m.department, '')::text AS department,
    COALESCE(m.sub_department, '')::text AS sub_department,
    COALESCE(m.class, '')::text AS class,
    ry.pack_qty,
    ry.box_qty
  FROM master m
  JOIN range_y ry ON ry.sku_code = m.sku_code
  JOIN store_meta sm ON sm.store_name = ry.store_name
  LEFT JOIN sales_per_store sps ON sps.sku = m.sku_code AND sps.store_name = ry.store_name
  LEFT JOIN rank_d rd ON rd.item_id = m.sku_code
  LEFT JOIN mm_up mu ON mu.item_id = m.sku_code AND mu.store_name = ry.store_name
  ORDER BY m.sku_code, ry.store_name;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_minmax_unit_pick(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  WITH src AS (
    SELECT
      (x->>'item_id')::text AS item_id,
      (x->>'store_name')::text AS store_name,
      (x->>'unit_pick')::text AS unit_pick,
      NULLIF(x->>'type_store','')::text AS type_store,
      NULLIF(x->>'min_val','')::numeric AS min_val,
      NULLIF(x->>'max_val','')::numeric AS max_val
    FROM jsonb_array_elements(p_rows) x
  ),
  upd AS (
    UPDATE minmax mm
       SET unit_pick = s.unit_pick,
           type_store = COALESCE(s.type_store, mm.type_store),
           min_val = COALESCE(s.min_val, mm.min_val),
           max_val = COALESCE(s.max_val, mm.max_val),
           updated_at = now()
      FROM src s
     WHERE mm.item_id = s.item_id AND mm.store_name = s.store_name
    RETURNING mm.id
  ),
  ins AS (
    INSERT INTO minmax(item_id, store_name, unit_pick, type_store, min_val, max_val)
    SELECT s.item_id, s.store_name, s.unit_pick, s.type_store, s.min_val, s.max_val
    FROM src s
    WHERE NOT EXISTS (
      SELECT 1 FROM minmax mm WHERE mm.item_id = s.item_id AND mm.store_name = s.store_name
    )
    RETURNING id
  )
  SELECT (SELECT COUNT(*) FROM upd) + (SELECT COUNT(*) FROM ins) INTO v_count;
  RETURN v_count;
END;
$function$;
