CREATE OR REPLACE FUNCTION public.read_range_store_view(
  p_departments text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_buyers text[] DEFAULT NULL,
  p_owners text[] DEFAULT NULL,
  p_skus text[] DEFAULT NULL,
  p_avg_stores text[] DEFAULT NULL,
  p_range_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS SETOF range_store_view
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '120s'
AS $$
DECLARE
  v_avg_stores text[] := p_avg_stores;
  v_range_stores text[] := p_range_stores;
BEGIN
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
    AND (p_owners IS NULL OR rsv.product_owner = ANY(p_owners))
    AND (p_skus IS NULL OR rsv.sku_code = ANY(p_skus))
  ORDER BY rsv.sku_code
  LIMIT COALESCE(p_limit, 1000000);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_range_store_filter_lists()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '60s'
AS $$
  SELECT jsonb_build_object(
    'division_groups', COALESCE((SELECT jsonb_agg(DISTINCT division_group ORDER BY division_group) FROM range_store_view WHERE division_group IS NOT NULL AND division_group <> ''), '[]'::jsonb),
    'divisions',       COALESCE((SELECT jsonb_agg(DISTINCT division       ORDER BY division)       FROM range_store_view WHERE division IS NOT NULL AND division <> ''), '[]'::jsonb),
    'departments',     COALESCE((SELECT jsonb_agg(DISTINCT department     ORDER BY department)     FROM range_store_view WHERE department IS NOT NULL AND department <> ''), '[]'::jsonb),
    'sub_departments', COALESCE((SELECT jsonb_agg(DISTINCT sub_department ORDER BY sub_department) FROM range_store_view WHERE sub_department IS NOT NULL AND sub_department <> ''), '[]'::jsonb),
    'classes',         COALESCE((SELECT jsonb_agg(DISTINCT class          ORDER BY class)          FROM range_store_view WHERE class IS NOT NULL AND class <> ''), '[]'::jsonb),
    'item_types',      COALESCE((SELECT jsonb_agg(DISTINCT item_type      ORDER BY item_type)      FROM range_store_view WHERE item_type IS NOT NULL AND item_type <> ''), '[]'::jsonb),
    'buying_statuses', COALESCE((SELECT jsonb_agg(DISTINCT buying_status  ORDER BY buying_status)  FROM range_store_view WHERE buying_status IS NOT NULL AND buying_status <> ''), '[]'::jsonb),
    'owners',          COALESCE((SELECT jsonb_agg(DISTINCT product_owner  ORDER BY product_owner)  FROM range_store_view WHERE product_owner IS NOT NULL AND product_owner <> ''), '[]'::jsonb)
  );
$$;