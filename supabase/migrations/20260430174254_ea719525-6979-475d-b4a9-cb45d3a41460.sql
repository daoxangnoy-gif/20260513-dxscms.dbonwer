-- Seed Order B2B menu under SRR
DO $$
DECLARE
  v_srr_id uuid;
  v_admin_role uuid;
  v_menu_id uuid;
BEGIN
  SELECT id INTO v_srr_id FROM public.menus WHERE menu_code = 'srr' LIMIT 1;
  SELECT id INTO v_admin_role FROM public.roles WHERE role_name = 'Admin' LIMIT 1;

  IF v_srr_id IS NOT NULL THEN
    INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
    VALUES ('order_b2b', 'Order B2B', 'Sub', v_srr_id, 99, true)
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.menus (menu_code, menu_name, menu_type, sort_order, is_active)
    VALUES ('order_b2b', 'Order B2B', 'Sub', 99, true)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO v_menu_id FROM public.menus WHERE menu_code = 'order_b2b' LIMIT 1;

  IF v_admin_role IS NOT NULL AND v_menu_id IS NOT NULL THEN
    INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_admin_role, v_menu_id, true, true, true, true, true)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;