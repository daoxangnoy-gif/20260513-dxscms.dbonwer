CREATE TABLE public.document_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  doc_name text NOT NULL,
  depositor_name text,
  receiver_name text,
  origin_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  destination_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  compared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_document_shipments ON public.document_shipments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_document_shipments ON public.document_shipments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY auth_update_document_shipments ON public.document_shipments
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));
CREATE POLICY auth_delete_document_shipments ON public.document_shipments
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE TRIGGER trg_document_shipments_updated_at
  BEFORE UPDATE ON public.document_shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();