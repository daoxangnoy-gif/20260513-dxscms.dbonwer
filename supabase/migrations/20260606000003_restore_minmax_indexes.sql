-- Restore indexes dropped in 20260523181345 that are critical for get_minmax_calc_all performance

-- sales_by_week: ใช้ใน sales_per_store CTE (id18 + store_name lookup)
CREATE INDEX IF NOT EXISTS idx_sbw_id18_store    ON public.sales_by_week (id18, store_name);
CREATE INDEX IF NOT EXISTS idx_sbw_item_store    ON public.sales_by_week (item_id, store_name);

-- rank_sales: ใช้ใน rank_d CTE (DISTINCT ON item_id ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_rank_sales_item_created ON public.rank_sales (item_id, created_at DESC);

-- data_master: ใช้ใน master CTE (product_owner filter + DISTINCT ON sku_code ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_dm_owner_sku_created2
  ON public.data_master (product_owner, sku_code, created_at DESC);

-- minmax: ใช้ใน mm_up CTE (DISTINCT ON item_id, store_name ORDER BY updated_at DESC)
CREATE INDEX IF NOT EXISTS idx_minmax_item_store_updated
  ON public.minmax (item_id, store_name, updated_at DESC);

-- unit_pick_override: ใช้ใน up_over CTE (sku_code lookup)
CREATE INDEX IF NOT EXISTS idx_upo_sku ON public.unit_pick_override (sku_code);

ANALYZE public.sales_by_week;
ANALYZE public.rank_sales;
ANALYZE public.data_master;
ANALYZE public.minmax;
