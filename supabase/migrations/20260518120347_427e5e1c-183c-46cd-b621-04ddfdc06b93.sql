CREATE TABLE public.document_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES public.document_shipments(id) ON DELETE CASCADE,
  location_name text NOT NULL,
  action text NOT NULL,
  notes text,
  codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_movements_shipment ON public.document_movements(shipment_id, created_at DESC);

ALTER TABLE public.document_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_document_movements" ON public.document_movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_document_movements" ON public.document_movements
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_delete_document_movements" ON public.document_movements
  FOR DELETE TO authenticated USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'::text));