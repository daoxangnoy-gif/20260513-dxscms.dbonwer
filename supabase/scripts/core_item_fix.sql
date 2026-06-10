-- ============================================================
-- PATCH: รันต่อจาก core_item_setup.sql (ที่ fail ตอน step 5)
--   แก้: ต้อง DROP _oos_detail ก่อน เพราะเปลี่ยน return type (เพิ่ม ranking, core_item)
--   *** core_item / MV / oos_snapshot_rows สร้างเสร็จแล้วจาก step 1-4 — patch นี้ไม่แตะ ***
-- วิธีรัน: Supabase SQL Editor → วางทั้งไฟล์ → Run (เร็ว ไม่กี่วินาที)
-- ============================================================

-- 5) _oos_detail: DROP ก่อน แล้วสร้างใหม่ (เพิ่ม ranking, core_item)
DROP FUNCTION IF EXISTS public._oos_detail(text[],text[],text[],text[],text[],text[]);

CREATE FUNCTION public._oos_detail(
  p_spc text[] DEFAULT NULL, p_vendors text[] DEFAULT NULL, p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL, p_type_stores text[] DEFAULT NULL, p_stores text[] DEFAULT NULL
)
RETURNS TABLE (
  division text, department text, store_name text, type_store text, id_match text,
  sku text, barcode text, name_la text, vendor text, teadterm text,
  item_type text, buying text, rank_sale text, store_apply integer,
  stock_store numeric, stock_dc numeric, remark_stock text, remark_oos text,
  ranking text, core_item text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $function$
  SELECT division, department, store_name, type_store, id_match, sku, barcode, name_la,
         vendor, teadterm, item_type, buying, rank_sale, store_apply, stock_store, stock_dc,
         remark_stock, remark_oos, ranking, core_item
  FROM public.oos_detail_mv
  WHERE (p_spc         IS NULL OR cardinality(p_spc)=0         OR spc_name    = ANY(p_spc))
    AND (p_vendors     IS NULL OR cardinality(p_vendors)=0     OR vendor_code = ANY(p_vendors))
    AND (p_divisions   IS NULL OR cardinality(p_divisions)=0   OR division    = ANY(p_divisions))
    AND (p_departments IS NULL OR cardinality(p_departments)=0 OR department  = ANY(p_departments))
    AND (p_type_stores IS NULL OR cardinality(p_type_stores)=0 OR type_store  = ANY(p_type_stores))
    AND (p_stores      IS NULL OR cardinality(p_stores)=0      OR store_name  = ANY(p_stores));
$function$;
GRANT EXECUTE ON FUNCTION public._oos_detail(text[],text[],text[],text[],text[],text[]) TO anon, authenticated;

-- 6) save_oos_snapshot: เก็บ ranking, core_item ด้วย
CREATE OR REPLACE FUNCTION public.save_oos_snapshot(
  p_week text, p_filters jsonb DEFAULT '{}'::jsonb,
  p_spc text[] DEFAULT NULL, p_vendors text[] DEFAULT NULL, p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL, p_type_stores text[] DEFAULT NULL, p_stores text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '180s'
AS $function$
DECLARE v_id uuid; v_cnt integer;
BEGIN
  DELETE FROM public.oos_snapshots WHERE week_label = p_week;
  INSERT INTO public.oos_snapshots(week_label, filters, user_id)
  VALUES (p_week, COALESCE(p_filters,'{}'::jsonb), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.oos_snapshot_rows(
    snapshot_id, division, department, store_name, type_store, id_match,
    sku, barcode, name_la, vendor, teadterm, item_type, buying, rank_sale,
    store_apply, stock_store, stock_dc, remark_stock, remark_oos, ranking, core_item)
  SELECT v_id, division, department, store_name, type_store, id_match,
         sku, barcode, name_la, vendor, teadterm, item_type, buying, rank_sale,
         store_apply, stock_store, stock_dc, remark_stock, remark_oos, ranking, core_item
  FROM public._oos_detail(p_spc, p_vendors, p_divisions, p_departments, p_type_stores, p_stores);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE public.oos_snapshots SET total_rows = v_cnt WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'total_rows', v_cnt);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.save_oos_snapshot(text,jsonb,text[],text[],text[],text[],text[],text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_oos_snapshot(text,jsonb,text[],text[],text[],text[],text[],text[]) TO authenticated;
