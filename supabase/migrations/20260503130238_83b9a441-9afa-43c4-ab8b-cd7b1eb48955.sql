
CREATE TABLE IF NOT EXISTS public.tab_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL,
  menu_code text NOT NULL,
  tab_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, menu_code, tab_key)
);

ALTER TABLE public.tab_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_tab_permissions" ON public.tab_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_manage_tab_permissions" ON public.tab_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'Admin'::text)) WITH CHECK (has_role(auth.uid(), 'Admin'::text));

CREATE INDEX IF NOT EXISTS idx_tab_permissions_role ON public.tab_permissions(role_id);
