
-- ========== STEP 1: CREATE ALL TABLES ==========

CREATE TABLE public.roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  permission_name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.role_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  spc_name TEXT,
  vendor_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  UNIQUE (user_id, role_id)
);

CREATE TABLE public.menus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_name TEXT NOT NULL,
  menu_code TEXT NOT NULL UNIQUE,
  menu_type TEXT NOT NULL DEFAULT 'Main',
  parent_id UUID REFERENCES public.menus(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.role_menu_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (role_id, menu_id)
);

CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== STEP 2: ENABLE RLS ON ALL TABLES ==========

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_menu_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ========== STEP 3: SECURITY DEFINER FUNCTIONS ==========

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id AND r.role_name = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id AND p.permission_name = _perm
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id UUID)
RETURNS TABLE(role_name TEXT, permissions TEXT[], visible_menus TEXT[], spc_name TEXT, vendor_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT r.role_name,
    ARRAY_AGG(DISTINCT p.permission_name) FILTER (WHERE p.permission_name IS NOT NULL),
    ARRAY_AGG(DISTINCT m.menu_code) FILTER (WHERE rmp.can_view = true),
    prof.spc_name,
    prof.vendor_code
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  LEFT JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  LEFT JOIN public.permissions p ON p.id = rp.permission_id
  LEFT JOIN public.role_menu_permissions rmp ON rmp.role_id = ur.role_id
  LEFT JOIN public.menus m ON m.id = rmp.menu_id AND m.is_active = true
  LEFT JOIN public.profiles prof ON prof.user_id = _user_id
  WHERE ur.user_id = _user_id
  GROUP BY r.role_name, prof.spc_name, prof.vendor_code
  LIMIT 1;
END;
$$;

-- ========== STEP 4: RLS POLICIES ==========

-- Roles/Permissions/Menus: read-only for authenticated
CREATE POLICY "read_roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_menus" ON public.menus FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_role_menu_permissions" ON public.role_menu_permissions FOR SELECT TO authenticated USING (true);

-- Admin can manage role_permissions, role_menu_permissions
CREATE POLICY "admin_manage_role_permissions" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'Admin')) WITH CHECK (public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "admin_manage_role_menu_permissions" ON public.role_menu_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'Admin')) WITH CHECK (public.has_role(auth.uid(), 'Admin'));

-- Profiles
CREATE POLICY "view_own_or_admin_profiles" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "update_own_or_admin_profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "insert_profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "admin_delete_profiles" ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'));

-- User Roles
CREATE POLICY "view_own_or_admin_user_roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "admin_manage_user_roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'Admin')) WITH CHECK (public.has_role(auth.uid(), 'Admin'));

-- Audit Log
CREATE POLICY "admin_read_audit_log" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'));
CREATE POLICY "insert_own_audit_log" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ========== STEP 5: TRIGGER - AUTO CREATE PROFILE ON SIGNUP ==========

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role_id UUID;
  _user_count INT;
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO _user_count FROM public.user_roles;
  IF _user_count = 0 THEN
    SELECT id INTO _role_id FROM public.roles WHERE role_name = 'Admin';
  ELSE
    SELECT id INTO _role_id FROM public.roles WHERE role_name = 'Viewer';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id) VALUES (NEW.id, _role_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== STEP 6: SEED DATA ==========

INSERT INTO public.roles (role_name, description) VALUES
  ('Admin', 'Full access - manage users, roles, all data'),
  ('Manager', 'View all data, calculate, export'),
  ('Buyer', 'Restricted by SPC/Vendor, can calculate/edit/save'),
  ('Viewer', 'View only - no calculate, no edit');

INSERT INTO public.permissions (permission_name, description) VALUES
  ('view_data', 'View data in tables'),
  ('calculate', 'Run SRR calculations'),
  ('edit_data', 'Edit Order UOM and other editable fields'),
  ('export', 'Export/Save PO documents'),
  ('import_po', 'Import PO documents'),
  ('manage_user', 'Manage users and roles');

-- Admin: all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.role_name = 'Admin';

-- Manager: view, calculate, export, import_po
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.role_name = 'Manager' AND p.permission_name IN ('view_data','calculate','export','import_po');

-- Buyer: view, calculate, edit, export
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.role_name = 'Buyer' AND p.permission_name IN ('view_data','calculate','edit_data','export');

-- Viewer: view only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.role_name = 'Viewer' AND p.permission_name IN ('view_data');

-- Menus (Main)
INSERT INTO public.menus (menu_name, menu_code, menu_type, parent_id, sort_order) VALUES
  ('Data Control', 'data_control', 'Main', NULL, 1),
  ('SRR', 'srr', 'Main', NULL, 2),
  ('Admin', 'admin', 'Main', NULL, 4),
  ('Log', 'log', 'Main', NULL, 5);

-- Menus (Sub)
INSERT INTO public.menus (menu_name, menu_code, menu_type, parent_id, sort_order)
SELECT 'SRR DC ITEM', 'dc_item', 'Sub', id, 1 FROM public.menus WHERE menu_code = 'srr';
INSERT INTO public.menus (menu_name, menu_code, menu_type, parent_id, sort_order)
SELECT 'List Import PO', 'list_import_po', 'Sub', id, 2 FROM public.menus WHERE menu_code = 'srr';
INSERT INTO public.menus (menu_name, menu_code, menu_type, parent_id, sort_order)
SELECT 'User Management', 'user_management', 'Sub', id, 1 FROM public.menus WHERE menu_code = 'admin';

-- Admin: all menus
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
SELECT r.id, m.id, true FROM public.roles r CROSS JOIN public.menus m WHERE r.role_name = 'Admin';

-- Manager: all except admin menus
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
SELECT r.id, m.id, true FROM public.roles r, public.menus m
WHERE r.role_name = 'Manager' AND m.menu_code NOT IN ('admin','user_management');

-- Buyer: srr + sub-menus
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
SELECT r.id, m.id, true FROM public.roles r, public.menus m
WHERE r.role_name = 'Buyer' AND m.menu_code IN ('srr','dc_item','list_import_po');

-- Viewer: data_control, srr, dc_item
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
SELECT r.id, m.id, true FROM public.roles r, public.menus m
WHERE r.role_name = 'Viewer' AND m.menu_code IN ('data_control','srr','dc_item');
