-- Config Column Export feature
CREATE TABLE public.export_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  target_menu text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX export_templates_active_per_menu
  ON public.export_templates (target_menu) WHERE is_active = true;

CREATE INDEX export_templates_target_menu_idx
  ON public.export_templates (target_menu);

ALTER TABLE public.export_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_export_templates" ON public.export_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_export_templates" ON public.export_templates
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update_export_templates" ON public.export_templates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_export_templates" ON public.export_templates
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_export_templates_updated_at
  BEFORE UPDATE ON public.export_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed sidebar menus: Main "Config" + sub "Config Column Export"
INSERT INTO public.menus (menu_code, menu_name, menu_type, sort_order, is_active)
VALUES ('config', 'Config', 'Main', 95, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.menus (menu_code, menu_name, menu_type, sort_order, is_active, parent_id)
SELECT 'config_column_export', 'Config Column Export', 'Sub', 1, true, m.id
FROM public.menus m WHERE m.menu_code = 'config'
ON CONFLICT DO NOTHING;

-- Grant Admin role view/edit on the new menu
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, m.id, true, true, true, true, true
FROM public.roles r CROSS JOIN public.menus m
WHERE r.role_name = 'Admin' AND m.menu_code IN ('config', 'config_column_export')
ON CONFLICT DO NOTHING;

-- Seed a default Active template for SRR DC PO based on user's spec image
INSERT INTO public.export_templates (name, target_menu, is_active, columns)
VALUES (
  'Standard PO (Default)',
  'srr_dc_po',
  true,
  '[
    {"header":"partner_id","source":null,"condition":{"type":"srr_field","field":"vendor_code","scope":"first_row"}},
    {"header":"Picking Type / Database ID","source":null,"condition":{"type":"conditional","if_field":"type_store","if_equals":"DC","then_value":"2540","else_value":"__ship_to__","scope":"first_row"}},
    {"header":"Inter Transfer","source":null,"condition":{"type":"conditional","if_field":"type_store","if_equals":"DC","then_value":"","else_value":"true","scope":"first_row"}},
    {"header":"Products to Purchase/barcode","source":{"table":"srr_row","field":"main_barcode"},"condition":{"type":"all_row"}},
    {"header":"Products to Purchase/Product","source":{"table":"srr_row","field":"main_barcode"},"condition":{"type":"all_row"}},
    {"header":"Product name","source":{"table":"srr_row","field":"product_name_la"},"condition":{"type":"all_row"}},
    {"header":"Products to Purchase/UoM","source":{"table":"srr_row","field":"unit_of_measure"},"condition":{"type":"all_row"}},
    {"header":"Products to Purchase/Exclude In Package","source":null,"condition":{"type":"constant","value":"True","scope":"all_row"}},
    {"header":"Products to Purchase/Quantity","source":{"table":"srr_row","field":"final_suggest_qty"},"condition":{"type":"all_row"}},
    {"header":"Products to Purchase/Unit Price","source":{"table":"srr_row","field":"po_cost_unit"},"condition":{"type":"all_row"}},
    {"header":"assigned_to","source":null,"condition":{"type":"constant","value":"Spc manager","scope":"first_row"}},
    {"header":"description","source":null,"condition":{"type":"constant","value":"","scope":"first_row"}}
  ]'::jsonb
);