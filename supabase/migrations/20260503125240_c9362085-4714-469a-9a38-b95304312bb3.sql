ALTER TABLE public.vendor_master 
ADD COLUMN IF NOT EXISTS purchase_agreement_vat text,
ADD COLUMN IF NOT EXISTS vat_percent numeric;