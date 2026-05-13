-- เพิ่ม sub-menu "List Import PO (Special)" ภายใต้ SRR
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
VALUES (
  'list_import_po_special',
  'List Import PO (Special)',
  'Sub',
  '8936a65f-3ac5-4c6a-a148-1d9457cd0b92',
  5,
  true
)
ON CONFLICT (menu_code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  parent_id = EXCLUDED.parent_id,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- ให้สิทธิ์ทุก Role ที่มีสิทธิ์เห็น special_order อยู่แล้ว (ใช้สิทธิ์เดียวกัน)
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT
  rmp.role_id,
  (SELECT id FROM public.menus WHERE menu_code = 'list_import_po_special'),
  rmp.can_view,
  rmp.can_create,
  rmp.can_edit,
  rmp.can_delete,
  rmp.can_export
FROM public.role_menu_permissions rmp
JOIN public.menus m ON m.id = rmp.menu_id
WHERE m.menu_code = 'special_order'
ON CONFLICT DO NOTHING;