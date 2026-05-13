CREATE OR REPLACE FUNCTION public.get_srr_effective_vendors(
  p_item_types       text[] DEFAULT NULL,
  p_buying_statuses  text[] DEFAULT NULL,
  p_po_groups        text[] DEFAULT NULL,
  p_division_groups  text[] DEFAULT NULL,
  p_divisions        text[] DEFAULT NULL,
  p_departments      text[] DEFAULT NULL,
  p_sub_departments  text[] DEFAULT NULL,
  p_classes          text[] DEFAULT NULL,
  p_sub_classes      text[] DEFAULT NULL
)
RETURNS TABLE(vendor_code text, spc_name text, order_day text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH dm_filt AS (
    SELECT DISTINCT d.vendor_code
    FROM data_master d
    WHERE d.vendor_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND (p_item_types      IS NULL OR d.item_type      = ANY(p_item_types))
      AND (p_buying_statuses IS NULL OR d.buying_status  = ANY(p_buying_statuses))
      AND (p_po_groups       IS NULL OR d.po_group       = ANY(p_po_groups))
      AND (p_division_groups IS NULL OR d.division_group = ANY(p_division_groups))
      AND (p_divisions       IS NULL OR d.division       = ANY(p_divisions))
      AND (p_departments     IS NULL OR d.department     = ANY(p_departments))
      AND (p_sub_departments IS NULL OR d.sub_department = ANY(p_sub_departments))
      AND (p_classes         IS NULL OR d.class          = ANY(p_classes))
      AND (p_sub_classes     IS NULL OR d.sub_class      = ANY(p_sub_classes))
  )
  SELECT DISTINCT ON (vm.vendor_code)
    vm.vendor_code,
    COALESCE(vm.spc_name,'')  AS spc_name,
    COALESCE(vm.order_day,'') AS order_day
  FROM vendor_master vm
  WHERE vm.vendor_code IS NOT NULL
    AND vm.vendor_code IN (SELECT vendor_code FROM dm_filt)
  ORDER BY vm.vendor_code, vm.updated_at DESC;
$function$;