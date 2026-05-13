CREATE OR REPLACE FUNCTION public.get_srr_pre_filter_options()
RETURNS TABLE(
  item_types text[],
  buying_statuses text[],
  po_groups text[],
  stores jsonb,
  type_stores text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT ARRAY(SELECT DISTINCT item_type FROM public.data_master WHERE item_type IS NOT NULL AND item_type <> '' ORDER BY item_type)),
    (SELECT ARRAY(SELECT DISTINCT buying_status FROM public.data_master WHERE buying_status IS NOT NULL AND buying_status <> '' ORDER BY buying_status)),
    (SELECT ARRAY(SELECT DISTINCT po_group FROM public.data_master WHERE po_group IS NOT NULL AND po_group <> '' ORDER BY po_group)),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('store_name', store_name, 'type_store', type_store) ORDER BY type_store, store_name), '[]'::jsonb)
       FROM (SELECT DISTINCT store_name, type_store FROM public.store_type WHERE store_name IS NOT NULL AND type_store IS NOT NULL AND type_store <> 'Kokkok-Fc') s),
    (SELECT ARRAY(SELECT DISTINCT type_store FROM public.store_type WHERE type_store IS NOT NULL AND type_store <> '' AND type_store <> 'Kokkok-Fc' ORDER BY type_store))
$$;

GRANT EXECUTE ON FUNCTION public.get_srr_pre_filter_options() TO authenticated, anon;