// Shared types for SRR pages

export interface SRRRow {
  id: string;
  sku_code: string;
  barcode_unit: string;
  product_name_la: string;
  product_name_en: string;
  vendor_code: string;
  vendor_name: string;
  vendor_display: string;
  spc_name: string;
  order_day: string;
  rank_sales: string;
  min_jmart: number; max_jmart: number;
  min_kokkok: number; max_kokkok: number;
  min_kokkok_fc: number; max_kokkok_fc: number;
  min_udee: number; max_udee: number;
  tt_min: number; tt_max: number;
  stock_dc: number; stock_jmart: number;
  stock_kokkok: number; stock_kokkok_fc: number; stock_udee: number;
  tt_stock: number; tt_stock_store: number;
  avg_sales_jmart: number; avg_sales_kokkok: number;
  avg_sales_kokkok_fc: number;
  avg_sales_udee: number; avg_sales_tt: number;
  moq: number; pack: number | null; box: number | null; po_cost: number; po_cost_unit: number;
  orig_po_cost: number; orig_po_cost_unit: number;
  safety: number; leadtime: number; order_cycle: number;
  tt_safety: number; dc_min: number; on_order: number;
  gap_store: number; gap_dc: number;
  suggest_qty: number; final_suggest_qty: number; final_suggest_uom: number;
  order_uom_edit: string;
  doh_asis: number;
  doh_tobe: number;
  calculated: boolean;
  rank_is_default: boolean;
  item_type: string;
  buying_status: string;
  unit_of_measure: string;
  po_group: string;
  division_group: string;
  division: string;
  department: string;
  sub_department: string;
  class: string;
  sub_class: string;
  orig_on_order: number;
  orig_avg_sales_jmart: number;
  orig_avg_sales_kokkok: number;
  orig_avg_sales_kokkok_fc: number;
  orig_avg_sales_udee: number;
  orig_min_jmart: number;
  orig_min_kokkok: number;
  orig_min_kokkok_fc: number;
  orig_min_udee: number;
  orig_stock_dc: number;
  orig_stock_jmart: number;
  orig_stock_kokkok: number;
  orig_stock_kokkok_fc: number;
  orig_stock_udee: number;
}

export interface VendorInfo {
  vendor_code: string;
  vendor_display_name: string;
  spc_name: string;
  order_day: string;
  supplier_currency: string;
}

export interface VendorDocument {
  id: string;
  vendor_code: string;
  vendor_display: string;
  spc_name: string;
  date_key: string;
  created_at: string;
  item_count: number;
  suggest_count: number;
  data: SRRRow[];
  edit_count: number;
  edited_columns: string[];
  source?: "filter" | "vendor" | "import";
  user_id?: string;
}

export interface SavedPO {
  id: string;
  name: string;
  date: string;
  vendor_code: string;
  vendor_name: string;
  spc_name: string;
  rows: any[];
  pickingType: string;
  description: string;
  selected?: boolean;
}

export interface ColumnView {
  name: string;
  columns: string[];
}

export interface HierarchyFilter {
  divisionGroups?: string[] | null;
  divisions?: string[] | null;
  departments?: string[] | null;
  subDepartments?: string[] | null;
  classes?: string[] | null;
  subClasses?: string[] | null;
}
