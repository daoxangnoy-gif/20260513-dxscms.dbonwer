CREATE OR REPLACE FUNCTION public.get_po_cost_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'vendors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', e.vendor_code,
        'label', concat_ws(' - ',
          NULLIF(e.supplier_currency, ''),
          e.vendor_code,
          NULLIF(e.vendor_name, '')
        )
      ) ORDER BY e.vendor_code)
      FROM (
        SELECT DISTINCT ON (vendor_code)
          vendor_code, supplier_currency, vendor_name
        FROM public.po_cost_enriched
        WHERE vendor_code IS NOT NULL AND vendor_code <> ''
        ORDER BY vendor_code, supplier_currency NULLS LAST
      ) e
    ), '[]'::jsonb),
    'main_barcode_pack', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT main_barcode_pack AS v FROM public.po_cost_enriched
        WHERE main_barcode_pack IS NOT NULL AND main_barcode_pack <> ''
      ) t
    ), '[]'::jsonb),
    'main_barcode_unit', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT main_barcode_unit AS v FROM public.po_cost_enriched
        WHERE main_barcode_unit IS NOT NULL AND main_barcode_unit <> ''
      ) t
    ), '[]'::jsonb),
    'gm_buyer_code', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT gm_buyer_code AS v FROM public.po_cost_enriched
        WHERE gm_buyer_code IS NOT NULL AND gm_buyer_code <> ''
      ) t
    ), '[]'::jsonb),
    'header_buyer_code', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT header_buyer_code AS v FROM public.po_cost_enriched
        WHERE header_buyer_code IS NOT NULL AND header_buyer_code <> ''
      ) t
    ), '[]'::jsonb),
    'buyer_code', COALESCE((
      SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT buyer_code AS v FROM public.po_cost_enriched
        WHERE buyer_code IS NOT NULL AND buyer_code <> ''
      ) t
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_po_cost_filter_options() TO authenticated, anon;