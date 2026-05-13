
CREATE OR REPLACE FUNCTION public.get_srr_d2s_data(
  p_vendor_codes text[] DEFAULT NULL,
  p_spc_names text[] DEFAULT NULL,
  p_order_days text[] DEFAULT NULL,
  p_item_types text[] DEFAULT NULL
)
RETURNS TABLE(
  sku_code text,
  main_barcode text,
  product_name_la text,
  product_name_en text,
  vendor_code text,
  vendor_display_name text,
  spc_name text,
  order_day text,
  delivery_day text,
  trade_term text,
  rank_sales text,
  leadtime numeric,
  order_cycle numeric,
  store_name text,
  type_store text,
  min_store numeric,
  max_store numeric,
  stock_store numeric,
  stock_dc numeric,
  avg_sales_store numeric,
  moq numeric,
  po_cost numeric,
  po_cost_unit numeric,
  on_order_store numeric,
  unit_of_measure text,
  item_type text,
  buying_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
BEGIN
  RETURN QUERY
  WITH filtered_vendors AS (
    SELECT DISTINCT ON (vm.vendor_code)
      vm.vendor_code AS vc, vm.spc_name AS sn, vm.order_day AS od,
      vm.delivery_day AS dd, vm.trade_term AS tt,
      vm.leadtime AS lt, vm.order_cycle AS oc
    FROM vendor_master vm
    WHERE (p_spc_names IS NULL OR vm.spc_name = ANY(p_spc_names))
      AND (p_order_days IS NULL OR vm.order_day = ANY(p_order_days))
      AND vm.vendor_origin IN ('Laos', 'Thailand')
    ORDER BY vm.vendor_code, vm.created_at DESC
  ),
  base_items AS (
    SELECT DISTINCT ON (dm.sku_code)
      dm.sku_code, dm.main_barcode, dm.product_name_la, dm.product_name_en,
      dm.vendor_code, dm.vendor_display_name, dm.unit_of_measure,
      dm.item_type, dm.buying_status
    FROM data_master dm
    WHERE dm.sku_code IS NOT NULL
      AND dm.packing_size_qty = 1
      AND dm.stock_unit_flag = 'Y'
      AND dm.product_owner = 'Lanexang Green Property Sole Co.,Ltd'
      AND dm.buying_status IN ('Active','Discontinue')
      AND (p_item_types IS NULL OR dm.item_type = ANY(p_item_types))
      AND (p_vendor_codes IS NULL OR dm.vendor_code = ANY(p_vendor_codes))
      AND dm.vendor_code IN (SELECT vc FROM filtered_vendors)
    ORDER BY dm.sku_code, dm.created_at DESC
  ),
  rank_data AS (
    SELECT DISTINCT ON (rs.item_id) rs.item_id, rs.final_rank
    FROM rank_sales rs WHERE rs.item_id IN (SELECT bi.sku_code FROM base_items bi)
    ORDER BY rs.item_id, rs.created_at DESC
  ),
  -- Get all stores from store_type (exclude DC)
  all_stores AS (
    SELECT DISTINCT st.type_store, st.ship_to AS store_name
    FROM store_type st
    WHERE st.type_store IS NOT NULL AND st.type_store != 'DC'
  ),
  -- MinMax per store
  minmax_store AS (
    SELECT mm.item_id, mm.store_name, mm.type_store,
      COALESCE(SUM(mm.min_val),0) AS min_val,
      COALESCE(SUM(mm.max_val),0) AS max_val
    FROM minmax mm
    WHERE mm.item_id IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY mm.item_id, mm.store_name, mm.type_store
  ),
  -- Stock per store
  stock_store AS (
    SELECT s.item_id, s.location AS store_name, s.type_store,
      COALESCE(SUM(s.quantity),0) AS qty
    FROM stock s
    WHERE s.item_id IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY s.item_id, s.location, s.type_store
  ),
  -- Stock DC aggregated per SKU
  stock_dc_agg AS (
    SELECT s.item_id,
      COALESCE(SUM(s.quantity),0) AS stock_dc
    FROM stock s
    WHERE s.item_id IN (SELECT bi.sku_code FROM base_items bi)
      AND s.type_store = 'DC'
    GROUP BY s.item_id
  ),
  -- Sales per store
  sales_store AS (
    SELECT sw.id18 AS item_id, sw.store_name, sw.type_store,
      COALESCE(SUM(sw.avg_day),0) AS avg_day
    FROM sales_by_week sw
    WHERE sw.id18 IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY sw.id18, sw.store_name, sw.type_store
  ),
  -- PO Cost
  cost_data AS (
    SELECT DISTINCT ON (pc.item_id) pc.item_id,
      COALESCE(pc.moq,1) AS moq, COALESCE(pc.po_cost,0) AS po_cost, COALESCE(pc.po_cost_unit,0) AS po_cost_unit
    FROM po_cost pc WHERE pc.item_id IN (SELECT bi.sku_code FROM base_items bi)
    ORDER BY pc.item_id, pc.created_at DESC
  ),
  -- On Order per store
  order_store AS (
    SELECT oo.sku_code AS item_id, oo.store_name,
      COALESCE(SUM(oo.po_qty),0) AS po_qty
    FROM on_order oo
    WHERE oo.sku_code IN (SELECT bi.sku_code FROM base_items bi)
    GROUP BY oo.sku_code, oo.store_name
  ),
  -- Build per-store rows from sales_by_week + minmax + stock (union all store references)
  store_items AS (
    SELECT DISTINCT bi.sku_code, ref.store_name, ref.type_store
    FROM base_items bi
    CROSS JOIN (
      SELECT DISTINCT store_name, type_store FROM minmax_store
      UNION
      SELECT DISTINCT store_name, type_store FROM stock_store WHERE type_store != 'DC'
      UNION
      SELECT DISTINCT store_name, type_store FROM sales_store
    ) ref
    WHERE EXISTS (
      SELECT 1 FROM minmax_store ms WHERE ms.item_id = bi.sku_code AND ms.store_name = ref.store_name
    )
    OR EXISTS (
      SELECT 1 FROM stock_store ss WHERE ss.item_id = bi.sku_code AND ss.store_name = ref.store_name AND ss.type_store != 'DC'
    )
    OR EXISTS (
      SELECT 1 FROM sales_store sls WHERE sls.item_id = bi.sku_code AND sls.store_name = ref.store_name
    )
  )
  SELECT
    bi.sku_code, bi.main_barcode, bi.product_name_la, bi.product_name_en,
    bi.vendor_code, bi.vendor_display_name,
    COALESCE(fv.sn,'')::text AS spc_name,
    COALESCE(fv.od,'')::text AS order_day,
    COALESCE(fv.dd,'')::text AS delivery_day,
    COALESCE(fv.tt,'')::text AS trade_term,
    COALESCE(rd.final_rank,'D')::text AS rank_sales,
    COALESCE(fv.lt,0) AS leadtime,
    COALESCE(fv.oc,0) AS order_cycle,
    si.store_name::text,
    si.type_store::text,
    COALESCE(ms.min_val,0) AS min_store,
    COALESCE(ms.max_val,0) AS max_store,
    COALESCE(ss.qty,0) AS stock_store,
    COALESCE(sdc.stock_dc,0) AS stock_dc,
    ROUND(COALESCE(sls.avg_day,0)::numeric,4) AS avg_sales_store,
    COALESCE(cd.moq,1) AS moq,
    COALESCE(cd.po_cost,0) AS po_cost,
    COALESCE(cd.po_cost_unit,0) AS po_cost_unit,
    COALESCE(os.po_qty,0) AS on_order_store,
    COALESCE(bi.unit_of_measure,'')::text AS unit_of_measure,
    COALESCE(bi.item_type,'')::text AS item_type,
    COALESCE(bi.buying_status,'')::text AS buying_status
  FROM store_items si
  JOIN base_items bi ON bi.sku_code = si.sku_code
  LEFT JOIN filtered_vendors fv ON bi.vendor_code = fv.vc
  LEFT JOIN rank_data rd ON rd.item_id = bi.sku_code
  LEFT JOIN minmax_store ms ON ms.item_id = bi.sku_code AND ms.store_name = si.store_name
  LEFT JOIN stock_store ss ON ss.item_id = bi.sku_code AND ss.store_name = si.store_name AND ss.type_store != 'DC'
  LEFT JOIN stock_dc_agg sdc ON sdc.item_id = bi.sku_code
  LEFT JOIN sales_store sls ON sls.item_id = bi.sku_code AND sls.store_name = si.store_name
  LEFT JOIN cost_data cd ON cd.item_id = bi.sku_code
  LEFT JOIN order_store os ON os.item_id = bi.sku_code AND os.store_name = si.store_name
  ORDER BY bi.vendor_code, bi.sku_code, si.store_name;
END;
$function$;
