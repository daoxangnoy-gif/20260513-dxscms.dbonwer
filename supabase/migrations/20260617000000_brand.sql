-- Brand control (Order B2B internal → tab Brand control → ปุ่ม List Brand)
-- เก็บรายการ Brand: code (รันเลขอัตโนมัติ), brand_name, branch

CREATE TABLE IF NOT EXISTS public.brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code integer NOT NULL UNIQUE,
  brand_name text,
  branch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brand ENABLE ROW LEVEL SECURITY;

-- authenticated อ่าน/เขียนได้ทั้งหมด (เครื่องมือภายในองค์กร)
CREATE POLICY brand_select ON public.brand
  FOR SELECT TO authenticated USING (true);

CREATE POLICY brand_insert ON public.brand
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY brand_update ON public.brand
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY brand_delete ON public.brand
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_brand_code ON public.brand(code);
