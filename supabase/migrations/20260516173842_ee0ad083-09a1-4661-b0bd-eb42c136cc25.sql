-- Create list_po table
CREATE TABLE public.list_po (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_reference TEXT NOT NULL UNIQUE,
  partner TEXT,
  source TEXT,
  document TEXT,
  status TEXT,
  total NUMERIC,
  currency_name TEXT,
  delivery_to1 TEXT,
  delivery_to2 TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_list_po_order_reference ON public.list_po(order_reference);

ALTER TABLE public.list_po ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to list_po"
ON public.list_po FOR ALL
USING (true) WITH CHECK (true);

CREATE TRIGGER update_list_po_updated_at
BEFORE UPDATE ON public.list_po
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add menu entry under data_control
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
SELECT 'list_po', 'List PO', 'Sub', id, 100, true
FROM public.menus WHERE menu_code = 'data_control'
ON CONFLICT DO NOTHING;