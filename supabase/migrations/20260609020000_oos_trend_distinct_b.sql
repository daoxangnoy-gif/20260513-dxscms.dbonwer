-- get_oos_trend (นิยาม B): %OOS แบบ distinct SKU ที่ขาดสต็อก "ทุกสาขา"
--   ต่อ (week x type_store) + แถวรวมทั้งหมดต่อ week (type_store = '∑ ALL')
--   n_range = จำนวน distinct SKU, n_oos = distinct SKU ที่ remark_oos='Store OOS' ทุกสาขา
CREATE OR REPLACE FUNCTION public.get_oos_trend()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  WITH sku_type AS (
    -- ราย SKU ต่อ (week, type_store): ขาดทุกสาขาในกลุ่มนั้นไหม
    SELECT s.week_label, s.snapshot_date, r.type_store, r.sku,
           bool_and(r.remark_oos = 'Store OOS') AS all_oos
    FROM public.oos_snapshots s
    JOIN public.oos_snapshot_rows r ON r.snapshot_id = s.id
    GROUP BY s.week_label, s.snapshot_date, r.type_store, r.sku
  ),
  per_type AS (
    SELECT week_label, snapshot_date, type_store,
           COUNT(*) AS n_range,
           COUNT(*) FILTER (WHERE all_oos) AS n_oos
    FROM sku_type
    GROUP BY week_label, snapshot_date, type_store
  ),
  sku_all AS (
    -- ราย SKU ต่อ week (ข้ามทุก type_store): ขาดทุกสาขาทั้งหมดไหม
    SELECT s.week_label, s.snapshot_date, r.sku,
           bool_and(r.remark_oos = 'Store OOS') AS all_oos
    FROM public.oos_snapshots s
    JOIN public.oos_snapshot_rows r ON r.snapshot_id = s.id
    GROUP BY s.week_label, s.snapshot_date, r.sku
  ),
  grand AS (
    SELECT week_label, snapshot_date, '∑ ALL'::text AS type_store,
           COUNT(*) AS n_range,
           COUNT(*) FILTER (WHERE all_oos) AS n_oos
    FROM sku_all
    GROUP BY week_label, snapshot_date
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  FROM (
    SELECT * FROM per_type
    UNION ALL
    SELECT * FROM grand
    ORDER BY snapshot_date, type_store
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_oos_trend() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_oos_trend() TO authenticated;
