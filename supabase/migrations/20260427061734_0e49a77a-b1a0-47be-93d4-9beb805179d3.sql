-- Allow multiple Read & Cal batches per (date, spc, vendor) by dropping the
-- overly-strict unique constraint. Batches are now distinguished by created_at minute.
ALTER TABLE public.srr_snapshots
  DROP CONSTRAINT IF EXISTS srr_snapshots_date_key_spc_name_vendor_code_key;

-- Helpful index for the common batch lookup pattern.
CREATE INDEX IF NOT EXISTS idx_srr_snapshots_date_created
  ON public.srr_snapshots (date_key, created_at DESC);