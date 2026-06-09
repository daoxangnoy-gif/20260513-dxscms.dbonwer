-- get_oos_trend: สรุป %OOS ของแต่ละ snapshot (week) แยกตาม type_store
--   ใช้ในหน้า Report OOS แท็บ Trend เพื่อเทียบแนวโน้มระหว่างสัปดาห์
--   นับระดับ store-sku (1 แถว = 1 sku ในสาขานั้น): n_range = ทั้งหมด, n_oos = Store OOS
CREATE OR REPLACE FUNCTION public.get_oos_trend()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  FROM (
    SELECT
      s.week_label,
      s.snapshot_date,
      COALESCE(r.type_store,'(ไม่ระบุ)')                                   AS type_store,
      COUNT(*)                                                             AS n_range,
      COUNT(*) FILTER (WHERE r.remark_oos = 'Store OOS')                   AS n_oos
    FROM public.oos_snapshots s
    JOIN public.oos_snapshot_rows r ON r.snapshot_id = s.id
    GROUP BY s.week_label, s.snapshot_date, COALESCE(r.type_store,'(ไม่ระบุ)')
    ORDER BY s.snapshot_date, type_store
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_oos_trend() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_oos_trend() TO authenticated;
