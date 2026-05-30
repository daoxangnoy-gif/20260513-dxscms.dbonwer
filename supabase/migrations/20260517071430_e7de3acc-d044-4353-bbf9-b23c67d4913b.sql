
-- Table: sku_no_order (sku/barcode + store; no qty)
CREATE TABLE public.sku_no_order (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code TEXT NOT NULL,
  store_name TEXT NOT NULL,
  product_name_la TEXT,
  product_name_en TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sku_no_order_sku_store ON public.sku_no_order (sku_code, store_name);

ALTER TABLE public.sku_no_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_sku_no_order ON public.sku_no_order FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_sku_no_order ON public.sku_no_order FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_sku_no_order ON public.sku_no_order FOR UPDATE TO authenticated USING (true);
CREATE POLICY auth_delete_sku_no_order ON public.sku_no_order FOR DELETE TO authenticated USING (true);

-- Table: store_priority (per user)
CREATE TABLE public.store_priority (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  store_name TEXT NOT NULL,
  type_store TEXT,
  priority INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, store_name)
);

ALTER TABLE public.store_priority ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_store_priority ON public.store_priority FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_store_priority ON public.store_priority FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY auth_update_store_priority ON public.store_priority FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));
CREATE POLICY auth_delete_store_priority ON public.store_priority FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));
