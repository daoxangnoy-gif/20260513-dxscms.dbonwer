
-- 0) Dedupe minmax — keep latest by updated_at, then created_at, then ctid
DELETE FROM public.minmax a
USING public.minmax b
WHERE a.item_id = b.item_id
  AND a.store_name = b.store_name
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.created_at < b.created_at)
    OR (a.updated_at = b.updated_at AND a.created_at = b.created_at AND a.ctid < b.ctid)
  );

-- 1) Unique index for UPSERT
CREATE UNIQUE INDEX IF NOT EXISTS minmax_item_store_uidx ON public.minmax(item_id, store_name);
CREATE INDEX IF NOT EXISTS minmax_store_idx ON public.minmax(store_name);

-- 2) Bulk UPSERT RPC
CREATE OR REPLACE FUNCTION public.upsert_minmax_view(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;

  WITH src AS (
    SELECT
      NULLIF(r->>'sku_code','')      AS item_id,
      NULLIF(r->>'store_name','')    AS store_name,
      NULLIF(r->>'type_store','')    AS type_store,
      NULLIF(r->>'unit_pick','')     AS unit_pick,
      NULLIF(r->>'min_final','')::numeric AS min_val,
      NULLIF(r->>'max_final','')::numeric AS max_val
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO public.minmax (item_id, store_name, type_store, unit_pick, min_val, max_val, created_at, updated_at)
  SELECT item_id, store_name, type_store, unit_pick, min_val, max_val, now(), now()
  FROM src
  WHERE item_id IS NOT NULL AND store_name IS NOT NULL
  ON CONFLICT (item_id, store_name) DO UPDATE
  SET type_store = COALESCE(EXCLUDED.type_store, public.minmax.type_store),
      unit_pick  = COALESCE(EXCLUDED.unit_pick,  public.minmax.unit_pick),
      min_val    = EXCLUDED.min_val,
      max_val    = EXCLUDED.max_val,
      updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 3) SRR consumers: read from minmax table
CREATE OR REPLACE FUNCTION public.get_latest_minmax_flat()
RETURNS TABLE(sku_code text, store_name text, type_store text, min_val numeric, max_val numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s'
AS $$
  SELECT m.item_id AS sku_code, m.store_name, COALESCE(m.type_store,'') AS type_store, m.min_val, m.max_val
  FROM public.minmax m
  WHERE m.item_id IS NOT NULL AND m.store_name IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_minmax_for_skus(p_skus text[])
RETURNS TABLE(sku_code text, store_name text, type_store text, min_val numeric, max_val numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s'
AS $$
  SELECT m.item_id AS sku_code, m.store_name, COALESCE(m.type_store,'') AS type_store, m.min_val, m.max_val
  FROM public.minmax m
  WHERE m.item_id = ANY(p_skus);
$$;

-- 4) View-for-calc RPC (joined with data_master)
CREATE OR REPLACE FUNCTION public.get_minmax_view_for_calc()
RETURNS TABLE(
  sku_code text, product_name_la text, product_name_en text, main_barcode text, unit_of_measure text,
  store_name text, type_store text, unit_pick numeric, min_val numeric, max_val numeric,
  item_type text, buying_status text, division text, department text, sub_department text, class text,
  pack_qty numeric, box_qty numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '120s'
AS $$
  SELECT
    m.item_id AS sku_code,
    d.product_name_la, d.product_name_en, d.main_barcode, d.unit_of_measure,
    m.store_name, COALESCE(m.type_store,'') AS type_store,
    NULLIF(m.unit_pick,'')::numeric AS unit_pick,
    m.min_val, m.max_val,
    COALESCE(d.item_type,'') AS item_type, COALESCE(d.buying_status,'') AS buying_status,
    COALESCE(d.division,'') AS division, COALESCE(d.department,'') AS department,
    COALESCE(d.sub_department,'') AS sub_department, COALESCE(d.class,'') AS class,
    d.packing_size_qty AS pack_qty, NULL::numeric AS box_qty
  FROM public.minmax m
  LEFT JOIN public.data_master d ON d.sku_code = m.item_id
  WHERE m.item_id IS NOT NULL AND m.store_name IS NOT NULL;
$$;
