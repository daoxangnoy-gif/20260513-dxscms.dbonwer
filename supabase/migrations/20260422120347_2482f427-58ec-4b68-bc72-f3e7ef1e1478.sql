-- Extend clear_range_store to support per-store clearing.
-- When p_stores is provided (non-empty), only delete rows for those store_names.
-- When p_skus is provided, restrict by SKU; both filters can combine.
CREATE OR REPLACE FUNCTION public.clear_range_store(
  p_skus text[] DEFAULT NULL,
  p_stores text[] DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c integer;
  has_skus boolean := (p_skus IS NOT NULL AND array_length(p_skus, 1) IS NOT NULL);
  has_stores boolean := (p_stores IS NOT NULL AND array_length(p_stores, 1) IS NOT NULL);
BEGIN
  IF NOT has_skus AND NOT has_stores THEN
    DELETE FROM public.range_store;
  ELSIF has_skus AND has_stores THEN
    DELETE FROM public.range_store
      WHERE sku_code = ANY(p_skus) AND store_name = ANY(p_stores);
  ELSIF has_skus THEN
    DELETE FROM public.range_store WHERE sku_code = ANY(p_skus);
  ELSE
    DELETE FROM public.range_store WHERE store_name = ANY(p_stores);
  END IF;
  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c;
END;
$function$;