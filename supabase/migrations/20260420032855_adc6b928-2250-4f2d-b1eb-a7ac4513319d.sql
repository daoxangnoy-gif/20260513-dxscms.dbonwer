-- Add Data Control sub-menus (one per data table) so admins can grant per-table permissions
DO $$
DECLARE
  v_parent_id uuid;
BEGIN
  SELECT id INTO v_parent_id FROM public.menus WHERE menu_code = 'data_control' LIMIT 1;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'data_control parent menu not found';
  END IF;

  -- Insert sub-menus (skip if exists)
  INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active) VALUES
    ('data_master',   'Data Master',    'Sub', v_parent_id, 1,  true),
    ('stock',         'Stock',          'Sub', v_parent_id, 2,  true),
    ('minmax',        'Min/Max',        'Sub', v_parent_id, 3,  true),
    ('po_cost',       'PO Cost',        'Sub', v_parent_id, 4,  true),
    ('on_order',      'On Order',       'Sub', v_parent_id, 5,  true),
    ('rank_sales',    'Rank Sales',     'Sub', v_parent_id, 6,  true),
    ('sales_by_week', 'Sales By Week',  'Sub', v_parent_id, 7,  true),
    ('vendor_master', 'Vendor Master',  'Sub', v_parent_id, 8,  true),
    ('store_type',    'Store Type',     'Sub', v_parent_id, 9,  true),
    ('range_store',   'Range Store',    'Sub', v_parent_id, 10, true)
  ON CONFLICT (menu_code) DO NOTHING;

  -- Normalize menu_type casing for special_order (was "sub")
  UPDATE public.menus SET menu_type = 'Sub' WHERE menu_code = 'special_order' AND menu_type <> 'Sub';
END $$;

-- Auto-grant Admin role full access to ALL menus (current + future)
DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM public.roles WHERE role_name = 'Admin' LIMIT 1;
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
    SELECT v_admin_id, m.id, true, true, true, true, true
    FROM public.menus m
    WHERE m.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.role_menu_permissions rmp
        WHERE rmp.role_id = v_admin_id AND rmp.menu_id = m.id
      );
  END IF;
END $$;