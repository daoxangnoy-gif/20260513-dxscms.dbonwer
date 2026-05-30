
CREATE OR REPLACE FUNCTION public.get_minmax_report_grouped(
  p_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL
)
RETURNS TABLE(
  division text,
  department text,
  store_name text,
  type_store text,
  sku_count bigint,
  sum_min numeric,
  sum_max numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout TO '120s'
AS $$
  WITH dm AS (
    SELECT DISTINCT ON (sku_code)
      sku_code,
      COALESCE(division,'') AS division,
      COALESCE(department,'') AS department,
      COALESCE(sub_department,'') AS sub_department,
      COALESCE(class,'') AS class,
      COALESCE(item_type,'') AS item_type,
      COALESCE(buying_status,'') AS buying_status
    FROM public.data_master
    WHERE sku_code IS NOT NULL
    ORDER BY sku_code, updated_at DESC NULLS LAST
  ),
  joined AS (
    SELECT
      COALESCE(d.division,'') AS division,
      COALESCE(d.department,'') AS department,
      m.store_name,
      COALESCE(m.type_store,'') AS type_store,
      m.min_val, m.max_val,
      d.item_type, d.buying_status, d.sub_department, d.class
    FROM public.minmax m
    LEFT JOIN dm d ON d.sku_code = m.item_id
    WHERE m.item_id IS NOT NULL AND m.store_name IS NOT NULL
  )
  SELECT
    division, department, store_name,
    COALESCE(MAX(type_store),'') AS type_store,
    COUNT(*)::bigint AS sku_count,
    COALESCE(SUM(min_val),0) AS sum_min,
    COALESCE(SUM(max_val),0) AS sum_max
  FROM joined
  WHERE (p_stores IS NULL OR cardinality(p_stores)=0 OR store_name = ANY(p_stores))
    AND (p_type_stores IS NULL OR cardinality(p_type_stores)=0 OR type_store = ANY(p_type_stores))
    AND (p_item_types IS NULL OR cardinality(p_item_types)=0 OR item_type = ANY(p_item_types))
    AND (p_buying_statuses IS NULL OR cardinality(p_buying_statuses)=0 OR buying_status = ANY(p_buying_statuses))
    AND (p_divisions IS NULL OR cardinality(p_divisions)=0 OR division = ANY(p_divisions))
    AND (p_departments IS NULL OR cardinality(p_departments)=0 OR department = ANY(p_departments))
    AND (p_sub_departments IS NULL OR cardinality(p_sub_departments)=0 OR sub_department = ANY(p_sub_departments))
    AND (p_classes IS NULL OR cardinality(p_classes)=0 OR class = ANY(p_classes))
  GROUP BY division, department, store_name
  ORDER BY division, department, store_name;
$$;

-- Update get_minmax_view_by_stores to support all filters (for export with filter)
CREATE OR REPLACE FUNCTION public.get_minmax_view_by_stores(
  p_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL
)
RETURNS TABLE(
  sku_code text, product_name_la text, product_name_en text, main_barcode text,
  unit_of_measure text, store_name text, type_store text, unit_pick numeric,
  min_val numeric, max_val numeric, item_type text, buying_status text,
  division text, department text, sub_department text, class text,
  pack_qty numeric, box_qty numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout TO '180s' AS $$
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
    AND (p_stores IS NULL OR cardinality(p_stores)=0 OR m.store_name = ANY(p_stores))
    AND (p_type_stores IS NULL OR cardinality(p_type_stores)=0 OR COALESCE(m.type_store,'') = ANY(p_type_stores))
    AND (p_item_types IS NULL OR cardinality(p_item_types)=0 OR COALESCE(d.item_type,'') = ANY(p_item_types))
    AND (p_buying_statuses IS NULL OR cardinality(p_buying_statuses)=0 OR COALESCE(d.buying_status,'') = ANY(p_buying_statuses))
    AND (p_divisions IS NULL OR cardinality(p_divisions)=0 OR COALESCE(d.division,'') = ANY(p_divisions))
    AND (p_departments IS NULL OR cardinality(p_departments)=0 OR COALESCE(d.department,'') = ANY(p_departments))
    AND (p_sub_departments IS NULL OR cardinality(p_sub_departments)=0 OR COALESCE(d.sub_department,'') = ANY(p_sub_departments))
    AND (p_classes IS NULL OR cardinality(p_classes)=0 OR COALESCE(d.class,'') = ANY(p_classes));
$$;
