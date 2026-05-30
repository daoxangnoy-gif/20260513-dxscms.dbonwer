
-- View by stores: load minmax rows filtered by store list (for "View" button)
CREATE OR REPLACE FUNCTION public.get_minmax_view_by_stores(p_stores text[] DEFAULT NULL)
RETURNS TABLE(
  sku_code text, product_name_la text, product_name_en text, main_barcode text,
  unit_of_measure text, store_name text, type_store text, unit_pick numeric,
  min_val numeric, max_val numeric, item_type text, buying_status text,
  division text, department text, sub_department text, class text,
  pack_qty numeric, box_qty numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout TO '120s' AS $$
  WITH dm AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, product_name_la, product_name_en, main_barcode, unit_of_measure,
      item_type, buying_status, division, department, sub_department, class, packing_size_qty
    FROM public.data_master
    WHERE sku_code IS NOT NULL
    ORDER BY sku_code, updated_at DESC NULLS LAST
  )
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
  LEFT JOIN dm d ON d.sku_code = m.item_id
  WHERE m.item_id IS NOT NULL AND m.store_name IS NOT NULL
    AND (p_stores IS NULL OR cardinality(p_stores) = 0 OR m.store_name = ANY(p_stores));
$$;

-- Report summary: per-store SKU count + sum of max_val (final qty)
CREATE OR REPLACE FUNCTION public.get_minmax_report_summary()
RETURNS TABLE(store_name text, type_store text, sku_count bigint, sum_min numeric, sum_max numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    store_name,
    COALESCE(MAX(type_store), '') AS type_store,
    COUNT(*)::bigint AS sku_count,
    COALESCE(SUM(min_val), 0) AS sum_min,
    COALESCE(SUM(max_val), 0) AS sum_max
  FROM public.minmax
  WHERE store_name IS NOT NULL
  GROUP BY store_name
  ORDER BY store_name;
$$;
