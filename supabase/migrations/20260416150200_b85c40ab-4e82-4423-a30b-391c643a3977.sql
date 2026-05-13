
-- Add missing SRR sub-menus
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
VALUES 
  ('direct_item', 'SRR DIRECT ITEM', 'Sub', '8936a65f-3ac5-4c6a-a148-1d9457cd0b92', 2, true),
  ('list_import_po_dc', 'List Import PO (DC)', 'Sub', '8936a65f-3ac5-4c6a-a148-1d9457cd0b92', 3, true),
  ('list_import_po_d2s', 'List Import PO (D2S)', 'Sub', '8936a65f-3ac5-4c6a-a148-1d9457cd0b92', 4, true);

-- Update old list_import_po to inactive since it's replaced by DC/D2S
UPDATE public.menus SET is_active = false WHERE menu_code = 'list_import_po';

-- Grant view access to all roles for the new menus
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view)
SELECT r.id, m.id, true
FROM public.roles r
CROSS JOIN public.menus m
WHERE m.menu_code IN ('direct_item', 'list_import_po_dc', 'list_import_po_d2s')
ON CONFLICT DO NOTHING;
