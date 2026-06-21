-- Routeplan — แนบไฟล์ PDF Routeplan (เก็บไฟล์ล่าสุด 1 รายการ) + เวลาอัปล่าสุด + จำนวนครั้ง
CREATE TABLE IF NOT EXISTS public.routeplan (
  key text PRIMARY KEY DEFAULT 'default',  -- เก็บแถวเดียว (key='default')
  pdf_url text,
  uploaded_at timestamptz,
  upload_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.routeplan ENABLE ROW LEVEL SECURITY;
CREATE POLICY routeplan_select ON public.routeplan FOR SELECT TO authenticated USING (true);
CREATE POLICY routeplan_insert ON public.routeplan FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY routeplan_update ON public.routeplan FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY routeplan_delete ON public.routeplan FOR DELETE TO authenticated USING (true);
