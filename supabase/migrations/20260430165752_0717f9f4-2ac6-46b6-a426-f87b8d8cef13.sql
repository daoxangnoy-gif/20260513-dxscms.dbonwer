-- Customers table
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_code text NOT NULL UNIQUE,
  name text,
  country text,
  district text,
  email text,
  gender text,
  phone text,
  state text,
  street text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to customers"
  ON public.customers FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_customers_customer_code ON public.customers (customer_code);

-- updated_at trigger
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Customer sub-menu under Data Control
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
SELECT 'customers', 'Customer', 'Sub',
       (SELECT id FROM public.menus WHERE menu_code = 'data_control' LIMIT 1),
       11, true
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE menu_code = 'customers');

-- Grant view access to all existing roles (so Admin sees it immediately)
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, m.id, true, true, true, true, true
FROM public.roles r
CROSS JOIN public.menus m
WHERE m.menu_code = 'customers'
  AND r.role_name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_menu_permissions rmp
    WHERE rmp.role_id = r.id AND rmp.menu_id = m.id
  );