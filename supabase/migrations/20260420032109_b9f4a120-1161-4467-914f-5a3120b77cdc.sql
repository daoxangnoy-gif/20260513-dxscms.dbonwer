CREATE TABLE IF NOT EXISTS public.srr_d2s_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_key DATE NOT NULL,
  spc_name TEXT NOT NULL,
  vendor_code TEXT NOT NULL,
  vendor_display TEXT,
  store_name TEXT NOT NULL,
  type_store TEXT,
  source TEXT NOT NULL DEFAULT 'filter',
  item_count INTEGER NOT NULL DEFAULT 0,
  suggest_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  edit_count INTEGER NOT NULL DEFAULT 0,
  edited_columns TEXT[] DEFAULT '{}'::text[],
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_srr_d2s_snap_date ON public.srr_d2s_snapshots(date_key);
CREATE INDEX IF NOT EXISTS idx_srr_d2s_snap_spc ON public.srr_d2s_snapshots(spc_name);
CREATE INDEX IF NOT EXISTS idx_srr_d2s_snap_user ON public.srr_d2s_snapshots(user_id);

ALTER TABLE public.srr_d2s_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read_d2s_snapshots ON public.srr_d2s_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_insert_d2s_snapshots ON public.srr_d2s_snapshots
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY authenticated_update_d2s_snapshots ON public.srr_d2s_snapshots
  FOR UPDATE TO authenticated USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'::text));

CREATE POLICY authenticated_delete_d2s_snapshots ON public.srr_d2s_snapshots
  FOR DELETE TO authenticated USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'::text));

CREATE TRIGGER update_srr_d2s_snapshots_updated_at
  BEFORE UPDATE ON public.srr_d2s_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.cleanup_old_d2s_snapshots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.srr_d2s_snapshots WHERE date_key < (CURRENT_DATE - INTERVAL '30 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;