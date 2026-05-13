CREATE TABLE public.srr_public_column_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('dc','direct')),
  name TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, name)
);

ALTER TABLE public.srr_public_column_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view public views"
ON public.srr_public_column_views FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated can insert public views"
ON public.srr_public_column_views FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update public views"
ON public.srr_public_column_views FOR UPDATE
TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete public views"
ON public.srr_public_column_views FOR DELETE
TO authenticated USING (true);

CREATE TRIGGER srr_public_views_updated_at
BEFORE UPDATE ON public.srr_public_column_views
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();