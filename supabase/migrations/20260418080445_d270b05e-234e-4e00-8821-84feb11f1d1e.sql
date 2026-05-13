-- Create range_store table for Range Store menu
CREATE TABLE public.range_store (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code TEXT NOT NULL,
  store_name TEXT NOT NULL,
  apply_yn TEXT NOT NULL DEFAULT 'N',
  min_display NUMERIC DEFAULT 0,
  unit_picking_super NUMERIC,
  unit_picking_mart NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sku_code, store_name)
);

-- Indexes for fast lookup
CREATE INDEX idx_range_store_sku ON public.range_store(sku_code);
CREATE INDEX idx_range_store_store ON public.range_store(store_name);
CREATE INDEX idx_range_store_apply ON public.range_store(apply_yn) WHERE apply_yn = 'Y';

-- Enable RLS
ALTER TABLE public.range_store ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read/write (consistent with other data tables)
CREATE POLICY "authenticated_read_range_store"
ON public.range_store FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "authenticated_insert_range_store"
ON public.range_store FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_update_range_store"
ON public.range_store FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "authenticated_delete_range_store"
ON public.range_store FOR DELETE
TO authenticated
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_range_store_updated_at
BEFORE UPDATE ON public.range_store
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();