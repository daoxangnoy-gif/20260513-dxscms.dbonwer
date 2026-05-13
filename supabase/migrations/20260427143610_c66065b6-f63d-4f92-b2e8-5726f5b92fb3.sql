-- ========== ลบ Y: UPDATE apply_yn='N', min_display=0 (เฉพาะ row ที่ apply_yn='Y') ==========
-- เก็บ row ไว้เพื่อรักษา unit_picking_super / unit_picking_mart
CREATE OR REPLACE FUNCTION public.clear_range_store(
  p_skus text[] DEFAULT NULL,
  p_stores text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.range_store
  SET apply_yn = 'N',
      min_display = 0,
      updated_at = now()
  WHERE apply_yn = 'Y'
    AND (p_skus   IS NULL OR sku_code   = ANY(p_skus))
    AND (p_stores IS NULL OR store_name = ANY(p_stores));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ========== ลบ Min: UPDATE min_display=0 (เฉพาะ row ที่ min_display>0, ไม่สน Y/N) ==========
CREATE OR REPLACE FUNCTION public.clear_range_min(
  p_skus text[] DEFAULT NULL,
  p_stores text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.range_store
  SET min_display = 0,
      updated_at = now()
  WHERE min_display > 0
    AND (p_skus   IS NULL OR sku_code   = ANY(p_skus))
    AND (p_stores IS NULL OR store_name = ANY(p_stores));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ========== Index ช่วย UPDATE ให้เร็วขึ้น ==========
CREATE INDEX IF NOT EXISTS idx_range_store_apply_yn 
  ON public.range_store(apply_yn) WHERE apply_yn = 'Y';

CREATE INDEX IF NOT EXISTS idx_range_store_min_display 
  ON public.range_store(min_display) WHERE min_display > 0;