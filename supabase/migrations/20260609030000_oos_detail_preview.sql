-- get_oos_detail_preview: ดึงตัวอย่างแถวแรกๆ แบบเร็ว (ไม่ ORDER BY → Postgres หยุดได้เร็วหลังครบ limit)
--   ใช้โชว์หน้าแรกทันทีตอนกด Get ระหว่างรอโหลดชุดเต็ม
CREATE OR REPLACE FUNCTION public.get_oos_detail_preview(
  p_spc          text[] DEFAULT NULL,
  p_vendors      text[] DEFAULT NULL,
  p_divisions    text[] DEFAULT NULL,
  p_departments  text[] DEFAULT NULL,
  p_type_stores  text[] DEFAULT NULL,
  p_stores       text[] DEFAULT NULL,
  p_limit        integer DEFAULT 100
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
    LIMIT GREATEST(p_limit, 1)
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.get_oos_detail_preview(text[],text[],text[],text[],text[],text[],integer) TO anon, authenticated;
