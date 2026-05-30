-- Fix A: bump statement_timeout for SRR RPCs to 180s
ALTER FUNCTION public.get_srr_data(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],boolean) SET statement_timeout TO '180s';
ALTER FUNCTION public.get_srr_d2s_data(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],boolean) SET statement_timeout TO '180s';

-- Fix D: composite indexes for faster join/aggregation
CREATE INDEX IF NOT EXISTS idx_stock_item_type_store ON public.stock (item_id, type_store);
CREATE INDEX IF NOT EXISTS idx_stock_item_company ON public.stock (item_id, company);
CREATE INDEX IF NOT EXISTS idx_sbw_item_type ON public.sales_by_week (item_id, type_store);
CREATE INDEX IF NOT EXISTS idx_sbw_id18_type ON public.sales_by_week (id18, type_store);
CREATE INDEX IF NOT EXISTS idx_sbw_item_store ON public.sales_by_week (item_id, store_name);
CREATE INDEX IF NOT EXISTS idx_sbw_id18_store ON public.sales_by_week (id18, store_name);
CREATE INDEX IF NOT EXISTS idx_on_order_sku_store ON public.on_order (sku_code, store_name);
CREATE INDEX IF NOT EXISTS idx_po_cost_item_vendor_updated ON public.po_cost (item_id, vendor, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_vendor_sku ON public.data_master (vendor_code, sku_code);
CREATE INDEX IF NOT EXISTS idx_dm_sku_updated ON public.data_master (sku_code, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vm_vendor_updated ON public.vendor_master (vendor_code, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_sales_item_updated ON public.rank_sales (item_id, updated_at DESC);