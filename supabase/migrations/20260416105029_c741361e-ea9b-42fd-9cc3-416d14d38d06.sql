
-- Table: srr_snapshots (daily calculation snapshots)
CREATE TABLE public.srr_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_key DATE NOT NULL,
  spc_name TEXT NOT NULL,
  vendor_code TEXT NOT NULL,
  vendor_display TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  suggest_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  edit_count INTEGER NOT NULL DEFAULT 0,
  edited_columns TEXT[] DEFAULT '{}',
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date_key, spc_name, vendor_code)
);

ALTER TABLE public.srr_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_snapshots" ON public.srr_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_snapshots" ON public.srr_snapshots
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "authenticated_update_snapshots" ON public.srr_snapshots
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE POLICY "authenticated_delete_snapshots" ON public.srr_snapshots
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE INDEX idx_srr_snapshots_date ON public.srr_snapshots(date_key DESC);
CREATE INDEX idx_srr_snapshots_spc ON public.srr_snapshots(spc_name);
CREATE INDEX idx_srr_snapshots_vendor ON public.srr_snapshots(vendor_code);

CREATE TRIGGER update_srr_snapshots_updated_at
  BEFORE UPDATE ON public.srr_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: saved_po_documents (saved PO lists)
CREATE TABLE public.saved_po_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_key DATE NOT NULL,
  spc_name TEXT NOT NULL,
  vendor_code TEXT NOT NULL,
  vendor_display TEXT,
  po_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 0,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date_key, spc_name, vendor_code)
);

ALTER TABLE public.saved_po_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_po_docs" ON public.saved_po_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_po_docs" ON public.saved_po_documents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "authenticated_update_po_docs" ON public.saved_po_documents
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE POLICY "authenticated_delete_po_docs" ON public.saved_po_documents
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'Admin'));

CREATE INDEX idx_saved_po_date ON public.saved_po_documents(date_key DESC);
CREATE INDEX idx_saved_po_spc ON public.saved_po_documents(spc_name);

CREATE TRIGGER update_saved_po_updated_at
  BEFORE UPDATE ON public.saved_po_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function: cleanup old snapshots (>30 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_snapshots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.srr_snapshots WHERE date_key < CURRENT_DATE - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM public.saved_po_documents WHERE date_key < CURRENT_DATE - INTERVAL '30 days';
  
  RETURN deleted_count;
END;
$$;
