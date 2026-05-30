CREATE OR REPLACE FUNCTION public.merge_minmax_doc(
  p_payload jsonb,
  p_doc_name text DEFAULT NULL,
  p_n_factor numeric DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_create_if_missing boolean DEFAULT true
)
RETURNS TABLE(doc_id uuid, doc_name text, merged_count integer, total_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  v_doc_id uuid;
  v_doc_name text;
  v_existing jsonb;
  v_merged jsonb;
  v_in_count integer := 0;
  v_total integer := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' THEN
    RAISE EXCEPTION 'p_payload must be a jsonb array';
  END IF;

  v_in_count := jsonb_array_length(p_payload);

  -- Lock & fetch latest doc
  SELECT id, doc_name, data INTO v_doc_id, v_doc_name, v_existing
  FROM public.minmax_cal_documents
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_doc_id IS NULL THEN
    IF NOT p_create_if_missing THEN
      RAISE EXCEPTION 'No active Min/Max document found';
    END IF;
    v_doc_name := COALESCE(NULLIF(p_doc_name,''), to_char(now(),'YYYYMMDDHH24MISS') || '-minmaxcal');
    INSERT INTO public.minmax_cal_documents (doc_name, user_id, n_factor, item_count, data)
    VALUES (v_doc_name, p_user_id, COALESCE(p_n_factor, 3), v_in_count, p_payload)
    RETURNING id INTO v_doc_id;
    v_total := v_in_count;
  ELSE
    -- Merge by (sku_code||store_name): new rows overwrite existing
    WITH existing AS (
      SELECT (r->>'sku_code') AS sku, (r->>'store_name') AS store, r AS row
      FROM jsonb_array_elements(COALESCE(v_existing,'[]'::jsonb)) r
    ),
    incoming AS (
      SELECT (r->>'sku_code') AS sku, (r->>'store_name') AS store, r AS row
      FROM jsonb_array_elements(p_payload) r
    ),
    combined AS (
      SELECT row FROM incoming
      UNION ALL
      SELECT e.row FROM existing e
      WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.sku = e.sku AND i.store = e.store)
    )
    SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_merged FROM combined;

    v_total := jsonb_array_length(v_merged);

    UPDATE public.minmax_cal_documents
    SET data = v_merged,
        item_count = v_total,
        n_factor = COALESCE(p_n_factor, n_factor),
        doc_name = COALESCE(NULLIF(p_doc_name,''), doc_name),
        updated_at = now()
    WHERE id = v_doc_id
    RETURNING doc_name INTO v_doc_name;
  END IF;

  RETURN QUERY SELECT v_doc_id, v_doc_name, v_in_count, v_total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.merge_minmax_doc(jsonb, text, numeric, uuid, boolean) TO authenticated;