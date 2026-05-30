DROP FUNCTION IF EXISTS public.get_srr_batch_items(timestamp with time zone, timestamp with time zone, text);
DROP FUNCTION IF EXISTS public.get_srr_d2s_batch_items(timestamp with time zone, timestamp with time zone, text);
DROP FUNCTION IF EXISTS public.refresh_srr_mv(text);

DROP MATERIALIZED VIEW IF EXISTS public.mv_srr_snapshots_items;
DROP MATERIALIZED VIEW IF EXISTS public.mv_srr_d2s_snapshots_items;

ALTER FUNCTION public.get_srr_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean)
  SET statement_timeout TO '90s';

ALTER FUNCTION public.get_srr_d2s_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean)
  SET statement_timeout TO '90s';

DROP INDEX IF EXISTS public.idx_stock_item_type_store;
DROP INDEX IF EXISTS public.idx_stock_item_company;
DROP INDEX IF EXISTS public.idx_sbw_item_type;
DROP INDEX IF EXISTS public.idx_sbw_id18_type;
DROP INDEX IF EXISTS public.idx_sbw_item_store;
DROP INDEX IF EXISTS public.idx_sbw_id18_store;
DROP INDEX IF EXISTS public.idx_on_order_sku_store;
DROP INDEX IF EXISTS public.idx_po_cost_item_vendor_updated;
DROP INDEX IF EXISTS public.idx_dm_vendor_sku;
DROP INDEX IF EXISTS public.idx_dm_sku_updated;
DROP INDEX IF EXISTS public.idx_vm_vendor_updated;
DROP INDEX IF EXISTS public.idx_rank_sales_item_updated;