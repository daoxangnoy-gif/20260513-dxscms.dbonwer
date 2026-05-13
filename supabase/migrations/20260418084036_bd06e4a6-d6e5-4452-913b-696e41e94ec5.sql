-- Add buying_status filter to Master RPC and bump returning rows
CREATE OR REPLACE FUNCTION public.get_range_store_master()
 RETURNS TABLE(sku_code text, main_barcode text, product_name_la text, product_name_en text, division_group text, division text, department text, sub_department text, class text, gm_buyer_code text, buyer_code text, product_owner text, product_bu text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT DISTINCT ON (dm.sku_code)
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class,
    dm.gm_buyer_code, dm.buyer_code, dm.product_owner, dm.product_bu
  FROM data_master dm
  WHERE dm.stock_unit_flag = 'Y'
    AND dm.sku_code IS NOT NULL
    AND (dm.buying_status IS NULL OR dm.buying_status <> 'Inactive')
  ORDER BY dm.sku_code, dm.created_at DESC;
$function$;

-- Same filter on status RPC
CREATE OR REPLACE FUNCTION public.get_range_store_status()
 RETURNS TABLE(sku_code text, standard_price numeric, list_price numeric, item_status text, item_type text, buying_status text, rank_sale text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  WITH master AS (
    SELECT DISTINCT ON (sku_code)
      sku_code, standard_price, list_price, item_status, item_type, buying_status
    FROM data_master 
    WHERE stock_unit_flag = 'Y' 
      AND sku_code IS NOT NULL
      AND (buying_status IS NULL OR buying_status <> 'Inactive')
    ORDER BY sku_code, created_at DESC
  ),
  rank_d AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IS NOT NULL
    ORDER BY item_id, created_at DESC
  )
  SELECT m.sku_code, m.standard_price, m.list_price,
    m.item_status, m.item_type, m.buying_status,
    COALESCE(r.final_rank, '') AS rank_sale
  FROM master m
  LEFT JOIN rank_d r ON r.item_id = m.sku_code;
$function$;

-- Bulk-clear function for range_store
CREATE OR REPLACE FUNCTION public.clear_range_store(p_skus text[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c integer;
BEGIN
  IF p_skus IS NULL OR array_length(p_skus, 1) IS NULL THEN
    DELETE FROM public.range_store;
  ELSE
    DELETE FROM public.range_store WHERE sku_code = ANY(p_skus);
  END IF;
  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c;
END;
$function$;