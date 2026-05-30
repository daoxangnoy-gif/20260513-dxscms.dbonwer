import { supabase } from "@/integrations/supabase/client";

export type FilterOperator =
  | "is_in"
  | "not_in"
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty"
  | "distinct";

export interface FilterRule {
  source_table?: string; // ตาราง source ที่ column นี้มาจาก (สำหรับ UI; runtime filter ใช้ row[column] ตรง ๆ)
  column: string;
  operator: FilterOperator;
  value?: string | string[];
  join?: "AND" | "OR"; // join with the PREVIOUS rule (first rule's join is ignored)
}

/** Related source table within a menu (Step 3 lets user pick which table the column comes from) */
export interface MenuTable { name: string; label: string; columns: string[] }

export interface FilterTemplate {
  id: string;
  name: string;
  target_table: string;
  is_active: boolean;
  rules: FilterRule[];
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
}

// ---------- Per-table column catalog ----------
const COLS = {
  data_master: [
    "sku_code", "main_barcode", "barcode", "product_name_la", "product_name_en", "product_name_th",
    "brand", "vendor_code", "vendor_display_name", "vendor_current_status",
    "item_status", "item_type", "buying_status", "sale_ranging",
    "division_group", "division", "department", "sub_department", "class", "sub_class",
    "buyer_code", "gm_buyer_code", "product_owner", "product_bu",
    "replenishment_type", "product_type", "packing_size", "packing_size_qty", "unit_of_measure",
    "house_brand", "po_group", "order_condition", "high_value",
  ],
  vendor_master: [
    "vendor_code", "vendor_name_en", "vendor_name_la", "vendor_origin", "vendor_type",
    "vendor_payment_terms", "supplier_currency", "replenishment_type",
    "spc_name", "order_day", "delivery_day", "trade_term", "supp_current_status",
    "purchase_agreement_vat",
  ],
  stock:         ["item_id", "barcode", "product", "type_store", "location", "company", "unit_of_measure", "quantity"],
  minmax:        ["item_id", "store_name", "type_store", "unit_pick", "min", "max"],
  po_cost:       ["item_id", "goodcode", "vendor", "product_name", "po_cost", "moq"],
  on_order:      ["item_id", "sku_code", "store_name", "po_number", "sku_name", "po_qty"],
  on_order_dc:   ["sku_code", "store_name", "product_name_la", "product_name_en", "po_qty"],
  rank_sales:    ["item_id", "product_name", "final_rank"],
  sales_by_week: ["item_id", "store_name", "type_store", "avg_day"],
  range_store:   ["sku_code", "store_name", "apply_yn", "pack_qty", "box_qty"],
  store_type:    ["store_name", "type_store", "type_doc", "code", "ship_to", "size_store"],
  customers:     ["customer_code", "name", "email", "country", "state", "district"],
} as const;

/**
 * MENUS = หน่วยของ Filter Template (Apply to Menu).
 * แต่ละ menu มี:
 *  - value (= menu code), label
 *  - tables: รายการ source tables ที่หน้านั้นเกี่ยวข้อง (Step 3 ให้ user เลือกก่อน → แล้วค่อยเลือก column)
 *  - columns: flat union ของทุก column (backward-compat)
 */
export const MENUS: { value: string; label: string; tables: MenuTable[]; columns: string[] }[] = (() => {
  const mk = (value: string, label: string, tables: MenuTable[]) => ({
    value, label, tables,
    columns: Array.from(new Set(tables.flatMap(t => t.columns))),
  });
  return [
    // ---------- Data Control sub-menus (1 menu = 1 table) ----------
    mk("data_master",   "Data Control · Data Master",   [{ name: "data_master",   label: "data_master",   columns: [...COLS.data_master] }]),
    mk("vendor_master", "Data Control · Vendor Master", [{ name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] }]),
    mk("stock",         "Data Control · Stock",         [{ name: "stock",         label: "stock",         columns: [...COLS.stock] }]),
    mk("minmax",        "Data Control · MinMax",        [{ name: "minmax",        label: "minmax",        columns: [...COLS.minmax] }]),
    mk("po_cost",       "Data Control · PO Cost",       [{ name: "po_cost",       label: "po_cost",       columns: [...COLS.po_cost] }]),
    mk("on_order",      "Data Control · On Order",      [{ name: "on_order",      label: "on_order",      columns: [...COLS.on_order] }]),
    mk("on_order_dc",   "Data Control · On Order DC",   [{ name: "on_order_dc",   label: "on_order_dc",   columns: [...COLS.on_order_dc] }]),
    mk("rank_sales",    "Data Control · Rank Sales",    [{ name: "rank_sales",    label: "rank_sales",    columns: [...COLS.rank_sales] }]),
    mk("sales_by_week", "Data Control · Sales By Week", [{ name: "sales_by_week", label: "sales_by_week", columns: [...COLS.sales_by_week] }]),
    mk("range_store",   "Data Control · Range Store",   [
      { name: "range_store",   label: "range_store",   columns: [...COLS.range_store] },
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
      { name: "store_type",    label: "store_type",    columns: [...COLS.store_type] },
    ]),
    mk("store_type",    "Data Control · Store Type",    [{ name: "store_type",    label: "store_type",    columns: [...COLS.store_type] }]),
    mk("customers",     "Data Control · Customers",     [{ name: "customers",     label: "customers",     columns: [...COLS.customers] }]),

    // ---------- SRR & Calc menus (rows = join ของหลาย table) ----------
    mk("srr_dc",       "SRR · DC", [
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
      { name: "stock",         label: "stock",         columns: [...COLS.stock] },
      { name: "on_order",      label: "on_order",      columns: [...COLS.on_order] },
      { name: "rank_sales",    label: "rank_sales",    columns: [...COLS.rank_sales] },
    ]),
    mk("srr_direct",   "SRR · Direct (D2S)", [
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
      { name: "stock",         label: "stock",         columns: [...COLS.stock] },
      { name: "on_order",      label: "on_order",      columns: [...COLS.on_order] },
      { name: "rank_sales",    label: "rank_sales",    columns: [...COLS.rank_sales] },
    ]),
    mk("srr_special",  "SRR · Special Order", [
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
    ]),
    mk("sar", "SAR", [
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
      { name: "stock",         label: "stock",         columns: [...COLS.stock] },
      { name: "on_order_dc",   label: "on_order_dc",   columns: [...COLS.on_order_dc] },
      { name: "minmax",        label: "minmax",        columns: [...COLS.minmax] },
    ]),
    mk("minmax_cal", "MinMax Cal", [
      { name: "data_master",   label: "data_master",   columns: [...COLS.data_master] },
      { name: "vendor_master", label: "vendor_master", columns: [...COLS.vendor_master] },
      { name: "sales_by_week", label: "sales_by_week", columns: [...COLS.sales_by_week] },
      { name: "rank_sales",    label: "rank_sales",    columns: [...COLS.rank_sales] },
    ]),
  ];
})();


// Backward-compat aliases (old name)
export const FILTER_TABLES = MENUS;
export const TABLE_APPLIES_TO: Record<string, string[]> = Object.fromEntries(
  MENUS.map((m) => [m.value, [m.label]])
);

export const OPERATORS: { value: FilterOperator; label: string; needsValue: boolean; multi?: boolean }[] = [
  { value: "is_in", label: "Is in", needsValue: true, multi: true },
  { value: "not_in", label: "Not in", needsValue: true, multi: true },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "not_contains", label: "Not contains", needsValue: true },
  { value: "equals", label: "Equals", needsValue: true },
  { value: "not_equals", label: "Not equals", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
  { value: "distinct", label: "Distinct by column (keep first)", needsValue: false },
];

// In-memory cache with TTL
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, FilterTemplate[]>();
let cacheTs = 0;           // timestamp of last full fetch
let prefetchPromise: Promise<void> | null = null;
const EVENT = "filter-templates-updated";

export function invalidateFilterTemplatesCache() {
  cache.clear();
  cacheTs = 0;
  prefetchPromise = null;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function onFilterTemplatesUpdated(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = () => cb();
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Fetch ALL active templates in one query and populate cache. */
async function prefetchAllTemplates(): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("filter_templates")
    .select("*")
    .eq("is_active", true);
  if (error) {
    console.error("[filter_templates] prefetch error", error);
    return;
  }
  cache.clear();
  for (const tpl of (data || []) as FilterTemplate[]) {
    const list = cache.get(tpl.target_table) ?? [];
    list.push(tpl);
    cache.set(tpl.target_table, list);
  }
  cacheTs = Date.now();
}

/** Returns true if at least one active template exists for the menu. */
export async function hasActiveFilterTemplates(table: string): Promise<boolean> {
  const tpls = await loadActiveFilterTemplates(table);
  return tpls.length > 0;
}

export async function loadActiveFilterTemplates(table: string): Promise<FilterTemplate[]> {
  const isStale = Date.now() - cacheTs > CACHE_TTL_MS;
  if (!isStale && cache.has(table)) return cache.get(table)!;
  if (isStale || cacheTs === 0) {
    // Dedupe concurrent calls: only one prefetch at a time
    prefetchPromise ??= prefetchAllTemplates().finally(() => { prefetchPromise = null; });
    await prefetchPromise;
  }
  return cache.get(table) ?? [];
}

function ruleMatches(row: any, rule: FilterRule): boolean {
  const raw = row?.[rule.column];
  const v = raw == null ? "" : String(raw);
  switch (rule.operator) {
    case "is_in":
      return Array.isArray(rule.value) ? rule.value.map(String).includes(v) : v === String(rule.value ?? "");
    case "not_in":
      return Array.isArray(rule.value) ? !rule.value.map(String).includes(v) : v !== String(rule.value ?? "");
    case "contains":
      return v.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "not_contains":
      return !v.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "equals":
      return v === String(rule.value ?? "");
    case "not_equals":
      return v !== String(rule.value ?? "");
    case "is_empty":
      return v === "" || raw == null;
    case "is_not_empty":
      return v !== "" && raw != null;
    case "distinct":
      // Per-row eval N/A — handled at template level by applyDistinctTemplate
      return false;
    default:
      return false;
  }
}

function templateMatchesRow(tpl: FilterTemplate, row: any): boolean {
  if (!tpl.rules || tpl.rules.length === 0) return false;
  // Evaluate left-to-right with AND/OR joins (no precedence)
  let acc = ruleMatches(row, tpl.rules[0]);
  for (let i = 1; i < tpl.rules.length; i++) {
    const r = tpl.rules[i];
    const match = ruleMatches(row, r);
    if ((r.join ?? "AND") === "OR") acc = acc || match;
    else acc = acc && match;
  }
  return acc;
}

/** Apply a distinct template: keep first occurrence per composite key of distinct columns. */
function applyDistinctTemplate<T extends Record<string, any>>(rows: T[], tpl: FilterTemplate): T[] {
  const cols = (tpl.rules || []).filter(r => r.operator === "distinct").map(r => r.column).filter(Boolean);
  if (!cols.length) return rows;
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = cols.map(c => String(r?.[c] ?? "")).join("\u0001");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDistinctTemplate(tpl: FilterTemplate): boolean {
  return (tpl.rules || []).some(r => r.operator === "distinct");
}

/**
 * Row enrichment: ถ้า template อ้างถึง column จาก source_table อื่นที่ไม่ได้ join มากับ row
 * ระบบจะ batch-fetch column ที่ต้องใช้แล้ว merge เข้า row ก่อนประเมิน rules
 * ลำดับสำคัญ: เช่น range_store ต้อง enrich data_master ก่อน (เพื่อให้ได้ vendor_code)
 * แล้วถึงค่อย enrich vendor_master (ใช้ vendor_code เป็น join key)
 */
type EnrichStep = { table: string; sourceKey: string };
const ENRICHMENT: Record<string, EnrichStep[]> = {
  range_store: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
  store_type: [],
  customers: [],
  // Data Control sub-menus = single-table → ไม่ต้อง enrich
  data_master: [],
  vendor_master: [],
  stock: [],
  minmax: [],
  po_cost: [],
  on_order: [],
  on_order_dc: [],
  rank_sales: [],
  sales_by_week: [],
  // SRR/Calc menus — rows ผ่าน merge ของหลาย table ใน page อยู่แล้ว แต่บาง column อาจไม่ครบ
  srr_dc: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
  srr_direct: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
  srr_special: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
  sar: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
  minmax_cal: [
    { table: "data_master",   sourceKey: "sku_code" },
    { table: "vendor_master", sourceKey: "vendor_code" },
  ],
};

async function enrichRows<T extends Record<string, any>>(
  rows: T[],
  menu: string,
  tpls: FilterTemplate[]
): Promise<T[]> {
  const steps = ENRICHMENT[menu] || [];
  if (!steps.length || !rows.length) return rows;
  // คอลัมน์ที่ rules ต้องใช้ (per source_table)
  const wantCols: Record<string, Set<string>> = {};
  for (const t of tpls) {
    for (const r of t.rules || []) {
      if (!r.source_table || !r.column) continue;
      (wantCols[r.source_table] ||= new Set()).add(r.column);
    }
  }
  if (Object.keys(wantCols).length === 0) return rows;

  // Transitive enrichment: ถ้า step ปลายทางต้องการ sourceKey ที่ row ยังไม่มี
  // → เปิด step ก่อนหน้าที่ table นั้นมี column = sourceKey เพื่อ pull key มาก่อน
  const sample = rows[0] || {};
  const needed: Record<string, Set<string>> = {}; // table -> cols
  for (const k of Object.keys(wantCols)) needed[k] = new Set(wantCols[k]);
  // วน reverse เพื่อ propagate ความต้องการของ key ไปยัง step ก่อนหน้า
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (!needed[s.table]) continue;
    needed[s.table].add(s.sourceKey);
    // ถ้า sample row ไม่มี sourceKey → ต้องหา step ก่อนหน้าที่ provides มัน
    if (sample[s.sourceKey] == null) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = steps[j];
        const prevCols = (COLS as any)[prev.table] as readonly string[] | undefined;
        if (prevCols && prevCols.includes(s.sourceKey)) {
          (needed[prev.table] ||= new Set()).add(s.sourceKey);
          break;
        }
      }
    }
  }

  let working = rows as any[];
  for (const step of steps) {
    const cols = needed[step.table];
    if (!cols || cols.size === 0) continue;
    cols.add(step.sourceKey);
    const keys = Array.from(new Set(
      working.map(r => r?.[step.sourceKey]).filter(v => v != null && v !== "").map(String)
    ));
    if (!keys.length) continue;
    // ตรวจว่ามี row ไหนยังขาด column เหล่านี้บ้าง — ถ้าครบหมดแล้วข้ามได้
    const extraCols = Array.from(cols).filter(c => c !== step.sourceKey);
    const missing = extraCols.length === 0
      ? false
      : extraCols.some(c => working.some(r => r?.[c] == null));
    if (!missing && extraCols.length > 0) continue;
    const fetched: any[] = [];
    const CHUNK = 1000;
    const selectCols = Array.from(cols).join(",");
    try {
      for (let i = 0; i < keys.length; i += CHUNK) {
        const slice = keys.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from(step.table).select(selectCols).in(step.sourceKey, slice);
        if (error) { console.error("[filter enrich]", step.table, error); break; }
        fetched.push(...(data || []));
      }
    } catch (e) {
      console.error("[filter enrich exception]", step.table, e);
      continue;
    }
    const map = new Map<string, any>();
    for (const f of fetched) map.set(String(f[step.sourceKey]), f);
    working = working.map(r => {
      const hit = map.get(String(r?.[step.sourceKey]));
      if (!hit) return r;
      const merged: any = { ...r };
      for (const k of Object.keys(hit)) if (merged[k] == null) merged[k] = hit[k];
      return merged;
    });
  }
  return working as T[];
}

/** Apply exclude filters: returns rows where NO active template matches. */
export async function applyExcludeFilters<T extends Record<string, any>>(
  rows: T[],
  table: string
): Promise<T[]> {
  const tpls = await loadActiveFilterTemplates(table);
  if (!tpls.length) return rows;
  const enriched = await enrichRows(rows, table, tpls);
  return applyExcludeFiltersSync(enriched, tpls);
}

/** Synchronous version when templates already loaded. */
export function applyExcludeFiltersSync<T extends Record<string, any>>(
  rows: T[],
  tpls: FilterTemplate[]
): T[] {
  if (!tpls.length) return rows;
  const normal = tpls.filter(t => !isDistinctTemplate(t));
  const distinct = tpls.filter(isDistinctTemplate);
  let out = rows;
  if (normal.length) out = out.filter((r) => !normal.some((t) => templateMatchesRow(t, r)));
  for (const t of distinct) out = applyDistinctTemplate(out, t);
  return out;
}
