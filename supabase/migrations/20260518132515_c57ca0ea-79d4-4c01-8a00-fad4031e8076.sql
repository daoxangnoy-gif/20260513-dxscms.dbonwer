ALTER TABLE public.document_shipments
  ADD COLUMN IF NOT EXISTS origin_location text,
  ADD COLUMN IF NOT EXISTS destination_location text;

UPDATE public.document_shipments s
SET origin_location = m.location_name
FROM public.document_movements m
WHERE m.shipment_id = s.id
  AND m.action = 'origin_save'
  AND (s.origin_location IS NULL OR btrim(s.origin_location) = '');

UPDATE public.document_shipments s
SET destination_location = s.receiver_name
WHERE (s.destination_location IS NULL OR btrim(s.destination_location) = '')
  AND s.receiver_name IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.document_locations l
    WHERE l.name = s.receiver_name
  );