-- get_oos_detail_page: ดึง detail แบบแบ่งหน้า (ordered + limit/offset)
--   ใช้โหลดชุดเต็มทีละ chunk → เลี่ยง payload ก้อนใหญ่ที่ทำให้ Cloudflare 520 + โชว์ความคืบหน้าได้
CREATE OR REPLACE FUNCTION public.get_oos_detail_page(
  p_spc          text[] DEFAULT NULL,
  p_vendors      text[] DEFAULT NULL,
  p_divisions    text[] DEFAULT NULL,
  p_departments  text[] DEFAULT NULL,
  p_type_stores  text[] DEFAULT NULL,
  p_stores       text[] DEFAULT NULL,
  p_limit        integer DEFAULT 50000,
  p_offset       integer DEFAULT 0
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
    LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0)
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_detail_page(text[],text[],text[],text[],text[],text[],integer,integer) TO anon, authenticated;
