import { Database } from "@/integrations/supabase/types";

export type TableName = 
  | "data_master" 
  | "stock" 
  | "minmax" 
  | "po_cost" 
  | "on_order" 
  | "rank_sales" 
  | "sales_by_week" 
  | "vendor_master"
  | "store_type"
  | "customers"
  | "list_po";

// Tables that are placeholder only (no DB table yet)
export type PlaceholderTable = "range_store";
export type AllTableName = TableName | PlaceholderTable;

export interface DataTableConfig {
  name: AllTableName;
  label: string;
  labelTh: string;
}

export const DATA_TABLES: DataTableConfig[] = [
  { name: "data_master", label: "Data Master", labelTh: "ข้อมูลสินค้า" },
  { name: "stock", label: "Stock", labelTh: "สต็อก" },
  { name: "minmax", label: "Min/Max", labelTh: "Min/Max" },
  { name: "po_cost", label: "PO Cost", labelTh: "ต้นทุน PO" },
  { name: "on_order", label: "On Order", labelTh: "สั่งซื้อ" },
  { name: "rank_sales", label: "Rank Sales", labelTh: "อันดับขาย" },
  { name: "sales_by_week", label: "Sales By Week", labelTh: "ขายรายสัปดาห์" },
  { name: "vendor_master", label: "Vendor Master", labelTh: "ข้อมูล Vendor" },
  { name: "store_type", label: "Store Type", labelTh: "ประเภทร้าน" },
  { name: "customers", label: "Customer", labelTh: "ลูกค้า" },
  { name: "list_po", label: "List PO", labelTh: "List PO" },
  { name: "range_store", label: "Range Store", labelTh: "Range Store" },
];

export const SRR_SUB_MENUS = [
  { key: "dc_item", label: "SRR DC ITEM" },
  { key: "direct_item", label: "SRR DIRECT ITEM" },
  { key: "special_order", label: "Special Order" },
  { key: "order_b2b", label: "Order B2B" },
  { key: "order_b2b_internal", label: "Order B2B internal" },
  { key: "srr_payment_overdue", label: "Payment Overdue" },
  { key: "srr_job_assign", label: "Job Assign" },
  { key: "srr_send_docs", label: "ส่งเอกสาร" },
  { key: "sar", label: "SAR" },
];

export const REPORT_SUB_MENUS: { key: string; label: string; menuCode: string }[] = [
  { key: "report_po", label: "Report PO", menuCode: "report" },
  { key: "report_oos", label: "Report OOS", menuCode: "report" },
  { key: "report_doh", label: "Report DOH", menuCode: "report" },
];

// Column display configs per table (excluding id, created_at, updated_at)
export const TABLE_COLUMNS: Record<AllTableName, string[]> = {
  data_master: [
    "sku_code", "main_barcode", "barcode",
    "product_name_la", "product_name_en", "product_name_th", "product_name_kr", "product_name_cn",
    "unit_of_measure", "packing_size_qty", "packing_size", "stock_unit_flag", "small_unit_flag",
    "weight", "width", "depth", "height", "min_display", "max_display",
    "use_serial", "unit_picking_super", "unit_picking_mart", "lao_label", "high_value",
    "mfg_expire_status", "product_shelf_life", "item_origin", "item_classify",
    "vat_flag", "tax_rate", "one_retail_status", "store_selection",
    "division_group_code", "division_group", "division_code", "division",
    "department_code", "department", "sub_department_code", "sub_department",
    "class_code", "class", "sub_class_code", "sub_class",
    "gm_buyer_code", "header_buyer_code", "buyer_code", "product_owner", "product_bu",
    "item_status", "item_type", "buying_status",
    "inactive_action_code", "inactive_action_name", "discontinue_action_code", "discontinue_action_name",
    "sale_ranging", "register_date", "house_brand", "brand",
    "vendor_code", "vendor_display_name", "vendor_current_status", "vdi_code",
    "replenishment_type", "product_type", "returnable_flag", "rtv_condition", "register_form_status",
    "excise_tax", "import_tax", "hs_code", "po_group", "order_condition",
    "min_order_pcs", "dc_min_stock", "default_location",
    "sales", "purchase", "available_in_self_order", "pack_product",
    "track_inventory", "tracking", "auto_create_lot", "create_purchase_order_pos", "valuation_by_lot",
    "standard_price", "list_price", "jmart_price",
  ],
  stock: [
    "location", "barcode", "item_id", "product", "unit_of_measure",
    "inventoried_quantity", "quantity", "on_hand", "reserved_quantity",
    "values_amount", "package", "company", "type_store",
  ],
  minmax: ["item_id", "min_val", "max_val", "type_store", "store_name", "unit_pick"],
  po_cost: ["vendor", "goodcode", "item_id", "product_name", "moq", "po_cost", "po_cost_unit"],
  on_order: ["sku_code", "sku_name", "po_qty", "id18", "item_id", "store_name", "last_po_date", "po_number"],
  rank_sales: ["item_id", "product_name", "final_rank"],
  sales_by_week: ["type_store", "store_name", "old_id", "id18", "avg_day"],
  vendor_master: [
    "vendor_code", "vendor_name_en", "vendor_name_la", "vendor_origin", "vendor_type",
    "vendor_payment_terms", "supplier_currency", "purchase_agreement_vat", "vat_percent", "replenishment_type",
    "leadtime", "order_cycle", "spc_name", "order_day", "delivery_day",
    "trade_term", "supp_current_status",
  ],
  store_type: ["ship_to", "code", "type_store", "size_store", "type_doc", "store_name"],
  customers: ["customer_code", "name", "country", "district", "email", "gender", "phone", "state", "street"],
  list_po: ["order_reference", "partner", "source", "document", "status", "total", "currency_name", "delivery_to1", "delivery_to2"],
  range_store: [],
};

// Unique conflict key per table for upsert during import. When set, both
// "insert" and "update" modes will upsert on this column instead of failing
// on duplicates.
export const TABLE_UNIQUE_KEY: Partial<Record<TableName, string>> = {
  customers: "customer_code",
  list_po: "order_reference",
  vendor_master: "vendor_code",
};

// Key columns for search highlighting (main columns per table)
export const KEY_COLUMNS: Partial<Record<TableName, string[]>> = {
  data_master: ["sku_code", "main_barcode", "product_name_la", "product_name_en", "brand", "vendor_code"],
  stock: ["item_id", "barcode", "product", "location", "type_store"],
  minmax: ["item_id", "type_store", "store_name", "unit_pick"],
  po_cost: ["goodcode", "product_name", "item_id", "vendor"],
  on_order: ["sku_code", "sku_name", "item_id", "store_name"],
  rank_sales: ["item_id", "product_name", "final_rank"],
  sales_by_week: ["type_store", "store_name", "id18"],
  vendor_master: ["vendor_code", "vendor_name_en", "vendor_name_la", "spc_name"],
  store_type: ["ship_to", "code", "type_store", "size_store", "type_doc", "store_name"],
  customers: ["customer_code", "name", "email", "phone", "country"],
  list_po: ["order_reference", "partner", "document", "status"],
};

// Per-table label overrides. Falls back to COLUMN_LABELS when not set.
export const TABLE_COLUMN_LABELS: Partial<Record<string, Record<string, string>>> = {
  on_order: {
    id18: "PO Number",
    item_id: "Vendor / Name",
    last_po_date: "Last PO Date",
    po_number: "PO Number (Doc)",
  },
  po_cost: {
    vendor: "Vendor",
    goodcode: "Main Barcode",
    item_id: "ID (SKUCode)",
    product_name: "Product Name",
    moq: "MOQ (1x)",
    po_cost: "PO Cost",
    po_cost_unit: "PO Cost Unit",
  },
};

export function getColumnLabel(col: string, table?: string): string {
  if (table && TABLE_COLUMN_LABELS[table]?.[col]) {
    return TABLE_COLUMN_LABELS[table]![col];
  }
  return COLUMN_LABELS[col] || col;
}

export const COLUMN_LABELS: Record<string, string> = {
  sku_code: "SKU Code",
  main_barcode: "Main Barcode",
  barcode: "Barcode",
  product_name_la: "Product Name (LA)",
  product_name_en: "Product Name (EN)",
  product_name_th: "Product Name (TH)",
  product_name_kr: "Product Name (KR)",
  product_name_cn: "Product Name (CN)",
  unit_of_measure: "Unit of Measure",
  packing_size_qty: "Packing Size Qty",
  packing_size: "Packing Size",
  stock_unit_flag: "Stock Unit Flag",
  small_unit_flag: "Small Unit Flag",
  weight: "Weight",
  width: "Width",
  depth: "Depth",
  height: "Height",
  min_display: "Min Display",
  max_display: "Max Display",
  use_serial: "Use Serial",
  unit_picking_super: "Unit Picking-SUPER",
  unit_picking_mart: "Unit Picking-MART",
  lao_label: "Lao Label",
  high_value: "High Value",
  mfg_expire_status: "Mfg Expire Status",
  product_shelf_life: "Product Shelf Life",
  item_origin: "Item Origin",
  item_classify: "Item Classify",
  vat_flag: "Vat Flag",
  tax_rate: "Tax Rate",
  one_retail_status: "One Retail Status",
  store_selection: "Store Selection",
  division_group_code: "Division Group Code",
  division_group: "Division Group",
  division_code: "Division Code",
  division: "Division",
  department_code: "Department Code",
  department: "Department",
  sub_department_code: "Sub-Department Code",
  sub_department: "Sub-Department",
  class_code: "Class Code",
  class: "Class",
  sub_class_code: "Sub-Class Code",
  sub_class: "Sub-Class",
  gm_buyer_code: "GM Buyer Code",
  header_buyer_code: "Header Buyer Code",
  buyer_code: "Buyer Code",
  product_owner: "Product Owner",
  product_bu: "Product BU",
  item_status: "Item Status",
  item_type: "Item Type",
  buying_status: "Buying Status",
  inactive_action_code: "Inactive Action Code",
  inactive_action_name: "Inactive Action Name",
  discontinue_action_code: "Discontinue Action Code",
  discontinue_action_name: "Discontinue Action Name",
  sale_ranging: "Sale Ranging",
  register_date: "Register Date",
  house_brand: "House Brand",
  brand: "Brand",
  vendor_code: "Vendor Code",
  vendor_display_name: "Vendor Name",
  vendor_current_status: "Vendor Current Status",
  vdi_code: "VDI Code",
  replenishment_type: "Replenishment Type",
  product_type: "Product Type",
  returnable_flag: "Returnable Flag",
  rtv_condition: "RTV Condition",
  register_form_status: "Register Form Status",
  excise_tax: "Excise Tax",
  import_tax: "Import Tax",
  hs_code: "HS Code",
  po_group: "PO Group",
  order_condition: "Order Condition",
  min_order_pcs: "Min Order Pcs",
  dc_min_stock: "DC Min Stock",
  default_location: "Default Location",
  sales: "Sales",
  purchase: "Purchase",
  available_in_self_order: "Available in Self Order",
  pack_product: "Pack Product",
  track_inventory: "Track Inventory",
  tracking: "Tracking",
  auto_create_lot: "Auto Create Lot",
  create_purchase_order_pos: "Create PO Pos",
  valuation_by_lot: "Valuation by Lot",
  standard_price: "Standard Price",
  list_price: "List Price",
  jmart_price: "Jmart Price",
  // Stock
  location: "Location",
  item_id: "ID",
  product: "Product",
  inventoried_quantity: "Inventoried Qty",
  quantity: "Quantity",
  on_hand: "On Hand",
  reserved_quantity: "Reserved Qty",
  values_amount: "Values Amount",
  package: "Package",
  company: "Company",
  type_store: "Type Store",
  // MinMax
  min_val: "MIN",
  max_val: "MAX",
  unit_pick: "Unit Pick",
  // PO Cost
  goodcode: "Good Code",
  product_name: "Product Name",
  moq: "MOQ (1x)",
  po_cost_unit: "PO Cost Unit",
  po_cost: "PO Cost",
  vendor: "Vendor",
  // On Order
  sku_name: "SKU Name",
  po_qty: "PO QTY",
  id18: "ID18",
  // Rank Sales
  final_rank: "Final Rank",
  // Sales by Week
  store_name: "Store Name",
  old_id: "Old ID",
  avg_day: "Avg/Day",
  // Vendor Master
  vendor_name_en: "Vendor Name (EN)",
  vendor_name_la: "Vendor Name (LA)",
  vendor_origin: "Vendor Origin",
  vendor_type: "Vendor Type",
  vendor_payment_terms: "Payment Terms",
  supplier_currency: "Currency",
  purchase_agreement_vat: "Purchase Agreement Vat",
  vat_percent: "Vat %",
   leadtime: "Leadtime",
  order_cycle: "Order Cycle",
  spc_name: "SPC Name",
  order_day: "Order Day",
  delivery_day: "Delivery Day",
  trade_term: "Trade Term",
  supp_current_status: "Supp Current Status",
  // Store Type
  ship_to: "Ship To",
  code: "Code",
  type_doc: "Type Doc",
  size_store: "Size Store",
  // Customer
  customer_code: "Customer Code",
  name: "Name",
  country: "Country",
  district: "District",
  email: "Email",
  gender: "Gender",
  phone: "Phone",
  state: "State",
  street: "Street",
  // List PO
  order_reference: "Order Reference",
  partner: "Partner",
  source: "Source",
  document: "Document",
  total: "Total",
  currency_name: "Currency/Name",
  delivery_to1: "Delivery to1",
  delivery_to2: "Delivery to2",
};
