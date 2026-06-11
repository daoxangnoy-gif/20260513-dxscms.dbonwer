-- ============================================================
-- get_oos_store_summary: สรุป OOS ราย store หลาย week (สำหรับ Report เทียบ week)
--   stores/totals     = OOS ปกติ (Have/OOS/Range)
--   dc_stores/dc_totals = DC Coverage (ในสินค้า Store OOS: DC มีของเติมได้ไหม)
--   อ่านจาก oos_snapshot_rows (index snapshot_id → เร็ว)
-- วิธีรัน: Supabase SQL Editor → วาง → Run  (CREATE OR REPLACE — รันทับได้เลย)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oos_store_summary(p_weeks text[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT s.week_label, s.snapshot_date, r.type_store, r.store_name, r.sku, r.remark_oos, r.remark_stock
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
  ),
  -- DC Coverage: เฉพาะสินค้า Store OOS → DC มีของ (เติมได้) / ไม่มี (ต้องสั่งซื้อ)
  dc_stores AS (
    SELECT week_label, type_store, store_name,
      COUNT(*) FILTER (WHERE remark_oos='Store OOS' AND remark_stock='DC Have stock') AS dc_have,
      COUNT(*) FILTER (WHERE remark_oos='Store OOS' AND remark_stock='DC No Stock')   AS dc_no,
      COUNT(*) FILTER (WHERE remark_oos='Store OOS')                                  AS total_oos
    FROM base GROUP BY week_label, type_store, store_name
  ),
  sku_oos AS (
    -- all_oos = ขาดทุกสาขา (นิยาม B ตรงกับ Total ตารางบน) · remark_stock ต่อ sku เหมือนกันทุกสาขา (DC เดียว)
    SELECT week_label, type_store, sku,
      bool_and(remark_oos='Store OOS')       AS all_oos,
      bool_or(remark_stock='DC Have stock')  AS dc_have
    FROM base GROUP BY week_label, type_store, sku
  ),
  dc_totals AS (
    SELECT week_label, type_store,
      COUNT(*) FILTER (WHERE all_oos AND dc_have)     AS dc_have,
      COUNT(*) FILTER (WHERE all_oos AND NOT dc_have) AS dc_no,
      COUNT(*) FILTER (WHERE all_oos)                 AS total_oos
    FROM sku_oos GROUP BY week_label, type_store
  )
  SELECT jsonb_build_object(
    'stores',    (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb),'[]'::jsonb) FROM (SELECT * FROM stores ORDER BY type_store, store_name) t),
    'totals',    (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb),'[]'::jsonb) FROM (SELECT * FROM totals ORDER BY type_store) t),
    'dc_stores', (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb),'[]'::jsonb) FROM (SELECT * FROM dc_stores ORDER BY type_store, store_name) t),
    'dc_totals', (SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb),'[]'::jsonb) FROM (SELECT * FROM dc_totals ORDER BY type_store) t)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_store_summary(text[]) TO anon, authenticated;
