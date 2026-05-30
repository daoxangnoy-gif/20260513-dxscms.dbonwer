CREATE OR REPLACE FUNCTION public.get_srr_data_json(
  p_spc_names text[] DEFAULT NULL,
  p_order_days text[] DEFAULT NULL,
  p_vendor_codes text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_sub_classes text[] DEFAULT NULL,
  p_sku_codes text[] DEFAULT NULL,
  p_skip_default_filters boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '240s'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.get_srr_data(
    p_spc_names, p_order_days, p_vendor_codes, p_item_types,
    p_division_groups, p_divisions, p_departments, p_sub_departments,
    p_classes, p_sub_classes, p_sku_codes, p_skip_default_filters
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_srr_d2s_data_json(
  p_spc_names text[] DEFAULT NULL,
  p_order_days text[] DEFAULT NULL,
  p_vendor_codes text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL,
  p_division_groups text[] DEFAULT NULL,
  p_divisions text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_sub_departments text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_sub_classes text[] DEFAULT NULL,
  p_sku_codes text[] DEFAULT NULL,
  p_skip_default_filters boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '240s'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.get_srr_d2s_data(
    p_spc_names, p_order_days, p_vendor_codes, p_item_types,
    p_division_groups, p_divisions, p_departments, p_sub_departments,
    p_classes, p_sub_classes, p_sku_codes, p_skip_default_filters
  ) t;
$function$;