-- 1. Add new permission
INSERT INTO public.permissions (permission_name, description)
VALUES ('delete_minmax', 'Delete Min/Max rows by filter (Report tab)')
ON CONFLICT (permission_name) DO NOTHING;

-- 2. Grant to Admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.role_name = 'Admin' AND p.permission_name = 'delete_minmax'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. RPC for filtered delete
CREATE OR REPLACE FUNCTION public.delete_minmax_by_filter(
  p_stores text[] DEFAULT NULL,
  p_type_stores text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_buying_statuses text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
  v_has_filter boolean;
BEGIN
  -- Permission check
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'delete_minmax') THEN
    RAISE EXCEPTION 'permission denied: delete_minmax required';
  END IF;

  v_has_filter := (p_stores IS NOT NULL AND array_length(p_stores,1) > 0)
    OR (p_type_stores IS NOT NULL AND array_length(p_type_stores,1) > 0)
    OR (p_item_types IS NOT NULL AND array_length(p_item_types,1) > 0)
    OR (p_buying_statuses IS NOT NULL AND array_length(p_buying_statuses,1) > 0)
    OR (p_divisions IS NOT NULL AND array_length(p_divisions,1) > 0)
    OR (p_departments IS NOT NULL AND array_length(p_departments,1) > 0)
    OR (p_sub_departments IS NOT NULL AND array_length(p_sub_departments,1) > 0)
    OR (p_classes IS NOT NULL AND array_length(p_classes,1) > 0);

  IF NOT v_has_filter THEN
    RAISE EXCEPTION 'at least one filter is required to delete';
  END IF;

  WITH dm AS (
    SELECT DISTINCT ON (sku_code)
      sku_code,
      COALESCE(division,'') AS division,
      COALESCE(department,'') AS department,
      COALESCE(sub_department,'') AS sub_department,
      COALESCE(class,'') AS class,
      COALESCE(item_type,'') AS item_type,
      COALESCE(buying_status,'') AS buying_status
    FROM public.data_master
    WHERE sku_code IS NOT NULL
    ORDER BY sku_code, updated_at DESC NULLS LAST
  ),
  target AS (
    SELECT m.id
    FROM public.minmax m
    LEFT JOIN dm d ON d.sku_code = m.item_id
    WHERE (p_stores IS NULL OR m.store_name = ANY(p_stores))
      AND (p_type_stores IS NULL OR m.type_store = ANY(p_type_stores))
      AND (p_item_types IS NULL OR d.item_type = ANY(p_item_types))
      AND (p_buying_statuses IS NULL OR d.buying_status = ANY(p_buying_statuses))
      AND (p_divisions IS NULL OR d.division = ANY(p_divisions))
      AND (p_departments IS NULL OR d.department = ANY(p_departments))
      AND (p_sub_departments IS NULL OR d.sub_department = ANY(p_sub_departments))
      AND (p_classes IS NULL OR d.class = ANY(p_classes))
  ),
  del AS (
    DELETE FROM public.minmax WHERE id IN (SELECT id FROM target)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_minmax_by_filter(text[],text[],text[],text[],text[],text[],text[],text[]) TO authenticated;
