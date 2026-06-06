-- ============================================================================
-- Min/Max Cal performance: range_store_flat + dynamic-SQL get_minmax_calc_all
-- ----------------------------------------------------------------------------
-- ปัญหาเดิม: ปุ่ม Calculate ในหน้า Min/Max Calculator ช้า 60+ วิ
-- สาเหตุ:
--   1) get_minmax_calc_all แกะ JSONB (jsonb_each บน range_store_view) ทุกครั้ง
--      = ขยาย ~3,000 SKU × หลายสิบ store ทุก Cal
--   2) เวอร์ชัน LANGUAGE sql ใช้ pattern (p_x IS NULL OR col = ANY(p_x))
--      ทำให้ planner ประเมิน selectivity ผิด → เลือก plan ห่วยเมื่อเรียกผ่าน RPC
-- วิธีแก้:
--   A) range_store_flat — ตารางกางข้อมูล range (sku × store) ไว้ล่วงหน้า
--   B) get_minmax_calc_all — dynamic SQL (ฝัง filter เป็น literal เฉพาะเมื่อมีค่า)
--      + อ่านจาก range_store_flat แทน jsonb_each
--   C) sync_range_store_view / sync_range_store_view_skus rebuild flat อัตโนมัติ
-- ผล: 60+ วิ → ~1.2 วิ
-- ============================================================================

-- A) Flat table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.range_store_flat (
  sku_code   text NOT NULL,
  store_name text NOT NULL,
  pack_qty   numeric,
  box_qty    numeric,
  PRIMARY KEY (sku_code, store_name)
);
CREATE INDEX IF NOT EXISTS idx_rsf_store ON public.range_store_flat (store_name);
CREATE INDEX IF NOT EXISTS idx_rsf_sku   ON public.range_store_flat (sku_code);

-- Populate ครั้งแรกจาก range_store_view (apply_yn = 'Y' เท่านั้น)
TRUNCATE public.range_store_flat;
INSERT INTO public.range_store_flat (sku_code, store_name, pack_qty, box_qty)
SELECT rsv.sku_code, (kv.key)::text, rsv.pack_qty, rsv.box_qty
FROM public.range_store_view rsv
CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
  AND rsv.sku_code IS NOT NULL;

-- B) get_minmax_calc_all (dynamic SQL + range_store_flat) --------------------
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
  IF p_store_names     IS NOT NULL THEN v_store_filter := format(' AND st.store_name = ANY(%L::text[])', p_store_names); END IF;
  IF p_type_stores     IS NOT NULL THEN v_type_filter  := format(' AND st.type_store = ANY(%L::text[])', p_type_stores); END IF;
  IF p_item_types      IS NOT NULL THEN v_item_type    := format(' AND dm.item_type = ANY(%L::text[])', p_item_types); END IF;
  IF p_buying_statuses IS NOT NULL THEN v_buying       := format(' AND dm.buying_status = ANY(%L::text[])', p_buying_statuses); END IF;
  IF p_divisions       IS NOT NULL THEN v_div          := format(' AND dm.division = ANY(%L::text[])', p_divisions); END IF;
  IF p_departments     IS NOT NULL THEN v_dept         := format(' AND dm.department = ANY(%L::text[])', p_departments); END IF;
  IF p_sub_departments IS NOT NULL THEN v_subdept      := format(' AND dm.sub_department = ANY(%L::text[])', p_sub_departments); END IF;
  IF p_classes         IS NOT NULL THEN v_class        := format(' AND dm.class = ANY(%L::text[])', p_classes); END IF;
  IF p_sku_codes       IS NOT NULL THEN v_sku          := format(' AND dm.sku_code = ANY(%L::text[])', p_sku_codes); END IF;
  IF p_barcodes        IS NOT NULL THEN v_barcode      := format(' AND dm.main_barcode = ANY(%L::text[])', p_barcodes); END IF;

  v_sql := format($SQL$
    WITH
    store_meta AS (
      SELECT DISTINCT ON (st.store_name) st.store_name, st.type_store, st.size_store
      FROM store_type st
      WHERE st.store_name IS NOT NULL %s %s
      ORDER BY st.store_name, st.created_at DESC
    ),
    allowed_stores AS (SELECT store_name FROM store_meta),
    range_y AS (
      SELECT rsf.sku_code, rsf.store_name, rsf.pack_qty, rsf.box_qty
      FROM range_store_flat rsf
      WHERE rsf.store_name IN (SELECT store_name FROM allowed_stores)
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
        mm.item_id, mm.store_name, NULLIF(mm.unit_pick, '')::numeric AS unit_pick
      FROM minmax mm
      WHERE mm.item_id IN (SELECT sku_code FROM master)
        AND mm.store_name IN (SELECT store_name FROM allowed_stores)
      ORDER BY mm.item_id, mm.store_name, mm.updated_at DESC
    ),
    up_over AS (
      SELECT upo.sku_code, upo.store_name, upo.unit_pick
      FROM unit_pick_override upo
      INNER JOIN master m ON m.sku_code = upo.sku_code
    )
    SELECT
      m.sku_code, m.product_name_la, m.product_name_en, m.main_barcode, m.unit_of_measure,
      ry.store_name,
      COALESCE(sm.type_store, '')::text,
      COALESCE(sm.size_store, '')::text,
      COALESCE(upo.unit_pick, mu.unit_pick, 1)::numeric,
      ROUND(COALESCE(sps.avg_sale,0)::numeric, 4),
      COALESCE(rd.final_rank, 'D')::text,
      (CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END)::int,
      (CASE WHEN COALESCE(sps.avg_sale,0)=0 THEN 3
            ELSE CEIL(COALESCE(sps.avg_sale,0)*(CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END))
       END)::numeric,
      (CASE WHEN COALESCE(sps.avg_sale,0)=0 THEN
              CASE WHEN COALESCE(upo.unit_pick, mu.unit_pick, 1)<=1 THEN 6
                   ELSE 3 + COALESCE(upo.unit_pick, mu.unit_pick, 1) END
            ELSE
              CEIL(
                (CEIL(COALESCE(sps.avg_sale,0)*(CASE COALESCE(rd.final_rank,'D') WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7 END))
                 + COALESCE(sps.avg_sale,0)*%L::numeric)
                / NULLIF(COALESCE(upo.unit_pick, mu.unit_pick, 1), 0)
              ) * COALESCE(upo.unit_pick, mu.unit_pick, 1)
       END)::numeric,
      (COALESCE(sps.avg_sale,0)=0),
      COALESCE(m.item_type,'')::text, COALESCE(m.buying_status,'')::text,
      COALESCE(m.division,'')::text, COALESCE(m.department,'')::text,
      COALESCE(m.sub_department,'')::text, COALESCE(m.class,'')::text,
      ry.pack_qty, ry.box_qty
    FROM master m
    JOIN range_y ry ON ry.sku_code = m.sku_code
    JOIN store_meta sm ON sm.store_name = ry.store_name
    LEFT JOIN sales_per_store sps ON sps.sku = m.sku_code AND sps.store_name = ry.store_name
    LEFT JOIN rank_d rd ON rd.item_id = m.sku_code
    LEFT JOIN mm_up mu ON mu.item_id = m.sku_code AND mu.store_name = ry.store_name
    LEFT JOIN up_over upo ON upo.sku_code = m.sku_code AND upo.store_name = ry.store_name
    ORDER BY m.sku_code, ry.store_name
  $SQL$,
    v_store_filter, v_type_filter,
    v_item_type, v_buying, v_div, v_dept, v_subdept, v_class, v_sku, v_barcode,
    p_n_factor
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_minmax_calc_all(numeric,text[],text[],text[],text[],text[],text[],text[],text[],text[],text[]) TO authenticated;

-- C1) Full sync — rebuild flat ทั้งหมดหลัง rebuild view ---------------------
CREATE OR REPLACE FUNCTION public.sync_range_store_view()
RETURNS TABLE(rows_synced integer, ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  c integer;
BEGIN
  TRUNCATE public.range_store_view;
  INSERT INTO public.range_store_view (
    sku_code, main_barcode, product_name_la, product_name_en, unit_of_measure,
    packing_size_qty, standard_price, list_price, item_status, item_type, buying_status,
    division_group, division, department, sub_department, class,
    gm_buyer_code, buyer_code, product_owner, product_bu,
    barcode_pack, pack_qty, barcode_box, box_qty,
    rank_sale, avg_jmart, avg_kokkok, avg_kokkok_fc, avg_udee,
    avg_per_store, range_data, synced_at
  )
  SELECT
    d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
    d.packing_size_qty, d.standard_price, d.list_price, d.item_status, d.item_type, d.buying_status,
    d.division_group, d.division, d.department, d.sub_department, d.class,
    d.gm_buyer_code, d.buyer_code, d.product_owner, d.product_bu,
    d.barcode_pack, d.pack_qty, d.barcode_box, d.box_qty,
    d.rank_sale, d.avg_jmart, d.avg_kokkok, d.avg_kokkok_fc, d.avg_udee,
    d.avg_per_store, d.range_data, now()
  FROM public.get_range_store_data() d;

  GET DIAGNOSTICS c = ROW_COUNT;

  -- rebuild flat (Min/Max Cal ใช้)
  TRUNCATE public.range_store_flat;
  INSERT INTO public.range_store_flat (sku_code, store_name, pack_qty, box_qty)
  SELECT rsv.sku_code, (kv.key)::text, rsv.pack_qty, rsv.box_qty
  FROM public.range_store_view rsv
  CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
  WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
    AND rsv.sku_code IS NOT NULL;

  RETURN QUERY SELECT c, EXTRACT(MILLISECONDS FROM clock_timestamp() - t0)::int;
END;
$$;

-- C2) Incremental sync — อัปเดต flat เฉพาะ SKU ที่ import -------------------
CREATE OR REPLACE FUNCTION public.sync_range_store_view_skus(p_skus text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  c integer := 0;
BEGIN
  IF p_skus IS NULL OR array_length(p_skus, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.range_store_view WHERE sku_code = ANY(p_skus);
  INSERT INTO public.range_store_view (
    sku_code, main_barcode, product_name_la, product_name_en, unit_of_measure,
    packing_size_qty, standard_price, list_price, item_status, item_type, buying_status,
    division_group, division, department, sub_department, class,
    gm_buyer_code, buyer_code, product_owner, product_bu,
    barcode_pack, pack_qty, barcode_box, box_qty,
    rank_sale, avg_jmart, avg_kokkok, avg_kokkok_fc, avg_udee,
    avg_per_store, range_data, synced_at
  )
  SELECT
    d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
    d.packing_size_qty, d.standard_price, d.list_price, d.item_status, d.item_type, d.buying_status,
    d.division_group, d.division, d.department, d.sub_department, d.class,
    d.gm_buyer_code, d.buyer_code, d.product_owner, d.product_bu,
    d.barcode_pack, d.pack_qty, d.barcode_box, d.box_qty,
    d.rank_sale, d.avg_jmart, d.avg_kokkok, d.avg_kokkok_fc, d.avg_udee,
    d.avg_per_store, d.range_data, now()
  FROM public.get_range_store_data() d
  WHERE d.sku_code = ANY(p_skus);
  GET DIAGNOSTICS c = ROW_COUNT;

  -- อัปเดต flat เฉพาะ SKU เหล่านี้
  DELETE FROM public.range_store_flat WHERE sku_code = ANY(p_skus);
  INSERT INTO public.range_store_flat (sku_code, store_name, pack_qty, box_qty)
  SELECT rsv.sku_code, (kv.key)::text, rsv.pack_qty, rsv.box_qty
  FROM public.range_store_view rsv
  CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
  WHERE rsv.sku_code = ANY(p_skus)
    AND COALESCE(kv.value->>'apply_yn','N') = 'Y';

  RETURN c;
END;
$$;

ANALYZE public.range_store_flat;
