CREATE TABLE IF NOT EXISTS public.unit_pick_override (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code text NOT NULL,
  store_name text NOT NULL,
  unit_pick integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unit_pick_override_unique UNIQUE (sku_code, store_name)
);

ALTER TABLE public.unit_pick_override ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read unit_pick_override"
  ON public.unit_pick_override FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated write unit_pick_override"
  ON public.unit_pick_override FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
