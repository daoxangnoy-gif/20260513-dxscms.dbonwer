-- แก้ delete-scope bug: ตอน Save Doc แบบ filter Type Store
-- เดิม frontend คำนวณรายชื่อสาขาจาก filterOpts (อาจไม่ครบ) แล้วส่งให้ delete_minmax_by_stores
-- → สาขาที่หลุดจาก list ไม่ถูกลบ → minmax สะสมค้าง (table 116k แต่ save แค่ 68k)
-- ใหม่: ลบด้วย type_store ตรงๆ ใน DB → ครอบคลุมทุกสาขาของ type นั้นเสมอ

CREATE OR REPLACE FUNCTION public.delete_minmax_by_type_stores(p_type_stores text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_type_stores IS NULL OR array_length(p_type_stores, 1) IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.minmax WHERE type_store = ANY(p_type_stores);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_minmax_by_type_stores(text[]) TO anon, authenticated;
