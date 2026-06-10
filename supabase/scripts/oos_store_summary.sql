-- ============================================================
-- get_oos_store_summary: สรุป OOS ราย store ของหลาย week พร้อมกัน (สำหรับ Report เทียบ week)
--   อ่านจาก oos_snapshot_rows (index ที่ snapshot_id → เร็ว) ไม่ต้องโหลดมา client
--   stores = ราย store (นับตรง) · totals = ราย type_store (distinct SKU แบบ B: OOS=ขาดทุกสาขา)
-- วิธีรัน: Supabase SQL Editor → วาง → Run
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oos_store_summary(p_weeks text[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT s.week_label, s.snapshot_date, r.type_store, r.store_name, r.sku, r.remark_oos
    FROM public.oos_snapshots s
    JOIN public.oos_snapshot_rows r ON r.snapshot_id = s.id
    WHERE s.week_label = ANY(p_weeks)
  ),
  stores AS (
    SELECT week_label, snapshot_date, type_store, store_name,
      COUNT(*) FILTER (WHERE remark_oos = 'StockHaveStock') AS have,
      COUNT(*) FILTER (WHERE remark_oos = 'Store OOS')      AS oos,
      COUNT(*)                                              AS range_cnt
    FROM base GROUP BY week_label, snapshot_date, type_store, store_name
  ),
  sku_lvl AS (
    SELECT week_label, type_store, sku,
      bool_or(remark_oos = 'StockHaveStock') AS any_have
    FROM base GROUP BY week_label, type_store, sku
  ),
  totals AS (
    SELECT week_label, type_store,
      COUNT(*) FILTER (WHERE any_have)     AS have,
      COUNT(*) FILTER (WHERE NOT any_have) AS oos,
      COUNT(*)                             AS range_cnt
    FROM sku_lvl GROUP BY week_label, type_store
  )
  SELECT jsonb_build_object(
    'stores', (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
               FROM (SELECT * FROM stores ORDER BY type_store, store_name) t),
    'totals', (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
               FROM (SELECT * FROM totals ORDER BY type_store) t)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_store_summary(text[]) TO anon, authenticated;
