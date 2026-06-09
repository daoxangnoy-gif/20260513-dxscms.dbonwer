-- ============================================================
-- Report OOS (Out of Stock) — ราย Store
--   นิยาม:
--     100%  = SKU ที่ range อยู่ในสาขานั้น (range_data apply_yn = 'Y')
--     Store OOS       = Stock Store  = 0  (รวมกรณีไม่มีแถวใน stock เลย)
--     StockHaveStock  = Stock Store <> 0  (รวมค่าติดลบ)
--   แหล่งข้อมูล:
--     range_store_view (per-store apply_yn), data_master (vendor_code),
--     vendor_master (trade_term, vendor_name_en, spc_name),
--     stock (per-store ที่ company, DC ที่ type_store='DC'),
--     store_type (map store_name -> type_store)
-- ============================================================

-- ---------- 1) Core: _oos_detail(filters) -> รายแถว SKU x Store ----------
CREATE OR REPLACE FUNCTION public._oos_detail(
  p_spc          text[] DEFAULT NULL,
  p_vendors      text[] DEFAULT NULL,
  p_divisions    text[] DEFAULT NULL,
  p_departments  text[] DEFAULT NULL,
  p_type_stores  text[] DEFAULT NULL,
  p_stores       text[] DEFAULT NULL
)
RETURNS TABLE (
  division     text,
  department   text,
  store_name   text,
  type_store   text,
  id_match     text,
  sku          text,
  barcode      text,
  name_la      text,
  vendor       text,
  teadterm     text,
  item_type    text,
  buying       text,
  rank_sale    text,
  store_apply  integer,
  stock_store  numeric,
  stock_dc     numeric,
  remark_stock text,
  remark_oos   text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
  WITH dm AS (
    -- vendor_code ต่อ SKU (range_store_view มี division/department/etc อยู่แล้ว ขาดแค่ vendor)
    SELECT DISTINCT ON (sku_code) sku_code, vendor_code
    FROM public.data_master
    WHERE sku_code IS NOT NULL
    ORDER BY sku_code, updated_at DESC NULLS LAST
  ),
  vm AS (
    SELECT DISTINCT ON (vendor_code) vendor_code, vendor_name_en, trade_term, spc_name
    FROM public.vendor_master
    WHERE vendor_code IS NOT NULL
    ORDER BY vendor_code, updated_at DESC NULLS LAST
  ),
  ranged AS (
    -- แตก range_data เป็นราย store เฉพาะ apply_yn = 'Y'
    SELECT
      rsv.sku_code,
      (kv.key)::text                         AS store_name,
      COALESCE(rsv.division,'')              AS division,
      COALESCE(rsv.department,'')            AS department,
      COALESCE(rsv.product_name_la,'')       AS name_la,
      COALESCE(rsv.main_barcode,'')          AS barcode,
      COALESCE(rsv.item_type,'')             AS item_type,
      COALESCE(rsv.buying_status,'')         AS buying,
      COALESCE(rsv.rank_sale,'')             AS rank_sale
    FROM public.range_store_view rsv
    CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
    WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
  ),
  sa_cnt AS (
    -- จำนวนสาขาที่ SKU นั้น range อยู่ (global ต่อ SKU ไม่อิง filter)
    SELECT sku_code, COUNT(*)::int AS cnt FROM ranged GROUP BY sku_code
  ),
  st_store AS (
    -- stock ราย store (company = ชื่อสาขา) ตัด DC ออก, รวมหลายแถว
    SELECT item_id, company AS store_name, SUM(COALESCE(quantity,0)) AS qty
    FROM public.stock
    WHERE company IS NOT NULL AND (type_store IS NULL OR type_store <> 'DC')
    GROUP BY item_id, company
  ),
  st_dc AS (
    SELECT item_id, SUM(COALESCE(quantity,0)) AS qty
    FROM public.stock
    WHERE type_store = 'DC'
    GROUP BY item_id
  )
  SELECT
    r.division,
    r.department,
    r.store_name,
    COALESCE(stp.type_store,'')                                       AS type_store,
    r.store_name || r.sku_code                                        AS id_match,
    r.sku_code                                                        AS sku,
    r.barcode,
    r.name_la,
    CASE
      WHEN d.vendor_code IS NULL OR d.vendor_code = '' THEN ''
      WHEN v.vendor_name_en IS NULL OR v.vendor_name_en = '' THEN d.vendor_code
      ELSE d.vendor_code || '-' || v.vendor_name_en
    END                                                              AS vendor,
    COALESCE(v.trade_term,'')                                        AS teadterm,
    r.item_type,
    r.buying,
    r.rank_sale,
    COALESCE(sa.cnt,0)                                               AS store_apply,
    COALESCE(ss.qty,0)                                               AS stock_store,
    COALESCE(sd.qty,0)                                               AS stock_dc,
    CASE WHEN COALESCE(sd.qty,0) <> 0 THEN 'DC Have stock' ELSE 'DC No Stock' END     AS remark_stock,
    CASE WHEN COALESCE(ss.qty,0) =  0 THEN 'Store OOS'     ELSE 'StockHaveStock' END  AS remark_oos
  FROM ranged r
  LEFT JOIN dm d           ON d.sku_code   = r.sku_code
  LEFT JOIN vm v           ON v.vendor_code = d.vendor_code
  LEFT JOIN sa_cnt sa      ON sa.sku_code  = r.sku_code
  LEFT JOIN st_store ss    ON ss.item_id   = r.sku_code AND ss.store_name = r.store_name
  LEFT JOIN st_dc sd       ON sd.item_id   = r.sku_code
  LEFT JOIN public.store_type stp ON stp.store_name = r.store_name
  WHERE (p_spc          IS NULL OR cardinality(p_spc)=0          OR v.spc_name      = ANY(p_spc))
    AND (p_vendors      IS NULL OR cardinality(p_vendors)=0      OR d.vendor_code   = ANY(p_vendors))
    AND (p_divisions    IS NULL OR cardinality(p_divisions)=0    OR r.division      = ANY(p_divisions))
    AND (p_departments  IS NULL OR cardinality(p_departments)=0  OR r.department    = ANY(p_departments))
    AND (p_type_stores  IS NULL OR cardinality(p_type_stores)=0  OR stp.type_store  = ANY(p_type_stores))
    AND (p_stores       IS NULL OR cardinality(p_stores)=0       OR r.store_name    = ANY(p_stores));
$function$;

GRANT EXECUTE ON FUNCTION public._oos_detail(text[],text[],text[],text[],text[],text[]) TO anon, authenticated;

-- ---------- 2) get_oos_detail: คืนทุกแถวเป็น jsonb (สำหรับปุ่ม Get) ----------
CREATE OR REPLACE FUNCTION public.get_oos_detail(
  p_spc          text[] DEFAULT NULL,
  p_vendors      text[] DEFAULT NULL,
  p_divisions    text[] DEFAULT NULL,
  p_departments  text[] DEFAULT NULL,
  p_type_stores  text[] DEFAULT NULL,
  p_stores       text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  FROM (
    SELECT * FROM public._oos_detail(p_spc, p_vendors, p_divisions, p_departments, p_type_stores, p_stores)
    ORDER BY type_store, store_name, sku
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_detail(text[],text[],text[],text[],text[],text[]) TO anon, authenticated;

-- ---------- 3) Snapshot tables ----------
CREATE TABLE IF NOT EXISTS public.oos_snapshots (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_label    text NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  filters       jsonb DEFAULT '{}'::jsonb,
  total_rows    integer NOT NULL DEFAULT 0,
  user_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oos_snapshot_rows (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id  uuid NOT NULL REFERENCES public.oos_snapshots(id) ON DELETE CASCADE,
  division     text,
  department   text,
  store_name   text,
  type_store   text,
  id_match     text,
  sku          text,
  barcode      text,
  name_la      text,
  vendor       text,
  teadterm     text,
  item_type    text,
  buying       text,
  rank_sale    text,
  store_apply  integer,
  stock_store  numeric,
  stock_dc     numeric,
  remark_stock text,
  remark_oos   text
);

CREATE INDEX IF NOT EXISTS idx_oos_rows_snapshot ON public.oos_snapshot_rows(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_oos_snapshots_week ON public.oos_snapshots(week_label);
CREATE INDEX IF NOT EXISTS idx_oos_snapshots_date ON public.oos_snapshots(snapshot_date DESC);

ALTER TABLE public.oos_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oos_snapshot_rows  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_oos_snap" ON public.oos_snapshots;
CREATE POLICY "auth_read_oos_snap"   ON public.oos_snapshots     FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_write_oos_snap" ON public.oos_snapshots;
CREATE POLICY "auth_write_oos_snap"  ON public.oos_snapshots     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_oos_rows" ON public.oos_snapshot_rows;
CREATE POLICY "auth_read_oos_rows"   ON public.oos_snapshot_rows FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_write_oos_rows" ON public.oos_snapshot_rows;
CREATE POLICY "auth_write_oos_rows"  ON public.oos_snapshot_rows FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ---------- 4) save_oos_snapshot: regenerate + INSERT...SELECT ฝั่ง server ----------
--   ทับ snapshot ของ week เดิม (ถ้ามี) แล้วสร้างใหม่ คืน snapshot id + จำนวนแถว
CREATE OR REPLACE FUNCTION public.save_oos_snapshot(
  p_week         text,
  p_filters      jsonb   DEFAULT '{}'::jsonb,
  p_spc          text[]  DEFAULT NULL,
  p_vendors      text[]  DEFAULT NULL,
  p_divisions    text[]  DEFAULT NULL,
  p_departments  text[]  DEFAULT NULL,
  p_type_stores  text[]  DEFAULT NULL,
  p_stores       text[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  v_id  uuid;
  v_cnt integer;
BEGIN
  DELETE FROM public.oos_snapshots WHERE week_label = p_week;  -- cascade ลบ rows เก่า

  INSERT INTO public.oos_snapshots(week_label, filters, user_id)
  VALUES (p_week, COALESCE(p_filters,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.oos_snapshot_rows(
    snapshot_id, division, department, store_name, type_store, id_match,
    sku, barcode, name_la, vendor, teadterm, item_type, buying, rank_sale,
    store_apply, stock_store, stock_dc, remark_stock, remark_oos
  )
  SELECT v_id, division, department, store_name, type_store, id_match,
         sku, barcode, name_la, vendor, teadterm, item_type, buying, rank_sale,
         store_apply, stock_store, stock_dc, remark_stock, remark_oos
  FROM public._oos_detail(p_spc, p_vendors, p_divisions, p_departments, p_type_stores, p_stores);

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE public.oos_snapshots SET total_rows = v_cnt WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'total_rows', v_cnt);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_oos_snapshot(text,jsonb,text[],text[],text[],text[],text[],text[]) TO authenticated;

-- ---------- 5) get_oos_filter_options: ตัวเลือก dropdown ทั้งหมดในครั้งเดียว ----------
CREATE OR REPLACE FUNCTION public.get_oos_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  SELECT jsonb_build_object(
    'divisions', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
      FROM (SELECT DISTINCT division AS d FROM public.data_master
            WHERE division IS NOT NULL AND division <> '') s
    ),
    'departments', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
      FROM (SELECT DISTINCT department AS d FROM public.data_master
            WHERE department IS NOT NULL AND department <> '') s
    ),
    'spc', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
      FROM (SELECT DISTINCT spc_name AS d FROM public.vendor_master
            WHERE spc_name IS NOT NULL AND spc_name <> '') s
    ),
    'type_stores', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
      FROM (SELECT DISTINCT type_store AS d FROM public.store_type
            WHERE type_store IS NOT NULL AND type_store <> '') s
    ),
    'stores', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('store_name', store_name, 'type_store', type_store)
                                ORDER BY store_name), '[]'::jsonb)
      FROM public.store_type WHERE store_name IS NOT NULL AND store_name <> ''
    ),
    'vendors', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('vendor_code', vendor_code,
                                                   'vendor_name_en', COALESCE(vendor_name_en,''),
                                                   'spc_name', COALESCE(spc_name,''))
                                ORDER BY vendor_code), '[]'::jsonb)
      FROM (SELECT DISTINCT ON (vendor_code) vendor_code, vendor_name_en, spc_name
            FROM public.vendor_master WHERE vendor_code IS NOT NULL
            ORDER BY vendor_code, updated_at DESC NULLS LAST) s
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_filter_options() TO anon, authenticated;
