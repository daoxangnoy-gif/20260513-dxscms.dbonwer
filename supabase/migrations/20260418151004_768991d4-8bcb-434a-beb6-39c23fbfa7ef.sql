-- Add CRUD columns to role_menu_permissions (preserve existing can_view rows)
ALTER TABLE public.role_menu_permissions
  ADD COLUMN IF NOT EXISTS can_create boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false;

-- Backfill: if a role currently can_view, give Admin full CRUD; others view-only
UPDATE public.role_menu_permissions rmp
SET can_create = true, can_edit = true, can_delete = true, can_export = true
WHERE rmp.can_view = true
  AND EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = rmp.role_id AND r.role_name = 'Admin'
  );

-- Create column_permissions table
CREATE TABLE IF NOT EXISTS public.column_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  menu_code text NOT NULL,
  column_key text NOT NULL,
  access text NOT NULL DEFAULT 'write' CHECK (access IN ('hidden','read','write')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (role_id, menu_code, column_key)
);

ALTER TABLE public.column_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_column_permissions ON public.column_permissions;
CREATE POLICY read_column_permissions ON public.column_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS admin_manage_column_permissions ON public.column_permissions;
CREATE POLICY admin_manage_column_permissions ON public.column_permissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'Admin'))
  WITH CHECK (has_role(auth.uid(), 'Admin'));

CREATE INDEX IF NOT EXISTS idx_column_permissions_role ON public.column_permissions(role_id);