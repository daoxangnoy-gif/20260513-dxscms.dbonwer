-- ลงทะเบียน 3 menu สำหรับสิทธิ์แยกต่อแท็บใน Order B2B internal
-- (Brand control / SCM Control / DC(KR) Control) → admin ตั้ง view/create/edit/delete/export/import ได้
-- เป็นลูกของ menu 'order_b2b_internal' ถ้ามี; ถ้าไม่มีจะเป็น orphan (ยังตั้งสิทธิ์ได้ในหมวด Other)
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
SELECT v.code, v.name, 'Sub',
       (SELECT id FROM public.menus WHERE menu_code = 'order_b2b_internal' LIMIT 1),
       v.ord, true
FROM (VALUES
  ('b2b_brand', 'B2B — Brand control', 1),
  ('b2b_scm',   'B2B — SCM Control',   2),
  ('b2b_dckr',  'B2B — DC(KR) Control', 3)
) AS v(code, name, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE menu_code = v.code);
