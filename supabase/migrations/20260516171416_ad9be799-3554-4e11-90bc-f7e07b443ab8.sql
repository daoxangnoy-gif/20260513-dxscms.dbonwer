ALTER TABLE public.document_shipments
ADD COLUMN origin_scanned_at timestamptz,
ADD COLUMN destination_scanned_at timestamptz;