-- Create update_updated_at function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 1. Data Master
CREATE TABLE public.data_master (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code TEXT,
  main_barcode TEXT,
  barcode TEXT,
  product_name_la TEXT,
  product_name_en TEXT,
  product_name_th TEXT,
  product_name_kr TEXT,
  product_name_cn TEXT,
  unit_of_measure TEXT,
  packing_size_qty NUMERIC,
  packing_size TEXT,
  stock_unit_flag TEXT,
  small_unit_flag TEXT,
  weight NUMERIC,
  width NUMERIC,
  depth NUMERIC,
  height NUMERIC,
  min_display NUMERIC,
  max_display NUMERIC,
  use_serial TEXT,
  unit_picking_super TEXT,
  unit_picking_mart TEXT,
  lao_label TEXT,
  high_value TEXT,
  mfg_expire_status TEXT,
  product_shelf_life TEXT,
  item_origin TEXT,
  item_classify TEXT,
  vat_flag TEXT,
  tax_rate NUMERIC,
  one_retail_status TEXT,
  store_selection TEXT,
  division_group_code TEXT,
  division_group TEXT,
  division_code TEXT,
  division TEXT,
  department_code TEXT,
  department TEXT,
  sub_department_code TEXT,
  sub_department TEXT,
  class_code TEXT,
  class TEXT,
  sub_class_code TEXT,
  sub_class TEXT,
  gm_buyer_code TEXT,
  header_buyer_code TEXT,
  buyer_code TEXT,
  product_owner TEXT,
  product_bu TEXT,
  item_status TEXT,
  item_type TEXT,
  buying_status TEXT,
  inactive_action_code TEXT,
  inactive_action_name TEXT,
  discontinue_action_code TEXT,
  discontinue_action_name TEXT,
  sale_ranging TEXT,
  register_date TEXT,
  house_brand TEXT,
  brand TEXT,
  vendor_code TEXT,
  vendor_display_name TEXT,
  vendor_current_status TEXT,
  vdi_code TEXT,
  replenishment_type TEXT,
  product_type TEXT,
  returnable_flag TEXT,
  rtv_condition TEXT,
  register_form_status TEXT,
  excise_tax NUMERIC,
  import_tax NUMERIC,
  hs_code TEXT,
  po_group TEXT,
  order_condition TEXT,
  min_order_pcs NUMERIC,
  dc_min_stock NUMERIC,
  default_location TEXT,
  sales TEXT,
  purchase TEXT,
  available_in_self_order TEXT,
  pack_product TEXT,
  track_inventory TEXT,
  tracking TEXT,
  auto_create_lot TEXT,
  create_purchase_order_pos TEXT,
  valuation_by_lot TEXT,
  standard_price NUMERIC,
  list_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.data_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to data_master" ON public.data_master FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_data_master_updated_at BEFORE UPDATE ON public.data_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Stock
CREATE TABLE public.stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location TEXT,
  barcode TEXT,
  item_id TEXT,
  product TEXT,
  unit_of_measure TEXT,
  inventoried_quantity NUMERIC,
  quantity NUMERIC,
  on_hand NUMERIC,
  reserved_quantity NUMERIC,
  values_amount NUMERIC,
  package TEXT,
  company TEXT,
  type_store TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to stock" ON public.stock FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_stock_updated_at BEFORE UPDATE ON public.stock FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Minmax
CREATE TABLE public.minmax (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id TEXT,
  min_val NUMERIC,
  max_val NUMERIC,
  type_store TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.minmax ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to minmax" ON public.minmax FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_minmax_updated_at BEFORE UPDATE ON public.minmax FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. PO Cost
CREATE TABLE public.po_cost (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goodcode TEXT,
  product_name TEXT,
  moq NUMERIC,
  po_cost_unit NUMERIC,
  po_cost NUMERIC,
  item_id TEXT,
  vendor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.po_cost ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to po_cost" ON public.po_cost FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_po_cost_updated_at BEFORE UPDATE ON public.po_cost FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. On Order
CREATE TABLE public.on_order (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code TEXT,
  sku_name TEXT,
  po_qty NUMERIC,
  id18 TEXT,
  item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.on_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to on_order" ON public.on_order FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_on_order_updated_at BEFORE UPDATE ON public.on_order FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Rank Sales
CREATE TABLE public.rank_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id TEXT,
  product_name TEXT,
  final_rank TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rank_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rank_sales" ON public.rank_sales FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_rank_sales_updated_at BEFORE UPDATE ON public.rank_sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Sales By Week
CREATE TABLE public.sales_by_week (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type_store TEXT,
  store_name TEXT,
  old_id TEXT,
  item_id TEXT,
  week_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_by_week ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sales_by_week" ON public.sales_by_week FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_sales_by_week_updated_at BEFORE UPDATE ON public.sales_by_week FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Vendor Master
CREATE TABLE public.vendor_master (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_code TEXT,
  vendor_name_en TEXT,
  vendor_name_la TEXT,
  vendor_origin TEXT,
  vendor_type TEXT,
  vendor_payment_terms TEXT,
  supplier_currency TEXT,
  replenishment_type TEXT,
  lead_time NUMERIC,
  leadtime NUMERIC,
  order_cycle NUMERIC,
  spc_name TEXT,
  order_day TEXT,
  delivery_day TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vendor_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to vendor_master" ON public.vendor_master FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_vendor_master_updated_at BEFORE UPDATE ON public.vendor_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for join columns
CREATE INDEX idx_data_master_sku_code ON public.data_master(sku_code);
CREATE INDEX idx_data_master_vendor_code ON public.data_master(vendor_code);
CREATE INDEX idx_stock_item_id ON public.stock(item_id);
CREATE INDEX idx_stock_type_store ON public.stock(type_store);
CREATE INDEX idx_minmax_item_id ON public.minmax(item_id);
CREATE INDEX idx_minmax_type_store ON public.minmax(type_store);
CREATE INDEX idx_po_cost_item_id ON public.po_cost(item_id);
CREATE INDEX idx_on_order_item_id ON public.on_order(item_id);
CREATE INDEX idx_on_order_sku_code ON public.on_order(sku_code);
CREATE INDEX idx_rank_sales_item_id ON public.rank_sales(item_id);
CREATE INDEX idx_sales_by_week_item_id ON public.sales_by_week(item_id);
CREATE INDEX idx_sales_by_week_type_store ON public.sales_by_week(type_store);
CREATE INDEX idx_vendor_master_vendor_code ON public.vendor_master(vendor_code);