-- Add Special Order sub-menu under SRR
DO $$
DECLARE
  srr_parent_id uuid;
  new_menu_id uuid;
BEGIN
  SELECT id INTO srr_parent_id FROM public.menus WHERE menu_code = 'srr' LIMIT 1;

  -- Insert special_order menu if not exists
  INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
  VALUES ('special_order', 'Special Order', 'sub', srr_parent_id, 99, true)
  ON CONFLICT (menu_code) DO UPDATE SET is_active = true, parent_id = EXCLUDED.parent_id
  RETURNING id INTO new_menu_id;

  IF new_menu_id IS NULL THEN
    SELECT id INTO new_menu_id FROM public.menus WHERE menu_code = 'special_order' LIMIT 1;
  END IF;

  -- Grant view permission to every role that already has access to 'srr'
  INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
  SELECT DISTINCT rmp.role_id, new_menu_id, true
  FROM public.role_menu_permissions rmp
  JOIN public.menus m ON m.id = rmp.menu_id
  WHERE m.menu_code = 'srr' AND rmp.can_view = true
  ON CONFLICT DO NOTHING;
END $$;