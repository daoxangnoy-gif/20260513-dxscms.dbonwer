
CREATE TABLE IF NOT EXISTS public.document_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_document_locations ON public.document_locations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_insert_document_locations ON public.document_locations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY auth_update_document_locations ON public.document_locations
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY auth_delete_document_locations ON public.document_locations
  FOR DELETE TO authenticated USING (
    (created_by = auth.uid()) OR has_role(auth.uid(), 'Admin')
  );
