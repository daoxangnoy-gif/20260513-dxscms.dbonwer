import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import type { SRRRow, VendorInfo, VendorDocument, SavedPO, ColumnView } from "./srrTypes";
import type { SnapshotBatch } from "./snapshotService";

// --- Fetch all rows helper ---
export async function fetchAllRows<T>(table: string, selectCols: string, filter?: (q: any) => any): Promise<T[]> {
  const all: T[] = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    let q: any = (supabase as any).from(table).select(selectCols).range(offset, offset + batchSize - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return all;
}

// --- Per-session RPC cache for SRR DC ---
export const SRR_RPC_CACHE = new Map<string, { ts: number; rows: any[] }>();
const SRR_RPC_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchSRRDataRPC(
  vendorCodes: string[] | null, spcNames: string[] | null,
  orderDays: string[] | null, itemTypes: string[] | null,
  hierarchy?: import("./srrTypes").HierarchyFilter,
  onProgress?: (loaded: number) => void,
  skuCodes?: string[] | null
): Promise<any[]> {
  const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
  const skipDefaults = await hasActiveFilterTemplates("srr_dc");
  const params: any = {
    p_vendor_codes: vendorCodes,
    p_spc_names: spcNames,
    p_order_days: orderDays,
    p_item_types: itemTypes,
    p_division_groups: hierarchy?.divisionGroups ?? null,
    p_divisions: hierarchy?.divisions ?? null,
    p_departments: hierarchy?.departments ?? null,
    p_sub_departments: hierarchy?.subDepartments ?? null,
    p_classes: hierarchy?.classes ?? null,
    p_sub_classes: hierarchy?.subClasses ?? null,
    p_sku_codes: skuCodes && skuCodes.length > 0 ? skuCodes : null,
    p_skip_default_filters: skipDefaults,
  };
  const sortedKey = JSON.stringify(
    Object.keys(params).sort().reduce((acc: any, k) => {
      const v = params[k];
      acc[k] = Array.isArray(v) ? [...v].sort() : v;
      return acc;
    }, {})
  );
  const cached = SRR_RPC_CACHE.get(sortedKey);
  if (cached && Date.now() - cached.ts < SRR_RPC_CACHE_TTL_MS) {
    onProgress?.(cached.rows.length);
    return cached.rows;
  }
  const { data, error } = await (supabase
    .rpc("get_srr_data_json" as any, params as any) as any)
    .abortSignal(AbortSignal.timeout(240000));
  if (error) throw error;
  const allRows: any[] = Array.isArray(data) ? data : (data || []);
  onProgress?.(allRows.length);
  SRR_RPC_CACHE.set(sortedKey, { ts: Date.now(), rows: allRows });
  return allRows;
}

// --- SRR Columns ---
export const HIGHLIGHT_COLS = new Set([
  "tt_min", "tt_max", "stock_dc", "tt_stock", "tt_stock_store", "rank_sales",
  "avg_sales_tt", "dc_min", "gap_store", "gap_dc", "suggest_qty",
  "final_suggest_qty", "final_suggest_uom", "doh_asis", "doh_tobe",
]);
export const TRUNCATE_COLS = new Set(["product_name_la", "product_name_en", "vendor_display"]);

export const SRR_COLUMNS: { key: keyof SRRRow | "pack_size" | "ranking" | "core_item" | "amount"; label: string; group?: string }[] = [
  { key: "vendor_display", label: "Vendor" },
  { key: "po_group", label: "PO Group" },
  { key: "division_group", label: "Division Group" },
  { key: "division", label: "Division" },
  { key: "department", label: "Department" },
  { key: "sub_department", label: "Sub-Department" },
  { key: "class", label: "Class" },
  { key: "sub_class", label: "Sub-Class" },
  { key: "item_type", label: "Item Type" },
  { key: "buying_status", label: "Buying Status" },
  { key: "sku_code", label: "ID (SKU)" },
  { key: "barcode_unit", label: "Barcode Unit" },
  { key: "product_name_la", label: "Product Name (LA)" },
  { key: "product_name_en", label: "Product Name (EN)" },
  { key: "spc_name", label: "SPC" },
  { key: "order_day", label: "Order Day" },
  { key: "rank_sales", label: "Rank" },
  { key: "ranking", label: "Ranking" },
  { key: "core_item", label: "Core Item" },
  { key: "min_jmart", label: "Min Jmart", group: "Min/Max" },
  { key: "min_kokkok", label: "Min Kokkok", group: "Min/Max" },
  { key: "min_kokkok_fc", label: "Min Kokkok-fc", group: "Min/Max" },
  { key: "min_udee", label: "Min U-dee", group: "Min/Max" },
  { key: "max_jmart", label: "Max Jmart", group: "Min/Max" },
  { key: "max_kokkok", label: "Max Kokkok", group: "Min/Max" },
  { key: "max_kokkok_fc", label: "Max Kokkok-fc", group: "Min/Max" },
  { key: "max_udee", label: "Max U-dee", group: "Min/Max" },
  { key: "tt_min", label: "TT MIN", group: "Min/Max" },
  { key: "tt_max", label: "TT MAX", group: "Min/Max" },
  { key: "stock_dc", label: "Stock DC", group: "Stock" },
  { key: "stock_jmart", label: "Stock Jmart", group: "Stock" },
  { key: "stock_kokkok", label: "Stock Kokkok", group: "Stock" },
  { key: "stock_kokkok_fc", label: "Stock Kokkok-fc", group: "Stock" },
  { key: "stock_udee", label: "Stock U-dee", group: "Stock" },
  { key: "tt_stock", label: "TT Stock", group: "Stock" },
  { key: "tt_stock_store", label: "TT Stock Store", group: "Stock" },
  { key: "avg_sales_jmart", label: "Avg Jmart", group: "Avg Sales" },
  { key: "avg_sales_kokkok", label: "Avg Kokkok", group: "Avg Sales" },
  { key: "avg_sales_kokkok_fc", label: "Avg Kokkok-fc", group: "Avg Sales" },
  { key: "avg_sales_udee", label: "Avg U-dee", group: "Avg Sales" },
  { key: "avg_sales_tt", label: "Avg TT", group: "Avg Sales" },
  { key: "moq", label: "MOQ" },
  { key: "pack", label: "Pack" },
  { key: "box", label: "Box" },
  { key: "po_cost", label: "PO Cost" },
  { key: "po_cost_unit", label: "PO Cost Unit" },
  { key: "safety", label: "Safety" },
  { key: "leadtime", label: "Leadtime" },
  { key: "order_cycle", label: "Order Cycle" },
  { key: "tt_safety", label: "TT Safety" },
  { key: "dc_min", label: "DC Min" },
  { key: "on_order", label: "On Order" },
  { key: "gap_store", label: "Gap Store" },
  { key: "gap_dc", label: "Gap DC" },
  { key: "suggest_qty", label: "Suggest Qty" },
  { key: "final_suggest_qty", label: "Final Suggest" },
  { key: "final_suggest_uom", label: "Final UOM" },
  { key: "pack_size", label: "Packsize" },
  { key: "order_uom_edit", label: "Order UOM EDIT" },
  { key: "doh_asis", label: "DOH ASIS" },
  { key: "doh_tobe", label: "DOH TOBE" },
  { key: "amount", label: "Amount" }, // = po_cost_unit × final_suggest_qty
];

export const ALL_COL_KEYS = SRR_COLUMNS.map(c => c.key);
// Default columns ที่แสดงตอนเปิดหน้า SRR DC (ที่เหลือซ่อนไว้ ผู้ใช้ติกเพิ่มเองได้)
export const DEFAULT_SRR_VISIBLE = new Set<string>([
  "vendor_display",
  "po_group",
  "division",
  "sku_code",
  "product_name_la",
  "rank_sales",
  "ranking",
  "core_item",
  "tt_min",
  "tt_max",
  "stock_dc",
  "tt_stock",
  "tt_stock_store",
  "avg_sales_tt",
  "po_cost_unit",
  "dc_min",
  "on_order",
  "final_suggest_qty",
  "final_suggest_uom",
  "pack_size",
  "order_uom_edit",
  "doh_asis",
  "doh_tobe",
  "amount",
]);
export const EDITABLE_COLS = new Set(["order_uom_edit", "safety"]);

export function formatCellValue(val: any, key: string): string {
  if (key === "pack" || key === "box") {
    if (val === null || val === undefined || val === "" || (typeof val === "number" && !Number.isFinite(val))) return "-";
    if (typeof val === "number") return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return String(val);
  }
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    if (val === 0) return "";
    if (key === "po_cost_unit" || key === "orig_po_cost_unit") {
      return Number.isInteger(val)
        ? val.toLocaleString()
        : val.toLocaleString(undefined, { maximumFractionDigits: 10 });
    }
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(val);
}

export function getDefaultWidth(key: string): number {
  if (TRUNCATE_COLS.has(key)) return 180;
  if (key === "vendor_display") return 200;
  if (key === "sku_code" || key === "barcode_unit") return 120;
  if (key === "order_uom_edit") return 110;
  if (key === "doh_asis" || key === "doh_tobe") return 90;
  if (key === "amount") return 110;
  return 90;
}

export function getBatchKey(doc: { date_key: string; created_at?: string }): string {
  if (!doc.created_at) return doc.date_key.replace(/-/g, "");
  const dt = new Date(doc.created_at);
  if (isNaN(dt.getTime())) return doc.date_key.replace(/-/g, "");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}${p(dt.getHours())}${p(dt.getMinutes())}`;
}

export function fmtTreeStamp(batchKey: string, _docs: { created_at?: string }[]): string {
  return batchKey;
}

export const SAFETY_BY_RANK: Record<string, number> = { A: 21, B: 14, C: 10, D: 7 };
export function getDefaultSafety(rank: string): number {
  return SAFETY_BY_RANK[rank?.toUpperCase()] ?? 7;
}

export function recalcRow(row: SRRRow): SRRRow {
  const n = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const min_jmart = n(row.min_jmart), min_kokkok = n(row.min_kokkok), min_kokkok_fc = n(row.min_kokkok_fc), min_udee = n(row.min_udee);
  const max_jmart = n(row.max_jmart), max_kokkok = n(row.max_kokkok), max_kokkok_fc = n(row.max_kokkok_fc), max_udee = n(row.max_udee);
  const stock_dc = n(row.stock_dc), stock_jmart = n(row.stock_jmart), stock_kokkok = n(row.stock_kokkok), stock_kokkok_fc = n(row.stock_kokkok_fc), stock_udee = n(row.stock_udee);
  const avg_jmart = n(row.avg_sales_jmart), avg_kokkok = n(row.avg_sales_kokkok), avg_kokkok_fc = n(row.avg_sales_kokkok_fc), avg_udee = n(row.avg_sales_udee);
  const safety = n(row.safety), leadtime = n(row.leadtime), order_cycle = n(row.order_cycle), on_order = n(row.on_order);
  const moqRaw = n(row.moq);
  const ttMin = min_jmart + min_kokkok + min_kokkok_fc + min_udee;
  const ttMax = max_jmart + max_kokkok + max_kokkok_fc + max_udee;
  const ttStock = stock_dc + stock_jmart + stock_kokkok + stock_kokkok_fc + stock_udee;
  const ttStockStore = stock_jmart + stock_kokkok + stock_kokkok_fc + stock_udee;
  const avgTt = avg_jmart + avg_kokkok + avg_kokkok_fc + avg_udee;
  const ttSafety = leadtime + order_cycle + safety;
  const dcMin = avgTt * ttSafety;
  const clampedStockStore = ttStockStore <= 0 ? 0 : ttStockStore;
  const gapStore = clampedStockStore <= ttMin ? ttMin - clampedStockStore : 0;
  const clampedStockDc = stock_dc <= 0 ? 0 : stock_dc;
  const gapDc = clampedStockDc <= dcMin ? dcMin - clampedStockDc : 0;
  const suggestQty = gapStore + gapDc;
  const rawFinal = Math.max(suggestQty - on_order, 0);
  const moq = moqRaw || 1;
  const calcFinalSuggestQty = rawFinal === 0 ? 0 : moq > 0 ? Math.ceil(rawFinal / moq) * moq : rawFinal;
  const calcFinalSuggestUom = moq > 0 ? calcFinalSuggestQty / moq : calcFinalSuggestQty;
  const hasUomEdit = row.order_uom_edit !== "" && row.order_uom_edit != null && !isNaN(Number(row.order_uom_edit));
  const uomEditNum = hasUomEdit ? Number(row.order_uom_edit) : 0;
  const finalSuggestUom = hasUomEdit ? uomEditNum : calcFinalSuggestUom;
  const finalSuggestQty = hasUomEdit ? uomEditNum * moq : calcFinalSuggestQty;
  const effectiveFinalSuggest = finalSuggestQty;
  const avgTtRounded = Math.round(avgTt * 100) / 100;
  const dohAsis = avgTtRounded > 0 ? ttStock / avgTtRounded : 0;
  const dohTobe = avgTtRounded > 0
    ? (ttStock + effectiveFinalSuggest + on_order - (avgTtRounded * leadtime)) / avgTtRounded : 0;
  return {
    ...row,
    min_jmart, min_kokkok, min_kokkok_fc, min_udee,
    max_jmart, max_kokkok, max_kokkok_fc, max_udee,
    stock_dc, stock_jmart, stock_kokkok, stock_kokkok_fc, stock_udee,
    avg_sales_jmart: avg_jmart, avg_sales_kokkok: avg_kokkok,
    avg_sales_kokkok_fc: avg_kokkok_fc, avg_sales_udee: avg_udee,
    safety, leadtime, order_cycle, on_order, moq: moqRaw,
    tt_min: ttMin, tt_max: ttMax,
    tt_stock: ttStock, tt_stock_store: ttStockStore,
    avg_sales_tt: Math.round(avgTt * 100) / 100,
    tt_safety: ttSafety,
    dc_min: Math.round(dcMin * 100) / 100,
    gap_store: Math.round(gapStore * 100) / 100,
    gap_dc: Math.round(gapDc * 100) / 100,
    suggest_qty: Math.round(suggestQty * 100) / 100,
    final_suggest_qty: Math.round(finalSuggestQty * 100) / 100,
    final_suggest_uom: Math.round(finalSuggestUom * 100) / 100,
    doh_asis: Math.round(dohAsis * 100) / 100,
    doh_tobe: Math.round(dohTobe * 100) / 100,
  };
}

export function buildSRRRows(rawRows: any[], vendorInfoList: VendorInfo[]): SRRRow[] {
  const viMap = new Map<string, VendorInfo>();
  for (const v of vendorInfoList) viMap.set(v.vendor_code, v);
  return rawRows.map((r: any, idx: number) => {
    const vi = viMap.get(r.vendor_code || "");
    const rank = r.rank_sales || "D";
    const rankIsDefault = !r.rank_sales || r.rank_sales === "";
    const safetyDays = getDefaultSafety(rank);
    const leadtime = Number(r.leadtime) || 0;
    const orderCycle = Number(r.order_cycle) || 0;
    const currency = vi?.supplier_currency || "";
    const currSuffix = currency ? ` (${currency})` : "";
    const vendorDisplay = r.vendor_code ? `${r.vendor_code} - ${r.vendor_display_name || r.vendor_code}${currSuffix}` : "";
    const moq = Number(r.moq) || 1;
    const poCostVal = Number(r.po_cost) || 0;
    const poCostUnit = Number(r.po_cost_unit) || (moq > 0 ? poCostVal / moq : 0);
    const row: SRRRow = {
      id: `srr-${r.sku_code || idx}`,
      sku_code: r.sku_code || "",
      barcode_unit: r.main_barcode || "",
      product_name_la: r.product_name_la || "",
      product_name_en: r.product_name_en || "",
      vendor_code: r.vendor_code || "",
      vendor_name: r.vendor_display_name || "",
      vendor_display: vendorDisplay,
      spc_name: r.spc_name || vi?.spc_name || "",
      order_day: r.order_day || vi?.order_day || "",
      rank_sales: rank,
      rank_is_default: rankIsDefault,
      min_jmart: Number(r.min_jmart) || 0, max_jmart: Number(r.max_jmart) || 0,
      min_kokkok: Number(r.min_kokkok) || 0, max_kokkok: Number(r.max_kokkok) || 0,
      min_kokkok_fc: Number(r.min_kokkok_fc) || 0, max_kokkok_fc: Number(r.max_kokkok_fc) || 0,
      min_udee: Number(r.min_udee) || 0, max_udee: Number(r.max_udee) || 0,
      tt_min: 0, tt_max: 0,
      stock_dc: Number(r.stock_dc) || 0, stock_jmart: Number(r.stock_jmart) || 0,
      stock_kokkok: Number(r.stock_kokkok) || 0, stock_kokkok_fc: Number(r.stock_kokkok_fc) || 0, stock_udee: Number(r.stock_udee) || 0,
      tt_stock: 0, tt_stock_store: 0,
      avg_sales_jmart: Number(r.avg_sales_jmart) || 0,
      avg_sales_kokkok: Number(r.avg_sales_kokkok) || 0,
      avg_sales_kokkok_fc: Number(r.avg_sales_kokkok_fc) || 0,
      avg_sales_udee: Number(r.avg_sales_udee) || 0,
      avg_sales_tt: 0,
      moq, pack: null, box: null,
      po_cost: poCostVal, po_cost_unit: poCostUnit,
      orig_po_cost: poCostVal, orig_po_cost_unit: poCostUnit,
      safety: safetyDays, leadtime, order_cycle: orderCycle,
      tt_safety: leadtime + orderCycle + safetyDays,
      dc_min: 0, on_order: Number(r.on_order) || 0,
      orig_on_order: Number(r.on_order) || 0,
      gap_store: 0, gap_dc: 0,
      suggest_qty: 0, final_suggest_qty: 0, final_suggest_uom: 0,
      order_uom_edit: "",
      doh_asis: 0, doh_tobe: 0,
      calculated: true,
      item_type: (r as any).item_type || "",
      buying_status: (r as any).buying_status || "",
      unit_of_measure: (r as any).unit_of_measure || "",
      po_group: (r as any).po_group || "",
      division_group: (r as any).division_group || "",
      division: (r as any).division || "",
      department: (r as any).department || "",
      sub_department: (r as any).sub_department || "",
      class: (r as any).class || "",
      sub_class: (r as any).sub_class || "",
      orig_avg_sales_jmart: Number(r.avg_sales_jmart) || 0,
      orig_avg_sales_kokkok: Number(r.avg_sales_kokkok) || 0,
      orig_avg_sales_kokkok_fc: Number(r.avg_sales_kokkok_fc) || 0,
      orig_avg_sales_udee: Number(r.avg_sales_udee) || 0,
      orig_min_jmart: Number(r.min_jmart) || 0,
      orig_min_kokkok: Number(r.min_kokkok) || 0,
      orig_min_kokkok_fc: Number(r.min_kokkok_fc) || 0,
      orig_min_udee: Number(r.min_udee) || 0,
      orig_stock_dc: Number(r.stock_dc) || 0,
      orig_stock_jmart: Number(r.stock_jmart) || 0,
      orig_stock_kokkok: Number(r.stock_kokkok) || 0,
      orig_stock_kokkok_fc: Number(r.stock_kokkok_fc) || 0,
      orig_stock_udee: Number(r.stock_udee) || 0,
    };
    return recalcRow(row);
  });
}

// --- Saved views/PO/VendorDocs storage ---
export const VIEWS_KEY = "srr_column_views";
export function loadSavedViews(): ColumnView[] {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); } catch { return []; }
}
export function saveSavedViews(views: ColumnView[]) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

export const PO_KEY = "srr_saved_pos";

export function applyHighPrecisionFormat(ws: XLSX.WorkSheet, columnNames: string[] = ["Products to Purchase/Unit Price"]) {
  if (!ws || !ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const targetCols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const headerAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const headerCell = ws[headerAddr];
    if (headerCell && columnNames.includes(String(headerCell.v))) targetCols.push(c);
  }
  if (targetCols.length === 0) return;
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (const c of targetCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      if (typeof cell.v === "number") { cell.t = "n"; cell.z = "0.##########"; }
    }
  }
}

export function loadSavedPOs(): SavedPO[] {
  try { return JSON.parse(localStorage.getItem(PO_KEY) || "[]"); } catch { return []; }
}
export function saveSavedPOs(pos: SavedPO[]) {
  try {
    localStorage.setItem(PO_KEY, JSON.stringify(pos));
  } catch (e) {
    console.error("localStorage save failed:", e);
    if (pos.length > 10) {
      const trimmed = pos.slice(-10);
      try { localStorage.setItem(PO_KEY, JSON.stringify(trimmed)); } catch { }
    }
    throw new Error("พื้นที่จัดเก็บเต็ม กรุณาลบ PO เก่าก่อน");
  }
}

export const VENDOR_DOCS_KEY = "srr_vendor_docs";
export function loadVendorDocs(): VendorDocument[] {
  try {
    const raw = localStorage.getItem(VENDOR_DOCS_KEY);
    if (!raw) return [];
    const docs: VendorDocument[] = JSON.parse(raw);
    return docs.filter(d => isWithin30Days(d.date_key));
  } catch { return []; }
}
export function saveVendorDocs(docs: VendorDocument[]) {
  try { localStorage.setItem(VENDOR_DOCS_KEY, JSON.stringify(docs)); } catch { /* storage full */ }
}

export function getDateKey(d?: Date): string {
  const now = d || new Date();
  return now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
}
export function isWithin30Days(dateKey: string): boolean {
  const y = parseInt(dateKey.substring(0, 4));
  const m = parseInt(dateKey.substring(4, 6)) - 1;
  const d = parseInt(dateKey.substring(6, 8));
  const docDate = new Date(y, m, d);
  const diffMs = new Date().getTime() - docDate.getTime();
  return diffMs < 30 * 24 * 60 * 60 * 1000;
}

export function stripSeconds(name: string): string {
  return name.replace(/^(\d{12})\d{2}/, "$1");
}
export function formatLocalBatchLabel(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

export function getLocalPOBatches(storageKey: string): SnapshotBatch[] {
  let pos: SavedPO[] = [];
  try { pos = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { pos = []; }
  const groups = new Map<string, { value: string; date_key: string; count: number }>();
  for (const po of pos) {
    if (!po.date) continue;
    const sec = String(po.date).slice(0, 19);
    const existing = groups.get(sec);
    if (existing) { existing.count += 1; }
    else { groups.set(sec, { value: po.date, date_key: po.date.split("T")[0], count: 1 }); }
  }
  return [...groups.values()]
    .sort((a, b) => b.value.localeCompare(a.value))
    .map((g) => ({ value: g.value, label: formatLocalBatchLabel(g.value), date_key: g.date_key, count: g.count }));
}
