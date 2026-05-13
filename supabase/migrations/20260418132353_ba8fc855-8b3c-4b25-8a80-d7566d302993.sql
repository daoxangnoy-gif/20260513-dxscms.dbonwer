-- RPC: ดึง list Store + Type Store มาให้ผู้ใช้เลือกก่อน Prepare (เร็ว)
CREATE OR REPLACE FUNCTION public.get_range_store_lists()
 RETURNS TABLE(store_name text, type_store text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT store_name, COALESCE(type_store, '') AS type_store
  FROM public.store_type
  WHERE store_name IS NOT NULL
    AND store_name <> ''
    AND (type_store IS NULL OR type_store <> 'DC')
  ORDER BY store_name;
$function$;

-- RPC: Filter-first prepare — ดึงจาก MV แต่ filter jsonb keys ให้เหลือเฉพาะ store ที่เลือก
-- ทำให้ payload เล็กลงมากเมื่อเลือกไม่กี่ store
CREATE OR REPLACE FUNCTION public.get_mv_range_store_filtered(
  p_avg_stores text[] DEFAULT NULL,
  p_range_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL
)
 RETURNS TABLE(
   sku_code text, main_barcode text, product_name_la text, product_name_en text,
   unit_of_measure text, packing_size_qty numeric, standard_price numeric, list_price numeric,
   item_status text, item_type text, buying_status text,
   division_group text, division text, department text, sub_department text, class text,
   gm_buyer_code text, buyer_code text, product_owner text, product_bu text,
   barcode_pack text, pack_qty numeric, barcode_box text, box_qty numeric,
   rank_sale text,
   avg_jmart numeric, avg_kokkok numeric, avg_kokkok_fc numeric, avg_udee numeric,
   avg_per_store jsonb, range_data jsonb
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_avg_stores text[];
  v_range_stores text[];
BEGIN
  -- ถ้าระบุ type_stores → แปลงเป็น list store ที่อยู่ใน type_stores นั้น (ใช้กับทั้ง avg และ range ถ้าไม่ได้ระบุแยก)
  IF p_type_stores IS NOT NULL AND array_length(p_type_stores, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT store_name) INTO v_avg_stores
    FROM public.store_type
    WHERE type_store = ANY(p_type_stores) AND store_name IS NOT NULL;
    v_range_stores := v_avg_stores;
  END IF;

  -- ถ้าระบุ p_avg_stores ตรง ๆ → ใช้อันนั้น (override type_stores)
  IF p_avg_stores IS NOT NULL AND array_length(p_avg_stores, 1) > 0 THEN
    v_avg_stores := p_avg_stores;
  END IF;
  IF p_range_stores IS NOT NULL AND array_length(p_range_stores, 1) > 0 THEN
    v_range_stores := p_range_stores;
  END IF;

  RETURN QUERY
  SELECT
    mv.sku_code, mv.main_barcode, mv.product_name_la, mv.product_name_en,
    mv.unit_of_measure, mv.packing_size_qty, mv.standard_price, mv.list_price,
    mv.item_status, mv.item_type, mv.buying_status,
    mv.division_group, mv.division, mv.department, mv.sub_department, mv.class,
    mv.gm_buyer_code, mv.buyer_code, mv.product_owner, mv.product_bu,
    mv.barcode_pack, mv.pack_qty, mv.barcode_box, mv.box_qty,
    mv.rank_sale,
    mv.avg_jmart, mv.avg_kokkok, mv.avg_kokkok_fc, mv.avg_udee,
    -- Filter avg_per_store keys
    CASE
      WHEN v_avg_stores IS NULL THEN mv.avg_per_store
      ELSE COALESCE(
        (SELECT jsonb_object_agg(k, v)
         FROM jsonb_each(mv.avg_per_store)
         WHERE k = ANY(v_avg_stores)),
        '{}'::jsonb
      )
    END AS avg_per_store,
    -- Filter range_data keys
    CASE
      WHEN v_range_stores IS NULL THEN mv.range_data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(k, v)
         FROM jsonb_each(mv.range_data)
         WHERE k = ANY(v_range_stores)),
        '{}'::jsonb
      )
    END AS range_data
  FROM public.mv_range_store mv;
END;
$function$;