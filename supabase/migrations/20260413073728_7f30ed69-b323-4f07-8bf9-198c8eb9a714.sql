ALTER TABLE public.sales_by_week DROP COLUMN IF EXISTS week_data;
ALTER TABLE public.sales_by_week ADD COLUMN IF NOT EXISTS id18 text;
ALTER TABLE public.sales_by_week ADD COLUMN IF NOT EXISTS avg_day numeric;