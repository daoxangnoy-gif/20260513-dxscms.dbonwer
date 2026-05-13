ALTER TABLE public.on_order ADD COLUMN IF NOT EXISTS last_po_date date;
ALTER TABLE public.on_order ADD COLUMN IF NOT EXISTS po_number text;
CREATE INDEX IF NOT EXISTS idx_on_order_last_po_date ON public.on_order(last_po_date);