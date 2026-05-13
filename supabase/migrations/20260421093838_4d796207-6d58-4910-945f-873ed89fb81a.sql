CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(
  p_spc_names text[] DEFAULT NULL::text[],
  p_order_days text[] DEFAULT NULL::text[],
  p_vendor_codes text[] DEFAULT NULL::text[],
  p_item_types text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  sku_code text, main_barcode text, product_name_la text, product_name_en text, unit_of_measure text,
  vendor_code text, vendor_display_name text, vendor_current_status text,
  spc_name text, order_day text, delivery_day text, trade_term text,
  leadtime numeric, order_cycle numeric, supplier_currency text,
  item_type text, buying_status text, po_group text,
  division_group text, division text, department text, sub_department text, class text, sub_class text,
  rank_sales text, moq numeric, po_cost numeric, po_cost_unit numeric,
  store_name text, type_store text,
  min_store numeric, max_store numeric,
  stock_store numeric, stock_dc numeric,
  avg_sales_store numeric, on_order_store numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH vm AS (
    SELECT DISTINCT ON (vendor_code)
      vendor_code, spc_name, order_day, delivery_day, trade_term,
      leadtime, order_cycle, supplier_currency
    FROM vendor_master
    WHERE vendor_code IS NOT NULL
      AND (trade_term IS NULL OR trade_term <> 'Consignment')
      AND (p_spc_names IS NULL OR spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR order_day = ANY(p_order_days))
      AND (p_vendor_codes IS NULL OR vendor_code = ANY(p_vendor_codes))
    ORDER BY vendor_code, updated_at DESC
  ),
  dm AS (
    SELECT DISTINCT ON (d.sku_code)
      d.sku_code, d.main_barcode, d.product_name_la, d.product_name_en, d.unit_of_measure,
      d.vendor_code, d.vendor_display_name, d.vendor_current_status,
      d.item_type, d.buying_status, d.po_group,
      d.division_group, d.division, d.department, d.sub_department, d.class, d.sub_class
    FROM data_master d
    JOIN vm ON vm.vendor_code = d.vendor_code
    WHERE d.sku_code IS NOT NULL
      AND d.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND (d.buying_status IS NULL OR d.buying_status <> 'Inactive')
      AND d.stock_unit_flag = 'Y'
      AND d.packing_size_qty = 1
      AND (p_item_types IS NULL OR d.item_type = ANY(p_item_types))
    ORDER BY d.sku_code, d.updated_at DESC
  ),
  sku_set AS (SELECT sku_code FROM dm),
  rs AS (
    SELECT DISTINCT ON (item_id) item_id, final_rank
    FROM rank_sales WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  pc AS (
    SELECT DISTINCT ON (item_id) item_id, moq, po_cost, po_cost_unit
    FROM po_cost WHERE item_id IN (SELECT sku_code FROM sku_set)
    ORDER BY item_id, updated_at DESC
  ),
  mm AS (
    SELECT item_id, store_name, type_store, min_val, max_val
    FROM minmax
    WHERE item_id IN (SELECT sku_code FROM sku_set)
      AND store_name IS NOT NULL
      AND (type_store IS NULL OR type_store <> 'Kokkok-Fc')
  ),
  st_store AS (
    SELECT item_id, type_store AS store_name, SUM(COALESCE(quantity,0)) AS stock_store
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) GROUP BY item_id, type_store
  ),
  st_dc AS (
    SELECT item_id, SUM(CASE WHEN type_store='DC' THEN COALESCE(quantity,0) END) AS stock_dc
    FROM stock WHERE item_id IN (SELECT sku_code FROM sku_set) GROUP BY item_id
  ),
  sw AS (
    SELECT item_id, store_name, type_store, AVG(avg_day) AS avg_sales_store
    FROM sales_by_week
    WHERE item_id IN (SELECT sku_code FROM sku_set)
      AND store_name IS NOT NULL
      AND (type_store IS NULL OR type_store <> 'Kokkok-Fc')
    GROUP BY item_id, store_name, type_store
  ),
  oo AS (
    SELECT item_id, store_name, SUM(COALESCE(po_qty,0)) AS on_order_store
    FROM on_order WHERE item_id IN (SELECT sku_code FROM sku_set) AND store_name IS NOT NULL
    GROUP BY item_id, store_name
  ),
  combos AS (
    SELECT DISTINCT item_id, store_name, type_store FROM mm
    UNION
    SELECT DISTINCT item_id, store_name, type_store FROM sw
  )
  SELECT
    dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en, dm.unit_of_measure,
    dm.vendor_code, dm.vendor_display_name, dm.vendor_current_status,
    vm.spc_name, vm.order_day, vm.delivery_day, vm.trade_term,
    vm.leadtime, vm.order_cycle, vm.supplier_currency,
    dm.item_type, dm.buying_status, dm.po_group,
    dm.division_group, dm.division, dm.department, dm.sub_department, dm.class, dm.sub_class,
    rs.final_rank AS rank_sales,
    pc.moq, pc.po_cost, pc.po_cost_unit,
    c.store_name, c.type_store,
    mm.min_val AS min_store, mm.max_val AS max_store,
    sts.stock_store, std.stock_dc,
    sw.avg_sales_store,
    oo.on_order_store
  FROM dm
  JOIN vm ON vm.vendor_code = dm.vendor_code
  JOIN combos c ON c.item_id = dm.sku_code
  LEFT JOIN rs ON rs.item_id = dm.sku_code
  LEFT JOIN pc ON pc.item_id = dm.sku_code
  LEFT JOIN mm ON mm.item_id = dm.sku_code AND mm.store_name = c.store_name
  LEFT JOIN st_store sts ON sts.item_id = dm.sku_code AND sts.store_name = c.type_store
  LEFT JOIN st_dc std ON std.item_id = dm.sku_code
  LEFT JOIN sw ON sw.item_id = dm.sku_code AND sw.store_name = c.store_name
  LEFT JOIN oo ON oo.item_id = dm.sku_code AND oo.store_name = c.store_name;
$function$;