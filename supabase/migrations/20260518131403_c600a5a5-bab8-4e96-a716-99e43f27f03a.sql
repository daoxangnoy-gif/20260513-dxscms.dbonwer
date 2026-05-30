ALTER TABLE public.document_movements
  ADD COLUMN IF NOT EXISTS depositor_name text,
  ADD COLUMN IF NOT EXISTS receiver_name text;