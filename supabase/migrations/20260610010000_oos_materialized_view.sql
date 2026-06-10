-- ============================================================
-- Report OOS — Materialized View (แก้ปัญหา query หนัก/ช้าหลัง re-import ถาวร)
--   คำนวณ detail ทั้งหมดครั้งเดียวเก็บเป็น MV + index → query เป็น lookup เร็ว
--   refresh ใหม่หลัง import ผ่านปุ่มในหน้า OOS (refresh_oos_mv)
--
-- ⚠️ รันไฟล์นี้ใน Supabase SQL Editor (CREATE MATERIALIZED VIEW ... WITH DATA
--    จะคำนวณทันที ~1-2 นาที — SQL Editor ไม่ติด limit 125s เหมือน RPC)
-- ============================================================

-- ---------- 1) Materialized View: detail ทั้งหมด (+ vendor_code, spc_name สำหรับ filter) ----------
DROP MATERIALIZED VIEW IF EXISTS public.oos_detail_mv;
CREATE MATERIALIZED VIEW public.oos_detail_mv AS
  WITH dm AS (
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
    SELECT
      rsv.sku_code,
      (kv.key)::text                   AS store_name,
      COALESCE(rsv.division,'')        AS division,
      COALESCE(rsv.department,'')      AS department,
      COALESCE(rsv.product_name_la,'') AS name_la,
      COALESCE(rsv.main_barcode,'')    AS barcode,
      COALESCE(rsv.item_type,'')       AS item_type,
      COALESCE(rsv.buying_status,'')   AS buying,
      COALESCE(rsv.rank_sale,'')       AS rank_sale
    FROM public.range_store_view rsv
    CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
    WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
  ),
  sa_cnt AS (
    SELECT sku_code, COUNT(*)::int AS cnt FROM ranged GROUP BY sku_code
  ),
  st_store AS (
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
    COALESCE(stp.type_store,'')                  AS type_store,
    r.store_name || r.sku_code                   AS id_match,
    r.sku_code                                   AS sku,
    r.barcode,
    r.name_la,
    d.vendor_code,
    v.spc_name,
    CASE
      WHEN d.vendor_code IS NULL OR d.vendor_code = '' THEN ''
      WHEN v.vendor_name_en IS NULL OR v.vendor_name_en = '' THEN d.vendor_code
      ELSE d.vendor_code || '-' || v.vendor_name_en
    END                                          AS vendor,
    COALESCE(v.trade_term,'')                    AS teadterm,
    r.item_type,
    r.buying,
    r.rank_sale,
    COALESCE(sa.cnt,0)                           AS store_apply,
    COALESCE(ss.qty,0)                           AS stock_store,
    COALESCE(sd.qty,0)                           AS stock_dc,
    CASE WHEN COALESCE(sd.qty,0) <> 0 THEN 'DC Have stock' ELSE 'DC No Stock' END    AS remark_stock,
    CASE WHEN COALESCE(ss.qty,0) =  0 THEN 'Store OOS'     ELSE 'StockHaveStock' END AS remark_oos
  FROM ranged r
  LEFT JOIN dm d        ON d.sku_code    = r.sku_code
  LEFT JOIN vm v        ON v.vendor_code = d.vendor_code
  LEFT JOIN sa_cnt sa   ON sa.sku_code   = r.sku_code
  LEFT JOIN st_store ss ON ss.item_id    = r.sku_code AND ss.store_name = r.store_name
  LEFT JOIN st_dc sd    ON sd.item_id    = r.sku_code
  LEFT JOIN public.store_type stp ON stp.store_name = r.store_name;

-- ---------- 2) Indexes (รองรับ filter + REFRESH CONCURRENTLY) ----------
CREATE UNIQUE INDEX oos_mv_uk     ON public.oos_detail_mv (store_name, sku); -- ต้องมีสำหรับ CONCURRENTLY
CREATE INDEX oos_mv_type          ON public.oos_detail_mv (type_store);
CREATE INDEX oos_mv_store         ON public.oos_detail_mv (store_name);
CREATE INDEX oos_mv_div           ON public.oos_detail_mv (division);
CREATE INDEX oos_mv_dept          ON public.oos_detail_mv (department);
CREATE INDEX oos_mv_vendor        ON public.oos_detail_mv (vendor_code);
CREATE INDEX oos_mv_spc           ON public.oos_detail_mv (spc_name);
CREATE INDEX oos_mv_order         ON public.oos_detail_mv (type_store, store_name, sku);

GRANT SELECT ON public.oos_detail_mv TO anon, authenticated;

-- ---------- 3) _oos_detail: เปลี่ยนไปอ่านจาก MV (เร็ว) — signature เดิม callers ไม่ต้องแก้ ----------
CREATE OR REPLACE FUNCTION public._oos_detail(
  p_spc          text[] DEFAULT NULL,
  p_vendors      text[] DEFAULT NULL,
  p_divisions    text[] DEFAULT NULL,
  p_departments  text[] DEFAULT NULL,
  p_type_stores  text[] DEFAULT NULL,
  p_stores       text[] DEFAULT NULL
)
RETURNS TABLE (
  division text, department text, store_name text, type_store text, id_match text,
  sku text, barcode text, name_la text, vendor text, teadterm text,
  item_type text, buying text, rank_sale text, store_apply integer,
  stock_store numeric, stock_dc numeric, remark_stock text, remark_oos text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  SELECT division, department, store_name, type_store, id_match, sku, barcode, name_la,
         vendor, teadterm, item_type, buying, rank_sale, store_apply, stock_store, stock_dc,
         remark_stock, remark_oos
  FROM public.oos_detail_mv
  WHERE (p_spc          IS NULL OR cardinality(p_spc)=0          OR spc_name    = ANY(p_spc))
    AND (p_vendors      IS NULL OR cardinality(p_vendors)=0      OR vendor_code = ANY(p_vendors))
    AND (p_divisions    IS NULL OR cardinality(p_divisions)=0    OR division    = ANY(p_divisions))
    AND (p_departments  IS NULL OR cardinality(p_departments)=0  OR department  = ANY(p_departments))
    AND (p_type_stores  IS NULL OR cardinality(p_type_stores)=0  OR type_store  = ANY(p_type_stores))
    AND (p_stores       IS NULL OR cardinality(p_stores)=0       OR store_name  = ANY(p_stores));
$function$;

GRANT EXECUTE ON FUNCTION public._oos_detail(text[],text[],text[],text[],text[],text[]) TO anon, authenticated;

-- ---------- 4) meta + refresh + status ----------
CREATE TABLE IF NOT EXISTS public.oos_mv_meta (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refreshed_at timestamptz,
  row_count    integer
);
INSERT INTO public.oos_mv_meta (id, refreshed_at, row_count)
  VALUES (1, now(), (SELECT count(*) FROM public.oos_detail_mv))
  ON CONFLICT (id) DO UPDATE SET refreshed_at = now(), row_count = EXCLUDED.row_count;

ALTER TABLE public.oos_mv_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_oos_mv_meta" ON public.oos_mv_meta;
CREATE POLICY "read_oos_mv_meta" ON public.oos_mv_meta FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.refresh_oos_mv()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $function$
DECLARE v_cnt integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.oos_detail_mv;
  SELECT count(*) INTO v_cnt FROM public.oos_detail_mv;
  INSERT INTO public.oos_mv_meta (id, refreshed_at, row_count)
    VALUES (1, now(), v_cnt)
    ON CONFLICT (id) DO UPDATE SET refreshed_at = now(), row_count = v_cnt;
  RETURN jsonb_build_object('refreshed_at', now(), 'row_count', v_cnt);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_oos_mv() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_oos_mv() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_oos_mv_status()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('refreshed_at', refreshed_at, 'row_count', row_count)
  FROM public.oos_mv_meta WHERE id = 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_mv_status() TO anon, authenticated;
