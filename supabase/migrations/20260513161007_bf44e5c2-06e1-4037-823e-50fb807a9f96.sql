
-- Range Store: Physical Table View (pre-joined, server-side filter)
-- Replaces runtime joins for Tab Data fast read

CREATE TABLE IF NOT EXISTS public.range_store_view (
  sku_code text PRIMARY KEY,
  main_barcode text,
  product_name_la text,
  product_name_en text,
  unit_of_measure text,
  packing_size_qty numeric,
  standard_price numeric,
  list_price numeric,
  item_status text,
  item_type text,
  buying_status text,
  division_group text,
  division text,
  department text,
  sub_department text,
  class text,
  gm_buyer_code text,
  buyer_code text,
  product_owner text,
  product_bu text,
  barcode_pack text,
  pack_qty numeric,
  barcode_box text,
  box_qty numeric,
  rank_sale text,
  avg_jmart numeric,
  avg_kokkok numeric,
  avg_kokkok_fc numeric,
  avg_udee numeric,
  avg_per_store jsonb DEFAULT '{}'::jsonb,
  range_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsv_department ON public.range_store_view(department);
CREATE INDEX IF NOT EXISTS idx_rsv_division ON public.range_store_view(division);
CREATE INDEX IF NOT EXISTS idx_rsv_division_group ON public.range_store_view(division_group);
CREATE INDEX IF NOT EXISTS idx_rsv_item_type ON public.range_store_view(item_type);
CREATE INDEX IF NOT EXISTS idx_rsv_buying_status ON public.range_store_view(buying_status);
CREATE INDEX IF NOT EXISTS idx_rsv_buyer ON public.range_store_view(buyer_code);

ALTER TABLE public.range_store_view ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_rsv ON public.range_store_view;
CREATE POLICY auth_read_rsv ON public.range_store_view FOR SELECT TO authenticated USING (true);

-- Full sync (rebuild the whole view from sources)
CREATE OR REPLACE FUNCTION public.sync_range_store_view()
RETURNS TABLE(rows_synced integer, ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  c integer;
BEGIN
  TRUNCATE public.range_store_view;
  INSERT INTO public.range_store_view (
    sku_code, main_barcode, product_name_la, product_name_en, unit_of_measure,
    packing_size_qty, standard_price, list_price, item_status, item_type, buying_status,
    division_group, division, department, sub_department, class,
    gm_buyer_code, buyer_code, product_owner, product_bu,
    barcode_pack, pack_qty, barcode_box, box_qty,
    rank_sale, avg_jmart, avg_kokkok, avg_kokkok_fc, avg_udee,
    avg_per_store, range_data, synced_at
  )
  SELECT
    d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
    d.packing_size_qty, d.standard_price, d.list_price, d.item_status, d.item_type, d.buying_status,
    d.division_group, d.division, d.department, d.sub_department, d.class,
    d.gm_buyer_code, d.buyer_code, d.product_owner, d.product_bu,
    d.barcode_pack, d.pack_qty, d.barcode_box, d.box_qty,
    d.rank_sale, d.avg_jmart, d.avg_kokkok, d.avg_kokkok_fc, d.avg_udee,
    d.avg_per_store, d.range_data, now()
  FROM public.get_range_store_data() d;

  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN QUERY SELECT c, EXTRACT(MILLISECONDS FROM clock_timestamp() - t0)::int;
END;
$$;

-- Sync only specific SKUs (for incremental update after import)
CREATE OR REPLACE FUNCTION public.sync_range_store_view_skus(p_skus text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  c integer := 0;
BEGIN
  IF p_skus IS NULL OR array_length(p_skus, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.range_store_view WHERE sku_code = ANY(p_skus);

  INSERT INTO public.range_store_view (
    sku_code, main_barcode, product_name_la, product_name_en, unit_of_measure,
    packing_size_qty, standard_price, list_price, item_status, item_type, buying_status,
    division_group, division, department, sub_department, class,
    gm_buyer_code, buyer_code, product_owner, product_bu,
    barcode_pack, pack_qty, barcode_box, box_qty,
    rank_sale, avg_jmart, avg_kokkok, avg_kokkok_fc, avg_udee,
    avg_per_store, range_data, synced_at
  )
  SELECT
    d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
    d.packing_size_qty, d.standard_price, d.list_price, d.item_status, d.item_type, d.buying_status,
    d.division_group, d.division, d.department, d.sub_department, d.class,
    d.gm_buyer_code, d.buyer_code, d.product_owner, d.product_bu,
    d.barcode_pack, d.pack_qty, d.barcode_box, d.box_qty,
    d.rank_sale, d.avg_jmart, d.avg_kokkok, d.avg_kokkok_fc, d.avg_udee,
    d.avg_per_store, d.range_data, now()
  FROM public.get_range_store_data() d
  WHERE d.sku_code = ANY(p_skus);

  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c;
END;
$$;

-- Filtered read: server-side row + per-store column filter
CREATE OR REPLACE FUNCTION public.read_range_store_view(
  p_departments text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_buyers text[] DEFAULT NULL,
  p_skus text[] DEFAULT NULL,
  p_avg_stores text[] DEFAULT NULL,
  p_range_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS SETOF public.range_store_view
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_avg_stores text[] := p_avg_stores;
  v_range_stores text[] := p_range_stores;
BEGIN
  -- type_store expands into store list (overridden by explicit avg/range stores)
  IF p_type_stores IS NOT NULL AND array_length(p_type_stores, 1) > 0 THEN
    IF v_avg_stores IS NULL OR array_length(v_avg_stores,1) IS NULL THEN
      SELECT ARRAY_AGG(DISTINCT store_name) INTO v_avg_stores
      FROM public.store_type WHERE type_store = ANY(p_type_stores) AND store_name IS NOT NULL;
    END IF;
    IF v_range_stores IS NULL OR array_length(v_range_stores,1) IS NULL THEN
      v_range_stores := v_avg_stores;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    rsv.sku_code, rsv.main_barcode, rsv.product_name_la, rsv.product_name_en, rsv.unit_of_measure,
    rsv.packing_size_qty, rsv.standard_price, rsv.list_price, rsv.item_status, rsv.item_type, rsv.buying_status,
    rsv.division_group, rsv.division, rsv.department, rsv.sub_department, rsv.class,
    rsv.gm_buyer_code, rsv.buyer_code, rsv.product_owner, rsv.product_bu,
    rsv.barcode_pack, rsv.pack_qty, rsv.barcode_box, rsv.box_qty,
    rsv.rank_sale, rsv.avg_jmart, rsv.avg_kokkok, rsv.avg_kokkok_fc, rsv.avg_udee,
    CASE
      WHEN v_avg_stores IS NULL THEN rsv.avg_per_store
      ELSE COALESCE(
        (SELECT jsonb_object_agg(je.key, je.value) FROM jsonb_each(rsv.avg_per_store) je WHERE je.key = ANY(v_avg_stores)),
        '{}'::jsonb)
    END AS avg_per_store,
    CASE
      WHEN v_range_stores IS NULL THEN rsv.range_data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(je.key, je.value) FROM jsonb_each(rsv.range_data) je WHERE je.key = ANY(v_range_stores)),
        '{}'::jsonb)
    END AS range_data,
    rsv.synced_at
  FROM public.range_store_view rsv
  WHERE (p_departments IS NULL OR rsv.department = ANY(p_departments))
    AND (p_divisions IS NULL OR rsv.division = ANY(p_divisions))
    AND (p_division_groups IS NULL OR rsv.division_group = ANY(p_division_groups))
    AND (p_sub_departments IS NULL OR rsv.sub_department = ANY(p_sub_departments))
    AND (p_classes IS NULL OR rsv.class = ANY(p_classes))
    AND (p_item_types IS NULL OR rsv.item_type = ANY(p_item_types))
    AND (p_buying_statuses IS NULL OR rsv.buying_status = ANY(p_buying_statuses))
    AND (p_buyers IS NULL OR rsv.buyer_code = ANY(p_buyers))
    AND (p_skus IS NULL OR rsv.sku_code = ANY(p_skus))
  ORDER BY rsv.sku_code
  LIMIT COALESCE(p_limit, 1000000);
END;
$$;

-- View metadata helper
CREATE OR REPLACE FUNCTION public.range_store_view_info()
RETURNS TABLE(row_count bigint, last_sync timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::bigint, MAX(synced_at) FROM public.range_store_view;
$$;
