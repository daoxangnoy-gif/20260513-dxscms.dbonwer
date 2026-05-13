
CREATE OR REPLACE FUNCTION public.get_latest_minmax_for_skus(p_skus text[])
RETURNS TABLE(sku_code text, store_name text, type_store text, min_val numeric, max_val numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  WITH latest AS (
    SELECT id FROM public.minmax_cal_documents
    ORDER BY created_at DESC LIMIT 1
  )
  SELECT
    (r->>'sku_code')::text,
    (r->>'store_name')::text,
    COALESCE(r->>'type_store','')::text,
    NULLIF(r->>'min_final','')::numeric,
    NULLIF(r->>'max_final','')::numeric
  FROM public.minmax_cal_documents d,
       LATERAL jsonb_array_elements(d.data) r
  WHERE d.id IN (SELECT id FROM latest)
    AND (r->>'sku_code') = ANY(p_skus);
$function$;
