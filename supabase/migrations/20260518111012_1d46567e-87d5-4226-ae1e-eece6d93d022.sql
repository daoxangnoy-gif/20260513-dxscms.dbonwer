CREATE OR REPLACE FUNCTION public.merge_minmax_doc(
  p_payload jsonb,
  p_doc_name text DEFAULT NULL::text,
  p_n_factor numeric DEFAULT NULL::numeric,
  p_user_id uuid DEFAULT NULL::uuid,
  p_create_if_missing boolean DEFAULT true,
  p_doc_id uuid DEFAULT NULL::uuid,
  p_force_new boolean DEFAULT false
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

  -- 1) ถ้าระบุ p_doc_id มา → ใช้ doc นั้นตรง ๆ
  IF p_doc_id IS NOT NULL THEN
    SELECT d.id, d.doc_name, d.data INTO v_doc_id, v_doc_name, v_existing
    FROM public.minmax_cal_documents d
    WHERE d.id = p_doc_id
    FOR UPDATE;
    IF v_doc_id IS NULL THEN
      RAISE EXCEPTION 'Doc id % not found', p_doc_id;
    END IF;
  -- 2) ถ้า force_new → สร้าง doc ใหม่เสมอ (ใช้กับ chunk แรกของ Save session)
  ELSIF p_force_new THEN
    v_doc_name := COALESCE(NULLIF(p_doc_name,''), to_char(now(),'YYYYMMDDHH24MISS') || '-minmaxcal');
    INSERT INTO public.minmax_cal_documents (doc_name, user_id, n_factor, item_count, data)
    VALUES (v_doc_name, p_user_id, COALESCE(p_n_factor, 3), v_in_count, p_payload)
    RETURNING minmax_cal_documents.id INTO v_doc_id;
    v_total := v_in_count;
    RETURN QUERY SELECT v_doc_id, v_doc_name, v_in_count, v_total;
    RETURN;
  ELSE
    -- 3) fallback: ใช้ doc ล่าสุด
    SELECT d.id, d.doc_name, d.data INTO v_doc_id, v_doc_name, v_existing
    FROM public.minmax_cal_documents d
    ORDER BY d.created_at DESC LIMIT 1 FOR UPDATE;

    IF v_doc_id IS NULL THEN
      IF NOT p_create_if_missing THEN
        RAISE EXCEPTION 'No active Min/Max document found';
      END IF;
      v_doc_name := COALESCE(NULLIF(p_doc_name,''), to_char(now(),'YYYYMMDDHH24MISS') || '-minmaxcal');
      INSERT INTO public.minmax_cal_documents (doc_name, user_id, n_factor, item_count, data)
      VALUES (v_doc_name, p_user_id, COALESCE(p_n_factor, 3), v_in_count, p_payload)
      RETURNING minmax_cal_documents.id INTO v_doc_id;
      v_total := v_in_count;
      RETURN QUERY SELECT v_doc_id, v_doc_name, v_in_count, v_total;
      RETURN;
    END IF;
  END IF;

  -- Merge by (sku_code||store_name): new overwrites existing
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

  UPDATE public.minmax_cal_documents AS d
  SET data=v_merged, item_count=v_total,
      n_factor=COALESCE(p_n_factor, d.n_factor),
      doc_name=COALESCE(NULLIF(p_doc_name,''), d.doc_name),
      updated_at=now()
  WHERE d.id = v_doc_id;

  SELECT d.doc_name INTO v_doc_name FROM public.minmax_cal_documents d WHERE d.id = v_doc_id;

  RETURN QUERY SELECT v_doc_id, v_doc_name, v_in_count, v_total;
END;
$function$;