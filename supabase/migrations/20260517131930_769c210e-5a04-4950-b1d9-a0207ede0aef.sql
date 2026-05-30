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
  sku_code text, product_name_la text, product_name_en text, main_barcode text,
  unit_of_measure text, store_name text, type_store text, size_store text,
  unit_pick numeric, avg_sale numeric, rank_sale text, rank_factor integer,
  min_cal numeric, max_cal numeric, is_default_min boolean,
  item_type text, buying_status text, division text, department text,
  sub_department text, class text, pack_qty numeric, box_qty numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  v_sql text;
  v_store_filter text := '';
  v_type_filter  text := '';
  v_item_type    text := '';
  v_buying       text := '';
  v_div          text := '';
  v_dept         text := '';
  v_subdept      text := '';
  v_class        text := '';
  v_sku          text := '';
  v_barcode      text := '';
BEGIN
  -- Inline literal filters so the planner sees actual cardinalities (no generic plan)
  IF p_store_names IS NOT NULL THEN
    v_store_filter := format(' AND st.store_name = ANY(%L::text[])', p_store_names);
  END IF;
  IF p_type_stores IS NOT NULL THEN
    v_type_filter := format(' AND st.type_store = ANY(%L::text[])', p_type_stores);
  END IF;
  IF p_item_types IS NOT NULL THEN
    v_item_type := format(' AND dm.item_type = ANY(%L::text[])', p_item_types);
  END IF;
  IF p_buying_statuses IS NOT NULL THEN
    v_buying := format(' AND dm.buying_status = ANY(%L::text[])', p_buying_statuses);
  END IF;
  IF p_divisions IS NOT NULL THEN
    v_div := format(' AND dm.division = ANY(%L::text[])', p_divisions);
  END IF;
  IF p_departments IS NOT NULL THEN
    v_dept := format(' AND dm.department = ANY(%L::text[])', p_departments);
  END IF;
  IF p_sub_departments IS NOT NULL THEN
    v_subdept := format(' AND dm.sub_department = ANY(%L::text[])', p_sub_departments);
  END IF;
  IF p_classes IS NOT NULL THEN
    v_class := format(' AND dm.class = ANY(%L::text[])', p_classes);
  END IF;
  IF p_sku_codes IS NOT NULL THEN
    v_sku := format(' AND dm.sku_code = ANY(%L::text[])', p_sku_codes);
  END IF;
  IF p_barcodes IS NOT NULL THEN
    v_barcode := format(' AND dm.main_barcode = ANY(%L::text[])', p_barcodes);
  END IF;

  v_sql := format($SQL$
    WITH
    store_meta AS (
      SELECT DISTINCT ON (st.store_name)
        st.store_name, st.type_store, st.size_store
      FROM store_type st
      WHERE st.store_name IS NOT NULL %s %s
      ORDER BY st.store_name, st.created_at DESC
    ),
    allowed_stores AS (SELECT store_name FROM store_meta),
    range_y AS (
      SELECT rsv.sku_code, (kv.key)::text AS store_name, rsv.pack_qty, rsv.box_qty
      FROM range_store_view rsv
      CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
      WHERE (kv.key)::text IN (SELECT store_name FROM allowed_stores)
        AND COALESCE(kv.value->>'apply_yn','N') = 'Y'
    ),
    target_skus AS (SELECT DISTINCT sku_code FROM range_y),
    master AS (
      SELECT DISTINCT ON (dm.sku_code)
        dm.sku_code, dm.product_name_la, dm.product_name_en, dm.main_barcode,
        dm.unit_of_measure, dm.item_type, dm.buying_status,
        dm.division, dm.department, dm.sub_department, dm.class
      FROM data_master dm
      WHERE dm.sku_code IN (SELECT sku_code FROM target_skus)
        AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
        AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
        %s %s %s %s %s %s %s %s
      ORDER BY dm.sku_code, dm.created_at DESC
    ),
    sales_per_store AS (
      SELECT sw.id18 AS sku, sw.store_name, COALESCE(SUM(sw.avg_day),0) AS avg_sale
      FROM sales_by_week sw
      WHERE sw.id18 IN (SELECT sku_code FROM master)
        AND sw.store_name IN (SELECT store_name FROM allowed_stores)
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
        AND mm.store_name IN (SELECT store_name FROM allowed_stores)
      ORDER BY mm.item_id, mm.store_name, mm.updated_at DESC
    )
    SELECT
      m.sku_code, m.product_name_la, m.product_name_en, m.main_barcode, m.unit_of_measure,
      ry.store_name,
      COALESCE(sm.type_store, '')::text,
      COALESCE(sm.size_store, '')::text,
      COALESCE(mu.unit_pick, 1)::numeric,
      ROUND(COALESCE(sps.avg_sale,0)::numeric, 4),
      COALESCE(rd.final_rank, 'D')::text,
      (CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END)::int,
      (CASE WHEN COALESCE(sps.avg_sale,0)=0 THEN 3
            ELSE CEIL(COALESCE(sps.avg_sale,0)*(CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END))
       END)::numeric,
      (CASE WHEN COALESCE(sps.avg_sale,0)=0 THEN
              CASE WHEN COALESCE(mu.unit_pick,1)<=1 THEN 6 ELSE 3+COALESCE(mu.unit_pick,1) END
            ELSE
              CEIL((CEIL(COALESCE(sps.avg_sale,0)*(CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END)) + COALESCE(sps.avg_sale,0)*%L::numeric)
                   / NULLIF(COALESCE(mu.unit_pick,1),0)) * COALESCE(mu.unit_pick,1)
       END)::numeric,
      (COALESCE(sps.avg_sale,0)=0),
      COALESCE(m.item_type,'')::text,
      COALESCE(m.buying_status,'')::text,
      COALESCE(m.division,'')::text,
      COALESCE(m.department,'')::text,
      COALESCE(m.sub_department,'')::text,
      COALESCE(m.class,'')::text,
      ry.pack_qty, ry.box_qty
    FROM master m
    JOIN range_y ry ON ry.sku_code = m.sku_code
    JOIN store_meta sm ON sm.store_name = ry.store_name
    LEFT JOIN sales_per_store sps ON sps.sku = m.sku_code AND sps.store_name = ry.store_name
    LEFT JOIN rank_d rd ON rd.item_id = m.sku_code
    LEFT JOIN mm_up mu ON mu.item_id = m.sku_code AND mu.store_name = ry.store_name
    ORDER BY m.sku_code, ry.store_name
  $SQL$,
    v_store_filter, v_type_filter,
    v_item_type, v_buying, v_div, v_dept, v_subdept, v_class, v_sku, v_barcode,
    p_n_factor
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;