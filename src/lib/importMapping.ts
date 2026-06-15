// Shared Excel→DB column mapping + value coercion for imports.
// แยกออกมาจาก useDataTable.ts เพื่อให้ Web Worker (big-file import) เรียกใช้ได้
// โดยไม่ต้องแตะ flow import เดิม. Logic ต้องตรงกับ useDataTable.ts เป๊ะ ๆ
import { TableName, TABLE_COLUMNS, getColumnLabel } from "@/lib/tableConfig";

// คอลัมน์ที่เป็นตัวเลข — ต้อง coerce จาก boolean/string ของ Excel เป็น number|null
const NUMERIC_COLS: Record<string, Set<string>> = {
  stock: new Set(["inventoried_quantity", "quantity", "on_hand", "reserved_quantity", "values_amount"]),
  data_master: new Set([
    "weight", "width", "depth", "height", "min_display", "max_display",
    "packing_size_qty", "tax_rate", "excise_tax", "import_tax",
    "min_order_pcs", "dc_min_stock", "standard_price", "list_price", "jmart_price",
  ]),
  minmax: new Set(["min_val", "max_val"]),
  po_cost: new Set(["moq", "po_cost_unit", "po_cost"]),
  on_order: new Set(["po_qty"]),
  sales_by_week: new Set(["avg_day"]),
  vendor_master: new Set(["leadtime", "order_cycle"]),
};

export function coerceValue(tableName: TableName, dbCol: string, val: any): any {
  const numericSet = NUMERIC_COLS[tableName] || new Set<string>();
  if (val === undefined || val === null || val === "") return null;
  if (numericSet.has(dbCol)) {
    if (typeof val === "boolean") return val ? 1 : 0;
    const s = String(val).trim().toLowerCase();
    if (s === "" || s === "false" || s === "no" || s === "n/a" || s === "-") return null;
    if (s === "true" || s === "yes") return 1;
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === "boolean") return val ? "Y" : "N";
  return val;
}

export function buildColumnMap(sampleRow: Record<string, any>, tableName: TableName): Record<string, string> {
  const excelHeaders = Object.keys(sampleRow);
  const dbColumns = TABLE_COLUMNS[tableName];
  const dbSet = new Set<string>(dbColumns);

  const norm = (s: string) => String(s ?? "").toLowerCase().trim()
    .replace(/[()]/g, "")
    .replace(/[\s\/\-\.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  const labelToCol: Record<string, string> = {};
  for (const col of dbColumns) {
    const label = getColumnLabel(col, tableName);
    labelToCol[norm(label)] = col;
    labelToCol[norm(col)] = col;
  }

  const specialMappings: Record<string, string> = {
    skucode: "sku_code",
    product_name_la: "product_name_la", product_name_en: "product_name_en",
    product_name_th: "product_name_th", product_name_kr: "product_name_kr",
    product_name_cn: "product_name_cn",
    unit_of_measure_name: "unit_of_measure",
    packaging_depth: "depth",
    seller_ids_vendor_code: "vendor_code",
    seller_ids_display_name: "vendor_display_name",
    vendor_name: "vendor_display_name",
    discontinue_action_code_code: "discontinue_action_code",
    valuation_by_lot_serial_number: "valuation_by_lot",
    create_po_pos: "create_purchase_order_pos",
    create_purchase_order_pos: "create_purchase_order_pos",
    min: "min_val", max: "max_val", "1x": "moq",
    product_name2: "product_name",
    type: "product_type",
    sub_department_code: "sub_department_code",
    sub_department: "sub_department",
    sub_class_code: "sub_class_code",
    sub_class: "sub_class",
    jmart_price: "jmart_price",
  };

  const map: Record<string, string> = {};
  for (const header of excelHeaders) {
    const n = norm(header);
    if (labelToCol[n]) { map[header] = labelToCol[n]; continue; }
    if (dbSet.has(n)) { map[header] = n; continue; }
    if (specialMappings[n] && dbSet.has(specialMappings[n])) { map[header] = specialMappings[n]; continue; }
    const candidates = dbColumns.filter(col => col === n || n === col);
    if (candidates.length === 1) { map[header] = candidates[0]; continue; }
    const includes = dbColumns.filter(col => n === col || (n.length > 4 && col.length > 4 && (n === col)));
    if (includes.length === 1) { map[header] = includes[0]; }
  }
  return map;
}

// map ทั้ง batch -> payload (coerce + ตัด field ว่าง)
export function mapRows(
  rows: Record<string, any>[],
  columnMap: Record<string, string>,
  tableName: TableName,
): Record<string, any>[] {
  return rows.map(row => {
    const mapped: Record<string, any> = {};
    for (const [excelCol, dbCol] of Object.entries(columnMap)) {
      if (dbCol && row[excelCol] !== undefined) {
        const coerced = coerceValue(tableName, dbCol, row[excelCol]);
        if (coerced !== null && coerced !== undefined) mapped[dbCol] = coerced;
      }
    }
    return mapped;
  }).filter(row => Object.keys(row).length > 0);
}
