
CREATE TABLE public.help_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.help_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_help" ON public.help_sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_help" ON public.help_sections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_help" ON public.help_sections FOR UPDATE TO authenticated USING (true);
CREATE POLICY "admin_delete_help" ON public.help_sections FOR DELETE TO authenticated USING (has_role(auth.uid(), 'Admin'::text));

INSERT INTO public.help_sections (data) VALUES ('[]'::jsonb);

INSERT INTO storage.buckets (id, name, public) VALUES ('help-images', 'help-images', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Public read help images" ON storage.objects FOR SELECT USING (bucket_id = 'help-images');
CREATE POLICY "Auth upload help images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'help-images');
CREATE POLICY "Auth update help images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'help-images');
CREATE POLICY "Auth delete help images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'help-images');
