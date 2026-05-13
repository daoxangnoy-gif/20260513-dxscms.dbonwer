
-- Indexes on real underlying tables for SRR RPC speed
CREATE INDEX IF NOT EXISTS idx_data_master_vendor_code ON public.data_master(vendor_code);
CREATE INDEX IF NOT EXISTS idx_data_master_sku_code ON public.data_master(sku_code);
CREATE INDEX IF NOT EXISTS idx_data_master_product_owner ON public.data_master(product_owner);
CREATE INDEX IF NOT EXISTS idx_data_master_buying_status ON public.data_master(buying_status);
CREATE INDEX IF NOT EXISTS idx_data_master_item_type ON public.data_master(item_type);

CREATE INDEX IF NOT EXISTS idx_vendor_master_vendor_code ON public.vendor_master(vendor_code);
CREATE INDEX IF NOT EXISTS idx_vendor_master_spc_name ON public.vendor_master(spc_name);
CREATE INDEX IF NOT EXISTS idx_vendor_master_order_day ON public.vendor_master(order_day);
CREATE INDEX IF NOT EXISTS idx_vendor_master_trade_term ON public.vendor_master(trade_term);

CREATE INDEX IF NOT EXISTS idx_stock_item_id ON public.stock(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_type_store ON public.stock(type_store);
CREATE INDEX IF NOT EXISTS idx_sales_by_week_id18 ON public.sales_by_week(id18);
CREATE INDEX IF NOT EXISTS idx_sales_by_week_item_id ON public.sales_by_week(item_id);
CREATE INDEX IF NOT EXISTS idx_sales_by_week_store_name ON public.sales_by_week(store_name);
CREATE INDEX IF NOT EXISTS idx_on_order_sku_code ON public.on_order(sku_code);
CREATE INDEX IF NOT EXISTS idx_rank_sales_item_id ON public.rank_sales(item_id);
CREATE INDEX IF NOT EXISTS idx_po_cost_item_id ON public.po_cost(item_id);

-- Bump per-function statement_timeout to 60s
ALTER FUNCTION public.get_srr_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]) SET statement_timeout = '60s';
ALTER FUNCTION public.get_srr_d2s_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]) SET statement_timeout = '60s';
