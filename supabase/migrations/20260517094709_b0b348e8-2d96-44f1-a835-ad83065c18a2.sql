
-- 1) Add can_import column to permissions tables
ALTER TABLE public.role_menu_permissions ADD COLUMN IF NOT EXISTS can_import boolean NOT NULL DEFAULT false;
ALTER TABLE public.tab_permissions ADD COLUMN IF NOT EXISTS can_import boolean NOT NULL DEFAULT false;

-- 2) Fix orphan: srr_job_assign should belong to "srr" Main
UPDATE public.menus
SET parent_id = (SELECT id FROM public.menus WHERE menu_code = 'srr' AND menu_type = 'Main')
WHERE menu_code = 'srr_job_assign' AND parent_id IS NULL;

-- 3) Insert missing Sub menus referenced by the app
WITH srr AS (SELECT id FROM public.menus WHERE menu_code = 'srr' AND menu_type = 'Main'),
     report AS (SELECT id FROM public.menus WHERE menu_code = 'report' AND menu_type = 'Main'),
     conf AS (SELECT id FROM public.menus WHERE menu_code = 'config' AND menu_type = 'Main')
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active) VALUES
  ('srr_send_docs', 'ส่งเอกสาร',   'Sub', (SELECT id FROM srr),    50, true),
  ('sar',           'SAR',         'Sub', (SELECT id FROM srr),    60, true),
  ('srr_help',      'SRR Help',    'Sub', (SELECT id FROM srr),    99, true),
  ('report_po',     'Report PO',   'Sub', (SELECT id FROM report), 10, true),
  ('report_oos',    'Report OOS',  'Sub', (SELECT id FROM report), 20, true),
  ('report_doh',    'Report DOH',  'Sub', (SELECT id FROM report), 30, true),
  ('config_filter', 'Config Filter','Sub',(SELECT id FROM conf),   20, true)
ON CONFLICT DO NOTHING;

-- Make sure config_filter isn't duplicate by code
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
SELECT 'config_filter','Config Filter','Sub',(SELECT id FROM public.menus WHERE menu_code='config' AND menu_type='Main'),20,true
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE menu_code='config_filter');

-- 4) Update get_user_permissions RPC to include can_import in menu_crud
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS TABLE(role_name text, permissions text[], visible_menus text[], menu_crud jsonb, column_perms jsonb, spc_name text, vendor_code text, is_active boolean)
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
          'view',   rmp2.can_view,
          'create', rmp2.can_create,
          'edit',   rmp2.can_edit,
          'delete', rmp2.can_delete,
          'export', rmp2.can_export,
          'import', rmp2.can_import
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
