-- ============ SNAPSHOTS TABLE ============
CREATE TABLE IF NOT EXISTS public.range_store_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  store_list TEXT[] NOT NULL DEFAULT '{}',
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.range_store_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_range_snapshots ON public.range_store_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_range_snapshots ON public.range_store_snapshots
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY auth_update_range_snapshots ON public.range_store_snapshots
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));
CREATE POLICY auth_delete_range_snapshots ON public.range_store_snapshots
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE TRIGGER range_snapshots_updated_at
  BEFORE UPDATE ON public.range_store_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ PHASE 1: MASTER (fastest, used to render rows) ============
CREATE OR REPLACE FUNCTION public.get_range_store_master()
RETURNS TABLE(
  sku_code text, main_barcode text, product_name_la text, product_name_en text,
  division_group text, division text, department text, sub_department text, class text,
  gm_buyer_code text, buyer_code text, product_owner text, product_bu text
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $$
  SELECT DISTINCT ON (dm.sku_code)
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class,
    dm.gm_buyer_code, dm.buyer_code, dm.product_owner, dm.product_bu
  FROM data_master dm
  WHERE dm.stock_unit_flag = 'Y' AND dm.sku_code IS NOT NULL
  ORDER BY dm.sku_code, dm.created_at DESC;
$$;

-- ============ PHASE 2: PACK / BOX ============
CREATE OR REPLACE FUNCTION public.get_range_store_packbox()
RETURNS TABLE(
  sku_code text, barcode_pack text, pack_qty numeric,
  barcode_box text, box_qty numeric, unit_of_measure text, packing_size_qty numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $$
  WITH pack_min AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, main_barcode AS barcode_pack, packing_size_qty AS pack_qty
    FROM data_master WHERE unit_of_measure = 'Pack' AND sku_code IS NOT NULL
    ORDER BY sku_code, packing_size_qty NULLS LAST
  ),
  box_min AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, main_barcode AS barcode_box, packing_size_qty AS box_qty
    FROM data_master WHERE unit_of_measure = 'Box' AND sku_code IS NOT NULL
    ORDER BY sku_code, packing_size_qty NULLS LAST
  ),
  master AS (
    SELECT DISTINCT ON (sku_code) sku_code, unit_of_measure, packing_size_qty
    FROM data_master WHERE stock_unit_flag = 'Y' AND sku_code IS NOT NULL
    ORDER BY sku_code, created_at DESC
  )
  SELECT m.sku_code, p.barcode_pack, p.pack_qty, b.barcode_box, b.box_qty,
    m.unit_of_measure, m.packing_size_qty
  FROM master m
  LEFT JOIN pack_min p ON p.sku_code = m.sku_code
  LEFT JOIN box_min b ON b.sku_code = m.sku_code;
$$;

-- ============ PHASE 3: PRICE & STATUS ============
CREATE OR REPLACE FUNCTION public.get_range_store_status()
RETURNS TABLE(
  sku_code text, standard_price numeric, list_price numeric,
  item_status text, item_type text, buying_status text, rank_sale text
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $$
  WITH master AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, standard_price, list_price, item_status, item_type, buying_status
    FROM data_master WHERE stock_unit_flag = 'Y' AND sku_code IS NOT NULL
    ORDER BY sku_code, created_at DESC
  ),
  rank_d AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IS NOT NULL
    ORDER BY item_id, created_at DESC
  )
  SELECT m.sku_code, m.standard_price, m.list_price,
    m.item_status, m.item_type, m.buying_status,
    COALESCE(r.final_rank, '') AS rank_sale
  FROM master m
  LEFT JOIN rank_d r ON r.item_id = m.sku_code;
$$;

-- ============ PHASE 4: AVG SALES BY TYPE ============
CREATE OR REPLACE FUNCTION public.get_range_store_avg_type()
RETURNS TABLE(
  sku_code text, avg_jmart numeric, avg_kokkok numeric,
  avg_kokkok_fc numeric, avg_udee numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $$
  SELECT id18 AS sku_code,
    COALESCE(SUM(CASE WHEN type_store = 'Jmart' THEN avg_day END), 0) AS avg_jmart,
    COALESCE(SUM(CASE WHEN type_store = 'Kokkok' THEN avg_day END), 0) AS avg_kokkok,
    COALESCE(SUM(CASE WHEN type_store = 'Kokkok-FC' THEN avg_day END), 0) AS avg_kokkok_fc,
    COALESCE(SUM(CASE WHEN type_store = 'U-dee' THEN avg_day END), 0) AS avg_udee
  FROM sales_by_week WHERE id18 IS NOT NULL
  GROUP BY id18;
$$;

-- ============ PHASE 5: PER-STORE (avg + range overrides) ============
CREATE OR REPLACE FUNCTION public.get_range_store_perstore()
RETURNS TABLE(
  sku_code text, avg_per_store jsonb, range_data jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s'
AS $$
  WITH sales_store AS (
    SELECT id18 AS sku, jsonb_object_agg(store_name, total_avg) AS per_store
    FROM (
      SELECT id18, store_name, SUM(avg_day) AS total_avg
      FROM sales_by_week
      WHERE id18 IS NOT NULL AND store_name IS NOT NULL
      GROUP BY id18, store_name
    ) s GROUP BY id18
  ),
  range_d AS (
    SELECT sku_code AS sku,
      jsonb_object_agg(store_name, jsonb_build_object(
        'apply_yn', apply_yn,
        'min_display', min_display,
        'unit_picking_super', unit_picking_super,
        'unit_picking_mart', unit_picking_mart
      )) AS payload
    FROM range_store GROUP BY sku_code
  ),
  all_skus AS (
    SELECT sku FROM sales_store
    UNION SELECT sku FROM range_d
  )
  SELECT a.sku AS sku_code,
    COALESCE(ss.per_store, '{}'::jsonb) AS avg_per_store,
    COALESCE(rd.payload, '{}'::jsonb) AS range_data
  FROM all_skus a
  LEFT JOIN sales_store ss ON ss.sku = a.sku
  LEFT JOIN range_d rd ON rd.sku = a.sku;
$$;