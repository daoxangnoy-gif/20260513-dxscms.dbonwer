
-- 1) Table to store Min/Max calculation snapshots (Documents)
CREATE TABLE IF NOT EXISTS public.minmax_cal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name text NOT NULL,
  user_id uuid NOT NULL,
  n_factor numeric NOT NULL DEFAULT 3,
  item_count integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minmax_cal_docs_created ON public.minmax_cal_documents (created_at DESC);

ALTER TABLE public.minmax_cal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_minmax_docs" ON public.minmax_cal_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_minmax_docs" ON public.minmax_cal_documents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "auth_update_minmax_docs" ON public.minmax_cal_documents
  FOR UPDATE TO authenticated 
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE POLICY "auth_delete_minmax_docs" ON public.minmax_cal_documents
  FOR DELETE TO authenticated 
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE TRIGGER trg_minmax_docs_updated
  BEFORE UPDATE ON public.minmax_cal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2) RPC: Build Min/Max calculation rows (per SKU x Store) from current data
-- Pulls: data_master (SKU filter), latest range_store apply_yn='Y', store_type (size_store),
-- sales_by_week (avg_day per store), rank_sales (final_rank)
CREATE OR REPLACE FUNCTION public.calc_minmax_rows(p_n_factor numeric DEFAULT 3)
RETURNS TABLE(
  sku_code text,
  product_name_la text,
  product_name_en text,
  main_barcode text,
  unit_of_measure text,
  store_name text,
  type_store text,
  size_store text,
  unit_pick numeric,
  avg_sale numeric,
  rank_sale text,
  rank_factor integer,
  min_cal numeric,
  max_cal numeric,
  is_default_min boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
BEGIN
  RETURN QUERY
  WITH base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.product_name_la, dm.product_name_en, dm.main_barcode, dm.unit_of_measure
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  range_y AS (
    -- only stores with apply_yn='Y' per SKU
    SELECT rs.sku_code, rs.store_name,
      MAX(rs.unit_picking_super) AS unit_picking_super,
      MAX(rs.unit_picking_mart) AS unit_picking_mart
    FROM range_store rs
    WHERE rs.apply_yn = 'Y'
    GROUP BY rs.sku_code, rs.store_name
  ),
  store_meta AS (
    SELECT DISTINCT ON (st.store_name)
      st.store_name, st.type_store, st.size_store
    FROM store_type st
    WHERE st.store_name IS NOT NULL
    ORDER BY st.store_name, st.created_at DESC
  ),
  sales_per_store AS (
    SELECT sw.id18 AS sku, sw.store_name, COALESCE(SUM(sw.avg_day),0) AS avg_sale
    FROM sales_by_week sw
    WHERE sw.id18 IS NOT NULL AND sw.store_name IS NOT NULL
    GROUP BY sw.id18, sw.store_name
  ),
  rank_d AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs WHERE rs.item_id IS NOT NULL
    ORDER BY rs.item_id, rs.created_at DESC
  )
  SELECT
    bi.sku_code,
    bi.product_name_la,
    bi.product_name_en,
    bi.main_barcode,
    bi.unit_of_measure,
    ry.store_name,
    COALESCE(sm.type_store, '')::text AS type_store,
    COALESCE(sm.size_store, '')::text AS size_store,
    -- unit_pick: super for Super-size, mart otherwise (default mart)
    COALESCE(
      CASE
        WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.unit_picking_super
        ELSE ry.unit_picking_mart
      END, 1)::numeric AS unit_pick,
    ROUND(COALESCE(sps.avg_sale,0)::numeric, 4) AS avg_sale,
    COALESCE(rd.final_rank, 'D')::text AS rank_sale,
    CASE COALESCE(rd.final_rank,'D')
      WHEN 'A' THEN 21
      WHEN 'B' THEN 14
      WHEN 'C' THEN 10
      ELSE 7
    END::int AS rank_factor,
    -- min_cal logic
    CASE
      WHEN COALESCE(sps.avg_sale, 0) = 0 THEN 3
      ELSE CEIL(COALESCE(sps.avg_sale,0) * (
        CASE COALESCE(rd.final_rank,'D')
          WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
        END))
    END::numeric AS min_cal,
    -- max_cal logic
    CASE
      WHEN COALESCE(sps.avg_sale,0) = 0 THEN
        CASE
          WHEN COALESCE(
            CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.unit_picking_super
                 ELSE ry.unit_picking_mart END, 1) <= 1 THEN 6
          ELSE 3 + COALESCE(
            CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.unit_picking_super
                 ELSE ry.unit_picking_mart END, 1)
        END
      ELSE
        CEIL(
          (CEIL(COALESCE(sps.avg_sale,0) * (
            CASE COALESCE(rd.final_rank,'D')
              WHEN 'A' THEN 21 WHEN 'B' THEN 14 WHEN 'C' THEN 10 ELSE 7
            END)) + COALESCE(sps.avg_sale,0) * p_n_factor)
          / NULLIF(COALESCE(
              CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.unit_picking_super
                   ELSE ry.unit_picking_mart END, 1), 0)
        ) * COALESCE(
              CASE WHEN UPPER(COALESCE(sm.size_store,'')) LIKE '%SUPER%' THEN ry.unit_picking_super
                   ELSE ry.unit_picking_mart END, 1)
    END::numeric AS max_cal,
    (COALESCE(sps.avg_sale,0) = 0) AS is_default_min
  FROM base_items bi
  JOIN range_y ry ON ry.sku_code = bi.sku_code
  LEFT JOIN store_meta sm ON sm.store_name = ry.store_name
  LEFT JOIN sales_per_store sps ON sps.sku = bi.sku_code AND sps.store_name = ry.store_name
  LEFT JOIN rank_d rd ON rd.item_id = bi.sku_code
  ORDER BY bi.sku_code, ry.store_name;
END;
$$;


-- 3) RPC: Get latest Min/Max document (returns flat rows)
CREATE OR REPLACE FUNCTION public.get_latest_minmax_doc()
RETURNS TABLE(
  doc_id uuid,
  doc_name text,
  created_at timestamptz,
  sku_code text,
  store_name text,
  type_store text,
  min_val numeric,
  max_val numeric,
  unit_pick numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_doc_id uuid;
  v_doc_name text;
  v_created timestamptz;
BEGIN
  SELECT id, doc_name, created_at INTO v_doc_id, v_doc_name, v_created
  FROM public.minmax_cal_documents
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_doc_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_doc_id,
    v_doc_name,
    v_created,
    (r->>'sku_code')::text,
    (r->>'store_name')::text,
    COALESCE(r->>'type_store','')::text,
    NULLIF(r->>'min_final','')::numeric,
    NULLIF(r->>'max_final','')::numeric,
    NULLIF(r->>'unit_pick','')::numeric
  FROM public.minmax_cal_documents d,
       LATERAL jsonb_array_elements(d.data) r
  WHERE d.id = v_doc_id;
END;
$$;
