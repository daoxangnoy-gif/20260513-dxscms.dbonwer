CREATE OR REPLACE FUNCTION public.delete_minmax_by_stores(p_store_names text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_store_names IS NULL OR array_length(p_store_names, 1) IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.minmax WHERE store_name = ANY(p_store_names);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;