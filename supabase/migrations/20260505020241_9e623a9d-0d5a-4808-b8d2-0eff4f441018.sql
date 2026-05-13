
-- Table
CREATE TABLE public.payment_overdue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_code text NOT NULL,
  vendor_name text,
  supplier_currency text,
  vat_percent numeric,
  amount_overdue numeric NOT NULL DEFAULT 0,
  reason text,
  attachment_url text,
  attachment_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_overdue ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_payment_overdue ON public.payment_overdue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_insert_payment_overdue ON public.payment_overdue
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY auth_update_payment_overdue ON public.payment_overdue
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE POLICY auth_delete_payment_overdue ON public.payment_overdue
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE TRIGGER set_payment_overdue_updated_at
  BEFORE UPDATE ON public.payment_overdue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_payment_overdue_vendor ON public.payment_overdue(vendor_code);
CREATE INDEX idx_payment_overdue_created ON public.payment_overdue(created_at DESC);

-- Storage bucket (public for easy image rendering; small images only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-overdue', 'payment-overdue', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "payment_overdue_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'payment-overdue');

CREATE POLICY "payment_overdue_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-overdue' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "payment_overdue_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-overdue' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "payment_overdue_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'payment-overdue' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Register menu for RBAC
INSERT INTO public.menus (menu_name, menu_code, menu_type, sort_order, is_active)
VALUES ('Payment Overdue', 'srr_payment_overdue', 'Sub', 50, true)
ON CONFLICT DO NOTHING;
