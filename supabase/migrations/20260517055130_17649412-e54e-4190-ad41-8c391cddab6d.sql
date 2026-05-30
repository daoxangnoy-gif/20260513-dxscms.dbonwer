
-- on_order_dc: per-store on-order qty for SAR
CREATE TABLE public.on_order_dc (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  store_name text NOT NULL,
  product_name_la text,
  product_name_en text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_on_order_dc_sku_store ON public.on_order_dc (sku_code, store_name);
ALTER TABLE public.on_order_dc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_on_order_dc" ON public.on_order_dc
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_on_order_dc" ON public.on_order_dc
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_on_order_dc" ON public.on_order_dc
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_on_order_dc" ON public.on_order_dc
  FOR DELETE TO authenticated USING (true);

-- sar_snapshots: saved SAR calc results
CREATE TABLE public.sar_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  doc_name text NOT NULL,
  source text NOT NULL DEFAULT 'filter',
  item_count integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sar_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_sar_snapshots" ON public.sar_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_sar_snapshots" ON public.sar_snapshots
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "auth_update_sar_snapshots" ON public.sar_snapshots
  FOR UPDATE TO authenticated USING ((user_id = auth.uid()) OR has_role(auth.uid(),'Admin'));
CREATE POLICY "auth_delete_sar_snapshots" ON public.sar_snapshots
  FOR DELETE TO authenticated USING ((user_id = auth.uid()) OR has_role(auth.uid(),'Admin'));
