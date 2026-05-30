CREATE OR REPLACE FUNCTION public.get_po_cost_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  v AS (
    SELECT vendor_code, COUNT(*)::int AS n,
           MAX(supplier_currency) AS supplier_currency,
           MAX(vendor_name) AS vendor_name
    FROM public.po_cost_enriched
    WHERE vendor_code IS NOT NULL AND vendor_code <> ''
    GROUP BY vendor_code
  ),
  bp AS (SELECT main_barcode_pack AS v, COUNT(*)::int AS n FROM public.po_cost_enriched WHERE main_barcode_pack IS NOT NULL AND main_barcode_pack <> '' GROUP BY main_barcode_pack),
  bu AS (SELECT main_barcode_unit AS v, COUNT(*)::int AS n FROM public.po_cost_enriched WHERE main_barcode_unit IS NOT NULL AND main_barcode_unit <> '' GROUP BY main_barcode_unit),
  gm AS (SELECT gm_buyer_code AS v, COUNT(*)::int AS n FROM public.po_cost_enriched WHERE gm_buyer_code IS NOT NULL AND gm_buyer_code <> '' GROUP BY gm_buyer_code),
  hb AS (SELECT header_buyer_code AS v, COUNT(*)::int AS n FROM public.po_cost_enriched WHERE header_buyer_code IS NOT NULL AND header_buyer_code <> '' GROUP BY header_buyer_code),
  by_ AS (SELECT buyer_code AS v, COUNT(*)::int AS n FROM public.po_cost_enriched WHERE buyer_code IS NOT NULL AND buyer_code <> '' GROUP BY buyer_code)
  SELECT jsonb_build_object(
    'vendors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', v.vendor_code,
        'count', v.n,
        'label', concat_ws(' - ', NULLIF(v.supplier_currency, ''), v.vendor_code, NULLIF(v.vendor_name, ''))
      ) ORDER BY v.vendor_code) FROM v
    ), '[]'::jsonb),
    'main_barcode_pack', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', v, 'count', n) ORDER BY v) FROM bp), '[]'::jsonb),
    'main_barcode_unit', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', v, 'count', n) ORDER BY v) FROM bu), '[]'::jsonb),
    'gm_buyer_code', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', v, 'count', n) ORDER BY v) FROM gm), '[]'::jsonb),
    'header_buyer_code', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', v, 'count', n) ORDER BY v) FROM hb), '[]'::jsonb),
    'buyer_code', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', v, 'count', n) ORDER BY v) FROM by_), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_po_cost_filter_options() TO authenticated, anon;