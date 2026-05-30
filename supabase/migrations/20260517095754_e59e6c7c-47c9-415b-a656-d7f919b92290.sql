CREATE TABLE IF NOT EXISTS public.role_division_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL,
  division text NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_import boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, division)
);

CREATE INDEX IF NOT EXISTS idx_rda_role ON public.role_division_access(role_id);

ALTER TABLE public.role_division_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_role_division_access"
  ON public.role_division_access FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "admin_manage_role_division_access"
  ON public.role_division_access FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'Admin'::text))
  WITH CHECK (has_role(auth.uid(), 'Admin'::text));

CREATE TRIGGER trg_rda_updated
  BEFORE UPDATE ON public.role_division_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();