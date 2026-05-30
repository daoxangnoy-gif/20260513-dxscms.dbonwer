
CREATE TABLE public.filter_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  target_table TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.filter_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_filter_templates" ON public.filter_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_insert_filter_templates" ON public.filter_templates
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'Admin'::text));

CREATE POLICY "admin_update_filter_templates" ON public.filter_templates
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'Admin'::text)) WITH CHECK (has_role(auth.uid(), 'Admin'::text));

CREATE POLICY "admin_delete_filter_templates" ON public.filter_templates
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'Admin'::text));

CREATE INDEX idx_filter_templates_table_active ON public.filter_templates(target_table, is_active);

CREATE TRIGGER update_filter_templates_updated_at
  BEFORE UPDATE ON public.filter_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
