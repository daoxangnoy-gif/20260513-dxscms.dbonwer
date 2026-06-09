-- SRR DC: Doc Final — เก็บเอกสารที่ผ่านการ Review แล้ว (บันทึกเฉพาะตอนกด Save)
-- โครงสร้างเทียบเท่า saved_po_documents แต่เก็บ full row data + suggest/edited metadata
-- ใช้ใน SRRPage.tsx: insert ตอน savePO, select ใน loadFinalDocs

CREATE TABLE IF NOT EXISTS public.srr_final_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_key DATE NOT NULL,
  spc_name TEXT NOT NULL DEFAULT '',
  vendor_code TEXT NOT NULL,
  vendor_display TEXT,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 0,
  suggest_count INTEGER NOT NULL DEFAULT 0,
  edited_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'filter',
  saved_by UUID NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.srr_final_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_srr_final"
  ON public.srr_final_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_srr_final"
  ON public.srr_final_documents
  FOR INSERT TO authenticated WITH CHECK (saved_by = auth.uid());

CREATE POLICY "authenticated_update_srr_final"
  ON public.srr_final_documents
  FOR UPDATE TO authenticated
  USING (saved_by = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE POLICY "authenticated_delete_srr_final"
  ON public.srr_final_documents
  FOR DELETE TO authenticated
  USING (saved_by = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE INDEX IF NOT EXISTS idx_srr_final_saved_at ON public.srr_final_documents(saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_srr_final_date ON public.srr_final_documents(date_key DESC);
CREATE INDEX IF NOT EXISTS idx_srr_final_vendor ON public.srr_final_documents(vendor_code);
