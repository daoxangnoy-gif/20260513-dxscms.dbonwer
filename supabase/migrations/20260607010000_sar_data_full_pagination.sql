-- get_sar_data_full — เพิ่ม pagination (p_limit / p_offset) คืน { total, rows }
-- กัน payload ใหญ่ตอนเลือก Type Store / หลาย docs (SAR + OFS)
-- frontend จะยิงขนานทีละ batch (รู้ total จากหน้าแรก)

-- ต้อง DROP ก่อน เพราะเพิ่ม argument = function signature ใหม่ (กัน overload ซ้อน)
DROP FUNCTION IF EXISTS public.get_sar_data_full(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[]);

CREATE OR REPLACE FUNCTION public.get_sar_data_full(
  p_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_skus text[] DEFAULT NULL,
  p_barcodes text[] DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
  WITH dm AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, product_name_la, product_name_en, main_barcode, unit_of_measure,
      item_type, buying_status, division, department, sub_department, class
    FROM public.data_master
    WHERE sku_code IS NOT NULL
    ORDER BY sku_code, updated_at DESC NULLS LAST
  ),
  price AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, standard_price, list_price, jmart_price
    FROM public.data_master
    WHERE sku_code IS NOT NULL AND packing_size_qty = 1
    ORDER BY sku_code, updated_at DESC NULLS LAST
  ),
  rk AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM public.rank_sales
    WHERE item_id IS NOT NULL
    ORDER BY item_id, updated_at DESC NULLS LAST
  ),
  rsv_per_store AS (
    SELECT rsv.sku_code, (kv.key)::text AS store_name,
           rsv.pack_qty, rsv.box_qty
    FROM public.range_store_view rsv
    CROSS JOIN LATERAL jsonb_each(COALESCE(rsv.range_data, '{}'::jsonb)) kv
    WHERE COALESCE(kv.value->>'apply_yn','N') = 'Y'
  ),
  sales_agg AS (
    SELECT sw.id18 AS sku_code, sw.store_name, COALESCE(SUM(sw.avg_day),0) AS avg_sale
    FROM public.sales_by_week sw
    WHERE sw.id18 IS NOT NULL AND sw.store_name IS NOT NULL
    GROUP BY sw.id18, sw.store_name
  ),
  base AS (
    SELECT
      m.item_id AS sku_code,
      d.product_name_la, d.product_name_en, d.main_barcode, d.unit_of_measure,
      m.store_name,
      COALESCE(m.type_store,'') AS type_store,
      NULLIF(m.unit_pick,'')::numeric AS unit_pick,
      m.min_val, m.max_val,
      COALESCE(d.item_type,'') AS item_type,
      COALESCE(d.buying_status,'') AS buying_status,
      COALESCE(d.division,'') AS division,
      COALESCE(d.department,'') AS department,
      COALESCE(d.sub_department,'') AS sub_department,
      COALESCE(d.class,'') AS class,
      ry.pack_qty, ry.box_qty,
      p.standard_price, p.list_price, p.jmart_price,
      COALESCE(rk.final_rank,'D') AS rank_sale,
      COALESCE(sa.avg_sale, 0) AS avg_sale
    FROM public.minmax m
    LEFT JOIN dm d ON d.sku_code = m.item_id
    LEFT JOIN price p ON p.sku_code = m.item_id
    LEFT JOIN rk ON rk.item_id = m.item_id
    LEFT JOIN rsv_per_store ry ON ry.sku_code = m.item_id AND ry.store_name = m.store_name
    LEFT JOIN sales_agg sa ON sa.sku_code = m.item_id AND sa.store_name = m.store_name
    WHERE (p_stores          IS NULL OR cardinality(p_stores)=0          OR m.store_name = ANY(p_stores))
      AND (p_type_stores     IS NULL OR cardinality(p_type_stores)=0     OR m.type_store = ANY(p_type_stores))
      AND (p_item_types      IS NULL OR cardinality(p_item_types)=0      OR COALESCE(d.item_type,'') = ANY(p_item_types))
      AND (p_buying_statuses  IS NULL OR cardinality(p_buying_statuses)=0  OR COALESCE(d.buying_status,'') = ANY(p_buying_statuses))
      AND (p_divisions       IS NULL OR cardinality(p_divisions)=0       OR COALESCE(d.division,'') = ANY(p_divisions))
      AND (p_departments     IS NULL OR cardinality(p_departments)=0     OR COALESCE(d.department,'') = ANY(p_departments))
      AND (p_sub_departments  IS NULL OR cardinality(p_sub_departments)=0  OR COALESCE(d.sub_department,'') = ANY(p_sub_departments))
      AND (p_classes         IS NULL OR cardinality(p_classes)=0         OR COALESCE(d.class,'') = ANY(p_classes))
      AND (p_skus            IS NULL OR cardinality(p_skus)=0            OR m.item_id = ANY(p_skus))
      AND (p_barcodes        IS NULL OR cardinality(p_barcodes)=0        OR d.main_barcode = ANY(p_barcodes))
  ),
  sliced AS (
    SELECT b.*, count(*) OVER() AS _total
    FROM base b
    ORDER BY b.sku_code, b.store_name
    LIMIT p_limit OFFSET COALESCE(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT MAX(_total) FROM sliced), 0),
    'rows',  COALESCE((SELECT jsonb_agg(to_jsonb(s) - '_total') FROM sliced s), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_sar_data_full(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],integer,integer) TO anon, authenticated;
