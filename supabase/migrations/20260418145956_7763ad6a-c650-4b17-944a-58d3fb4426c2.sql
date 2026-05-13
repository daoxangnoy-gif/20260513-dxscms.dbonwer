-- handle_new_user: signups default to is_active = false, NO role assigned
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin_role_id UUID;
  _user_count INT;
BEGIN
  -- Always create profile. First user ever → active + Admin. Others → inactive, no role.
  SELECT COUNT(*) INTO _user_count FROM public.user_roles;

  IF _user_count = 0 THEN
    INSERT INTO public.profiles (user_id, email, full_name, is_active)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), true);

    SELECT id INTO _admin_role_id FROM public.roles WHERE role_name = 'Admin';
    IF _admin_role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id) VALUES (NEW.id, _admin_role_id);
    END IF;
  ELSE
    -- Self-signup: inactive, no role until admin approves and assigns
    INSERT INTO public.profiles (user_id, email, full_name, is_active)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), false);
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Add phone + department to profiles for the pending-approval form
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS department text;

-- Update get_user_permissions to also return CRUD permissions per menu and is_active
DROP FUNCTION IF EXISTS public.get_user_permissions(uuid);

CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS TABLE(
  role_name text,
  permissions text[],
  visible_menus text[],
  menu_crud jsonb,
  column_perms jsonb,
  spc_name text,
  vendor_code text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    r.role_name,
    ARRAY_AGG(DISTINCT p.permission_name) FILTER (WHERE p.permission_name IS NOT NULL),
    ARRAY_AGG(DISTINCT m.menu_code) FILTER (WHERE rmp.can_view = true),
    COALESCE(
      (SELECT jsonb_object_agg(m2.menu_code, jsonb_build_object(
          'view', rmp2.can_view,
          'create', rmp2.can_create,
          'edit', rmp2.can_edit,
          'delete', rmp2.can_delete,
          'export', rmp2.can_export
        ))
       FROM public.role_menu_permissions rmp2
       JOIN public.menus m2 ON m2.id = rmp2.menu_id AND m2.is_active = true
       WHERE rmp2.role_id = ur.role_id),
      '{}'::jsonb
    ) AS menu_crud,
    COALESCE(
      (SELECT jsonb_object_agg(cp.menu_code || '::' || cp.column_key, cp.access)
       FROM public.column_permissions cp
       WHERE cp.role_id = ur.role_id),
      '{}'::jsonb
    ) AS column_perms,
    prof.spc_name,
    prof.vendor_code,
    COALESCE(prof.is_active, false) AS is_active
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  LEFT JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  LEFT JOIN public.permissions p ON p.id = rp.permission_id
  LEFT JOIN public.role_menu_permissions rmp ON rmp.role_id = ur.role_id
  LEFT JOIN public.menus m ON m.id = rmp.menu_id AND m.is_active = true
  LEFT JOIN public.profiles prof ON prof.user_id = _user_id
  WHERE ur.user_id = _user_id
  GROUP BY r.role_name, ur.role_id, prof.spc_name, prof.vendor_code, prof.is_active
  LIMIT 1;

  -- If no role yet, still return profile info so client can detect pending state
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      NULL::text,
      ARRAY[]::text[],
      ARRAY[]::text[],
      '{}'::jsonb,
      '{}'::jsonb,
      prof.spc_name,
      prof.vendor_code,
      COALESCE(prof.is_active, false)
    FROM public.profiles prof
    WHERE prof.user_id = _user_id
    LIMIT 1;
  END IF;
END;
$function$;