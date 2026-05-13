CREATE TABLE public.store_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_to text,
  code text,
  type_store text,
  type_doc text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.store_type ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to store_type" ON public.store_type FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_store_type_updated_at BEFORE UPDATE ON public.store_type FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();