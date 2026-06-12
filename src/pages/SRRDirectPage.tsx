import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchCoreItemMap, coreItemLabel, coreItemRanking } from "@/lib/coreItemService";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Calculator,
  Download,
  ChevronLeft,
  ChevronRight,
  Database,
  Search,
  X,
  FileSpreadsheet,
  Check,
  CheckSquare,
  Columns,
  XCircle,
  Save,
  Eye,
  ChevronDown,
  ChevronUp as ChevronUpIcon,
  RefreshCw,
  Filter,
  Play,
  Trash2,
  FolderOpen,
  CalendarDays,
  Upload,
  BarChart3,
  Info,
  RotateCcw,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { SRRReportTab } from "@/components/SRRReportTab";
import { SRRReport2Tab } from "@/components/SRRReport2Tab";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import { buildSRRDirectFormulaRow, buildSheetWithFormulaRow } from "@/lib/srrExportFormulas";
import {
  SrrImportFilter,
  type SrrImportMode,
  type ImportedItem,
  type ImportedVendor,
} from "@/components/SrrImportFilter";
import { SrrFiltersPopover } from "@/components/SrrFiltersPopover";
import { ImportSkipDialog, ImportSkipBar, type SkippedItem } from "@/components/ImportSkipDialog";
import { enrichSkippedSkusAfterRead, buildVendorEmptyResultSkips } from "@/lib/srrPostReadSkip";
import { TableChipSearch, applyChipFilter, type SearchChip } from "@/components/TableChipSearch";
import { getLatestRangeStorePackBox } from "@/lib/rangeStorePackBox";
import { SnapshotBatchPicker } from "@/components/SnapshotBatchPicker";
import {
  buildSnapshotBatchesFromDocs,
  deleteSnapshotDocuments,
  fetchSnapshotDataByIds,
  getSnapshotBatches,
  loadSnapshotBatch,
  mergeSnapshotBatches,
  pruneOldSnapshots,
  type SnapshotBatch,
} from "@/lib/snapshotService";
import { ListImportPO, getLocalPOBatches, applyHighPrecisionFormat } from "@/components/ListImportPO";
import { DocsPopupDialog, formatDocNo, type DocRow } from "@/components/DocsPopupDialog";
import { FinalDocsPopupDialog, type FinalDocRow } from "@/components/FinalDocsPopupDialog";
import { buildCost0Doc, appendCost0Docs, COST0_KEY_D2S, type Cost0Doc } from "@/lib/cost0Docs";
import { listPublicViews, savePublicView, deletePublicView, type SrrPublicView } from "@/lib/srrPublicViews";

// --- Types ---
interface D2SRow {
  id: string;
  sku_code: string;
  main_barcode: string;
  /** Main barcode of the data_master row where packing_size_qty=1 (Unit pack) */
  barcode_unit: string;
  product_name_la: string;
  product_name_en: string;
  vendor_code: string;
  vendor_display: string;
  spc_name: string;
  order_day: string;
  delivery_day: string;
  trade_term: string;
  rank_sales: string;
  rank_is_default: boolean;
  store_name: string;
  type_store: string;
  unit_name: string;
  avg_sales_store: number;
  orig_avg_sales_store: number;
  min_store: number;
  max_store: number;
  stock_store: number;
  orig_stock_store: number;
  stock_dc: number;
  order_cycle: number;
  orig_order_cycle: number;
  leadtime: number;
  srr_suggest: number;
  on_order_store: number;
  orig_on_order_store: number;
  final_order_qty: number;
  moq: number;
  pack: number | null;
  box: number | null;
  final_order_uom: number;
  /** FinalOrder UOM = FinalOrderR_up / MOQ (display column, ROUNDUP) */
  final_order_uom_div: number;
  order_uom_edit: string;
  doh_asis: number;
  doh_tobe: number;
  po_cost: number;
  po_cost_unit: number;
  /** Original PO cost from DB (before any import override) */
  orig_po_cost: number;
  orig_po_cost_unit: number;
  item_type: string;
  buying_status: string;
  unit_of_measure: string;
  po_group: string;
  // Data Master classification fields (added per spec A→AJ)
  division_group: string;
  division: string;
  department: string;
  sub_department: string;
  class_name: string;
  sub_class: string;
  calculated: boolean;
  safety: number;
  /** True when row was populated by Import Mode (Qty from Excel imported to Order UOM EDIT).
   *  In this case FinalOrder UOM column displays Qty × MOQ instead of the original formula. */
  is_import_row?: boolean;
}

interface VendorDocument {
  id: string;
  vendor_code: string;
  vendor_display: string;
  store_name: string;
  type_store: string;
  spc_name: string;
  date_key: string;
  created_at: string;
  item_count: number;
  suggest_count: number;
  data: D2SRow[];
  edit_count: number;
  edited_columns: string[];
  /** Source mode that generated this document — used to split tree by Filter / Vendor / Barcode */
  source?: "filter" | "vendor" | "import";
  user_id?: string;
}

// --- Helpers ---
async function fetchAllRows<T>(table: string, selectCols: string, filter?: (q: any) => any): Promise<T[]> {
  const all: T[] = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    let q: any = (supabase as any)
      .from(table)
      .select(selectCols)
      .range(offset, offset + batchSize - 1);
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

// --- D2S Snapshot DB persistence ---
function dateKeyToISO(dk: string): string {
  // YYYYMMDD -> YYYY-MM-DD
  if (dk.includes("-")) return dk;
  return `${dk.substring(0, 4)}-${dk.substring(4, 6)}-${dk.substring(6, 8)}`;
}
function isoToDateKey(iso: string): string {
  // YYYY-MM-DD -> YYYYMMDD
  return iso.replace(/-/g, "").substring(0, 8);
}

const D2S_META_FIELDS = "id, vendor_code, vendor_display, spc_name, store_name, type_store, date_key, created_at, updated_at, item_count, suggest_count, edit_count, edited_columns, source, user_id";

async function loadD2SSnapshots(): Promise<any[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const { data, error } = await (supabase as any)
    .from("srr_d2s_snapshots")
    .select(D2S_META_FIELDS)
    .gte("date_key", cutoffStr)
    .order("date_key", { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, data: [] }));
}

// Get distinct snapshot dates (YYYY-MM-DD) within last 30 days
async function getD2SSnapshotDates(): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const { data, error } = await (supabase as any)
    .from("srr_d2s_snapshots")
    .select("date_key")
    .gte("date_key", cutoffStr)
    .order("date_key", { ascending: false });
  if (error) throw error;
  const dates = [...new Set(((data || []) as any[]).map((r: any) => r.date_key as string))] as string[];
  return dates;
}

// Load snapshots for a specific date (YYYY-MM-DD) — metadata only, data loaded lazily
async function loadD2SSnapshotsByDate(dateKey: string): Promise<any[]> {
  const { data, error } = await (supabase as any)
    .from("srr_d2s_snapshots")
    .select(D2S_META_FIELDS)
    .eq("date_key", dateKey)
    .order("spc_name", { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, data: [] }));
}

async function saveD2SSnapshots(
  docs: {
    spc_name: string;
    vendor_code: string;
    vendor_display: string;
    store_name: string;
    type_store: string;
    source: string;
    item_count: number;
    suggest_count: number;
    data: any[];
    edit_count: number;
    edited_columns: string[];
  }[],
  userId: string,
  dateKey: string,
  createdAtIso?: string,
  onProgress?: (info: { phase: "delete" | "insert"; current: number; total: number; rowsCurrent?: number; rowsTotal?: number }) => void,
): Promise<void> {
  // Compute minute window for this batch (preserves earlier Read & Cal runs)
  let windowStartIso: string | null = null;
  let windowEndIso: string | null = null;
  if (createdAtIso) {
    const start = new Date(createdAtIso); start.setSeconds(0, 0);
    const end = new Date(start.getTime() + 60_000);
    windowStartIso = start.toISOString();
    windowEndIso = end.toISOString();
  }
  const totalRows = docs.reduce((s, d) => s + (d.item_count || (d.data?.length || 0)), 0);

  // Overwrite only the exact Direct document keys being re-saved.
  const pairs = [...new Set(docs.map((d) => `${d.spc_name}||${d.source || "filter"}||${d.vendor_code}||${d.store_name}`))];
  let pi = 0;
  // Run deletes in chunks of 20 in parallel for speed but still report progress
  const chunkSize = 20;
  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize);
    await Promise.all(chunk.map((pair) => {
      const [spc, src, vendorCode, storeName] = pair.split("||");
      let q = (supabase as any)
        .from("srr_d2s_snapshots")
        .delete()
        .eq("date_key", dateKey)
        .eq("spc_name", spc)
        .eq("source", src)
        .eq("vendor_code", vendorCode)
        .eq("store_name", storeName);
      if (windowStartIso && windowEndIso) {
        q = q.gte("created_at", windowStartIso).lt("created_at", windowEndIso);
      }
      return q;
    }));
    pi += chunk.length;
    onProgress?.({ phase: "delete", current: pi, total: pairs.length });
  }

  const batchSize = 50;
  let rowsDone = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const slice = docs.slice(i, i + batchSize);
    const batch = slice.map((d) => {
      const row: any = {
        date_key: dateKey,
        spc_name: d.spc_name,
        vendor_code: d.vendor_code,
        vendor_display: d.vendor_display,
        store_name: d.store_name,
        type_store: d.type_store,
        source: d.source,
        item_count: d.item_count,
        suggest_count: d.suggest_count,
        data: d.data,
        edit_count: d.edit_count,
        edited_columns: d.edited_columns,
        user_id: userId,
      };
      if (createdAtIso) row.created_at = new Date(createdAtIso).toISOString();
      return row;
    });
    const { error } = await (supabase as any).from("srr_d2s_snapshots").insert(batch);
    if (error) throw error;
    rowsDone += slice.reduce((s, d) => s + (d.item_count || (d.data?.length || 0)), 0);
    onProgress?.({
      phase: "insert",
      current: Math.min(i + batchSize, docs.length),
      total: docs.length,
      rowsCurrent: rowsDone,
      rowsTotal: totalRows,
    });
  }
}

async function deleteD2SSnapshot(id: string): Promise<void> {
  await (supabase as any).from("srr_d2s_snapshots").delete().eq("id", id);
}

export interface D2SHierarchyFilter {
  divisionGroups?: string[] | null;
  divisions?: string[] | null;
  departments?: string[] | null;
  subDepartments?: string[] | null;
  classes?: string[] | null;
  subClasses?: string[] | null;
}
async function fetchD2SDataRPC(
  vendorCodes: string[] | null,
  spcNames: string[] | null,
  orderDays: string[] | null,
  itemTypes: string[] | null,
  hierarchy?: D2SHierarchyFilter,
  onProgress?: (loaded: number) => void,
  skuCodes?: string[] | null,
): Promise<any[]> {
  const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
  const skipDefaults = await hasActiveFilterTemplates("srr_direct");
  const baseParams: any = {
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
    p_skip_default_filters: skipDefaults,
  };
  if (skuCodes && skuCodes.length > 0) {
    baseParams.p_sku_codes = skuCodes;
  }
  // JSON wrapper — returns one JSONB row containing all data, bypasses PostgREST 1000-row cap
  let { data, error } = await (supabase
    .rpc("get_srr_d2s_data_json" as any, baseParams) as any)
    .abortSignal(AbortSignal.timeout(240000));
  if (error && baseParams.p_sku_codes && /p_sku_codes|unknown|does not exist|argument/i.test(error.message || "")) {
    console.warn("[fetchD2SDataRPC] p_sku_codes not supported, retrying without it:", error.message);
    delete baseParams.p_sku_codes;
    ({ data, error } = await (supabase
      .rpc("get_srr_d2s_data_json" as any, baseParams) as any)
      .abortSignal(AbortSignal.timeout(240000)));
  }
  if (error) throw error;
  const allRows: any[] = Array.isArray(data) ? data : (data || []);
  onProgress?.(allRows.length);
  return allRows;
}

/**
 * PARALLEL paginated fetch — fetches first page sequentially, then if it's full,
 * speculatively fetches subsequent pages in parallel batches (4 at a time).
 * Falls back to sequential for the last partial page.
 * Returns ALL rows for the given filter set in fewer round trips.
 */
async function fetchD2SDataRPCFast(
  vendorCodes: string[] | null,
  spcNames: string[] | null,
  orderDays: string[] | null,
  itemTypes: string[] | null,
  hierarchy?: D2SHierarchyFilter,
  onProgress?: (loaded: number) => void,
  skuCodes?: string[] | null,
): Promise<any[]> {
  const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
  const skipDefaults = await hasActiveFilterTemplates("srr_direct");
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

  // JSON wrapper — returns one JSONB row containing all data, bypasses PostgREST 1000-row cap
  const { data, error } = await (supabase
    .rpc("get_srr_d2s_data_json" as any, params) as any)
    .abortSignal(AbortSignal.timeout(240000));
  if (error) throw error;
  const allRows: any[] = Array.isArray(data) ? data : (data || []);
  onProgress?.(allRows.length);
  return allRows;
}

// --- Per-session cache for Read & Cal raw RPC results ---
// Key = JSON of all RPC params; TTL = 5 minutes. Reused across button clicks
// when filters didn't change → instant re-display.
const D2S_RPC_CACHE = new Map<string, { ts: number; rows: any[] }>();
const D2S_RPC_CACHE_TTL_MS = 5 * 60 * 1000;

// --- Cache for filter option RPCs (30 min) ---
const D2S_FILTER_CACHE_TTL = 30 * 60 * 1000;
const _d2sFilterCache: {
  preFilterOptions?: { data: any; ts: number };
  hierarchyOptions?: { data: any; ts: number; skipDefaults: boolean };
} = {};
const D2S_SESSION_KEY_PRE = "srr_pre_filter_options";
const D2S_SESSION_KEY_HIER = "srr_hierarchy_options";

function d2sSessionCacheGet<T>(key: string, ttl: number): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: { data: T; ts: number } = JSON.parse(raw);
    if (Date.now() - parsed.ts > ttl) return null;
    return parsed as T;
  } catch { return null; }
}

function d2sSessionCacheSet(key: string, data: any): void {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}
function makeRpcCacheKey(p: Record<string, any>): string {
  const norm: Record<string, any> = {};
  for (const k of Object.keys(p).sort()) {
    const v = p[k];
    norm[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return JSON.stringify(norm);
}

// --- Calculation ---
const SAFETY_BY_RANK: Record<string, number> = { A: 21, B: 14, C: 10, D: 7 };


function recalcD2SRow(row: D2SRow): D2SRow {
  // SRR Suggest = IF(IF(Stock<=0,0,Stock) <= Min, Min - IF(Stock<=0,0,Stock) + Avg*OC, 0)
  const stockClamped = row.stock_store <= 0 ? 0 : row.stock_store;
  let srrSuggest = 0;
  if (row.min_store > 0 && stockClamped <= row.min_store) {
    srrSuggest = row.min_store - stockClamped + row.avg_sales_store * row.order_cycle;
  }
  srrSuggest = Math.max(0, srrSuggest);

  const moq = row.moq || 1;

  // FinalOrder Qty = IF(SRR Suggest - On Order <= 0, 0, ROUNDUP((SRR Suggest - On Order)/MOQ)*MOQ)
  const rawFinalQty = Math.max(srrSuggest - row.on_order_store, 0);
  const calcFinalOrderQty = rawFinalQty === 0 ? 0 : moq > 0 ? Math.ceil(rawFinalQty / moq) * moq : rawFinalQty;
  // FinalOrder UOM = IFERROR(ROUNDUP(Qty/MOQ, 0), 0)  [integer UOM count]
  const calcFinalOrderUom = moq > 0 ? Math.ceil(calcFinalOrderQty / moq) : 0;

  // Order UOM EDIT override: when user enters a UOM qty (or import provides Qty),
  // it overrides FinalOrder so Save PO / suggest counters recognize the quantity.
  const hasUomEdit = row.order_uom_edit !== "" && row.order_uom_edit != null && !isNaN(Number(row.order_uom_edit));
  const uomEditNum = hasUomEdit ? Number(row.order_uom_edit) : 0;
  const finalOrderQty = hasUomEdit ? uomEditNum * moq : calcFinalOrderQty;
  // FinalOrderR_up (column AF):
  //  - Import mode: when row came from Import Barcode → display Qty × MOQ (Order UOM EDIT × MOQ)
  //  - Filter mode: keep original formula (UomEdit override OR ROUNDUP(Qty/MOQ))
  const finalOrderUom =
    row.is_import_row && hasUomEdit ? uomEditNum * moq : hasUomEdit ? uomEditNum : calcFinalOrderUom;
  const effectiveFinal = finalOrderQty;

  // AsIs DOH = IFERROR(Stock/Avg, 0)
  const dohAsis = row.avg_sales_store > 0 ? row.stock_store / row.avg_sales_store : 0;
  // ToBe DOH per Excel literal: IFERROR((Stock+FinalQty+OnOrder)-(Avg*OC)/Avg, 0)
  // Operator precedence: (Stock+FinalQty+OnOrder) - ((Avg*OC)/Avg) = (Stock+FinalQty+OnOrder) - OC
  const dohTobe = row.avg_sales_store > 0 ? row.stock_store + effectiveFinal + row.on_order_store - row.order_cycle : 0;

  // FinalOrder UOM (new column) = ROUNDUP(FinalOrderR_up / MOQ, 0)
  const finalOrderUomDiv = moq > 0 ? Math.ceil(finalOrderUom / moq) : 0;

  return {
    ...row,
    srr_suggest: Math.round(srrSuggest * 100) / 100,
    final_order_qty: Math.round(finalOrderQty * 100) / 100,
    final_order_uom: Math.round(finalOrderUom * 100) / 100,
    final_order_uom_div: finalOrderUomDiv,
    doh_asis: Math.round(dohAsis * 100) / 100,
    doh_tobe: Math.round(dohTobe * 100) / 100,
  };
}

function buildD2SRows(rawRows: any[]): D2SRow[] {
  return rawRows.map((r: any, idx: number) => {
    const rank = r.rank_sales || "D";
    const rankIsDefault = !r.rank_sales || r.rank_sales === "" || r.rank_sales === "D";
    const moq = Number(r.moq) || 1;
    const poCostVal = Number(r.po_cost) || 0;
    const poCostUnit = Number(r.po_cost_unit) || (moq > 0 ? poCostVal / moq : 0);
    const vendorDisplay = r.vendor_code ? `${r.vendor_code} - ${r.vendor_display_name || r.vendor_code}` : "";
    const oc = Number(r.order_cycle) || 0;

    const row: D2SRow = {
      id: `d2s-${r.sku_code || idx}-${r.store_name || idx}`,
      sku_code: r.sku_code || "",
      main_barcode: r.main_barcode || "",
      barcode_unit: r.barcode_unit || "",
      product_name_la: r.product_name_la || "",
      product_name_en: r.product_name_en || "",
      vendor_code: r.vendor_code || "",
      vendor_display: vendorDisplay,
      spc_name: r.spc_name || "",
      order_day: r.order_day || "",
      delivery_day: r.delivery_day || "",
      trade_term: r.trade_term || "",
      rank_sales: rank,
      rank_is_default: rankIsDefault,
      store_name: r.store_name || "",
      type_store: r.type_store || "",
      unit_name: `1x${moq}`,
      avg_sales_store: Number(r.avg_sales_store) || 0,
      orig_avg_sales_store: Number(r.avg_sales_store) || 0,
      min_store: Number(r.min_store) || 0,
      max_store: Number(r.max_store) || 0,
      stock_store: Number(r.stock_store) || 0,
      orig_stock_store: Number(r.stock_store) || 0,
      stock_dc: Number(r.stock_dc) || 0,
      order_cycle: oc,
      orig_order_cycle: oc,
      leadtime: Number(r.leadtime) || 0,
      srr_suggest: 0,
      on_order_store: Number(r.on_order_store) || 0,
      orig_on_order_store: Number(r.on_order_store) || 0,
      final_order_qty: 0,
      moq,
      pack: null,
      box: null,
      final_order_uom: 0,
      final_order_uom_div: 0,
      order_uom_edit: "",
      doh_asis: 0,
      doh_tobe: 0,
      po_cost: poCostVal,
      po_cost_unit: poCostUnit,
      orig_po_cost: poCostVal,
      orig_po_cost_unit: poCostUnit,
      item_type: r.item_type || "",
      buying_status: r.buying_status || "",
      unit_of_measure: r.unit_of_measure || "",
      po_group: r.po_group || "",
      division_group: r.division_group || "",
      division: r.division || "",
      department: r.department || "",
      sub_department: r.sub_department || "",
      class_name: r.class || "",
      sub_class: r.sub_class || "",
      calculated: true,
      safety: SAFETY_BY_RANK[rank?.toUpperCase()] ?? 7,
    };
    return recalcD2SRow(row);
  });
}

// --- Columns (Spec A→AJ exact order) ---
const D2S_COLUMNS: { key: keyof D2SRow | "ranking" | "core_item"; label: string; group?: string }[] = [
  { key: "store_name", label: "Store Name" }, // A
  { key: "type_store", label: "Type Store" }, // B
  { key: "division_group", label: "Division Group" }, // C
  { key: "division", label: "Division" }, // D
  { key: "department", label: "Department" }, // E
  { key: "sub_department", label: "Sub-Department" }, // F
  { key: "class_name", label: "Class" }, // G
  { key: "sub_class", label: "Sub-Class" }, // H
  { key: "item_type", label: "Item Type" }, // I
  { key: "buying_status", label: "Buying Status" }, // J
  { key: "vendor_display", label: "Vendor" }, // K
  { key: "po_group", label: "PO Group" }, // L
  { key: "trade_term", label: "Trade Term" }, // M
  { key: "spc_name", label: "SPC Name" }, // N
  { key: "order_day", label: "Order Day" }, // O
  { key: "delivery_day", label: "Delivery Day" }, // P
  { key: "sku_code", label: "ID (SKU)" }, // Q
  { key: "barcode_unit", label: "Barcode Unit" }, // Q2 (between SKU and Product Name LA)
  { key: "product_name_la", label: "Product Name (LA)" }, // R
  { key: "product_name_en", label: "Product Name (EN)" }, // S
  { key: "rank_sales", label: "Sale Rank" }, // T
  { key: "ranking", label: "Ranking" }, // derive จาก core_item ตอนแสดงผล
  { key: "core_item", label: "Core Item" }, // derive จาก core_item ตอนแสดงผล
  { key: "avg_sales_store", label: "Avg Unit Sale/Day", group: "Sales" }, // V
  { key: "min_store", label: "Min Store", group: "Min/Max" }, // W
  { key: "stock_store", label: "Store Stock", group: "Stock" }, // X
  { key: "stock_dc", label: "Stock DC", group: "Stock" }, // Y
  { key: "order_cycle", label: "Order Cycle" }, // Z
  { key: "leadtime", label: "LeadTimeDelivery" }, // AA
  { key: "srr_suggest", label: "SRR Suggest (pcs)" }, // AB
  { key: "on_order_store", label: "On Order (pcs)" }, // AC
  { key: "final_order_qty", label: "FinalOrder Qty" }, // AD
  { key: "moq", label: "MOQ" }, // AE
  { key: "pack", label: "Pack" },
  { key: "box", label: "Box" },
  { key: "final_order_uom", label: "FinalOrderR_up" }, // AF (renamed from "FinalOrder UOM")
  { key: "final_order_uom_div", label: "FinalOrder UOM" }, // AF2 (= FinalOrderR_up / MOQ)
  { key: "unit_name", label: "UnitName" }, // moved: now after FinalOrder UOM
  { key: "order_uom_edit", label: "Order UOM EDIT" }, // AG
  { key: "doh_asis", label: "AsIs DOH" }, // AH
  { key: "doh_tobe", label: "ToBe DOH" }, // AI
  { key: "po_cost_unit", label: "PO Cost Unit" }, // AJ
];

const ALL_D2S_KEYS = D2S_COLUMNS.map((c) => c.key);
// Default columns ที่แสดงตอนเปิดหน้า (ที่เหลือซ่อนไว้ ผู้ใช้ติกเพิ่มเองได้)
const DEFAULT_D2S_VISIBLE = new Set<string>([
  "store_name",
  "division",
  "vendor_display",
  "sku_code",
  "product_name_la",
  "rank_sales",
  "ranking",
  "core_item",
  "avg_sales_store",
  "min_store",
  "stock_store",
  "stock_dc",
  "on_order_store",
  "final_order_uom",
  "final_order_uom_div",
  "unit_name",
  "order_uom_edit",
  "doh_asis",
  "doh_tobe",
  "po_cost_unit",
]);
const HIGHLIGHT_D2S = new Set([
  "srr_suggest",
  "final_order_qty",
  "final_order_uom",
  "final_order_uom_div",
  "doh_asis",
  "doh_tobe",
  "stock_dc",
]);
const TRUNCATE_D2S = new Set(["product_name_la", "product_name_en", "vendor_display", "store_name"]);
const EDITABLE_D2S = new Set(["order_uom_edit", "order_cycle"]);
const DOH_RED_THRESHOLD_D2S = 30;

function formatCellValue(val: any, key: string): string {
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

function getDefaultWidth(key: string): number {
  if (TRUNCATE_D2S.has(key)) return 180;
  if (key === "vendor_display") return 200;
  if (key === "store_name") return 140;
  if (key === "sku_code" || key === "main_barcode" || key === "barcode_unit") return 120;
  if (key === "order_uom_edit") return 110;
  return 90;
}

// --- Date helpers ---
function getDateKey(): string {
  const now = new Date();
  return (
    now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0")
  );
}

function isWithin30Days(dateKey: string): boolean {
  const y = parseInt(dateKey.substring(0, 4));
  const m = parseInt(dateKey.substring(4, 6)) - 1;
  const d = parseInt(dateKey.substring(6, 8));
  const docDate = new Date(y, m, d);
  return new Date().getTime() - docDate.getTime() < 30 * 24 * 60 * 60 * 1000;
}

/**
 * Build a batch key "yyyymmddHHMM" from a doc's created_at.
 * Docs from the same Read & Cal run share the same minute → same batch.
 */
function getBatchKey(doc: { date_key: string; created_at?: string }): string {
  if (!doc.created_at) return doc.date_key.replace(/-/g, "");
  const dt = new Date(doc.created_at);
  if (isNaN(dt.getTime())) return doc.date_key.replace(/-/g, "");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}${p(dt.getHours())}${p(dt.getMinutes())}`;
}

/**
 * Display label for a batch key — same as key (yyyymmddHHMM).
 */
function fmtTreeStamp(batchKey: string, _docs: { created_at?: string }[]): string {
  return batchKey;
}
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = true,
  compact = false,
}: {
  label: string;
  options: { value: string; display: string }[];
  selected: string[];
  onChange: (val: string[]) => void;
  searchable?: boolean;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = searchable
    ? options.filter(
        (o) =>
          o.display.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : options;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "text-xs justify-between",
            compact ? "h-7 min-w-[100px] max-w-[180px] px-2" : "h-8 min-w-[120px] max-w-[200px]",
          )}
        >
          <span className="truncate">{selected.length === 0 ? label : `${label} (${selected.length})`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {searchable && (
          <div className="flex items-center gap-1 mb-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="ค้นหา..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => onChange(filtered.map((o) => o.value))}
          >
            เลือกทั้งหมด
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([])}>
            ล้าง
          </Button>
        </div>
        <ScrollArea className="h-48">
          {filtered.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer">
              <Checkbox
                checked={selected.includes(opt.value)}
                onCheckedChange={(checked) => {
                  onChange(checked ? [...selected, opt.value] : selected.filter((v) => v !== opt.value));
                }}
              />
              <span className="text-xs truncate">{opt.display}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4">ไม่พบข้อมูล</p>}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// MAIN D2S PAGE
// ============================================================
const d2sStateRef = { current: null as any };

// Real-time elapsed seconds since `startedAt` (ms). Re-renders every 100ms.
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = ((Date.now() - startedAt) / 1000).toFixed(1);
  return <span className="text-[11px] font-mono tabular-nums text-primary font-semibold">⏱ {s}s</span>;
}


export default function SRRDirectPage() {
  const { user, canDo } = useAuth();
  const canDeleteDoc = canDo("direct_item", "delete");
  const [vendorDocs, setVendorDocsRaw] = useState<VendorDocument[]>(d2sStateRef.current?.vendorDocs || []);
  const setVendorDocs = useCallback((updater: VendorDocument[] | ((prev: VendorDocument[]) => VendorDocument[])) => {
    setVendorDocsRaw((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const [loading, setLoading] = useState(false);
  const [calcProgress, setCalcProgress] = useState(0);
  const [loadingPhase, setLoadingPhase] = useState("");
  const [loadingDetail, setLoadingDetail] = useState("");
  const [calcStartedAt, setCalcStartedAt] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>(d2sStateRef.current?.activeTab || "read-cal");
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const [finalDocsDialogOpen, setFinalDocsDialogOpen] = useState(false);
  const [finalDocs, setFinalDocs] = useState<any[]>([]);
  const [finalDocsLoading, setFinalDocsLoading] = useState(false);
  const [calConfirmOpen, setCalConfirmOpen] = useState(false);
  const cancelCalcRef = useRef(false);
  const [dataReady, setDataReady] = useState(false);
  const [dataLoadingMsg, setDataLoadingMsg] = useState("");
  const [statusBanner, setStatusBanner] = useState<{ title: string; detail?: string } | null>(null);
  useEffect(() => {
    if (!statusBanner) return;
    const t = setTimeout(() => setStatusBanner(null), 12000);
    return () => clearTimeout(t);
  }, [statusBanner]);

  // Snapshot date filter (mirrors DC)
  const [snapshotDates, setSnapshotDates] = useState<string[]>([]);
  const [snapshotBatches, setSnapshotBatches] = useState<SnapshotBatch[]>([]);
  const [poRefreshKey, setPoRefreshKey] = useState(0);
  const [cost0RefreshKey, setCost0RefreshKey] = useState(0);
  // Filter Date is per-mode (Filter / Vendor / Import) so each mode keeps its own date selection
  const [selectedBatchValuesByMode, setSelectedBatchValuesByMode] = useState<
    Record<"filter" | "vendor" | "import", string[]>
  >(d2sStateRef.current?.selectedBatchValuesByMode || { filter: [], vendor: [], import: [] });
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [snapshotLoadLabel, setSnapshotLoadLabel] = useState("");
  const [snapshotLoadedRows, setSnapshotLoadedRows] = useState(0);
  // Doc ids from the most recent Read & Cal — used to auto-tick & highlight in Doc dialog
  const [latestImportedDocIds, setLatestImportedDocIds] = useState<string[]>([]);
  const listPoBatches = useMemo(() => getLocalPOBatches("srr_saved_pos_d2s"), [poRefreshKey]);
  const documentBatches = useMemo(
    () => mergeSnapshotBatches(buildSnapshotBatchesFromDocs(vendorDocs), snapshotBatches),
    [vendorDocs, snapshotBatches],
  );

  // SPC selection
  const [selectedSpcForCal, setSelectedSpcForCal] = useState<string[]>([]);
  const [spcOptions, setSpcOptions] = useState<{ value: string; display: string }[]>([]);

  // Vendor filter for Read & Cal (subset)
  const [vendorFilterCal, setVendorFilterCal] = useState<string[]>([]);
  const [vendorOptionsForCal, setVendorOptionsForCal] = useState<{ value: string; display: string }[]>([]);
  // Type Store filter for Read & Cal (Jmart / Kokkok / U-dee)
  const [typeStoreCal, setTypeStoreCal] = useState<string[]>([]);
  // PRE-PREPARE filters
  const [orderDayCal, setOrderDayCal] = useState<string[]>([]);
  const [itemTypeCal, setItemTypeCal] = useState<string[]>([]);
  const [storeCal, setStoreCal] = useState<string[]>([]);
  const [buyingStatusCal, setBuyingStatusCal] = useState<string[]>([]);
  const [poGroupCal, setPoGroupCal] = useState<string[]>([]);
  // Product hierarchy filters (cascading) — applied at Read & Cal via RPC params
  const [divisionGroupCal, setDivisionGroupCal] = useState<string[]>([]);
  const [divisionCal, setDivisionCal] = useState<string[]>([]);
  const [departmentCal, setDepartmentCal] = useState<string[]>([]);
  const [subDepartmentCal, setSubDepartmentCal] = useState<string[]>([]);
  const [classCal, setClassCal] = useState<string[]>([]);
  const [subClassCal, setSubClassCal] = useState<string[]>([]);
  const [hierarchyRows, setHierarchyRows] = useState<{
    division_group: string; division: string; department: string;
    sub_department: string; class: string; sub_class: string;
  }[]>([]);
  const [vendorMasterAll, setVendorMasterAll] = useState<
    { vendor_code: string; vendor_name: string; spc_name: string; order_day: string; supplier_currency: string; purchase_agreement_vat: string }[]
  >([]);
  const [preFilterOptions, setPreFilterOptions] = useState<{
    itemTypes: { value: string; display: string }[];
    buyingStatuses: { value: string; display: string }[];
    poGroups: { value: string; display: string }[];
    stores: { value: string; display: string }[];
  }>({ itemTypes: [], buyingStatuses: [], poGroups: [], stores: [] });
  const TYPE_STORE_OPTIONS = useMemo(
    () => [
      { value: "Jmart", display: "Jmart" },
      { value: "Kokkok", display: "Kokkok" },
      { value: "Kokkok-Fc", display: "Kokkok-fc" },
      { value: "U-dee", display: "U-dee" },
    ],
    [],
  );

  // PRE-PREPARE: Cascading filters — each option list narrows by the OTHER two selections
  const preSpcOptions = useMemo(() => {
    const pool = vendorMasterAll.filter((v) =>
      (vendorFilterCal.length === 0 || vendorFilterCal.includes(v.vendor_code)) &&
      (orderDayCal.length === 0 || orderDayCal.includes(v.order_day))
    );
    return [...new Set(pool.map((v) => v.spc_name).filter(Boolean))].sort().map((s) => ({ value: s, display: s }));
  }, [vendorMasterAll, vendorFilterCal, orderDayCal]);
  const preVendorOptions = useMemo(() => {
    const pool = vendorMasterAll.filter((v) =>
      (selectedSpcForCal.length === 0 || selectedSpcForCal.includes(v.spc_name)) &&
      (orderDayCal.length === 0 || orderDayCal.includes(v.order_day))
    );
    const seen = new Map<string, { name: string; cur: string; pa: string }>();
    for (const v of pool) if (v.vendor_code && !seen.has(v.vendor_code)) seen.set(v.vendor_code, { name: v.vendor_name, cur: v.supplier_currency, pa: v.purchase_agreement_vat });
    return [...seen.entries()]
      .map(([k, info]) => ({ value: k, display: `${k} - ${info.name}` }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [vendorMasterAll, selectedSpcForCal, orderDayCal]);
  const preOrderDayOptions = useMemo(() => {
    const pool = vendorMasterAll.filter((v) =>
      (selectedSpcForCal.length === 0 || selectedSpcForCal.includes(v.spc_name)) &&
      (vendorFilterCal.length === 0 || vendorFilterCal.includes(v.vendor_code))
    );
    return [...new Set(pool.map((v) => v.order_day).filter(Boolean))].sort().map((d) => ({ value: d, display: d }));
  }, [vendorMasterAll, selectedSpcForCal, vendorFilterCal]);

  // Cascading hierarchy options — each list narrowed by OTHER 5 selections
  const hierarchySel = useMemo(() => ({
    division_group: divisionGroupCal,
    division: divisionCal,
    department: departmentCal,
    sub_department: subDepartmentCal,
    class: classCal,
    sub_class: subClassCal,
  }), [divisionGroupCal, divisionCal, departmentCal, subDepartmentCal, classCal, subClassCal]);

  const buildHierOpts = useCallback((field: "division_group" | "division" | "department" | "sub_department" | "class" | "sub_class") => {
    const pool = hierarchyRows.filter(row => {
      for (const k of Object.keys(hierarchySel) as (keyof typeof hierarchySel)[]) {
        if (k === field) continue;
        const sel = hierarchySel[k];
        if (sel.length === 0) continue;
        if (!sel.includes((row as any)[k])) return false;
      }
      return true;
    });
    const vals = [...new Set(pool.map(r => (r as any)[field]).filter(Boolean))].sort();
    return vals.map(v => ({ value: v as string, display: v as string }));
  }, [hierarchyRows, hierarchySel]);

  const preDivisionGroupOptions = useMemo(() => buildHierOpts("division_group"), [buildHierOpts]);
  const preDivisionOptions      = useMemo(() => buildHierOpts("division"),       [buildHierOpts]);
  const preDepartmentOptions    = useMemo(() => buildHierOpts("department"),     [buildHierOpts]);
  const preSubDepartmentOptions = useMemo(() => buildHierOpts("sub_department"), [buildHierOpts]);
  const preClassOptions         = useMemo(() => buildHierOpts("class"),          [buildHierOpts]);
  const preSubClassOptions      = useMemo(() => buildHierOpts("sub_class"),      [buildHierOpts]);

  // Vendors that match Item Type / Buying Status / PO Group / Hierarchy filters (server-side).
  // Used to narrow the inferred SPC list when those filters are active even if SPC/Vendor/OrderDay are empty.
  const [filterVendorPool, setFilterVendorPool] = useState<{ vendor_code: string; spc_name: string; order_day: string }[] | null>(null);
  useEffect(() => {
    const anyFilter =
      itemTypeCal.length > 0 || buyingStatusCal.length > 0 || poGroupCal.length > 0 ||
      divisionGroupCal.length > 0 || divisionCal.length > 0 || departmentCal.length > 0 ||
      subDepartmentCal.length > 0 || classCal.length > 0 || subClassCal.length > 0;
    if (!anyFilter) { setFilterVendorPool(null); return; }
    let cancelled = false;
    (async () => {
      const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
      const skipDefaults = await hasActiveFilterTemplates("srr_direct");
      const { data, error } = await supabase.rpc("get_srr_effective_vendors" as any, {
        p_item_types:      itemTypeCal.length      ? itemTypeCal      : null,
        p_buying_statuses: buyingStatusCal.length  ? buyingStatusCal  : null,
        p_po_groups:       poGroupCal.length       ? poGroupCal       : null,
        p_division_groups: divisionGroupCal.length ? divisionGroupCal : null,
        p_divisions:       divisionCal.length      ? divisionCal      : null,
        p_departments:     departmentCal.length    ? departmentCal    : null,
        p_sub_departments: subDepartmentCal.length ? subDepartmentCal : null,
        p_classes:         classCal.length         ? classCal         : null,
        p_sub_classes:     subClassCal.length      ? subClassCal      : null,
        p_skip_default_filters: skipDefaults,
      });
      if (cancelled) return;
      if (error) { console.error("get_srr_effective_vendors error:", error); setFilterVendorPool([]); return; }
      setFilterVendorPool((data as any[]) || []);
    })();
    return () => { cancelled = true; };
  }, [itemTypeCal, buyingStatusCal, poGroupCal, divisionGroupCal, divisionCal, departmentCal, subDepartmentCal, classCal, subClassCal]);

  // Effective SPC list: explicit selection OR inferred from any active filter
  const effectiveSpcsForCal = useMemo(() => {
    if (selectedSpcForCal.length > 0) return selectedSpcForCal;
    const noBaseFilter = vendorFilterCal.length === 0 && orderDayCal.length === 0;
    const noExtraFilter = filterVendorPool === null;
    if (noBaseFilter && noExtraFilter) return [];
    let pool = filterVendorPool !== null
      ? filterVendorPool.map(v => ({ vendor_code: v.vendor_code, spc_name: v.spc_name, order_day: v.order_day }))
      : vendorMasterAll.map(v => ({ vendor_code: v.vendor_code, spc_name: v.spc_name, order_day: v.order_day }));
    if (vendorFilterCal.length > 0) pool = pool.filter((v) => vendorFilterCal.includes(v.vendor_code));
    if (orderDayCal.length > 0)     pool = pool.filter((v) => orderDayCal.includes(v.order_day));
    return [...new Set(pool.map((v) => v.spc_name).filter(Boolean))].sort();
  }, [selectedSpcForCal, vendorFilterCal, orderDayCal, vendorMasterAll, filterVendorPool]);


  // Import Mode — persisted across navigation
  const [importMode, setImportMode] = useState<SrrImportMode>(
    (d2sStateRef.current?.importMode as SrrImportMode) || "filter",
  );
  const [importedItems, setImportedItems] = useState<ImportedItem[]>(d2sStateRef.current?.importedItems || []);
  const [importedSkuSet, setImportedSkuSet] = useState<Set<string>>(
    new Set(d2sStateRef.current?.importedSkuSetArr || []),
  );
  /** Per-store qty: key = `${sku}|${store}` (store="" → applies to all stores of that sku) */
  const [importedQtyByKey, setImportedQtyByKey] = useState<Map<string, number>>(
    new Map(d2sStateRef.current?.importedQtyByKeyArr || []),
  );
  /** Per-SKU po cost (NOT per-store, per spec) */
  const [importedPoCostBySku, setImportedPoCostBySku] = useState<Map<string, number>>(
    new Map(d2sStateRef.current?.importedPoCostBySkuArr || []),
  );
  /** Per-(sku|store) qty Unit override → roundup to MOQ, drives final_order_qty */
  const [importedQtyUnitByKey, setImportedQtyUnitByKey] = useState<Map<string, number>>(
    new Map(d2sStateRef.current?.importedQtyUnitByKeyArr || []),
  );
  /** Set of `${sku}|${store}` pairs to filter rows. If a sku has any store-specified entry, only those stores are kept. */
  const [importedStoreBySku, setImportedStoreBySku] = useState<Map<string, Set<string>>>(
    new Map((d2sStateRef.current?.importedStoreBySkuArr || []).map(([k, v]: [string, string[]]) => [k, new Set(v)])),
  );
  const [importedSkippedKeys, setImportedSkippedKeys] = useState<string[]>(
    d2sStateRef.current?.importedSkippedKeys || [],
  );
  const [importedSkippedItems, setImportedSkippedItems] = useState<SkippedItem[]>(
    d2sStateRef.current?.importedSkippedItems || [],
  );
  const [importSkipDialogOpen, setImportSkipDialogOpen] = useState(false);
  const [lastImportRanAt, setLastImportRanAt] = useState<number>(0);
  const [importedVendors, setImportedVendors] = useState<ImportedVendor[]>(d2sStateRef.current?.importedVendors || []);
  const [importedOverrideVendorBySku, setImportedOverrideVendorBySku] = useState<Map<string, any>>(
    new Map(d2sStateRef.current?.importedOverrideVendorBySkuArr || [])
  );

  // Tab 1: tree (5-level: SPC > Date > Vendor > TypeStore > Store)
  const [docSearch, setDocSearch] = useState("");
  const [expandedSPCs, setExpandedSPCs] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedTypeStores, setExpandedTypeStores] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<VendorDocument | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  // Tab 2: filters (load from stateRef for persistence)
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>(d2sStateRef.current?.itemTypeFilter ?? ["Basic"]);
  const [selectedDocSpc, setSelectedDocSpc] = useState<string[]>(d2sStateRef.current?.selectedDocSpc || []);
  const [orderDayFilter, setOrderDayFilter] = useState<string[]>(d2sStateRef.current?.orderDayFilter || []);
  const [vendorFilter, setVendorFilter] = useState<string[]>(d2sStateRef.current?.vendorFilter || []);
  const [storeFilter, setStoreFilter] = useState<string[]>(d2sStateRef.current?.storeFilter || []);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>(d2sStateRef.current?.typeStoreFilter || []);
  const [buyingStatusFilter, setBuyingStatusFilter] = useState<string[]>(d2sStateRef.current?.buyingStatusFilter || []);
  const [poGroupFilter, setPoGroupFilter] = useState<string[]>(d2sStateRef.current?.poGroupFilter || []);
  const [showOnlyFinalGt0, setShowOnlyFinalGt0] = useState<boolean>(d2sStateRef.current?.showOnlyFinalGt0 || false);
  const [showOnlyMinGt0, setShowOnlyMinGt0] = useState<boolean>(d2sStateRef.current?.showOnlyMinGt0 ?? true);
  // Tab 2 mode toggle (independent from Tab 1) — "filter" | "vendor" | "import"(=barcode)
  const [tab2Mode, setTab2Mode] = useState<"filter" | "vendor" | "import">(
    (d2sStateRef.current?.tab2Mode as "filter" | "vendor" | "import") || "filter",
  );
  const [vendorOptions, setVendorOptions] = useState<{ value: string; display: string }[]>([]);

  // Bulk-assign inputs
  const [assignMinValue, setAssignMinValue] = useState<string>(d2sStateRef.current?.assignMinValue || "3");
  const [assignOcValue, setAssignOcValue] = useState<string>(d2sStateRef.current?.assignOcValue || "");

  // Tab 2 display
  const [showData, setShowData] = useState<D2SRow[]>(d2sStateRef.current?.showData || []);
  const [page, setPage] = useState(d2sStateRef.current?.page || 0);
  // Immutable original on_order_store — keyed by row.id, set once when data loads, never mutated
  const origOnOrderStoreRef = useRef<Map<string, number>>(new Map());
  // Immutable original stock_store — keyed by row.id (สำหรับ Restore)
  const origStockStoreRef = useRef<Map<string, number>>(new Map());
  const [pageSize, setPageSize] = useState(d2sStateRef.current?.pageSize || 30);

  // Tab 2: Custom Safety Days per Rank (persisted)
  const DEFAULT_SAFETY_BY_RANK = { A: 21, B: 14, C: 10, D: 7 };
  const [safetyByRank, setSafetyByRank] = useState<Record<string, number>>(
    d2sStateRef.current?.safetyByRank || DEFAULT_SAFETY_BY_RANK
  );

  // Tab 2: Odoo-style chip search
  const [tableSearchChips, setTableSearchChips] = useState<SearchChip[]>([]);
  const TABLE_SEARCH_COLS = useMemo(
    () => [
      { key: "store_name", label: "Store" },
      { key: "type_store", label: "Type Store" },
      { key: "vendor_display", label: "Vendor" },
      { key: "vendor_code", label: "Vendor Code" },
      { key: "sku_code", label: "SKU" },
      { key: "main_barcode", label: "Barcode" },
      { key: "product_name_en", label: "Product (EN)" },
      { key: "product_name_la", label: "Product (LA)" },
      { key: "spc_name", label: "SPC" },
      { key: "po_group", label: "PO Group" },
      { key: "rank_sales", label: "Rank" },
      { key: "order_day", label: "Order Day" },
      { key: "item_type", label: "Item Type" },
    ],
    [],
  );
  const TABLE_SEARCH_KEYS = useMemo(() => TABLE_SEARCH_COLS.map((c) => c.key), [TABLE_SEARCH_COLS]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ col: string; startX: number; startW: number } | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_D2S_VISIBLE));
  // Saved column views (persist in localStorage)
  const D2S_VIEWS_KEY = "srr_d2s_column_views";
  const [savedViews, setSavedViews] = useState<{ name: string; columns: string[] }[]>(() => {
    try { return JSON.parse(localStorage.getItem(D2S_VIEWS_KEY) || "[]"); } catch { return []; }
  });
  const [publicViews, setPublicViews] = useState<SrrPublicView[]>([]);
  const [newViewName, setNewViewName] = useState("");
  const reloadPublicViews = useCallback(async () => {
    try { setPublicViews(await listPublicViews("direct")); } catch { /* ignore */ }
  }, []);
  useEffect(() => { reloadPublicViews(); }, [reloadPublicViews]);
  const persistViews = (views: { name: string; columns: string[] }[]) => {
    setSavedViews(views);
    try { localStorage.setItem(D2S_VIEWS_KEY, JSON.stringify(views)); } catch {}
  };
  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    const next = [...savedViews.filter(v => v.name !== name), { name, columns: Array.from(visibleColumns) }];
    persistViews(next);
    setNewViewName("");
    toast({ title: "บันทึก View ส่วนตัวสำเร็จ", description: name });
  };
  const saveCurrentViewPublic = async () => {
    const name = newViewName.trim();
    if (!name) return;
    try {
      await savePublicView("direct", name, Array.from(visibleColumns));
      await reloadPublicViews();
      setNewViewName("");
      toast({ title: "บันทึก Public View สำเร็จ", description: name });
    } catch (err: any) {
      toast({ title: "บันทึก Public View ล้มเหลว", description: err.message, variant: "destructive" });
    }
  };
  const loadView = (view: { name: string; columns: string[] }) => {
    setVisibleColumns(new Set(view.columns));
    toast({ title: `โหลด View: ${view.name}` });
  };
  const deleteView = (name: string) => {
    persistViews(savedViews.filter(v => v.name !== name));
  };
  const deletePublicViewById = async (id: string, name: string) => {
    try {
      await deletePublicView(id);
      await reloadPublicViews();
      toast({ title: `ลบ Public View: ${name}` });
    } catch (err: any) {
      toast({ title: "ลบ Public View ล้มเหลว", description: err.message, variant: "destructive" });
    }
  };

  // Store types for export
  const [storeTypes, setStoreTypes] = useState<
    { ship_to: string; code: string; type_store: string; type_doc: string; store_name: string }[]
  >([]);
  const [pickingType, setPickingType] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDescription, setExportDescription] = useState("");
  const [exportMaxPerPO, setExportMaxPerPO] = useState<string>("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showImportSkipped, setShowImportSkipped] = useState<SkippedItem[]>([]);

  const { toast } = useToast();
  const displayColumns = useMemo(() => D2S_COLUMNS.filter((c) => visibleColumns.has(c.key)), [visibleColumns]);

  // Core Item / Ranking lookup (เงื่อนไขเดียวกับ Report OOS) — derive ตอนแสดงผล ไม่ฝังลง Doc
  const [coreItemMap, setCoreItemMap] = useState<Map<string, string | null>>(new Map());
  useEffect(() => { fetchCoreItemMap().then(setCoreItemMap).catch(() => {}); }, []);
  const deriveCoreVal = useCallback((row: D2SRow, key: string) =>
    key === "core_item" ? coreItemLabel(coreItemMap, row.sku_code) : coreItemRanking(coreItemMap, row.sku_code),
  [coreItemMap]);

  // Persist state (filters + showData + assign values + per-mode date + import context for mode isolation)
  useEffect(() => {
    return () => {
      d2sStateRef.current = {
        vendorDocs,
        activeTab,
        page,
        pageSize,
        itemTypeFilter,
        selectedDocSpc,
        orderDayFilter,
        vendorFilter,
        storeFilter,
        typeStoreFilter,
        buyingStatusFilter,
        poGroupFilter,
        showOnlyFinalGt0,
        showOnlyMinGt0,
        tab2Mode,
        showData,
        safetyByRank,
        assignMinValue,
        assignOcValue,
        // --- mode isolation persistence ---
        importMode,
        selectedBatchValuesByMode,
        importedItems,
        importedSkuSetArr: Array.from(importedSkuSet),
        importedQtyByKeyArr: Array.from(importedQtyByKey.entries()),
        importedPoCostBySkuArr: Array.from(importedPoCostBySku.entries()),
        importedStoreBySkuArr: Array.from(importedStoreBySku.entries()).map(([k, v]) => [k, Array.from(v)]),
        importedSkippedKeys,
        importedSkippedItems,
        importedVendors,
        importedOverrideVendorBySkuArr: Array.from(importedOverrideVendorBySku.entries()),
      };
    };
  });

  // Load SPC list + restore docs from DB
  useEffect(() => {
    fetchAllRows<any>("vendor_master", "vendor_code, vendor_name_en, vendor_name_la, spc_name, order_day, supplier_currency, purchase_agreement_vat").then(
      (vms) => {
        const spcs = [...new Set(vms.map((v: any) => v.spc_name).filter(Boolean))].sort() as string[];
        setSpcOptions(spcs.map((s) => ({ value: s, display: s })));
        setVendorMasterAll(
          vms
            .filter((v: any) => v.vendor_code)
            .map((v: any) => ({
              vendor_code: v.vendor_code,
              vendor_name: v.vendor_name_en || v.vendor_name_la || v.vendor_code,
              spc_name: v.spc_name || "",
              order_day: v.order_day || "",
              supplier_currency: v.supplier_currency || "",
              purchase_agreement_vat: v.purchase_agreement_vat || "",
            })),
        );
      },
    );
    (async () => {
      const now = Date.now();
      let preRow: any = null;
      if (_d2sFilterCache.preFilterOptions && now - _d2sFilterCache.preFilterOptions.ts < D2S_FILTER_CACHE_TTL) {
        preRow = _d2sFilterCache.preFilterOptions.data;
      } else {
        const session = d2sSessionCacheGet<{ data: any; ts: number }>(D2S_SESSION_KEY_PRE, D2S_FILTER_CACHE_TTL);
        if (session) {
          preRow = session.data;
          _d2sFilterCache.preFilterOptions = { data: preRow, ts: session.ts };
        } else {
          const { data } = await supabase.rpc("get_srr_pre_filter_options" as any);
          preRow = (data as any[])?.[0];
          if (preRow) {
            _d2sFilterCache.preFilterOptions = { data: preRow, ts: now };
            d2sSessionCacheSet(D2S_SESSION_KEY_PRE, preRow);
          }
        }
      }
      if (preRow) {
        setPreFilterOptions({
          itemTypes: (preRow.item_types || []).map((v: string) => ({ value: v, display: v })),
          buyingStatuses: (preRow.buying_statuses || []).map((v: string) => ({ value: v, display: v })),
          poGroups: (preRow.po_groups || []).map((v: string) => ({ value: v, display: v })),
          stores: (preRow.stores || []).map((s: any) => ({
            value: s.store_name,
            display: `${s.store_name} (${s.type_store})`,
          })),
        });
      }
    })();
    (async () => {
      const now = Date.now();
      const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
      const skipDefaults = await hasActiveFilterTemplates("srr_direct");
      if (_d2sFilterCache.hierarchyOptions &&
          now - _d2sFilterCache.hierarchyOptions.ts < D2S_FILTER_CACHE_TTL &&
          _d2sFilterCache.hierarchyOptions.skipDefaults === skipDefaults) {
        setHierarchyRows(_d2sFilterCache.hierarchyOptions.data);
      } else {
        const session = d2sSessionCacheGet<{ data: any; ts: number }>(
          `${D2S_SESSION_KEY_HIER}_${skipDefaults}`, D2S_FILTER_CACHE_TTL
        );
        if (session) {
          setHierarchyRows(session.data);
          _d2sFilterCache.hierarchyOptions = { data: session.data, ts: session.ts, skipDefaults };
        } else {
          const { data } = await supabase.rpc("get_srr_hierarchy_options" as any, { p_skip_default_filters: skipDefaults });
          if (Array.isArray(data)) {
            setHierarchyRows(data as any);
            _d2sFilterCache.hierarchyOptions = { data, ts: now, skipDefaults };
            d2sSessionCacheSet(`${D2S_SESSION_KEY_HIER}_${skipDefaults}`, data);
          }
        }
      }
    })();
    supabase
      .from("store_type")
      .select("ship_to, code, type_store, type_doc, store_name")
      .then(({ data }) => {
        if (data) {
          setStoreTypes(data as any);
          if (data.length > 0 && !pickingType) setPickingType(data[0].ship_to);
        }
      });
    if (vendorDocs.length === 0) {
      setLoadingSnapshots(true);
      setSnapshotLoadLabel("กำลังโหลด D2S Snapshots จาก DB...");
      setSnapshotLoadedRows(0);
      loadD2SSnapshots()
        .then((snaps) => {
          if (!snaps || snaps.length === 0) return;
          setSnapshotLoadLabel("กำลังประมวลผล Documents...");
          setSnapshotLoadedRows(snaps.length);
          const docs: VendorDocument[] = snaps.map((s: any) => ({
            id: s.id,
            vendor_code: s.vendor_code,
            vendor_display: s.vendor_display || s.vendor_code,
            store_name: s.store_name,
            type_store: s.type_store || "",
            spc_name: s.spc_name,
            date_key: isoToDateKey(s.date_key),
            created_at: s.created_at,
            item_count: s.item_count,
            suggest_count: s.suggest_count,
            data: s.data || [],
            edit_count: s.edit_count || 0,
            edited_columns: s.edited_columns || [],
            source: (s.source as any) || "filter",
            user_id: (s as any).user_id,
          }));
          setVendorDocs(docs);
        })
        .catch((err) => console.error("Load D2S snapshots failed:", err))
        .finally(() => {
          setLoadingSnapshots(false);
          setSnapshotLoadLabel("");
          setSnapshotLoadedRows(0);
        });
    }
    // Load distinct snapshot dates (for Filter Date dropdown)
    pruneOldSnapshots(["srr_d2s_snapshots"]).catch(() => {});
    Promise.all([getD2SSnapshotDates(), getSnapshotBatches("srr_d2s_snapshots")])
      .then(([dates, batches]) => {
        setSnapshotDates(dates);
        setSnapshotBatches(batches);
      })
      .catch((err) => console.error("Load D2S snapshot dates failed:", err));
  }, []);

  // Active mode for the Filter Date picker — Tab 2 uses tab2Mode, otherwise importMode (Tab 1/3)
  const activeDateMode: "filter" | "vendor" | "import" =
    activeTab === "show-edit" ? tab2Mode : (importMode as "filter" | "vendor" | "import");

  // ===== Doc Final (D2S) — เก็บ snapshot ของ Doc ที่ผ่าน Review (บันทึกเฉพาะตอนกด Save/Export) =====
  const loadFinalDocs = async () => {
    setFinalDocsLoading(true);
    try {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
      const { data, error } = await (supabase as any)
        .from("srr_d2s_final_documents")
        .select("id, date_key, spc_name, vendor_code, vendor_display, item_count, suggest_count, edited_columns, source, saved_by, saved_at")
        .gte("saved_at", cutoff.toISOString())
        .order("saved_at", { ascending: false });
      if (!error && data) setFinalDocs(data);
    } catch { /* ignore */ } finally { setFinalDocsLoading(false); }
  };
  useEffect(() => { loadFinalDocs(); }, []);

  // เปิด Doc Final มาแสดงในตาราง (เหมือนเปิด Doc ปกติ) — ต้อง fetch data column เพิ่มเพราะ list โหลดแค่ metadata
  const openFinalDoc = async (d: any) => {
    setFinalDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("srr_d2s_final_documents")
        .select("data")
        .eq("id", d.id)
        .single();
      if (error || !data) {
        toast({ title: "เปิด Doc Final ไม่สำเร็จ", description: error?.message || "ไม่พบข้อมูล", variant: "destructive" });
        return;
      }
      const rows = (data.data || []) as D2SRow[];
      setTab2Mode((d.source || "filter") as "filter" | "vendor" | "import");
      setSelectedDocSpc(d.spc_name ? [d.spc_name] : []);
      setVendorFilter(d.vendor_code ? [d.vendor_code] : []);
      setOrderDayFilter([]); setItemTypeFilter(["Basic"]); setTypeStoreFilter([]); setStoreFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]); setShowOnlyMinGt0(true);
      setShowData(rows);
      setPage(0);
      setSelectedRows(new Set());
      setActiveCell(null);
      setActiveTab("show-edit");
      setFinalDocsDialogOpen(false);
    } catch (err: any) {
      toast({ title: "เปิด Doc Final ไม่สำเร็จ", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setFinalDocsLoading(false);
    }
  };

  // เปิด Doc Final หลายฉบับพร้อมกัน (ตามที่ติ๊ก) — ดึง data ทุกฉบับแล้ว merge เป็นตารางเดียว
  const openFinalDocs = async (ds: any[]) => {
    if (ds.length === 0) return;
    if (ds.length === 1) { await openFinalDoc(ds[0]); return; }
    setFinalDocsLoading(true);
    try {
      const ids = ds.map((d) => d.id);
      const { data, error } = await (supabase as any)
        .from("srr_d2s_final_documents")
        .select("id, data")
        .in("id", ids);
      if (error || !data) {
        toast({ title: "เปิด Doc Final ไม่สำเร็จ", description: error?.message || "ไม่พบข้อมูล", variant: "destructive" });
        return;
      }
      const seen = new Set<string>();
      const merged: D2SRow[] = [];
      for (const rec of data as any[]) {
        for (const r of (rec.data || []) as D2SRow[]) {
          if (r?.id && seen.has(r.id)) continue;
          if (r?.id) seen.add(r.id);
          merged.push(r);
        }
      }
      setTab2Mode((ds[0].source || "filter") as "filter" | "vendor" | "import");
      setSelectedDocSpc([...new Set(ds.map((d) => d.spc_name).filter(Boolean))]);
      setVendorFilter([...new Set(ds.map((d) => d.vendor_code).filter(Boolean))]);
      setOrderDayFilter([]); setItemTypeFilter(["Basic"]); setTypeStoreFilter([]); setStoreFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]); setShowOnlyMinGt0(true);
      setShowData(merged);
      setPage(0);
      setSelectedRows(new Set());
      setActiveCell(null);
      setActiveTab("show-edit");
      setFinalDocsDialogOpen(false);
    } catch (err: any) {
      toast({ title: "เปิด Doc Final ไม่สำเร็จ", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setFinalDocsLoading(false);
    }
  };

  // ลบ Doc Final ตาม ids
  const deleteFinalDocs = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { error } = await (supabase as any).from("srr_d2s_final_documents").delete().in("id", ids);
      if (error) {
        toast({ title: "ลบ Doc Final ไม่สำเร็จ", description: error.message, variant: "destructive" });
        return;
      }
      setFinalDocs((prev) => prev.filter((d) => !ids.includes(d.id)));
      toast({ title: `ลบ Doc Final แล้ว ${ids.length} ฉบับ` });
    } catch (err: any) {
      toast({ title: "ลบ Doc Final ไม่สำเร็จ", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  // Replace docs of a specific mode without touching other modes' docs
  const replaceDocsForMode = (mode: "filter" | "vendor" | "import", incoming: VendorDocument[]) => {
    setVendorDocs((prev) => {
      const others = prev.filter((d) => (d.source || "filter") !== mode);
      const tagged = incoming.map((d) => ({ ...d, source: mode }));
      return [...others, ...tagged];
    });
  };

  // Filter Date: load snapshots for a specific date, batch ISO, or "today" — applies to current mode only
  const loadHistoricalDate = async (key: string, mode: "filter" | "vendor" | "import" = activeDateMode) => {
    try {
      setLoadingSnapshots(true);
      const isBatch = key !== "today" && key.includes("T");
      const snapsRaw =
        key === "today"
          ? await loadD2SSnapshots()
          : isBatch
            ? await loadSnapshotBatch(key, "srr_d2s_snapshots")
            : await loadD2SSnapshotsByDate(key);
      // Filter by current mode so other modes' docs aren't reassigned to this mode
      const snaps = (snapsRaw || []).filter((s: any) => ((s as any).source || "filter") === mode);
      const docs: VendorDocument[] = (snaps || []).map((s: any) => ({
        id: s.id,
        vendor_code: s.vendor_code,
        vendor_display: s.vendor_display || s.vendor_code,
        store_name: s.store_name,
        type_store: s.type_store || "",
        spc_name: s.spc_name,
        date_key: isoToDateKey(s.date_key),
        created_at: s.created_at,
        item_count: s.item_count,
        suggest_count: s.suggest_count,
        data: s.data || [],
        edit_count: s.edit_count || 0,
        edited_columns: s.edited_columns || [],
        source: mode,
        user_id: (s as any).user_id,
      }));
      const label =
        key === "today" ? "ล่าสุด" : isBatch ? snapshotBatches.find((b) => b.value === key)?.label || key : key;
      // If selected batch is empty (was deleted from DB) → don't wipe current docs.
      // Refresh dropdown so the stale entry disappears, and inform the user.
      if (docs.length === 0 && key !== "today") {
        try {
          const batches = await getSnapshotBatches("srr_d2s_snapshots");
          setSnapshotBatches(batches);
        } catch {}
        toast({
          title: `ไม่พบข้อมูลใน ${label}`,
          description: "Batch นี้ถูกลบไปแล้ว — ข้อมูลปัจจุบันยังอยู่",
          variant: "destructive",
        });
        return;
      }
      replaceDocsForMode(mode, docs);
      setShowData([]);
      toast({ title: `โหลดข้อมูล ${label} (${mode})`, description: `${docs.length} document(s)` });
    } catch (err: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setLoadingSnapshots(false);
    }
  };

  // Multi-batch loader: merges snapshots from several batch timestamps — applies to current mode only
  const loadHistoricalBatches = async (keys: string[], mode: "filter" | "vendor" | "import" = activeDateMode) => {
    if (keys.length === 0) {
      await loadHistoricalDate("today", mode);
      return;
    }
    if (keys.length === 1) {
      await loadHistoricalDate(keys[0], mode);
      return;
    }
    try {
      setLoadingSnapshots(true);
      const arrays = await Promise.all(keys.map((k) => loadSnapshotBatch(k, "srr_d2s_snapshots")));
      const seen = new Set<string>();
      const mergedRaw: any[] = [];
      for (const arr of arrays)
        for (const s of arr || []) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          mergedRaw.push(s);
        }
      // Filter by current mode so other modes' docs aren't reassigned to this mode
      const merged = mergedRaw.filter((s: any) => ((s as any).source || "filter") === mode);
      const docs: VendorDocument[] = merged.map((s: any) => ({
        id: s.id,
        vendor_code: s.vendor_code,
        vendor_display: s.vendor_display || s.vendor_code,
        store_name: s.store_name,
        type_store: s.type_store || "",
        spc_name: s.spc_name,
        date_key: isoToDateKey(s.date_key),
        created_at: s.created_at,
        item_count: s.item_count,
        suggest_count: s.suggest_count,
        data: s.data || [],
        edit_count: s.edit_count || 0,
        edited_columns: s.edited_columns || [],
        source: mode,
        user_id: (s as any).user_id,
      }));
      if (docs.length === 0) {
        try {
          const batches = await getSnapshotBatches("srr_d2s_snapshots");
          setSnapshotBatches(batches);
        } catch {}
        toast({
          title: `ไม่พบข้อมูลใน batch ที่เลือก`,
          description: "Batch อาจถูกลบไปแล้ว — ข้อมูลปัจจุบันยังอยู่",
          variant: "destructive",
        });
        return;
      }
      replaceDocsForMode(mode, docs);
      setShowData([]);
      toast({ title: `โหลด ${keys.length} batch (${mode})`, description: `${docs.length} document(s)` });
    } catch (err: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setLoadingSnapshots(false);
    }
  };

  // Tree grouping: Batch (yyyymmddHHMM) > SPC > Vendor > TypeStore > Store
  // Each Read & Cal run = its own batch (separated by minute of created_at).
  const docTree = useMemo(() => {
    const tree = new Map<string, Map<string, Map<string, Map<string, VendorDocument[]>>>>();
    const search = docSearch.toLowerCase();
    for (const doc of vendorDocs) {
      if ((doc.source || "filter") !== importMode) continue;
      if (
        search &&
        !doc.spc_name.toLowerCase().includes(search) &&
        !doc.vendor_code.toLowerCase().includes(search) &&
        !doc.vendor_display.toLowerCase().includes(search) &&
        !doc.store_name.toLowerCase().includes(search)
      )
        continue;
      const batchKey = getBatchKey(doc);
      if (!tree.has(batchKey)) tree.set(batchKey, new Map());
      const spcMap = tree.get(batchKey)!;
      if (!spcMap.has(doc.spc_name)) spcMap.set(doc.spc_name, new Map());
      const vendorMap = spcMap.get(doc.spc_name)!;
      const vendorKey = doc.vendor_code;
      if (!vendorMap.has(vendorKey)) vendorMap.set(vendorKey, new Map());
      const typeStoreMap = vendorMap.get(vendorKey)!;
      const tsKey = doc.type_store || "(No Type)";
      if (!typeStoreMap.has(tsKey)) typeStoreMap.set(tsKey, []);
      typeStoreMap.get(tsKey)!.push(doc);
    }
    return tree;
  }, [vendorDocs, docSearch, importMode]);

  // Tab 2: only consider docs from Tab 2's own mode toggle (independent of Tab 1)
  const docsForTab2 = useMemo(() => {
    return vendorDocs.filter((d) => (d.source || "filter") === tab2Mode);
  }, [vendorDocs, tab2Mode]);

  // Derived filter options (mode-scoped)
  const docDerivedOptions = useMemo(() => {
    const allRows = docsForTab2.flatMap((d) => d.data);
    const vendors = new Map<string, string>();
    const orderDays = new Set<string>();
    const itemTypes = new Set<string>();
    const stores = new Set<string>();
    const typeStores = new Set<string>();
    const buyingStatuses = new Set<string>();
    const poGroups = new Set<string>();
    for (const row of allRows) {
      if (row.vendor_code) vendors.set(row.vendor_code, row.vendor_display || row.vendor_code);
      if (row.order_day) orderDays.add(row.order_day);
      if (row.item_type) itemTypes.add(row.item_type);
      if (row.store_name) stores.add(row.store_name);
      if (row.type_store) typeStores.add(row.type_store);
      if (row.buying_status) buyingStatuses.add(row.buying_status);
      if (row.po_group) poGroups.add(row.po_group);
    }
    return {
      vendors: [...vendors.entries()]
        .map(([k, v]) => ({ value: k, display: `${k} - ${v}` }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      orderDays: [...orderDays].sort().map((d) => ({ value: d, display: d })),
      itemTypes: [...itemTypes].sort().map((t) => ({ value: t, display: t })),
      stores: [...stores].sort().map((s) => ({ value: s, display: s })),
      typeStores: [...typeStores].sort().map((t) => ({ value: t, display: t })),
      buyingStatuses: [...buyingStatuses].sort().map((b) => ({ value: b, display: b })),
      poGroups: [...poGroups].sort().map((p) => ({ value: p, display: p })),
    };
  }, [docsForTab2]);

  const availableDocSpcs = useMemo(() => {
    const spcs = [...new Set(docsForTab2.map((d) => d.spc_name))].sort();
    return spcs.map((s) => ({
      value: s,
      display: `${s} (${docsForTab2.filter((d) => d.spc_name === s).reduce((a, d) => a + d.item_count, 0)} items)`,
    }));
  }, [docsForTab2]);

  useEffect(() => {
    const allRows = docsForTab2.flatMap((d) => d.data);
    let filtered = allRows;
    if (selectedDocSpc.length > 0) filtered = filtered.filter((r) => selectedDocSpc.includes(r.spc_name));
    if (orderDayFilter.length > 0) filtered = filtered.filter((r) => orderDayFilter.includes(r.order_day));
    const seen = new Map<string, string>();
    for (const r of filtered)
      if (r.vendor_code && !seen.has(r.vendor_code)) seen.set(r.vendor_code, r.vendor_display || r.vendor_code);
    setVendorOptions(
      [...seen.entries()]
        .map(([k, v]) => ({ value: k, display: `${k} - ${v}` }))
        .sort((a, b) => a.value.localeCompare(b.value)),
    );
  }, [selectedDocSpc, orderDayFilter, docsForTab2]);

  const loadFilterOptions = async () => {
    // Vendor Mode: imported vendor_codes → derive SPC from vendor_master
    if (importMode === "vendor") {
      if (importedVendors.length === 0) {
        toast({ title: "ยัง import vendor_code", variant: "destructive" });
        return;
      }
      setDataReady(false);
      setDataLoadingMsg(`Resolve ${importedVendors.length} vendor...`);
      try {
        const vCodes = [...new Set(importedVendors.map((v) => v.vendor_code).filter(Boolean))];
        const vms = await fetchAllRows<any>(
          "vendor_master",
          "vendor_code, spc_name, vendor_name_la, vendor_name_en",
          (q) => q.in("vendor_code", vCodes),
        );
        if (vms.length === 0) {
          const allSkipped: SkippedItem[] = vCodes.map((v) => ({
            kind: "vendor" as const,
            key: v,
            reason: "ไม่พบใน Vendor Master",
            detail: "vendor_code นี้ไม่มีใน vendor_master",
          }));
          setImportedSkippedItems(allSkipped);
          setImportSkipDialogOpen(true);
          toast({ title: "ไม่พบ vendor ใน Master", variant: "destructive" });
          setDataLoadingMsg(""); setLoadingDetail("");
          return;
        }
        const foundCodes = new Set<string>(vms.map((v: any) => v.vendor_code).filter(Boolean));
        const skippedVendors = vCodes.filter((v) => !foundCodes.has(v));
        const spcSet = new Set<string>();
        for (const v of vms) if (v.spc_name) spcSet.add(v.spc_name);
        // For Read & Cal we display vendor list & lock SPCs derived from imported vendors
        const seen = new Map<string, string>();
        for (const m of vms) {
          if (m.vendor_code && !seen.has(m.vendor_code))
            seen.set(m.vendor_code, m.vendor_name_en || m.vendor_name_la || m.vendor_code);
        }
        setVendorOptionsForCal(
          [...seen.entries()]
            .map(([k, v]) => ({ value: k, display: `${k} - ${v}` }))
            .sort((a, b) => a.value.localeCompare(b.value)),
        );
        setSelectedSpcForCal([...spcSet].sort());
        setVendorFilterCal([...foundCodes]);
        const skippedItems: SkippedItem[] = skippedVendors.map((v) => ({
          kind: "vendor" as const,
          key: v,
          reason: "ไม่พบใน Vendor Master",
          detail: "vendor_code นี้ไม่มีใน vendor_master",
        }));
        setImportedSkippedItems(skippedItems);
        setLastImportRanAt(Date.now());
        setDataReady(true);
        setDataLoadingMsg(""); setLoadingDetail("");
        setStatusBanner({
          title: "✅ เตรียมข้อมูลเสร็จ (Vendor)",
          detail: `Match ${foundCodes.size}/${vCodes.length} vendor · ${spcSet.size} SPC${skippedVendors.length ? ` · Skip ${skippedVendors.length}` : ""}`,
        });
        if (skippedItems.length > 0) setImportSkipDialogOpen(true);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setDataLoadingMsg(""); setLoadingDetail("");
      }
      return;
    }

    // Import Mode: resolve barcodes/SKUs → derive vendor + SPC
    if (importMode === "import") {
      if (importedItems.length === 0) {
        toast({ title: "ยัง import ไฟล์", variant: "destructive" });
        return;
      }
      setDataReady(false);
      setDataLoadingMsg(`Resolve ${importedItems.length} รายการ...`);
      try {
        const keys = importedItems.map((i) => i.key);
        const found = new Map<string, { sku_code: string; vendor_code: string; vendor_display_name: string }>();
        const matchedKeys = new Set<string>();
        const keyToSku = new Map<string, string>();
        const chunkSize = 80; // keep URL length safely under PostgREST/server limit
        for (let i = 0; i < keys.length; i += chunkSize) {
          const slice = keys.slice(i, i + chunkSize);
          setDataLoadingMsg(`Resolve ${Math.min(i + chunkSize, keys.length)}/${keys.length}...`);
          setLoadingDetail(`กำลังดึง ${slice[0]}${slice.length > 1 ? ` ... ${slice[slice.length - 1]}` : ""}`);
          const inExpr = slice.map((k) => `"${String(k).replace(/"/g, '\\"')}"`).join(",");
          const { data, error } = await (supabase as any)
            .from("data_master")
            .select("sku_code, main_barcode, barcode, vendor_code, vendor_display_name")
            .or(`main_barcode.in.(${inExpr}),barcode.in.(${inExpr}),sku_code.in.(${inExpr})`);
          if (error) throw error;
          for (const row of (data || []) as any[]) {
            if (!row.sku_code) continue;
            if (row.main_barcode && slice.includes(row.main_barcode)) {
              matchedKeys.add(row.main_barcode);
              keyToSku.set(row.main_barcode, row.sku_code);
            }
            if (row.barcode && slice.includes(row.barcode)) {
              matchedKeys.add(row.barcode);
              keyToSku.set(row.barcode, row.sku_code);
            }
            if (slice.includes(row.sku_code)) {
              matchedKeys.add(row.sku_code);
              keyToSku.set(row.sku_code, row.sku_code);
            }
            if (!found.has(row.sku_code))
              found.set(row.sku_code, {
                sku_code: row.sku_code,
                vendor_code: row.vendor_code || "",
                vendor_display_name: row.vendor_display_name || row.vendor_code || "",
              });
          }
        }
        // Build per-(sku,store) qty + per-sku poCost + sku→stores mapping
        const qtyByKey = new Map<string, number>(); // key = `${sku}|${store}` or `${sku}|` (no store)
        const poCostMap = new Map<string, number>(); // per-SKU only
        const storeBySku = new Map<string, Set<string>>(); // sku → set of stores from file (only if specified)
        let dbgQtyZero = 0;
        let dbgQtyOk = 0;
        let dbgNoSku = 0;
        const dbgSampleRaw: any[] = [];
        const qtyUnitByKey = new Map<string, number>();
        const skuToOverrideVendor = new Map<string, string>();
        for (const it of importedItems) {
          if (dbgSampleRaw.length < 5) dbgSampleRaw.push({ key: it.key, qty: it.qty, qtyType: typeof it.qty, store: it.storeName });
          const sku = keyToSku.get(it.key);
          if (!sku) { dbgNoSku++; continue; }
          const store = (it.storeName || "").trim();
          const qtyNum = Number(it.qty);
          const qtyUnitNum = Number(it.qtyUnit);
          if (!isNaN(qtyNum) && qtyNum > 0) {
            qtyByKey.set(`${sku}|${store}`, qtyNum);
            dbgQtyOk++;
          } else if (!isNaN(qtyUnitNum) && qtyUnitNum > 0) {
            qtyUnitByKey.set(`${sku}|${store}`, qtyUnitNum);
            dbgQtyOk++;
          } else {
            dbgQtyZero++;
          }
          if (it.poCost && it.poCost > 0) poCostMap.set(sku, it.poCost);
          if (store) {
            if (!storeBySku.has(sku)) storeBySku.set(sku, new Set());
            storeBySku.get(sku)!.add(store);
          }
          if (it.overrideVendor && it.overrideVendor.trim()) skuToOverrideVendor.set(sku, it.overrideVendor.trim());
        }
        setImportedQtyUnitByKey(qtyUnitByKey);
        console.log(`[IMPORT PREPARE DBG] qtyOk=${dbgQtyOk} qtyZero=${dbgQtyZero} noSku=${dbgNoSku}`);
        console.log(`[IMPORT PREPARE DBG SAMPLE RAW]`, dbgSampleRaw);
        console.log(
          `[IMPORT PREPARE] importedItems=${importedItems.length}, matched=${matchedKeys.size}, qtyByKey.size=${qtyByKey.size}, storeBySku.size=${storeBySku.size}`,
        );
        // Sample: first 3 entries to verify keys
        const sampleQty = Array.from(qtyByKey.entries()).slice(0, 5);
        console.log(`[IMPORT PREPARE SAMPLE qtyByKey]`, sampleQty);
        const sampleStores = Array.from(storeBySku.entries()).slice(0, 3).map(([k, v]) => [k, Array.from(v)]);
        console.log(`[IMPORT PREPARE SAMPLE storeBySku]`, sampleStores);
        const skipped = importedItems.map((i) => i.key).filter((k) => !matchedKeys.has(k));
        const skippedItems: SkippedItem[] = skipped.map((k) => {
          // ถ้ามี storeName ใน imported item ที่ skip → mark kind=store
          const it = importedItems.find((x) => x.key === k);
          return {
            kind: "sku" as const,
            key: k,
            reason: "ไม่พบใน Master",
            detail: it?.storeName ? `Store: ${it.storeName}` : "barcode/SKU นี้ไม่มีใน data_master",
          };
        });
        setImportedSkippedKeys(skipped);
        setImportedSkippedItems(skippedItems);
        setLastImportRanAt(Date.now());
        setImportedSkuSet(new Set(found.keys()));
        setImportedQtyByKey(qtyByKey);
        setImportedPoCostBySku(poCostMap);
        setImportedStoreBySku(storeBySku);
        if (found.size === 0) {
          setDataLoadingMsg(""); setLoadingDetail("");
          toast({ title: "ไม่พบรายการใน Master", variant: "destructive" });
          if (skippedItems.length) setImportSkipDialogOpen(true);
          return;
        }

        const baseVendorCodes = [...new Set([...found.values()].map((v) => v.vendor_code).filter(Boolean))];
        const overrideVendorCodes = [...new Set([...skuToOverrideVendor.values()])];
        const vendorCodes = [...new Set([...baseVendorCodes, ...overrideVendorCodes])];
        setDataLoadingMsg(`โหลด Vendor Master (${vendorCodes.length})...`);
        const vms = await fetchAllRows<any>(
          "vendor_master",
          "vendor_code, vendor_name_en, vendor_name_la, spc_name, order_day, supplier_currency, leadtime, order_cycle",
          (q) => q.in("vendor_code", vendorCodes),
        );
        const spcSet = new Set<string>();
        const vmMap = new Map<string, any>();
        for (const v of vms) {
          if (!v.vendor_code) continue;
          vmMap.set(v.vendor_code, v);
          if (v.spc_name) spcSet.add(v.spc_name);
        }

        // Build override map: sku → vendor patch (vendor_code/spc/leadtime/oc/...). Only changes vendor identity + planning fields.
        const overrideMap = new Map<string, any>();
        for (const [sku, newVendor] of skuToOverrideVendor) {
          const vm = vmMap.get(newVendor);
          overrideMap.set(sku, {
            vendor_code: newVendor,
            vendor_display_name: vm?.vendor_name_la || vm?.vendor_name_en || newVendor,
            spc_name: vm?.spc_name || "",
            order_day: vm?.order_day || "",
            supplier_currency: vm?.supplier_currency || "",
            leadtime: Number(vm?.leadtime) || 0,
            order_cycle: Number(vm?.order_cycle) || 0,
          });
        }
        setImportedOverrideVendorBySku(overrideMap);
        const missingOv = [...skuToOverrideVendor.values()].filter((vc) => !vmMap.has(vc));
        if (missingOv.length > 0) {
          toast({
            title: "Override Vendor: บาง vendor ไม่พบใน Vendor Master",
            description: `${missingOv.slice(0, 5).join(", ")}${missingOv.length > 5 ? ` ... +${missingOv.length - 5}` : ""} — แถวจะใช้ leadtime/oc = 0`,
            variant: "destructive",
          });
        }

        setVendorOptionsForCal(
          [...found.values()]
            .map((v) => {
              const ovVendor = overrideMap.get(v.sku_code)?.vendor_code;
              const finalVc = ovVendor || v.vendor_code;
              return { value: finalVc, display: `${finalVc} - ${ovVendor ? finalVc : v.vendor_display_name}` };
            })
            .filter((x, i, a) => a.findIndex(y => y.value === x.value) === i)
            .sort((a, b) => a.value.localeCompare(b.value)),
        );
        setSelectedSpcForCal([...spcSet].sort());
        setDataReady(true);
        setDataLoadingMsg(""); setLoadingDetail("");
        setStatusBanner({
          title: "✅ เตรียมข้อมูลเสร็จ (Import)",
          detail: `Match ${matchedKeys.size}/${importedItems.length} · ${spcSet.size} SPC · ${vendorCodes.length} Vendor${skipped.length ? ` · Skip ${skipped.length}` : ""}`,
        });
        if (skipped.length) setImportSkipDialogOpen(true);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setDataLoadingMsg(""); setLoadingDetail("");
      }
      return;
    }

    // Allow prepare with explicit SPC OR inferred SPC list from Vendor/OrderDay filters
    const spcsToLoad = selectedSpcForCal.length > 0 ? selectedSpcForCal : effectiveSpcsForCal;
    if (spcsToLoad.length === 0) {
      toast({ title: "กรุณาเลือก Filter ก่อน", description: "เลือก SPC Name, Vendor หรือ Order Day อย่างน้อย 1 ตัว", variant: "destructive" });
      return;
    }
    if (selectedSpcForCal.length === 0) setSelectedSpcForCal(spcsToLoad);
    setDataReady(false);
    setDataLoadingMsg("กำลังเตรียมข้อมูล...");
    try {
      const vms = await fetchAllRows<any>("vendor_master", "vendor_code", (q) => q.in("spc_name", spcsToLoad));
      if (vms.length === 0) {
        toast({ title: "ไม่พบ Vendor", variant: "destructive" });
        setDataLoadingMsg(""); setLoadingDetail("");
        return;
      }
      const vCodes = [...new Set(vms.map((v: any) => v.vendor_code).filter(Boolean))];
      const vendorMasters = await fetchAllRows<any>("data_master", "vendor_code, vendor_display_name", (q) =>
        q
          .in("vendor_code", vCodes)
          .eq("packing_size_qty", 1)
          .eq("product_owner", "Lanexang Green Property Sole Co.,Ltd"),
      );
      const seen = new Map<string, string>();
      for (const m of vendorMasters) {
        if (m.vendor_code && !seen.has(m.vendor_code)) seen.set(m.vendor_code, m.vendor_display_name || m.vendor_code);
      }
      setVendorOptionsForCal(
        [...seen.entries()]
          .map(([k, v]) => ({ value: k, display: `${k} - ${v}` }))
          .sort((a, b) => a.value.localeCompare(b.value)),
      );
      setDataReady(true);
      setDataLoadingMsg(""); setLoadingDetail("");
      setStatusBanner({
        title: "✅ เตรียมข้อมูลเสร็จ",
        detail: `${seen.size.toLocaleString()} Vendor · ${spcsToLoad.length.toLocaleString()} SPC Name (รอ Cal)`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setDataLoadingMsg(""); setLoadingDetail("");
    }
  };

  // Cal click — show confirm popup unless Excel import has Store Name in file
  const handleCalClick = () => {
    if (selectedSpcForCal.length === 0 || !dataReady) {
      toast({ title: "กรุณาเตรียมข้อมูลก่อน", variant: "destructive" });
      return;
    }
    const skipPopup = importMode === "import" && importedStoreBySku.size > 0;
    if (skipPopup) {
      readAndCalc();
      return;
    }
    setCalConfirmOpen(true);
  };

  // Read & Cal
  const readAndCalc = async () => {
    if (selectedSpcForCal.length === 0 || !dataReady) {
      toast({ title: "กรุณาเตรียมข้อมูลก่อน", variant: "destructive" });
      return;
    }
    setLoading(true);
    cancelCalcRef.current = false;
    setCalcProgress(1);
    setLoadingDetail("");
    setCalcStartedAt(Date.now());
    const t0 = performance.now();
    const dateKey = getDateKey();
    const now = new Date();
    const newDocs: VendorDocument[] = [];

    try {
      // ===== OPTIMIZATION =====
      // OLD: loop per-SPC → 1 RPC per SPC (sequential), each with sequential pagination.
      //      e.g. 10 SPC × 5 pages = 50 round trips.
      // NEW: 1 RPC for ALL SPCs at once + parallel pagination (4 pages/wave) +
      //      session cache (5min TTL) keyed on filter set → instant re-display
      //      when filters didn't change. Group-by-SPC happens in JS after fetch.

      // Import mode (Option A — fastest path): filter directly by imported SKU set.
      // Vendor codes can be null because the RPC restricts via the SKU filter
      // joined with vendor_master, avoiding the slow vendor-wide scan.
      const isImportMode = importMode === "import";
      const isVendorMode = importMode === "vendor";
      const ignoreFilters = isImportMode || isVendorMode;
      const skuFilter =
        isImportMode && importedSkuSet.size > 0 ? Array.from(importedSkuSet) : null;
      // Vendor Mode: restrict by imported vendor codes; Filter Mode: use vendorFilterCal
      const vcFilter = isImportMode
        ? null
        : isVendorMode
          ? (importedVendors.length > 0 ? [...new Set(importedVendors.map(v => v.vendor_code).filter(Boolean))] : null)
          : (vendorFilterCal.length > 0 ? vendorFilterCal : null);
      const odParam = ignoreFilters ? null : (orderDayCal.length > 0 ? orderDayCal : null);
      const itParam = ignoreFilters ? null : (itemTypeCal.length > 0 ? itemTypeCal : null);
      const hierarchy = {
        divisionGroups: ignoreFilters ? null : (divisionGroupCal.length > 0 ? divisionGroupCal : null),
        divisions: ignoreFilters ? null : (divisionCal.length > 0 ? divisionCal : null),
        departments: ignoreFilters ? null : (departmentCal.length > 0 ? departmentCal : null),
        subDepartments: ignoreFilters ? null : (subDepartmentCal.length > 0 ? subDepartmentCal : null),
        classes: ignoreFilters ? null : (classCal.length > 0 ? classCal : null),
        subClasses: ignoreFilters ? null : (subClassCal.length > 0 ? subClassCal : null),
      };

      // Warn user when many SPCs are selected (large fetches can be slow).
      // Skip warning for Import mode — SKU filter keeps the payload tiny.
      if (!isImportMode && selectedSpcForCal.length > 3) {
        const ok = window.confirm("SPC ที่เลือกมีจำนวนมาก อาจใช้เวลานาน ต้องการดำเนินการต่อไหม?");
        if (!ok) {
          toast({ title: "ยกเลิก" });
          return;
        }
      }

      setLoadingPhase(isImportMode
        ? `กำลังโหลด ${importedSkuSet.size} SKU (Import Mode)...`
        : `กำลังโหลดข้อมูล D2S ${selectedSpcForCal.length} SPC...`);
      setLoadingDetail(isImportMode
        ? `SKU จาก Import: ${importedSkuSet.size}`
        : `SPC: ${selectedSpcForCal.slice(0, 3).join(", ")}${selectedSpcForCal.length > 3 ? `, +${selectedSpcForCal.length - 3}` : ""}${vcFilter ? ` · Vendor: ${vcFilter.length}` : ""}`);
      setCalcProgress(5);

      const allRawRows: any[] = await fetchD2SDataRPCFast(
        vcFilter,
        selectedSpcForCal,
        odParam,
        itParam,
        hierarchy,
        (loaded) => {
          setLoadingPhase(`กำลังดึงข้อมูล D2S...`);
          setLoadingDetail(`โหลดแล้ว ${loaded.toLocaleString()} rows จาก data_master/stock/sales (per-store)`);
          setCalcProgress(Math.min(50, 5 + Math.round((loaded / 5000) * 10)));
        },
        skuFilter,
      );

      if (cancelCalcRef.current) {
        toast({ title: "ยกเลิกการคำนวณ" });
        return;
      }

      // OVERRIDE VENDOR: patch raw rows in-place — swap vendor_code/spc/order_day/leadtime/oc for matched SKUs.
      // Also re-lookup po_cost from (sku, override_vendor) because RPC joins po_cost by
      // data_master.vendor_code (original vendor) — override vendors get no po_cost otherwise.
      if (importMode === "import" && importedOverrideVendorBySku.size > 0) {
        const ovPairs: { sku: string; vendor: string }[] = [];
        for (const [sku, ov] of importedOverrideVendorBySku) {
          if (sku && ov?.vendor_code) ovPairs.push({ sku, vendor: ov.vendor_code });
        }
        const pcMap = new Map<string, { moq: number | null; po_cost: number | null; po_cost_unit: number | null }>();
        if (ovPairs.length > 0) {
          const ovSkus = [...new Set(ovPairs.map(p => p.sku))];
          const ovVendors = [...new Set(ovPairs.map(p => p.vendor))];
          try {
            const pcRows = await fetchAllRows<any>(
              "po_cost",
              "item_id, vendor, moq, po_cost, po_cost_unit, updated_at",
              q => q.in("item_id", ovSkus).in("vendor", ovVendors).order("updated_at", { ascending: false })
            );
            for (const r of pcRows) {
              const k = `${r.item_id}__${r.vendor}`;
              if (!pcMap.has(k)) pcMap.set(k, { moq: r.moq, po_cost: r.po_cost, po_cost_unit: r.po_cost_unit });
            }
          } catch (e) {
            console.warn("[SRR Direct] Override Vendor po_cost lookup failed:", e);
          }
        }
        for (const r of allRawRows) {
          const ov = importedOverrideVendorBySku.get(r.sku_code);
          if (!ov) continue;
          r.vendor_code = ov.vendor_code;
          r.vendor_display_name = ov.vendor_display_name || ov.vendor_code;
          r.spc_name = ov.spc_name || r.spc_name;
          r.order_day = ov.order_day || r.order_day;
          r.leadtime = ov.leadtime;
          r.order_cycle = ov.order_cycle;
          const pc = pcMap.get(`${r.sku_code}__${ov.vendor_code}`);
          if (pc) {
            r.moq = pc.moq ?? r.moq;
            r.po_cost = pc.po_cost ?? null;
            r.po_cost_unit = pc.po_cost_unit ?? (pc.po_cost != null && pc.moq ? Number(pc.po_cost) / Number(pc.moq) : null);
          } else {
            r.po_cost = null;
            r.po_cost_unit = null;
          }
        }
      }

      // Group raw rows by SPC for per-SPC processing
      const rowsBySpc = new Map<string, any[]>();
      for (const r of allRawRows) {
        const spc = r.spc_name || "";
        if (!selectedSpcForCal.includes(spc)) continue;
        if (!rowsBySpc.has(spc)) rowsBySpc.set(spc, []);
        rowsBySpc.get(spc)!.push(r);
      }

      // Pre-fetch barcode_unit ONCE for ALL skus across ALL SPCs (batched)
      setLoadingPhase("เตรียมข้อมูล Barcode Unit...");
      setCalcProgress(55);
      const allSkusForUnit = [...new Set(allRawRows.map((r: any) => r.sku_code).filter(Boolean))] as string[];
      setLoadingDetail(`SKU ทั้งหมด ${allSkusForUnit.length.toLocaleString()} · กำลังโหลด barcode_unit...`);
      let unitMap: Map<string, { barcode: string; uom: string }> = new Map();
      try {
        unitMap = await fetchUnitPackLookup(allSkusForUnit);
      } catch (e) {
        console.warn("[SRR DIRECT] barcode_unit lookup failed:", e);
      }

      const spcKeys = Array.from(rowsBySpc.keys());
      for (let i = 0; i < spcKeys.length; i++) {
        if (cancelCalcRef.current) {
          toast({ title: "ยกเลิกการคำนวณ", description: `${i}/${spcKeys.length} SPC` });
          break;
        }
        const spcName = spcKeys[i];
        const rawRows = rowsBySpc.get(spcName)!;
        setCalcProgress(60 + Math.round((i / Math.max(spcKeys.length, 1)) * 30));
        setLoadingPhase(`[${i + 1}/${spcKeys.length}] กำลังคำนวณ: ${spcName}`);
        setLoadingDetail(`SPC ${spcName} · ${rawRows.length.toLocaleString()} rows · กำลังกรอง Buying Status / PO Group / Store`);

        // Apply client-side filters that RPC doesn't support
        // Buying Status / PO Group skipped in Import/Vendor mode (those modes ignore filter-mode-only fields)
        // Store Name applies in ALL modes (incl. Import/Vendor) so user can narrow per store
        let filteredByExtras = rawRows;
        if (!ignoreFilters) {
          if (buyingStatusCal.length > 0) filteredByExtras = filteredByExtras.filter((r: any) => buyingStatusCal.includes(r.buying_status));
          if (poGroupCal.length > 0) filteredByExtras = filteredByExtras.filter((r: any) => poGroupCal.includes(r.po_group));
        }
        if (storeCal.length > 0) filteredByExtras = filteredByExtras.filter((r: any) => storeCal.includes(r.store_name));

        let filteredRaw = filteredByExtras;
        if (importMode === "import" && importedSkuSet.size > 0) {
          const beforeCount = filteredByExtras.length;
          let skuMissCount = 0,
            storeMissCount = 0;
          filteredRaw = filteredByExtras.filter((r: any) => {
            if (!importedSkuSet.has(r.sku_code)) {
              skuMissCount++;
              return false;
            }
            const stores = importedStoreBySku.get(r.sku_code);
            if (stores && stores.size > 0) {
              if (!stores.has(r.store_name)) {
                storeMissCount++;
                return false;
              }
              return true;
            }
            return true;
          });
          console.log(
            `[IMPORT FILTER] SPC=${spcName} raw=${beforeCount} → kept=${filteredRaw.length} (sku_miss=${skuMissCount}, store_miss=${storeMissCount}); importedSkuSet.size=${importedSkuSet.size}, storeBySku.size=${importedStoreBySku.size}`,
          );
        }
        if (filteredRaw.length === 0) continue;

        // Inject barcode_unit from pre-fetched map (no per-SPC query)
        if (unitMap.size > 0) {
          for (const r of filteredRaw) {
            const up = unitMap.get(r.sku_code);
            if (up && up.barcode) (r as any).barcode_unit = up.barcode;
          }
        }

        setLoadingDetail(`SPC ${spcName} · กำลังคำนวณ Min/Max/Stock/Sales (${filteredRaw.length.toLocaleString()} rows)`);
        let calculated = buildD2SRows(filteredRaw);

        // Apply Pack/Box (qty) from latest Range Store snapshot — targeted fetch by SKU
        try {
          const skus = [...new Set(calculated.map(r => r.sku_code).filter(Boolean))];
          const pbMap = await getLatestRangeStorePackBox(skus);
          if (pbMap.size > 0) {
            calculated = calculated.map(r => {
              const pb = pbMap.get(r.sku_code);
              return pb ? { ...r, pack: pb.pack, box: pb.box } : r;
            });
          }
        } catch (e) {
          console.warn("[SRR DIRECT] pack/box lookup failed:", e);
        }

        // Import overrides:
        //  Qty Uom  → order_uom_edit (recalc: final_order_qty = uomEdit * MOQ)
        //  Qty Unit → roundup MOQ → final_order_qty directly (order_uom_edit blank)
        //  Po cost  → per-SKU
        if (importMode === "import" && (importedQtyByKey.size > 0 || importedQtyUnitByKey.size > 0 || importedPoCostBySku.size > 0)) {
          let appliedQty = 0;
          let appliedPc = 0;
          let missQty = 0;
          calculated = calculated.map((r) => {
            const qStore = importedQtyByKey.get(`${r.sku_code}|${r.store_name}`);
            const qSku = importedQtyByKey.get(`${r.sku_code}|`);
            const q = qStore ?? qSku;
            const qUnitStore = importedQtyUnitByKey.get(`${r.sku_code}|${r.store_name}`);
            const qUnitSku = importedQtyUnitByKey.get(`${r.sku_code}|`);
            const qUnit = qUnitStore ?? qUnitSku;
            const pc = importedPoCostBySku.get(r.sku_code);
            if (!q && !qUnit && !pc) {
              if (importedQtyByKey.size > 0 || importedQtyUnitByKey.size > 0) missQty++;
              return r;
            }
            const moq = r.moq || 1;
            const next = { ...r };
            if (pc && pc > 0) {
              next.po_cost = pc;
              next.po_cost_unit = moq > 0 ? pc / moq : pc;
              appliedPc++;
            }
            if (q && q > 0) {
              next.order_uom_edit = String(q);
              next.is_import_row = true;
              appliedQty++;
              return recalcD2SRow(next);
            }
            if (qUnit && qUnit > 0) {
              const roundedUnit = moq > 0 ? Math.ceil(qUnit / moq) * moq : qUnit;
              const uomCount = moq > 0 ? roundedUnit / moq : roundedUnit;
              next.order_uom_edit = "";
              next.is_import_row = true;
              appliedQty++;
              const recalced = recalcD2SRow(next);
              recalced.final_order_qty = Math.round(roundedUnit * 100) / 100;
              recalced.final_order_uom = Math.round(roundedUnit * 100) / 100; // import mode: display qty (= unit * moq pattern)
              recalced.final_order_uom_div = Math.round(uomCount * 100) / 100;
              return recalced;
            }
            return recalcD2SRow(next);
          });
          console.log(
            `[IMPORT OVERRIDE] SPC=${spcName} rows=${calculated.length} appliedQty=${appliedQty} appliedPc=${appliedPc} missQty=${missQty} qtyMap.size=${importedQtyByKey.size}`,
          );
        }
        // Filter by Type Store (Jmart / Kokkok / Kokkok-fc / U-dee) — applies in ALL modes
        if (typeStoreCal.length > 0) {
          calculated = calculated.filter((r) => typeStoreCal.includes(r.type_store));
        }
        if (calculated.length === 0) continue;

        // Group by vendor + store
        const vendorStoreMap = new Map<string, D2SRow[]>();
        for (const row of calculated) {
          const key = `${row.vendor_code || "UNKNOWN"}|${row.store_name || "UNKNOWN"}`;
          if (!vendorStoreMap.has(key)) vendorStoreMap.set(key, []);
          vendorStoreMap.get(key)!.push(row);
        }

        for (const [key, rows] of vendorStoreMap) {
          const [vc, sn] = key.split("|");
          const ts = rows[0]?.type_store || "";
          newDocs.push({
            id: `d2s-doc-${importMode}-${dateKey}-${now.getTime()}-${spcName}-${vc}-${sn}`,
            vendor_code: vc,
            vendor_display: rows[0]?.vendor_display || vc,
            store_name: sn,
            type_store: ts,
            spc_name: spcName,
            date_key: dateKey,
            created_at: now.toISOString(),
            item_count: rows.length,
            suggest_count: rows.filter((r) => r.final_order_qty > 0).length,
            data: rows,
            edit_count: 0,
            edited_columns: [],
            source: importMode as "filter" | "vendor" | "import",
            user_id: user?.id,
          });
        }
      }

      setCalcProgress(95);
      setLoadingPhase("กำลังจัดเตรียมเอกสาร...");
      const totalRowsCalc = newDocs.reduce((s, d) => s + d.item_count, 0);
      setLoadingDetail(`รวม ${newDocs.length} Vendor×Store Docs · ${totalRowsCalc.toLocaleString()} rows`);

      // Replace only same mode + same batch + same SPC + same Vendor + same Store.
      const newDocKeys = new Set(newDocs.map((d) => `${d.source || importMode}|${getBatchKey(d)}|${d.spc_name}|${d.vendor_code}|${d.store_name}`));
      const finalDocs = [
        ...vendorDocs.filter((d) => {
          if (!isWithin30Days(d.date_key)) return false;
          const docKey = `${d.source || "filter"}|${getBatchKey(d)}|${d.spc_name}|${d.vendor_code}|${d.store_name}`;
          return !newDocKeys.has(docKey);
        }),
        ...newDocs,
      ];
      setVendorDocs(finalDocs);

      const latestBatchValue = newDocs.length > 0 ? newDocs[0].created_at : "";
      const latestBatchLabel = latestBatchValue ? fmtTreeStamp(dateKey, newDocs) : "";
      if (newDocs.length > 0) {
        setSnapshotBatches((prev) => [
          { value: latestBatchValue, label: latestBatchLabel, date_key: dateKeyToISO(dateKey), count: newDocs.length, source: importMode as any },
          ...prev.filter((b) => !(b.label === latestBatchLabel && (b.source || "filter") === importMode)),
        ]);
        setSelectedBatchValuesByMode((prev) => ({ ...prev, [importMode]: [latestBatchValue] }));
      }
      setLatestImportedDocIds(newDocs.map((d) => d.id));
      if (tab2Mode === importMode) {
        let merged = newDocs.flatMap((d) => d.data);
        merged.sort((a, b) => {
          const p = ((a as any).product_name_en || "").localeCompare((b as any).product_name_en || "");
          if (p !== 0) return p;
          const sd = ((a as any).sub_department || "").localeCompare((b as any).sub_department || "");
          if (sd !== 0) return sd;
          const d = ((a as any).department || "").localeCompare((b as any).department || "");
          if (d !== 0) return d;
          const pg = ((a as any).po_group || "").localeCompare((b as any).po_group || "");
          if (pg !== 0) return pg;
          const v = (a.vendor_code || "").localeCompare(b.vendor_code || "");
          if (v !== 0) return v;
          return (a.store_name || "").localeCompare(b.store_name || "");
        });
        const _excluded = await (await import("@/lib/filterTemplates")).applyExcludeFilters(merged as any[], "srr_direct");
        // Snapshot orig_on_order_store for Restore (immutable — never changed by Clear)
        const origMap = new Map<string, number>();
        (_excluded as any[]).forEach((r: any) => origMap.set(r.id, Number(r.on_order_store) || 0));
        origOnOrderStoreRef.current = origMap;
        // Snapshot orig_stock_store for Restore
        const origStockMap = new Map<string, number>();
        (_excluded as any[]).forEach((r: any) => origStockMap.set(r.id, Number(r.stock_store) || 0));
        origStockStoreRef.current = origStockMap;
        setShowData(_excluded as any);
        setSelectedRows(new Set());
        setActiveCell(null);
        setPage(0);
      }

      // AUTO-SAVE to DB (with granular progress)
      let savedNote = "";
      if (user && newDocs.length > 0) {
        try {
          setCalcProgress(98);
          setLoadingPhase(`กำลังบันทึกลง Database... (${newDocs.length} docs · ${totalRowsCalc.toLocaleString()} rows)`);
          setLoadingDetail(`เตรียมบันทึก...`);
          const batchCreatedAt = newDocs[0].created_at;
          await saveD2SSnapshots(
            newDocs.map((d) => ({
              spc_name: d.spc_name,
              vendor_code: d.vendor_code,
              vendor_display: d.vendor_display,
              store_name: d.store_name,
              type_store: d.type_store,
              source: d.source || "filter",
              item_count: d.item_count,
              suggest_count: d.suggest_count,
              data: d.data,
              edit_count: d.edit_count,
              edited_columns: d.edited_columns,
            })),
            user.id,
            dateKeyToISO(dateKey),
            batchCreatedAt,
            (info) => {
              if (info.phase === "delete") {
                setLoadingDetail(`🗑️ ลบของเดิม ${info.current}/${info.total} keys...`);
              } else {
                const pct = Math.round((info.current / info.total) * 100);
                setLoadingDetail(
                  `💾 บันทึก ${info.current.toLocaleString()}/${info.total.toLocaleString()} docs (${pct}%) · ${info.rowsCurrent?.toLocaleString() ?? 0}/${info.rowsTotal?.toLocaleString() ?? 0} rows`
                );
              }
            },
          );
          // Refresh available batches with dedupe (DB minute may differ from optimistic ms)
          try {
            setLoadingDetail("บันทึกสำเร็จ · refresh batch list...");
            const batches = await getSnapshotBatches("srr_d2s_snapshots");
            setSnapshotBatches((prev) => {
              const byKey = new Map<string, typeof prev[number]>();
              for (const b of batches) byKey.set(`${b.source || "filter"}|${b.label}`, b);
              for (const b of prev) {
                const k = `${b.source || "filter"}|${b.label}`;
                if (!byKey.has(k)) byKey.set(k, b);
              }
              return [...byKey.values()].sort((a, b) => b.label.localeCompare(a.label));
            });
            const dbMatch = batches.find((b) => b.label === latestBatchLabel && (b.source || "filter") === importMode);
            if (dbMatch && dbMatch.value !== latestBatchValue) {
              setSelectedBatchValuesByMode((prev) => ({ ...prev, [importMode]: [dbMatch.value] }));
            }
          } catch {}
          savedNote = " · บันทึกแล้ว";
          pruneOldSnapshots(["srr_d2s_snapshots"]).catch(() => {});
        } catch (saveErr: any) {
          console.error("Auto-save D2S to DB failed:", saveErr);
          toast({ title: "⚠️ บันทึก DB ไม่สำเร็จ", description: saveErr.message, variant: "destructive" });
        }
      }

      // Enrich Skip List: SKUs/Vendors that were imported but did NOT survive RPC business filters
      try {
        const rpcSkus = new Set<string>(allRawRows.map((r: any) => r.sku_code).filter(Boolean));
        const rpcVendors = new Set<string>(allRawRows.map((r: any) => r.vendor_code).filter(Boolean));
        const extra: SkippedItem[] = [];
        if (importMode === "import" && importedSkuSet.size > 0) {
          const enriched = await enrichSkippedSkusAfterRead(Array.from(importedSkuSet), rpcSkus);
          extra.push(...enriched);
        }
        if (importMode === "vendor" && importedVendors.length > 0) {
          const importedVcs = [...new Set(importedVendors.map(v => v.vendor_code).filter(Boolean))];
          extra.push(...buildVendorEmptyResultSkips(importedVcs, rpcVendors));
        }
        console.log("[SRR DIRECT] Skip enrich:", {
          mode: importMode, importedSkuSize: importedSkuSet.size,
          importedVendorsLen: importedVendors.length,
          rpcSkus: rpcSkus.size, rpcVendors: rpcVendors.size,
          extra: extra.length, sample: extra.slice(0, 3),
        });
        setImportedSkippedItems(prev => {
          if (extra.length === 0) return prev;
          const seen = new Set(prev.map(p => `${p.kind}|${p.key}|${p.reason}`));
          const merged = [...prev];
          for (const e of extra) {
            const k = `${e.kind}|${e.key}|${e.reason}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          console.log("[SRR DIRECT] Skip merged total:", merged.length);
          return merged;
        });
        setLastImportRanAt(Date.now());
      } catch (enrichErr) {
        console.warn("[SRR DIRECT] Skip enrichment failed:", enrichErr);
      }

      const totalItems = newDocs.reduce((s, d) => s + d.item_count, 0);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const uniqVendors = new Set(newDocs.map((d) => d.vendor_code)).size;
      const uniqSpcs = new Set(newDocs.map((d) => d.spc_name)).size;
      const uniqStores = new Set<string>();
      const uniqSkus = new Set<string>();
      for (const d of newDocs) {
        for (const r of d.data as any[]) {
          if (r?.sku_code) uniqSkus.add(r.sku_code);
          if (r?.store_name) uniqStores.add(r.store_name);
        }
      }
      setLoadingDetail(`เสร็จสิ้น ${elapsed}s · ${totalItems.toLocaleString()} rows`);
      setStatusBanner({
        title: `✅ คำนวณเสร็จ (${elapsed}s)`,
        detail: `${uniqVendors.toLocaleString()} Vendor · ${uniqSkus.size.toLocaleString()} SKU · ${uniqSpcs.toLocaleString()} SPC · ${uniqStores.size.toLocaleString()} Store · ${newDocs.length} Vendor×Store Docs${savedNote}`,
      });
      if (newDocs.length > 0) setDocsDialogOpen(true);
      // Show 100% briefly after save completes, then clear
      setCalcProgress(100);
      await new Promise((r) => requestAnimationFrame(r));
      setTimeout(() => { setLoadingPhase(""); setLoadingDetail(""); setCalcProgress(0); setCalcStartedAt(null); }, 1500);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (/timeout|canceling/i.test(msg)) {
        toast({ title: "Timeout", description: "ข้อมูลมีจำนวนมาก กรุณาลองใหม่อีกครั้ง หรือลดตัวกรองให้แคบลง", variant: "destructive" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
      setCalcProgress(0);
      setLoadingPhase("");
      setLoadingDetail("");
      setCalcStartedAt(null);
    } finally {
      setLoading(false);
    }
  };

  // Doc management
  const deleteVendorDoc = async (docId: string) => {
    const doc = vendorDocs.find((d) => d.id === docId);
    if (!doc) return;
    try {
      const result = await deleteSnapshotDocuments([doc], "srr_d2s_snapshots");
      setVendorDocs((prev) => prev.filter((d) => d.id !== docId));
      setShowData((prev) => prev.filter((r) => !doc.data.some((dr) => dr.id === r.id)));
      setSelectedDocIds((prev) => { const n = new Set(prev); n.delete(docId); return n; });
      toast({ title: "ลบ Document สำเร็จ", description: result.deleted === 0 ? "ลบออกจากหน้าจอแล้ว แต่ไม่พบแถวใน DB" : `ลบจาก DB ${result.deleted} รายการ` });
    } catch (e: any) {
      toast({ title: "ลบ Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };
  // Mode-scoped: only act on docs of the currently active importMode
  const clearAllDocuments = async () => {
    const modeDocs = vendorDocs.filter((d) => (d.source || "filter") === importMode);
    const ids = modeDocs.map((d) => d.id);
    if (ids.length === 0) {
      toast({ title: "ไม่มี Document ใน Mode นี้" });
      return;
    }
    try {
      const result = await deleteSnapshotDocuments(modeDocs, "srr_d2s_snapshots");
      const idSet = new Set(ids);
      setVendorDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
      setShowData([]);
      setSelectedBatchValuesByMode((prev) => ({ ...prev, [importMode]: [] }));
      setSelectedDocIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
      const modeLabel = importMode === "filter" ? "Filter" : importMode === "vendor" ? "Import Vendor" : "Import SKU";
      toast({ title: `ล้าง Document (${modeLabel}) แล้ว`, description: `ลบจาก DB ${result.deleted}/${result.requested} รายการ` });
    } catch (e: any) {
      toast({ title: "ล้าง Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };
  const selectAllDocs = () => {
    const modeIds = vendorDocs.filter((d) => (d.source || "filter") === importMode).map((d) => d.id);
    setSelectedDocIds((prev) => {
      const n = new Set(prev);
      modeIds.forEach((id) => n.add(id));
      return n;
    });
  };
  const unselectAllDocs = () => {
    const modeIds = new Set(vendorDocs.filter((d) => (d.source || "filter") === importMode).map((d) => d.id));
    setSelectedDocIds((prev) => {
      const n = new Set(prev);
      modeIds.forEach((id) => n.delete(id));
      return n;
    });
  };
  const toggleDocSelect = (id: string) => {
    setSelectedDocIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const deleteSelectedDocs = async () => {
    const modeIdSet = new Set(vendorDocs.filter((d) => (d.source || "filter") === importMode).map((d) => d.id));
    const ids = [...selectedDocIds].filter((id) => modeIdSet.has(id));
    if (ids.length === 0) return;
    const docs = vendorDocs.filter((d) => ids.includes(d.id));
    try {
      const result = await deleteSnapshotDocuments(docs, "srr_d2s_snapshots");
      const idSet = new Set(ids);
      setVendorDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
      setShowData((prev) => prev.filter((r) => !docs.some((doc) => doc.data.some((dr) => dr.id === r.id))));
      setSelectedDocIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
      toast({ title: "ลบ Document สำเร็จ", description: `ลบจาก DB ${result.deleted}/${result.requested} รายการ` });
    } catch (e: any) {
      toast({ title: "ลบ Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // Bulk delete by ids — used by Doc dialog
  const deleteDocsByIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const docs = vendorDocs.filter((d) => ids.includes(d.id));
    try {
      await deleteSnapshotDocuments(docs, "srr_d2s_snapshots");
      // Verify against DB — guard against silent RLS denials.
      const uuidIds = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const survivedIds = new Set<string>();
      if (uuidIds.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < uuidIds.length; i += chunkSize) {
          const chunk = uuidIds.slice(i, i + chunkSize);
          const { data } = await (supabase as any).from("srr_d2s_snapshots").select("id").in("id", chunk);
          (data || []).forEach((r: any) => survivedIds.add(r.id));
        }
      }
      const trulyDeleted = new Set(ids.filter((id) => !survivedIds.has(id)));
      setVendorDocs((prev) => prev.filter((d) => !trulyDeleted.has(d.id)));
      setShowData((prev) => prev.filter((r) => !docs.some((doc) => trulyDeleted.has(doc.id) && doc.data.some((dr) => dr.id === r.id))));
      setSelectedDocIds((prev) => { const n = new Set(prev); trulyDeleted.forEach((id) => n.delete(id)); return n; });
      if (survivedIds.size > 0) {
        toast({
          title: "ลบ Document ไม่ครบ",
          description: `ลบจริง ${trulyDeleted.size}/${ids.length} — เหลือ ${survivedIds.size} ตัวลบไม่ได้ (สิทธิ์ไม่พอ / เป็นของ user อื่น)`,
          variant: "destructive",
        });
      } else {
        toast({ title: "ลบ Document สำเร็จ", description: `ลบจาก DB ${trulyDeleted.size}/${ids.length} รายการ` });
      }
    } catch (e: any) {
      toast({ title: "ลบ Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // Show filtered (sort by Store Name > Vendor) — scoped to Tab 2's mode (filter / vendor / import)
  const showFilteredData = async () => {
    if (docsForTab2.length === 0) {
      const modeLabel =
        tab2Mode === "filter" ? "Mode Filter" : tab2Mode === "vendor" ? "Import Vendor" : "Import Barcode";
      toast({
        title: `ยังไม่มี Document ใน ${modeLabel}`,
        description: "ไปที่ Tab 1 แล้วกด Read & Cal ใน mode นี้ก่อน",
        variant: "destructive",
      });
      return;
    }
    let docs = docsForTab2;
    if (selectedDocSpc.length > 0) docs = docs.filter((d) => selectedDocSpc.includes(d.spc_name));
    if (vendorFilter.length > 0) docs = docs.filter((d) => vendorFilter.includes(d.vendor_code));

    // Lazy-load data for docs that haven't been fetched yet
    const unloaded = docs.filter((d) => d.data.length === 0 && d.item_count > 0);
    if (unloaded.length > 0) {
      const dataMap = await fetchSnapshotDataByIds(unloaded.map((d) => d.id), "srr_d2s_snapshots");
      setVendorDocs((prev) => prev.map((d) => {
        if (!dataMap.has(d.id)) return d;
        return { ...d, data: dataMap.get(d.id) as any[] };
      }));
      docs = docs.map((d) => dataMap.has(d.id) ? { ...d, data: dataMap.get(d.id) as any[] } : d);
    }

    let merged = docs.flatMap((d) => d.data);
    if (orderDayFilter.length > 0) merged = merged.filter((r) => orderDayFilter.includes(r.order_day));
    if (itemTypeFilter.length > 0) merged = merged.filter((r) => itemTypeFilter.includes(r.item_type));
    if (storeFilter.length > 0) merged = merged.filter((r) => storeFilter.includes(r.store_name));
    if (typeStoreFilter.length > 0) merged = merged.filter((r) => typeStoreFilter.includes(r.type_store));
    if (buyingStatusFilter.length > 0) merged = merged.filter((r) => buyingStatusFilter.includes(r.buying_status));
    if (poGroupFilter.length > 0) merged = merged.filter((r) => poGroupFilter.includes(r.po_group));
    // Sort: Product Name (EN) > Sub-Department > Department > PO Group > Vendor > Store Name (asc)
    merged.sort((a, b) => {
      const p = ((a as any).product_name_en || "").localeCompare((b as any).product_name_en || "");
      if (p !== 0) return p;
      const sd = ((a as any).sub_department || "").localeCompare((b as any).sub_department || "");
      if (sd !== 0) return sd;
      const d = ((a as any).department || "").localeCompare((b as any).department || "");
      if (d !== 0) return d;
      const pg = ((a as any).po_group || "").localeCompare((b as any).po_group || "");
      if (pg !== 0) return pg;
      const v = (a.vendor_code || "").localeCompare(b.vendor_code || "");
      if (v !== 0) return v;
      return (a.store_name || "").localeCompare(b.store_name || "");
    });

    // Overlay Pack/Box (qty) from latest Range Store — targeted fetch by SKU
    try {
      const skus = [...new Set(merged.map((r) => r.sku_code).filter(Boolean))];
      const pbMap = await getLatestRangeStorePackBox(skus);
      if (pbMap.size > 0) {
        merged = merged.map((r) => {
          if ((r as any).pack != null && (r as any).box != null) return r;
          const pb = pbMap.get(r.sku_code);
          if (!pb) return r;
          return {
            ...r,
            pack: (r as any).pack != null ? (r as any).pack : pb.pack,
            box: (r as any).box != null ? (r as any).box : pb.box,
          };
        });
      }
    } catch (e) {
      console.warn("[SRR DIRECT Show] pack/box overlay failed:", e);
    }

    // Backward-compat: snapshots saved before orig_on_order_store was added will have undefined here.
    merged = merged.map(r => ({
      ...r,
      orig_on_order_store: (r as any).orig_on_order_store ?? r.on_order_store,
      orig_stock_store: (r as any).orig_stock_store ?? r.stock_store,
    }));

    const _excluded2 = await (await import("@/lib/filterTemplates")).applyExcludeFilters(merged as any[], "srr_direct");
    // Snapshot orig_on_order_store for Restore (immutable)
    const origMap2 = new Map<string, number>();
    (_excluded2 as any[]).forEach((r: any) => origMap2.set(r.id, Number(r.on_order_store) || 0));
    origOnOrderStoreRef.current = origMap2;
    // Snapshot orig_stock_store for Restore
    const origStockMap2 = new Map<string, number>();
    (_excluded2 as any[]).forEach((r: any) => origStockMap2.set(r.id, Number(r.stock_store) || 0));
    origStockStoreRef.current = origStockMap2;
    setShowData(_excluded2 as any);
    setPage(0);
    setSelectedRows(new Set());
    setActiveCell(null);
    toast({ title: `แสดง ${merged.length.toLocaleString()} รายการ` });
  };

  const updateOnOrderStore = (rowId: string, value: number) => {
    setShowData((rows) => rows.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, on_order_store: value }))));
    setVendorDocs((prev) => prev.map((doc) => {
      if (!doc.data.some((r) => r.id === rowId)) return doc;
      return { ...doc, data: doc.data.map((r) => r.id === rowId ? recalcD2SRow({ ...r, on_order_store: value }) : r) };
    }));
  };

  const clearAllOnOrderStore = () => {
    setShowData((rows) => rows.map((r) => recalcD2SRow({ ...r, on_order_store: 0 })));
    setVendorDocs((prev) => prev.map((doc) => ({
      ...doc,
      data: doc.data.map((r) => recalcD2SRow({ ...r, on_order_store: 0 })),
    })));
  };

  const restoreAllOnOrderStore = () => {
    setShowData((rows) => rows.map((r) => {
      const orig = origOnOrderStoreRef.current.get(r.id) ?? r.orig_on_order_store ?? 0;
      return recalcD2SRow({ ...r, on_order_store: orig });
    }));
    setVendorDocs((prev) => prev.map((doc) => ({
      ...doc,
      data: doc.data.map((r) => {
        const orig = origOnOrderStoreRef.current.get(r.id) ?? r.orig_on_order_store ?? 0;
        return recalcD2SRow({ ...r, on_order_store: orig });
      }),
    })));
  };

  const updateStockStore = (rowId: string, value: number) => {
    setShowData((rows) => rows.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, stock_store: value }))));
    setVendorDocs((prev) => prev.map((doc) => {
      if (!doc.data.some((r) => r.id === rowId)) return doc;
      return { ...doc, data: doc.data.map((r) => r.id === rowId ? recalcD2SRow({ ...r, stock_store: value }) : r) };
    }));
  };

  const clearAllStockStore = () => {
    setShowData((rows) => rows.map((r) => recalcD2SRow({ ...r, stock_store: 0 })));
    setVendorDocs((prev) => prev.map((doc) => ({
      ...doc,
      data: doc.data.map((r) => recalcD2SRow({ ...r, stock_store: 0 })),
    })));
  };

  const restoreAllStockStore = () => {
    setShowData((rows) => rows.map((r) => {
      const orig = origStockStoreRef.current.get(r.id) ?? r.orig_stock_store ?? 0;
      return recalcD2SRow({ ...r, stock_store: orig });
    }));
    setVendorDocs((prev) => prev.map((doc) => ({
      ...doc,
      data: doc.data.map((r) => {
        const orig = origStockStoreRef.current.get(r.id) ?? r.orig_stock_store ?? 0;
        return recalcD2SRow({ ...r, stock_store: orig });
      }),
    })));
  };

  // Edit handlers
  const updateAvgSales = (rowId: string, value: string) => {
    const numVal = parseFloat(value);
    const newVal = isNaN(numVal) ? 0 : numVal;
    setShowData((rows) => rows.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, avg_sales_store: newVal }))));
    setVendorDocs((prev) =>
      prev.map((doc) => ({
        ...doc,
        data: doc.data.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, avg_sales_store: newVal }))),
        edit_count: doc.data.some((r) => r.id === rowId) ? doc.edit_count + 1 : doc.edit_count,
        edited_columns: doc.data.some((r) => r.id === rowId)
          ? [...new Set([...doc.edited_columns, "avg_sales_store"])]
          : doc.edited_columns,
      })),
    );
  };

  const updateOrderUomEdit = (rowId: string, value: string) => {
    setShowData((rows) => rows.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, order_uom_edit: value }))));
    setVendorDocs((prev) =>
      prev.map((doc) => ({
        ...doc,
        data: doc.data.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, order_uom_edit: value }))),
        edit_count: doc.data.some((r) => r.id === rowId) ? doc.edit_count + 1 : doc.edit_count,
        edited_columns: doc.data.some((r) => r.id === rowId)
          ? [...new Set([...doc.edited_columns, "order_uom_edit"])]
          : doc.edited_columns,
      })),
    );
  };

  const updateOrderCycle = (rowId: string, value: string) => {
    const numVal = parseFloat(value);
    const newVal = isNaN(numVal) ? 0 : numVal;
    setShowData((rows) => rows.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, order_cycle: newVal }))));
    setVendorDocs((prev) =>
      prev.map((doc) => ({
        ...doc,
        data: doc.data.map((r) => (r.id !== rowId ? r : recalcD2SRow({ ...r, order_cycle: newVal }))),
        edit_count: doc.data.some((r) => r.id === rowId) ? doc.edit_count + 1 : doc.edit_count,
        edited_columns: doc.data.some((r) => r.id === rowId)
          ? [...new Set([...doc.edited_columns, "order_cycle"])]
          : doc.edited_columns,
      })),
    );
  };

  // Assign Min N for shown data WHERE min_store === 0 only (with recalc)
  const assignMinBulk = () => {
    const n = parseFloat(assignMinValue);
    if (isNaN(n) || n <= 0) {
      toast({ title: "กรุณาใส่จำนวน Min ที่ถูกต้อง", variant: "destructive" });
      return;
    }
    if (showData.length === 0) {
      toast({ title: "ไม่มีข้อมูลที่แสดง", variant: "destructive" });
      return;
    }
    const zeroMinRows = showData.filter((r) => r.min_store === 0);
    if (zeroMinRows.length === 0) {
      toast({ title: "ไม่มีรายการที่ Min = 0", variant: "destructive" });
      return;
    }
    const affectedIds = new Set(zeroMinRows.map((r) => r.id));
    setShowData((rows) => rows.map((r) => (affectedIds.has(r.id) ? recalcD2SRow({ ...r, min_store: n }) : r)));
    setVendorDocs((prev) =>
      prev.map((doc) => ({
        ...doc,
        data: doc.data.map((r) => (affectedIds.has(r.id) ? recalcD2SRow({ ...r, min_store: n }) : r)),
        edit_count: doc.data.some((r) => affectedIds.has(r.id)) ? doc.edit_count + 1 : doc.edit_count,
        edited_columns: doc.data.some((r) => affectedIds.has(r.id))
          ? [...new Set([...doc.edited_columns, "min_store"])]
          : doc.edited_columns,
      })),
    );
    toast({ title: `Assign Min ${n} สำเร็จ`, description: `${zeroMinRows.length} รายการที่ Min=0 (Recalculated)` });
  };

  // Assign Order Cycle (overwrite for ALL shown rows, then recalc)
  const assignOrderCycleBulk = () => {
    const n = parseFloat(assignOcValue);
    if (isNaN(n) || n < 0) {
      toast({ title: "กรุณาใส่ Order Cycle ที่ถูกต้อง", variant: "destructive" });
      return;
    }
    if (showData.length === 0) {
      toast({ title: "ไม่มีข้อมูลที่แสดง", variant: "destructive" });
      return;
    }
    const affectedIds = new Set(showData.map((r) => r.id));
    setShowData((rows) => rows.map((r) => recalcD2SRow({ ...r, order_cycle: n })));
    setVendorDocs((prev) =>
      prev.map((doc) => ({
        ...doc,
        data: doc.data.map((r) => (affectedIds.has(r.id) ? recalcD2SRow({ ...r, order_cycle: n }) : r)),
        edit_count: doc.data.some((r) => affectedIds.has(r.id)) ? doc.edit_count + 1 : doc.edit_count,
        edited_columns: doc.data.some((r) => affectedIds.has(r.id))
          ? [...new Set([...doc.edited_columns, "order_cycle"])]
          : doc.edited_columns,
      })),
    );
    toast({ title: `Assign Order Cycle = ${n} สำเร็จ`, description: `${showData.length} รายการ (Recalculated)` });
  };

  // Import Excel: match Store Name + SKU → replace SRR Suggest (pcs) + recalc
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importFileRef.current) importFileRef.current.value = "";
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
      if (jsonData.length === 0) {
        toast({ title: "ไฟล์ว่าง", variant: "destructive" });
        return;
      }

      // Build lookup: key = "storeName|skuCode" => qty + track skipped rows
      const qtyMap = new Map<string, number>();
      const skipped: SkippedItem[] = [];
      jsonData.forEach((row, idx) => {
        const storeName = String(row["Store Name"] || row["store_name"] || "").trim();
        const sku = String(row["ID (SKU)"] || row["ID"] || row["sku_code"] || row["SKU"] || "").trim();
        const qtyRaw = row["QTy"] ?? row["Qty"] ?? row["qty"] ?? row["QTY"] ?? "";
        const qty = Number(qtyRaw);
        const key = `${storeName}|${sku}`;
        if (!storeName || !sku) {
          skipped.push({
            kind: "other",
            key: `Row ${idx + 2}`,
            reason: !storeName && !sku ? "ไม่มี Store Name และ SKU" : !storeName ? "ไม่มี Store Name" : "ไม่มี SKU",
            detail: `Store=${storeName || "-"}, SKU=${sku || "-"}`,
            original: row,
          });
        } else if (!qty || qty <= 0 || isNaN(qty)) {
          skipped.push({
            kind: "qty",
            key,
            reason: "Qty ว่าง / ไม่ใช่ตัวเลข / ≤ 0",
            detail: `Qty=${qtyRaw}`,
            original: row,
          });
        } else {
          qtyMap.set(key, qty);
        }
      });

      if (qtyMap.size === 0) {
        setShowImportSkipped(skipped);
        toast({
          title: "ไม่พบข้อมูลที่ตรง",
          description: "ต้องมีคอลัมน์ Store Name, ID (SKU), QTy",
          variant: "destructive",
        });
        return;
      }

      // Validate match against current showData (Store|SKU pairs that don't exist in result)
      const showKeys = new Set(showData.map((r) => `${r.store_name}|${r.sku_code}`));
      qtyMap.forEach((q, k) => {
        if (!showKeys.has(k)) {
          const [s, sku] = k.split("|");
          skipped.push({
            kind: "store",
            key: k,
            reason: "ไม่พบ Store + SKU ใน Show",
            detail: `Store=${s}, SKU=${sku}, Qty=${q}`,
          });
        }
      });

      let matchCount = 0;
      const updateRow = (r: D2SRow): D2SRow => {
        const key = `${r.store_name}|${r.sku_code}`;
        const qty = qtyMap.get(key);
        if (qty !== undefined) {
          matchCount++;
          const moq = r.moq || 1;
          const roundedQty = moq > 0 ? Math.ceil(qty / moq) * moq : qty;
          // Set srr_suggest to imported qty, then recalc final order
          const updated = { ...r, srr_suggest: roundedQty };
          const rawFinal = Math.max(roundedQty - r.on_order_store, 0);
          const calcFinalOrderQty = rawFinal === 0 ? 0 : moq > 0 ? Math.ceil(rawFinal / moq) * moq : rawFinal;
          const calcFinalOrderUom = moq > 0 ? calcFinalOrderQty / moq : calcFinalOrderQty;
          const hasUomEdit = r.order_uom_edit !== "" && r.order_uom_edit != null && !isNaN(Number(r.order_uom_edit));
          const uomEditNum = hasUomEdit ? Number(r.order_uom_edit) : 0;
          const finalOrderUom = hasUomEdit ? uomEditNum : calcFinalOrderUom;
          const finalOrderQty = hasUomEdit ? uomEditNum * moq : calcFinalOrderQty;
          const effectiveFinal = finalOrderQty;
          const dohAsis = r.avg_sales_store > 0 ? r.stock_store / r.avg_sales_store : 0;
          const dohTobe =
            r.avg_sales_store > 0
              ? (r.stock_store + r.on_order_store + effectiveFinal - r.avg_sales_store * r.leadtime) / r.avg_sales_store
              : 0;
          return {
            ...updated,
            final_order_qty: Math.round(finalOrderQty * 100) / 100,
            final_order_uom: Math.round(finalOrderUom * 100) / 100,
            final_order_uom_div: moq > 0 ? Math.ceil(finalOrderUom / moq) : 0,
            doh_asis: Math.round(dohAsis * 100) / 100,
            doh_tobe: Math.round(dohTobe * 100) / 100,
          };
        }
        return r;
      };

      setShowData((rows) => rows.map(updateRow));
      setVendorDocs((prev) =>
        prev.map((doc) => ({
          ...doc,
          data: doc.data.map(updateRow),
          edit_count: doc.edit_count + 1,
          edited_columns: [...new Set([...doc.edited_columns, "srr_suggest"])],
        })),
      );
      setShowImportSkipped(skipped);

      toast({
        title: "Import สำเร็จ",
        description: `Match ${matchCount} รายการจาก ${qtyMap.size} แถวในไฟล์${skipped.length ? ` · Skip ${skipped.length}` : ""}`,
      });
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    }
  };

  // Paged
  const filteredShowData = useMemo(() => {
    let base = showOnlyFinalGt0 ? showData.filter((r) => r.final_order_qty > 0) : showData;
    if (showOnlyMinGt0) base = base.filter((r) => (Number(r.min_store) || 0) > 0);
    if (itemTypeFilter.length > 0) base = base.filter((r) => itemTypeFilter.includes(r.item_type));
    const patched = base.map(r => ({
      ...r,
      orig_on_order_store: r.orig_on_order_store ?? r.on_order_store,
      orig_stock_store: r.orig_stock_store ?? r.stock_store,
    }));
    const filtered = applyChipFilter(patched, tableSearchChips, TABLE_SEARCH_KEYS);
    // Sort by Product Name (EN) A-Z → แล้วเรียง Store ตามรหัสสาขา (store_name ขึ้นต้นด้วย store code)
    return [...filtered].sort((a, b) => {
      const p = ((a as any).product_name_en || "").localeCompare((b as any).product_name_en || "");
      if (p !== 0) return p;
      return (a.store_name || "").localeCompare(b.store_name || "", undefined, { numeric: true });
    });
  }, [showData, tableSearchChips, TABLE_SEARCH_KEYS, showOnlyFinalGt0, showOnlyMinGt0, itemTypeFilter]);
  const pagedData = filteredShowData.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filteredShowData.length / pageSize);

  // Row interactions
  const handleRowClick = (idx: number, id: string, e: { shiftKey: boolean }) => {
    if (e.shiftKey && lastClickedRow !== null) {
      const start = Math.min(lastClickedRow, idx),
        end = Math.max(lastClickedRow, idx);
      setSelectedRows((prev) => {
        const n = new Set(prev);
        for (let i = start; i <= end; i++) if (pagedData[i]) n.add(pagedData[i].id);
        return n;
      });
    } else {
      setSelectedRows((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
    }
    setLastClickedRow(idx);
    setActiveCell({ row: idx, col: activeCell?.col ?? 0 });
  };
  const toggleSelectAll = () => {
    if (selectedRows.size === pagedData.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(pagedData.map((r) => r.id)));
  };

  // Resize
  const onResizeStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    setResizing({ col, startX: e.clientX, startW: columnWidths[col] || getDefaultWidth(col) });
  };
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) =>
      setColumnWidths((prev) => ({
        ...prev,
        [resizing.col]: Math.max(60, resizing.startW + e.clientX - resizing.startX),
      }));
    const onUp = () => setResizing(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const focusCellInput = useCallback((rowIdx: number, colKey: string) => {
    const el = document.querySelector(`input[data-row-idx="${rowIdx}"][data-col-key="${colKey}"]`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }, []);

  const editableColKeys = useMemo(() => [...EDITABLE_D2S], []);

  // Export
  const exportTableData = (selectedOnly: boolean) => {
    const rows = selectedOnly ? showData.filter((r) => selectedRows.has(r.id)) : showData;
    if (rows.length === 0) {
      toast({ title: "ไม่มีข้อมูล", variant: "destructive" });
      return;
    }
    const headers = displayColumns.map(c => c.label);
    const exportRows = rows.map((r) => {
      const mapped: Record<string, any> = {};
      for (const col of displayColumns) {
        mapped[col.label] = (col.key === "core_item" || col.key === "ranking")
          ? deriveCoreVal(r, col.key)
          : (r as any)[col.key];
      }
      return mapped;
    });
    const formulaRow = buildSRRDirectFormulaRow(headers);
    const ws = buildSheetWithFormulaRow(headers, exportRows, formulaRow);
    applyHighPrecisionFormat(ws, ["PO Cost Unit", "Products to Purchase/Unit Price"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SRR DIRECT ITEM");
    XLSX.writeFile(wb, `SRR_DIRECT_ITEM_export.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${rows.length} แถว` });
  };

  // Save PO (D2S)
  // Lookup main_barcode + unit_of_measure for the data_master row where packing_size_qty=1
  const fetchUnitPackLookup = async (skuCodes: string[]): Promise<Map<string, { barcode: string; uom: string }>> => {
    const map = new Map<string, { barcode: string; uom: string }>();
    const unique = [...new Set(skuCodes.filter(Boolean))];
    if (unique.length === 0) return map;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("data_master")
        .select("sku_code, main_barcode, unit_of_measure, packing_size_qty")
        .in("sku_code", chunk)
        .eq("packing_size_qty", 1);
      if (error) { console.error("fetchUnitPackLookup error:", error); continue; }
      for (const row of data || []) {
        if (row.sku_code && !map.has(row.sku_code)) {
          map.set(row.sku_code, {
            barcode: row.main_barcode || "",
            uom: row.unit_of_measure || "",
          });
        }
      }
    }
    return map;
  };

  const savePO = async () => {
    try {
      const vendors = [...new Set(showData.filter((r) => r.final_order_qty > 0).map((r) => r.vendor_code))].sort();
      if (vendors.length === 0) {
        toast({ title: "ไม่มี Vendor ที่มี Suggest > 0", variant: "destructive" });
        return;
      }
      const skusForLookup = showData.filter((r) => r.final_order_qty > 0).map((r) => r.sku_code);
      const unitPackMap = await fetchUnitPackLookup(skusForLookup);
      const now = new Date();
      const ts =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0") +
        String(now.getSeconds()).padStart(2, "0");
      // No manual picking type selection — auto-map per row from store_name
      const existing = JSON.parse(localStorage.getItem("srr_saved_pos_d2s") || "[]");
      const newPOs: any[] = [];

      const spcManager = "SPC manager01";
      for (const vc of vendors) {
        const vendorRows = showData.filter((r) => r.vendor_code === vc && r.final_order_qty > 0);
        if (vendorRows.length === 0) continue;
        const vName = vendorRows[0].vendor_display;

        // Group by Store Name → po_group (fallback: vendor_code) within Vendor
        const stores = [...new Set(vendorRows.map((r) => r.store_name))].sort();
        for (const storeName of stores) {
          const storeRows = vendorRows.filter((r) => r.store_name === storeName);
          // Sub-group by po_group within (vendor + store)
          const groupMap = new Map<string, D2SRow[]>();
          for (const r of storeRows) {
            const gk = r.po_group && r.po_group.trim() ? r.po_group.trim() : vc;
            if (!groupMap.has(gk)) groupMap.set(gk, []);
            groupMap.get(gk)!.push(r);
          }
          const matchedST = storeTypes.find((st) => st.store_name === storeName);
          const rowPickingId = matchedST ? matchedST.ship_to : "";

          for (const [groupKey, gRows] of groupMap) {
            const sortedRows = gRows.sort((a, b) => String(a.sku_code).localeCompare(String(b.sku_code)));
            const exportRows = sortedRows.map((r, idx) => {
              const up = unitPackMap.get(r.sku_code);
              const upBarcode = up?.barcode || r.main_barcode;
              const upUom = up?.uom || r.unit_of_measure || "";
              return {
                partner_id: idx === 0 ? vc : "",
                "Picking Type / Database ID": idx === 0 ? rowPickingId : "",
                "Inter Transfer": idx === 0 ? "true" : "",
                "PO Group": idx === 0 ? groupKey : "",
                "Products to Purchase/barcode": upBarcode,
                "Products to Purchase/Product": upBarcode,
                "Product name": r.product_name_la,
                "Store Name": r.store_name,
                "Products to Purchase/UoM": upUom,
                "Products to Purchase/Exclude In Package": "True",
                "Products to Purchase/Quantity": r.final_order_qty,
                "Products to Purchase/Unit Price": r.po_cost_unit,
                assigned_to: idx === 0 ? spcManager : "",
                description: idx === 0 ? exportDescription : "",
              };
            });
            newPOs.push({
              id: `po-d2s-${ts}-${vc}-${storeName}-${groupKey}`,
              name: `${ts} - D2S - ${vc} - ${storeName}${groupKey !== vc ? ` (${groupKey})` : ""}`,
              date: now.toISOString(),
              vendor_code: vc,
              vendor_name: vName,
              spc_name: gRows[0].spc_name || "",
              rows: exportRows,
              pickingType,
              description: exportDescription,
            });
          }
        }
      }
      localStorage.setItem("srr_saved_pos_d2s", JSON.stringify([...existing, ...newPOs]));
      setPoRefreshKey((v) => v + 1);
      setSelectedBatchValuesByMode((prev) => ({ ...prev, [activeDateMode]: [now.toISOString()] }));

      // Also persist to DB (saved_po_documents) so Report 2 (Act = Saved POs) can read it
      if (user?.id) {
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const srcMap: Record<string, "filter" | "vendor" | "import"> = { filter: "filter", vendor: "vendor", import: "import" };
        const src = srcMap[activeDateMode] || "filter";
        // Group newPOs by vendor_code so we save one row per vendor (with merged po_data across stores+po_groups)
        const byVendor = new Map<string, { spc_name: string; vendor_display: string; rows: any[] }>();
        for (const po of newPOs) {
          const cur = byVendor.get(po.vendor_code) || { spc_name: po.spc_name || "", vendor_display: po.vendor_name || "", rows: [] };
          cur.rows.push(...po.rows);
          if (!cur.spc_name && po.spc_name) cur.spc_name = po.spc_name;
          byVendor.set(po.vendor_code, cur);
        }
        try {
          const inserts = [...byVendor.entries()].map(([vc, v]) => ({
            date_key: dateKey,
            spc_name: v.spc_name || "",
            vendor_code: vc,
            vendor_display: v.vendor_display || "",
            po_data: v.rows as any,
            item_count: v.rows.length,
            source: src,
            user_id: user.id,
          }));
          if (inserts.length > 0) {
            const { error: insErr } = await supabase.from("saved_po_documents").insert(inserts);
            if (insErr) console.error("saved_po_documents insert error:", insErr);
          }
        } catch (dbErr) {
          console.error("Failed to persist saved POs to DB:", dbErr);
        }
      }

      toast({ title: "บันทึก PO สำเร็จ", description: `${newPOs.length} เอกสาร (แยกตาม vendor + store + po_group)` });
      setExportOpen(false);
    } catch (err: any) {
      toast({ title: "บันทึก PO ไม่สำเร็จ", description: err?.message, variant: "destructive" });
    }
  };

  // Export PO to XLSX (D2S) — mirrors DC's doExport, grouped by vendor + store + po_group
  const doExportD2S = async () => {
    try {
      const vendors = [...new Set(showData.filter((r) => r.final_order_qty > 0).map((r) => r.vendor_code))].sort();
      if (vendors.length === 0) {
        toast({ title: "ไม่มี Vendor ที่มี Suggest > 0", variant: "destructive" });
        return;
      }
      const skusForLookup = showData.filter((r) => r.final_order_qty > 0).map((r) => r.sku_code);
      const unitPackMap = await fetchUnitPackLookup(skusForLookup);
      const now = new Date();
      const ts =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0") +
        String(now.getSeconds()).padStart(2, "0");
      const spcManager = "SPC manager01";
      const allExportRows: any[] = [];
      const cost0DocsCreated: Cost0Doc[] = [];
      for (const vc of vendors) {
        const vendorRows = showData.filter((r) => r.vendor_code === vc && r.final_order_qty > 0);
        if (vendorRows.length === 0) continue;
        const stores = [...new Set(vendorRows.map((r) => r.store_name))].sort();
        const cost0VendorRows: { row: D2SRow; storeName: string }[] = [];
        for (const storeName of stores) {
          const storeRows = vendorRows.filter((r) => r.store_name === storeName);
          const groupMap = new Map<string, D2SRow[]>();
          for (const r of storeRows) {
            const gk = r.po_group && r.po_group.trim() ? r.po_group.trim() : vc;
            if (!groupMap.has(gk)) groupMap.set(gk, []);
            groupMap.get(gk)!.push(r);
          }
          const matchedST = storeTypes.find((st) => st.store_name === storeName);
          const rowPickingId = matchedST ? matchedST.ship_to : "";
          for (const [groupKey, gRows] of groupMap) {
            const sortedRows = gRows.sort((a, b) => String(a.sku_code).localeCompare(String(b.sku_code)));
            const validRows = sortedRows.filter((r) => Number(r.po_cost_unit) > 0);
            const zeroRows = sortedRows.filter((r) => !(Number(r.po_cost_unit) > 0));
            for (const r of zeroRows) cost0VendorRows.push({ row: r, storeName });
            if (validRows.length === 0) continue;
            const maxPerPO = Math.max(0, Math.floor(Number(exportMaxPerPO) || 0));
            const chunks: D2SRow[][] = [];
            if (maxPerPO > 0) {
              for (let i = 0; i < validRows.length; i += maxPerPO) chunks.push(validRows.slice(i, i + maxPerPO));
            } else {
              chunks.push(validRows);
            }
            for (let ci = 0; ci < chunks.length; ci++) {
              const chunkRows = chunks[ci];
              const chunkGroupKey = chunks.length > 1 ? `${groupKey}-${ci + 1}` : groupKey;
              const exportRows = chunkRows.map((r, idx) => {
                const up = unitPackMap.get(r.sku_code);
                const upBarcode = up?.barcode || r.main_barcode;
                const upUom = up?.uom || r.unit_of_measure || "";
                return {
                  partner_id: idx === 0 ? vc : "",
                  "Picking Type / Database ID": idx === 0 ? rowPickingId : "",
                  "Inter Transfer": idx === 0 ? "true" : "",
                  "PO Group": idx === 0 ? chunkGroupKey : "",
                  "Products to Purchase/barcode": upBarcode,
                  "Products to Purchase/Product": upBarcode,
                  "Product name": r.product_name_la,
                  "Store Name": r.store_name,
                  "Products to Purchase/UoM": upUom,
                  "Products to Purchase/Exclude In Package": "True",
                  "Products to Purchase/Quantity": r.final_order_qty,
                  "Products to Purchase/Unit Price": r.po_cost_unit,
                  assigned_to: idx === 0 ? spcManager : "",
                  description: idx === 0 ? exportDescription : "",
                };
              });
              const mapped = await remapRowsByTemplate("srr_d2s_po", exportRows);
              allExportRows.push(...mapped);
            }
          }
        }
        if (cost0VendorRows.length > 0) {
          const sample = vendorRows[0] as any;
          const vendorDisplay = sample?.vendor_display || `${vc} - ${sample?.vendor_name || ""}`;
          cost0DocsCreated.push(buildCost0Doc({
            variant: "direct",
            vendor_code: vc,
            vendor_name: sample?.vendor_name || "",
            vendor_display: vendorDisplay,
            spc_name: sample?.spc_name || "",
            ts,
            isoDate: now.toISOString(),
            rows: cost0VendorRows.map(({ row, storeName }) => ({
              Vendor: vendorDisplay,
              "SKU Code": row.sku_code,
              "Main barcode": row.main_barcode || "",
              "Product Name EN": (row as any).product_name_en || "",
              "PO Cost": "" as const,
              MOQ: "" as const,
              "Qty Order": Number(row.final_order_qty) || 0,
              _store: storeName,
            })),
          }));
        }
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(allExportRows);
      applyHighPrecisionFormat(ws, ["Products to Purchase/Unit Price"]);
      XLSX.utils.book_append_sheet(wb, ws, "PO");
      const fileName = vendors.length === 1 ? `${ts} - D2S - ${vendors[0]}.xlsx` : `${ts} - D2S - MultiVendor.xlsx`;
      if (allExportRows.length > 0) XLSX.writeFile(wb, fileName);
      if (cost0DocsCreated.length > 0) {
        try { appendCost0Docs(COST0_KEY_D2S, cost0DocsCreated); } catch (e: any) {
          toast({ title: "บันทึก Doc Cost=0 ไม่สำเร็จ", description: e?.message, variant: "destructive" });
        }
        setCost0RefreshKey(k => k + 1);
      }

      // Save Doc Final (D2S) — เก็บ snapshot ของ Doc ที่ผ่าน Review (บันทึกเฉพาะตอนกด Save/Export)
      if (user?.id) {
        try {
          const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          const src = activeDateMode || "filter";
          const finalInserts = vendors.map((vc) => {
            const vRows = showData.filter((r) => r.vendor_code === vc);
            const vDoc = vendorDocs.find((d) => d.vendor_code === vc);
            return {
              date_key: dateKey,
              spc_name: vDoc?.spc_name || vRows[0]?.spc_name || "",
              vendor_code: vc,
              vendor_display: vDoc?.vendor_display || vRows[0]?.vendor_display || vc,
              data: vRows as any,
              item_count: vRows.length,
              suggest_count: vRows.filter((r) => r.final_order_qty > 0).length,
              edited_columns: vDoc?.edited_columns || [],
              source: src,
              saved_by: user.id,
            };
          });
          if (finalInserts.length > 0) {
            const { error: finErr } = await (supabase as any).from("srr_d2s_final_documents").insert(finalInserts);
            if (finErr) {
              console.error("srr_d2s_final_documents insert error:", finErr);
              toast({ title: "บันทึก Doc Final ไม่สำเร็จ", description: finErr.message || "ตรวจสอบว่า table srr_d2s_final_documents ถูกสร้างแล้ว", variant: "destructive" });
            } else {
              loadFinalDocs();
            }
          }
        } catch (finErr: any) {
          console.error("Failed to save Doc Final:", finErr);
          toast({ title: "บันทึก Doc Final ไม่สำเร็จ", description: finErr?.message || "Unknown error", variant: "destructive" });
        }
      }

      setExportOpen(false);
      const cost0Total = cost0DocsCreated.reduce((s, d) => s + d.rows.length, 0);
      toast({
        title: allExportRows.length > 0 ? "Export สำเร็จ" : "ไม่มีรายการ Cost > 0",
        description: `${vendors.length} Vendor(s) · Excel ${allExportRows.length} แถว · Cost=0 ${cost0Total} แถว (${cost0DocsCreated.length} Doc) → ดูที่ Tab "Doc Cost = 0"`,
      });
    } catch (err: any) {
      toast({ title: "Export ไม่สำเร็จ", description: err?.message, variant: "destructive" });
    }
  };

  // Tree helpers (5-level: Date > SPC > Vendor > TypeStore > Store)
  const toggleDate = (dk: string) => {
    setExpandedDates((prev) => {
      const n = new Set(prev);
      n.has(dk) ? n.delete(dk) : n.add(dk);
      return n;
    });
  };
  const toggleSPC = (key: string) => {
    setExpandedSPCs((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };
  const toggleVendor = (key: string) => {
    setExpandedVendors((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };
  const toggleTypeStore = (key: string) => {
    setExpandedTypeStores((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };
  const expandAllTree = () => {
    const allDates = new Set<string>();
    const allSPCs = new Set<string>();
    const allVendors = new Set<string>();
    const allTS = new Set<string>();
    for (const [dk, sm] of docTree) {
      allDates.add(dk);
      for (const [s, vm] of sm) {
        allSPCs.add(`${dk}|${s}`);
        for (const [vc, tsm] of vm) {
          allVendors.add(`${dk}|${s}|${vc}`);
          for (const ts of tsm.keys()) allTS.add(`${dk}|${s}|${vc}|${ts}`);
        }
      }
    }
    setExpandedDates(allDates);
    setExpandedSPCs(allSPCs);
    setExpandedVendors(allVendors);
    setExpandedTypeStores(allTS);
  };
  const collapseAllTree = () => {
    setExpandedSPCs(new Set());
    setExpandedDates(new Set());
    setExpandedVendors(new Set());
    setExpandedTypeStores(new Set());
  };

  // Tab 1 summary: count docs that match the current Tab 1 mode (filter / vendor / import)
  const docsInMode = vendorDocs.filter((d) => (d.source || "filter") === importMode);
  const totalItems = docsInMode.reduce((s, d) => s + d.item_count, 0);
  const totalDocsCount = docsInMode.length;

  const renderTable = (rows: D2SRow[], showEdit: boolean) => {
    if (rows.length === 0) return null;
    return (
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            {showEdit && (
              <>
                <th className="data-table-header bg-muted" style={{ width: 36, minWidth: 36 }}>
                  <Checkbox
                    checked={selectedRows.size === pagedData.length && pagedData.length > 0}
                    onCheckedChange={toggleSelectAll}
                    className="mx-auto"
                  />
                </th>
                <th className="data-table-header bg-muted" style={{ width: 44, minWidth: 44 }}>
                  #
                </th>
              </>
            )}
            {!showEdit && (
              <th className="data-table-header bg-muted" style={{ width: 44, minWidth: 44 }}>
                #
              </th>
            )}
            {displayColumns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "data-table-header relative group cursor-pointer select-none whitespace-nowrap",
                  selectedCols.has(col.key) && "bg-emerald-100 dark:bg-emerald-900/40",
                  HIGHLIGHT_D2S.has(col.key) && "bg-blue-50 dark:bg-blue-950/30",
                )}
                style={{ width: columnWidths[col.key] || getDefaultWidth(col.key), minWidth: 60 }}
                onClick={() =>
                  setSelectedCols((prev) => {
                    const n = new Set(prev);
                    n.has(col.key) ? n.delete(col.key) : n.add(col.key);
                    return n;
                  })
                }
              >
                {col.label}
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/30 group-hover:bg-primary/10"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onResizeStart(col.key, e);
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isSelected = selectedRows.has(row.id);
            const isActiveRow = activeCell?.row === idx;
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border transition-colors",
                  isSelected
                    ? "bg-emerald-50 dark:bg-emerald-950/30"
                    : isActiveRow
                      ? "bg-blue-50/50 dark:bg-blue-950/20"
                      : "hover:bg-muted/50",
                )}
                onClick={(e) => showEdit && handleRowClick(idx, row.id, e)}
              >
                {showEdit && (
                  <>
                    <td
                      className="data-table-cell text-center bg-inherit"
                      style={{ width: 36 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() =>
                          setSelectedRows((prev) => {
                            const n = new Set(prev);
                            n.has(row.id) ? n.delete(row.id) : n.add(row.id);
                            return n;
                          })
                        }
                        className="h-3.5 w-3.5"
                      />
                    </td>
                    <td className="data-table-cell text-muted-foreground text-center bg-inherit" style={{ width: 44 }}>
                      {page * pageSize + idx + 1}
                    </td>
                  </>
                )}
                {!showEdit && (
                  <td className="data-table-cell text-muted-foreground text-center bg-inherit" style={{ width: 44 }}>
                    {idx + 1}
                  </td>
                )}
                {displayColumns.map((col, colIdx) => {
                  const val = (col.key === "core_item" || col.key === "ranking")
                    ? deriveCoreVal(row, col.key)
                    : row[col.key as keyof D2SRow];
                  const displayVal = formatCellValue(val, col.key);
                  const isTruncate = TRUNCATE_D2S.has(col.key);
                  const isHighlight = HIGHLIGHT_D2S.has(col.key);

                  // Order UOM Edit overrides Final Order Qty → orange highlight
                  const hasUomEditOverride = row.order_uom_edit !== "" && !isNaN(Number(row.order_uom_edit));
                  const isOverriddenFinal = col.key === "final_order_qty" && hasUomEditOverride;
                  // DOH ≥ 30 → light red highlight (D2S)
                  const isDohRed =
                    (col.key === "doh_asis" || col.key === "doh_tobe") &&
                    typeof val === "number" &&
                    (val as number) >= DOH_RED_THRESHOLD_D2S;

                  return (
                    <td
                      key={col.key}
                      data-row={idx}
                      data-col={colIdx}
                      className={cn(
                        "data-table-cell",
                        selectedCols.has(col.key) && "bg-emerald-50/50 dark:bg-emerald-950/20",
                        activeCell?.row === idx && activeCell?.col === colIdx && "ring-2 ring-primary ring-inset",
                        isHighlight &&
                          !isSelected &&
                          !isActiveRow &&
                          !isOverriddenFinal &&
                          !isDohRed &&
                          "bg-blue-50/40 dark:bg-blue-950/20",
                        isOverriddenFinal && "bg-orange-100 dark:bg-orange-950/40",
                        isDohRed && "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold",
                        col.key === "core_item" && (val === "Core Item" ? "text-blue-600 dark:text-blue-400 font-medium" : "text-muted-foreground"),
                        col.key === "final_order_qty" &&
                          typeof val === "number" &&
                          (val as number) > 0 &&
                          !isOverriddenFinal
                          ? "font-semibold text-green-600 dark:text-green-400"
                          : "",
                      )}
                      style={{
                        width: columnWidths[col.key] || getDefaultWidth(col.key),
                        maxWidth: isTruncate ? columnWidths[col.key] || 180 : undefined,
                      }}
                      onClick={(e) => {
                        if (showEdit) {
                          e.stopPropagation();
                          setActiveCell({ row: idx, col: colIdx });
                          handleRowClick(idx, row.id, e);
                        }
                      }}
                    >
                      {showEdit && col.key === "avg_sales_store" ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{displayVal}</span>
                          {(val as number) !== 0 ? (
                            <button
                              className="text-[9px] text-destructive hover:underline px-0.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateAvgSales(row.id, "0");
                              }}
                              title="Clear"
                            >
                              Clear
                            </button>
                          ) : (
                            <button
                              className="text-[9px] text-primary hover:underline px-0.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateAvgSales(row.id, String(row.orig_avg_sales_store));
                              }}
                              title="Restore"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      ) : showEdit && col.key === "on_order_store" ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{displayVal}</span>
                          <button
                            className="inline-flex items-center justify-center w-4 h-4 rounded border border-red-400 text-red-500 hover:bg-red-50"
                            onClick={(e) => { e.stopPropagation(); updateOnOrderStore(row.id, 0); }}
                            title="ล้างค่า ON ORDER"
                          ><X className="w-2.5 h-2.5" /></button>
                          <button
                            className="inline-flex items-center justify-center w-4 h-4 rounded border border-sky-400 text-sky-500 hover:bg-sky-50"
                            onClick={(e) => { e.stopPropagation(); const orig = origOnOrderStoreRef.current.get(row.id) ?? row.orig_on_order_store ?? 0; updateOnOrderStore(row.id, orig); }}
                            title={`คืนค่า ON ORDER เดิม (${origOnOrderStoreRef.current.get(row.id) ?? row.orig_on_order_store ?? 0})`}
                          ><RotateCcw className="w-2.5 h-2.5" /></button>
                        </div>
                      ) : showEdit && col.key === "stock_store" ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{displayVal}</span>
                          <button
                            className="inline-flex items-center justify-center w-4 h-4 rounded border border-red-400 text-red-500 hover:bg-red-50"
                            onClick={(e) => { e.stopPropagation(); updateStockStore(row.id, 0); }}
                            title="ล้างค่า Store Stock"
                          ><X className="w-2.5 h-2.5" /></button>
                          <button
                            className="inline-flex items-center justify-center w-4 h-4 rounded border border-sky-400 text-sky-500 hover:bg-sky-50"
                            onClick={(e) => { e.stopPropagation(); const orig = origStockStoreRef.current.get(row.id) ?? row.orig_stock_store ?? 0; updateStockStore(row.id, orig); }}
                            title={`คืนค่า Store Stock เดิม (${origStockStoreRef.current.get(row.id) ?? row.orig_stock_store ?? 0})`}
                          ><RotateCcw className="w-2.5 h-2.5" /></button>
                        </div>
                      ) : showEdit && col.key === "order_uom_edit" ? (
                        <Input
                          className="h-6 text-xs px-1 py-0 border-primary/50 w-full"
                          value={row.order_uom_edit}
                          onChange={(e) => updateOrderUomEdit(row.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="—"
                          data-row-idx={idx}
                          data-col-key={col.key}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "ArrowDown") {
                              e.preventDefault();
                              const nextRow = Math.min(idx + 1, pagedData.length - 1);
                              focusCellInput(nextRow, col.key);
                              setActiveCell({ row: nextRow, col: colIdx });
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              const prevRow = Math.max(idx - 1, 0);
                              focusCellInput(prevRow, col.key);
                              setActiveCell({ row: prevRow, col: colIdx });
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              const ei = editableColKeys.indexOf(col.key);
                              const nextEi = (ei + 1) % editableColKeys.length;
                              const nextRow = nextEi === 0 ? Math.min(idx + 1, pagedData.length - 1) : idx;
                              const nextKey = editableColKeys[nextEi];
                              const nextColIdx = displayColumns.findIndex((c) => c.key === nextKey);
                              focusCellInput(nextRow, nextKey);
                              setActiveCell({ row: nextRow, col: nextColIdx });
                            }
                          }}
                        />
                      ) : showEdit && col.key === "order_cycle" ? (
                        <div className="flex items-center gap-0.5">
                          <Input
                            className="h-6 text-xs px-1 py-0 border-primary/50 w-16"
                            type="number"
                            value={row.order_cycle || ""}
                            onChange={(e) => updateOrderCycle(row.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="—"
                            data-row-idx={idx}
                            data-col-key={col.key}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "ArrowDown") {
                                e.preventDefault();
                                const nextRow = Math.min(idx + 1, pagedData.length - 1);
                                focusCellInput(nextRow, col.key);
                                setActiveCell({ row: nextRow, col: colIdx });
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                const prevRow = Math.max(idx - 1, 0);
                                focusCellInput(prevRow, col.key);
                                setActiveCell({ row: prevRow, col: colIdx });
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                const ei = editableColKeys.indexOf(col.key);
                                const nextEi = (ei + 1) % editableColKeys.length;
                                const nextRow = nextEi === 0 ? Math.min(idx + 1, pagedData.length - 1) : idx;
                                const nextKey = editableColKeys[nextEi];
                                const nextColIdx = displayColumns.findIndex((c) => c.key === nextKey);
                                focusCellInput(nextRow, nextKey);
                                setActiveCell({ row: nextRow, col: nextColIdx });
                              }
                            }}
                          />
                          {row.order_cycle !== row.orig_order_cycle && (
                            <button
                              className="text-[9px] text-primary hover:underline px-0.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateOrderCycle(row.id, String(row.orig_order_cycle));
                              }}
                              title="Restore"
                            >
                              ↩
                            </button>
                          )}
                        </div>
                      ) : col.key === "po_cost_unit" &&
                        Math.abs((row.po_cost_unit || 0) - (row.orig_po_cost_unit || 0)) > 0.001 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="block">{displayVal}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info
                                className="h-3 w-3 text-amber-600 dark:text-amber-400 cursor-help"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <div className="text-xs space-y-0.5">
                                <div className="font-semibold">PO Cost Override (Import)</div>
                                <div>
                                  Original:{" "}
                                  <span className="font-mono">
                                    {row.orig_po_cost_unit?.toLocaleString(undefined, { maximumFractionDigits: 10 })}
                                  </span>
                                </div>
                                <div>
                                  Imported:{" "}
                                  <span className="font-mono text-amber-600 dark:text-amber-400">
                                    {row.po_cost_unit?.toLocaleString(undefined, { maximumFractionDigits: 10 })}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">
                                  Δ{" "}
                                  {((row.po_cost_unit || 0) - (row.orig_po_cost_unit || 0)).toLocaleString(undefined, {
                                    maximumFractionDigits: 10,
                                  })}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      ) : isTruncate && displayVal.length > 25 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block max-w-full">{displayVal}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm">
                            <p className="text-xs">{displayVal}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span
                          className={cn(
                            "block",
                            isTruncate && "truncate",
                            col.key === "rank_sales" &&
                              row.rank_is_default &&
                              "text-red-600 dark:text-red-400 font-semibold",
                          )}
                        >
                          {displayVal}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in" tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">SRR DIRECT ITEM</h1>
          <p className="text-xs text-muted-foreground">
            {totalDocsCount > 0
              ? `✅ ${totalDocsCount} Vendor Docs · ${totalItems.toLocaleString()} รายการ`
              : "กด Read & Cal เพื่อเริ่ม"}
            {showData.length > 0 && ` · แสดง ${showData.length.toLocaleString()}`}
            {selectedRows.size > 0 && ` · เลือก ${selectedRows.size}`}
          </p>
        </div>
      </div>

      {calcProgress > 0 && loadingPhase !== "" && (
        <div className="px-4 py-2 bg-card border-b border-border space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-medium truncate">{loadingPhase}</span>
            <div className="flex items-center gap-2 shrink-0">
              {calcStartedAt != null && <ElapsedTimer startedAt={calcStartedAt} />}
              <span className="text-xs font-semibold tabular-nums">{calcProgress}%</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  cancelCalcRef.current = true;
                }}
                className="h-6 text-xs px-2"
              >
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
          <Progress value={calcProgress} className="h-2" />
          {loadingDetail && (
            <div className="text-[10px] text-muted-foreground/80 truncate font-mono pt-0.5">
              ▸ {loadingDetail}
            </div>
          )}
        </div>
      )}

      {/* Prepare data progress (lighter) */}
      {!loading && dataLoadingMsg && (
        <div className="px-4 py-1.5 bg-amber-500/5 border-b border-amber-500/20 space-y-0.5">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium truncate">{dataLoadingMsg}</span>
          </div>
          {loadingDetail && (
            <div className="text-[10px] text-amber-600/80 truncate font-mono pl-5">
              ▸ {loadingDetail}
            </div>
          )}
        </div>
      )}

      {/* Status banner — Prepare/Cal completion (replaces right-side toast) */}
      {statusBanner && (
        <div className="px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 truncate">{statusBanner.title}</span>
            {statusBanner.detail && (
              <span className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 truncate">· {statusBanner.detail}</span>
            )}
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-emerald-700/70 hover:text-emerald-700 dark:text-emerald-400/70 shrink-0"
            aria-label="ปิด"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}


      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* ============ LINE 1: All primary controls in single row ============ */}
        <div className="px-1.5 pt-1.5 pb-1.5 border-b border-border bg-card flex items-stretch gap-1 flex-nowrap">
          {/* TAB zone (gray) */}
          <div className="flex items-center gap-1 shrink-0 px-1 py-0.5 rounded-md bg-muted/60 border border-border/80">
            <TabsList className="h-6 bg-transparent p-0 gap-0.5">
              <TabsTrigger value="read-cal" className="text-[11px] gap-1 h-6 px-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                <Database className="w-3 h-3" /> <span className="text-red-700 font-bold">1.</span> คำนวน
              </TabsTrigger>
              <TabsTrigger value="show-edit" className="text-[11px] gap-1 h-6 px-1.5 data-[state=inactive]:hidden data-[state=active]:bg-card data-[state=active]:shadow-sm">
                <Filter className="w-3 h-3" /> <span className="text-red-700 font-bold">2.</span> แสดง
              </TabsTrigger>
              <TabsTrigger value="report2" className="text-[11px] gap-1 h-6 px-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                <BarChart3 className="w-3 h-3" /> Report
              </TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "read-cal" && (
            <>
              {/* MODE zone — color tinted by active mode */}
              <div className={cn(
                "flex items-center gap-1 shrink-0 px-1 py-0.5 rounded-md border transition-colors",
                importMode === "filter" && "bg-violet-100/60 border-violet-300 dark:bg-violet-950/30 dark:border-violet-800",
                importMode === "import" && "bg-sky-100/60 border-sky-300 dark:bg-sky-950/30 dark:border-sky-800",
                importMode === "vendor" && "bg-orange-100/60 border-orange-300 dark:bg-orange-950/30 dark:border-orange-800",
              )}>
                <SrrImportFilter
                  compact
                  mode={importMode}
                  onModeChange={(m) => {
                    setImportMode(m);
                    setTab2Mode(m);
                    setDataReady(false);
                    if (m !== "import") {
                      setImportedItems([]);
                      setImportedSkuSet(new Set());
                      setImportedQtyByKey(new Map());
                      setImportedPoCostBySku(new Map());
                      setImportedStoreBySku(new Map());
                      setImportedOverrideVendorBySku(new Map());
                      setImportedSkippedKeys([]);
                    }
                    if (m !== "vendor") {
                      setImportedVendors([]);
                    }
                    if (m === "filter") {
                      setVendorFilterCal([]);
                    }
                    setImportedSkippedItems([]);
                    setSelectedDocSpc([]);
                    setVendorFilter([]);
                    setOrderDayFilter([]);
                    setItemTypeFilter([]);
                    setStoreFilter([]);
                    setTypeStoreFilter([]);
                    setBuyingStatusFilter([]);
                    setPoGroupFilter([]);
                    setShowData([]);
                    setTableSearchChips([]);
                    setSelectedRows(new Set());
                    setActiveCell(null);
                    setPage(0);
                  }}
                  importedItems={importedItems}
                  onImportedChange={(items) => {
                    setImportedItems(items);
                    setDataReady(false);
                  }}
                  matchedCount={importedSkuSet.size}
                  skippedCount={importedSkippedKeys.length}
                  disabled={loading}
                  enableVendorMode
                  importedVendors={importedVendors}
                  onImportedVendorsChange={(v) => {
                    setImportedVendors(v);
                    setDataReady(false);
                  }}
                  showStoreNameInTemplate
                />
              </div>

              {/* FILTER / UPLOAD zone — lighter tint matching mode */}
              <div className={cn(
                "flex items-center gap-1 shrink-0 px-1 py-0.5 rounded-md border transition-colors",
                importMode === "filter" && "bg-violet-50 border-violet-200 dark:bg-violet-950/20 dark:border-violet-900",
                importMode === "import" && "bg-sky-50 border-sky-200 dark:bg-sky-950/20 dark:border-sky-900",
                importMode === "vendor" && "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900",
              )}>
                {importMode === "filter" && (
                  <>
                    <SrrFiltersPopover
                      activeCount={
                        selectedSpcForCal.length +
                        orderDayCal.length + vendorFilterCal.length +
                        itemTypeCal.length +
                        typeStoreCal.length +
                        storeCal.length +
                        buyingStatusCal.length +
                        poGroupCal.length +
                        divisionGroupCal.length + divisionCal.length + departmentCal.length +
                        subDepartmentCal.length + classCal.length + subClassCal.length
                      }
                    >
                      <MultiSelect compact label="SPC Name" options={preSpcOptions.length > 0 ? preSpcOptions : spcOptions} selected={selectedSpcForCal} onChange={(v) => { setSelectedSpcForCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Order Day" options={preOrderDayOptions} selected={orderDayCal} onChange={(v) => { setOrderDayCal(v); setDataReady(false); }} searchable={false} />
                      <MultiSelect compact label="Vendor" options={preVendorOptions} selected={vendorFilterCal} onChange={(v) => { setVendorFilterCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Item Type" options={preFilterOptions.itemTypes} selected={itemTypeCal} onChange={setItemTypeCal} />
                      <MultiSelect compact label="Division Group" options={preDivisionGroupOptions} selected={divisionGroupCal} onChange={(v) => { setDivisionGroupCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Division"       options={preDivisionOptions}      selected={divisionCal}      onChange={(v) => { setDivisionCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Department"     options={preDepartmentOptions}    selected={departmentCal}    onChange={(v) => { setDepartmentCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Sub-Department" options={preSubDepartmentOptions} selected={subDepartmentCal} onChange={(v) => { setSubDepartmentCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Class"          options={preClassOptions}         selected={classCal}         onChange={(v) => { setClassCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Sub-Class"      options={preSubClassOptions}      selected={subClassCal}      onChange={(v) => { setSubClassCal(v); setDataReady(false); }} />
                      <MultiSelect compact label="Type Store" options={TYPE_STORE_OPTIONS} selected={typeStoreCal} onChange={setTypeStoreCal} searchable={false} />
                      <MultiSelect compact label="Store" options={preFilterOptions.stores} selected={storeCal} onChange={setStoreCal} />
                      <MultiSelect compact label="Buying Status" options={preFilterOptions.buyingStatuses} selected={buyingStatusCal} onChange={setBuyingStatusCal} />
                      <MultiSelect compact label="PO Group" options={preFilterOptions.poGroups} selected={poGroupCal} onChange={setPoGroupCal} />
                    </SrrFiltersPopover>

                    {(selectedSpcForCal.length > 0 || orderDayCal.length > 0 || vendorFilterCal.length > 0 ||
                      itemTypeCal.length > 0 || typeStoreCal.length > 0 || storeCal.length > 0 ||
                      buyingStatusCal.length > 0 || poGroupCal.length > 0 ||
                      divisionGroupCal.length > 0 || divisionCal.length > 0 || departmentCal.length > 0 ||
                      subDepartmentCal.length > 0 || classCal.length > 0 || subClassCal.length > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-1.5"
                        onClick={() => {
                          setSelectedSpcForCal([]); setOrderDayCal([]); setVendorFilterCal([]);
                          setItemTypeCal([]); setTypeStoreCal([]); setStoreCal([]);
                          setBuyingStatusCal([]); setPoGroupCal([]);
                          setDivisionGroupCal([]); setDivisionCal([]); setDepartmentCal([]);
                          setSubDepartmentCal([]); setClassCal([]); setSubClassCal([]);
                          setDataReady(false);
                        }}
                      >
                        <X className="w-3 h-3 mr-0.5" /> Clear
                      </Button>
                    )}
                  </>
                )}

                {importMode !== "filter" && (
                  <>
                    <MultiSelect compact label="Type Store" options={TYPE_STORE_OPTIONS} selected={typeStoreCal} onChange={setTypeStoreCal} searchable={false} />
                    <MultiSelect
                      compact
                      label="Store"
                      options={[...new Set(storeTypes.map((s: any) => s.store_name || s.ship_to).filter(Boolean))].sort().map((s: string) => ({ value: s, display: s }))}
                      selected={storeCal}
                      onChange={setStoreCal}
                    />
                    {(typeStoreCal.length > 0 || storeCal.length > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-1.5"
                        onClick={() => { setTypeStoreCal([]); setStoreCal([]); }}
                      >
                        <X className="w-3 h-3 mr-0.5" /> Clear
                      </Button>
                    )}
                  </>
                )}

              </div>

              {/* GO zone — green: prepare + run */}
              <div className="flex items-center gap-1 shrink-0 px-1 py-0.5 rounded-md bg-emerald-100/70 border border-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-700">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadFilterOptions}
                  disabled={
                    loading ||
                    (importMode === "filter"
                      ? effectiveSpcsForCal.length === 0
                      : importMode === "vendor"
                        ? importedVendors.length === 0
                        : importedItems.length === 0)
                  }
                  className="h-6 gap-1 text-[11px] px-1.5 border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 bg-card"
                >
                  <RefreshCw className="w-3 h-3" /> เตรียม{" "}
                  {importMode === "import" && importedItems.length > 0
                    ? `(${importedItems.length})`
                    : importMode === "vendor" && importedVendors.length > 0
                      ? `(${importedVendors.length})`
                      : importMode === "filter" && effectiveSpcsForCal.length > 0
                        ? `(${effectiveSpcsForCal.length})`
                        : ""}
                </Button>
                <Button
                  onClick={handleCalClick}
                  disabled={loading || !dataReady}
                  size="sm"
                  className="h-6 gap-1 text-[11px] px-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Cal
                </Button>
              </div>
            </>
          )}

          {/* DOC zone — pushed right */}
          <div className="ml-auto flex items-center gap-1.5 shrink-0 pl-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFinalDocsDialogOpen(true)}
              className="h-6 text-[11px] px-2 gap-1 border-amber-400 text-amber-700 hover:bg-amber-50"
              title="Doc Final — เอกสารที่ผ่านการ Review แล้ว (บันทึกเมื่อกด Save)"
            >
              <CheckCircle2 className="w-3 h-3" />
              Doc Final {finalDocs.length > 0 ? `(${finalDocs.length})` : ""}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => setDocsDialogOpen(true)}
              className="h-6 text-[11px] px-2 gap-1"
              title="เปิด List Documents"
            >
              <FolderOpen className="w-3 h-3" />
              Doc ({vendorDocs.length})
            </Button>
          </div>
        </div>

        {/* ============ Sub-row: status / skip ============ */}
        {activeTab === "read-cal" && (
          <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center gap-1.5 flex-wrap min-h-[36px]">
            {!dataReady && !loading && !dataLoadingMsg && (
              <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-muted/50 border border-border text-muted-foreground text-xs font-medium">
                <Database className="w-3 h-3" /> เลือก Filter แล้วกดเตรียมข้อมูล
              </div>
            )}
            {!dataReady && !loading && dataLoadingMsg && (
              <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-medium">
                <Loader2 className="w-3 h-3 animate-spin" /> {dataLoadingMsg}
              </div>
            )}
            {dataReady && !loading && (
              <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                <Check className="w-3 h-3" /> พร้อม ({selectedSpcForCal.length} SPC)
              </div>
            )}
            {(importedSkippedItems.length > 0 || lastImportRanAt > 0) && importMode !== "filter" && (
              <ImportSkipBar
                count={importedSkippedItems.length}
                context={importMode === "vendor" ? "Vendor Import" : "Barcode/SKU Import"}
                items={importedSkippedItems}
                title={importMode === "vendor" ? "srr_direct_vendor" : "srr_direct_sku"}
                forceShow={lastImportRanAt > 0}
                onClear={() => { setImportedSkippedItems([]); setLastImportRanAt(0); }}
              />
            )}
          </div>
        )}

        {/* TAB 1: READ & CAL */}
        <TabsContent value="read-cal" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">

          <div className="flex-1 overflow-auto p-4">
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              {loadingSnapshots && vendorDocs.length === 0 ? (
                <>
                  <div className="w-12 h-12 mb-4 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                  <p className="text-base font-medium text-foreground">{snapshotLoadLabel || "กำลังโหลด Docs..."}</p>
                  {snapshotLoadedRows > 0 && (
                    <p className="text-sm mt-1 font-mono text-primary font-semibold">
                      โหลดแล้ว {snapshotLoadedRows.toLocaleString()} rows
                    </p>
                  )}
                  <p className="text-xs mt-2 text-muted-foreground/70">กรุณารอสักครู่...</p>
                </>
              ) : totalDocsCount === 0 && !loading ? (
                <>
                  <Database className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-base font-medium">1. กด "เตรียมข้อมูล" → 2. เลือก SPC Name → 3. กด "Read & Cal"</p>
                  <p className="text-xs mt-2 text-muted-foreground/70">เมื่อคำนวณเสร็จ กดปุ่ม <strong>Doc</strong> ที่มุมขวาบน เพื่อเปิดดู Documents</p>
                </>
              ) : (
                <>
                  <Database className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-base font-medium">✅ มี {totalDocsCount} เอกสาร · {totalItems.toLocaleString()} รายการ</p>
                  <p className="text-xs mt-2 text-muted-foreground/70">กดปุ่ม <strong>เอกสารคำนวน ({vendorDocs.length})</strong> ที่มุมขวาบน เพื่อเปิดดู</p>
                  <Button size="sm" variant="default" className="mt-3 gap-1.5" onClick={() => setDocsDialogOpen(true)}>
                    <FolderOpen className="w-3.5 h-3.5" /> เปิดเอกสารคำนวน
                  </Button>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: FILTER & SHOW & EDIT */}
        <TabsContent value="show-edit" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setActiveTab("read-cal")} title="กลับไปหน้า Read & Cal">
              <ChevronLeft className="w-3.5 h-3.5" /> กลับ
            </Button>
            {/* Mode toggle (independent from Tab 1) — Filter / Vendor / Barcode */}
            <div className="flex items-center gap-0.5 border border-border rounded-md p-0.5 bg-muted/30">
              <Button
                size="sm"
                variant={tab2Mode === "filter" ? "default" : "ghost"}
                onClick={() => {
                  if (tab2Mode === "filter") return;
                  setTab2Mode("filter");
                  setSelectedDocSpc([]);
                  setOrderDayFilter([]);
                  setVendorFilter([]);
                  setItemTypeFilter([]);
                  setStoreFilter([]);
                  setTypeStoreFilter([]);
                  setBuyingStatusFilter([]);
                  setPoGroupFilter([]);
                  setShowData([]);
                  setTableSearchChips([]);
                  setPage(0);
                }}
                className="h-6 text-[11px] px-2"
              >
                Filter
              </Button>
              <Button
                size="sm"
                variant={tab2Mode === "vendor" ? "default" : "ghost"}
                onClick={() => {
                  if (tab2Mode === "vendor") return;
                  setTab2Mode("vendor");
                  setSelectedDocSpc([]);
                  setOrderDayFilter([]);
                  setVendorFilter([]);
                  setItemTypeFilter([]);
                  setStoreFilter([]);
                  setTypeStoreFilter([]);
                  setBuyingStatusFilter([]);
                  setPoGroupFilter([]);
                  setShowData([]);
                  setTableSearchChips([]);
                  setPage(0);
                }}
                className="h-6 text-[11px] px-2"
              >
                Import Vendor
              </Button>
              <Button
                size="sm"
                variant={tab2Mode === "import" ? "default" : "ghost"}
                onClick={() => {
                  if (tab2Mode === "import") return;
                  setTab2Mode("import");
                  setSelectedDocSpc([]);
                  setOrderDayFilter([]);
                  setVendorFilter([]);
                  setItemTypeFilter([]);
                  setStoreFilter([]);
                  setTypeStoreFilter([]);
                  setBuyingStatusFilter([]);
                  setPoGroupFilter([]);
                  setShowData([]);
                  setTableSearchChips([]);
                  setPage(0);
                }}
                className="h-6 text-[11px] px-2"
              >
                Import Barcode
              </Button>
            </div>
            <span className="text-[10px] text-muted-foreground">{docsForTab2.length} docs</span>
            <MultiSelect
              compact
              label="SPC Name"
              options={availableDocSpcs.length > 0 ? availableDocSpcs : spcOptions}
              selected={selectedDocSpc}
              onChange={setSelectedDocSpc}
            />
            <MultiSelect
              compact
              label="Order Day"
              options={docDerivedOptions.orderDays}
              selected={orderDayFilter}
              onChange={setOrderDayFilter}
              searchable={false}
            />
            <MultiSelect
              compact
              label="Vendor"
              options={vendorOptions}
              selected={vendorFilter}
              onChange={setVendorFilter}
            />
            <MultiSelect
              compact
              label="Item Type"
              options={docDerivedOptions.itemTypes}
              selected={itemTypeFilter}
              onChange={setItemTypeFilter}
              searchable={false}
            />
            <MultiSelect
              compact
              label="Type Store"
              options={docDerivedOptions.typeStores}
              selected={typeStoreFilter}
              onChange={setTypeStoreFilter}
              searchable={false}
            />
            <MultiSelect
              compact
              label="Store"
              options={docDerivedOptions.stores}
              selected={storeFilter}
              onChange={setStoreFilter}
            />
            <MultiSelect
              compact
              label="Buying Status"
              options={docDerivedOptions.buyingStatuses}
              selected={buyingStatusFilter}
              onChange={setBuyingStatusFilter}
              searchable={false}
            />
            <MultiSelect
              compact
              label="PO Group"
              options={docDerivedOptions.poGroups}
              selected={poGroupFilter}
              onChange={setPoGroupFilter}
              searchable={false}
            />
            {(selectedDocSpc.length > 0 ||
              orderDayFilter.length > 0 ||
              vendorFilter.length > 0 ||
              itemTypeFilter.length > 0 ||
              storeFilter.length > 0 ||
              typeStoreFilter.length > 0 ||
              buyingStatusFilter.length > 0 ||
              poGroupFilter.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => {
                  setSelectedDocSpc([]);
                  setOrderDayFilter([]);
                  setVendorFilter([]);
                  setItemTypeFilter([]);
                  setStoreFilter([]);
                  setTypeStoreFilter([]);
                  setBuyingStatusFilter([]);
                  setPoGroupFilter([]);
                }}
              >
                <X className="w-3 h-3 mr-1" /> Clear filter
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <Button
                size="sm"
                onClick={showFilteredData}
                disabled={vendorDocs.length === 0}
                className="text-xs gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" /> Show
              </Button>
              {showData.length > 0 && (
                <>
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border">
                    <span className="text-[10px] text-muted-foreground">Min=</span>
                    <Input
                      value={assignMinValue}
                      onChange={(e) => setAssignMinValue(e.target.value)}
                      className="h-6 w-12 text-xs px-1 py-0"
                      type="number"
                    />
                    <Button size="sm" variant="secondary" onClick={assignMinBulk} className="text-xs h-6 px-2">
                      Assign Min
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border">
                    <span className="text-[10px] text-muted-foreground">OC=</span>
                    <Input
                      value={assignOcValue}
                      onChange={(e) => setAssignOcValue(e.target.value)}
                      className="h-6 w-14 text-xs px-1 py-0"
                      type="number"
                      placeholder="วัน"
                    />
                    <Button size="sm" variant="secondary" onClick={assignOrderCycleBulk} className="text-xs h-6 px-2">
                      Assign OC
                    </Button>
                  </div>

                  <input
                    type="file"
                    ref={importFileRef}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleImportExcel}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => importFileRef.current?.click()}
                    className="text-xs gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import
                  </Button>
                  {/* Bulk Clear/Restore dropdowns (เหมือน SRR DC) */}
                  {[
                    { label: "ON ORDER", clear: clearAllOnOrderStore, restore: restoreAllOnOrderStore },
                    { label: "STORE STOCK", clear: clearAllStockStore, restore: restoreAllStockStore },
                  ].map(({ label, clear, restore }) => (
                    <DropdownMenu key={label}>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="text-xs gap-1 h-7 px-2">
                          {label} <ChevronDown className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[160px]">
                        <DropdownMenuItem className="text-destructive gap-2 text-xs" onClick={clear}>
                          <XCircle className="w-3.5 h-3.5" /> Clear All
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-primary gap-2 text-xs" onClick={restore}>
                          <RefreshCw className="w-3.5 h-3.5" /> Restore All
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ))}
                  {showImportSkipped.length > 0 && (
                    <ImportSkipBar
                      count={showImportSkipped.length}
                      context="Import Show"
                      items={showImportSkipped}
                      title="srr_direct_show_import"
                      onClear={() => setShowImportSkipped([])}
                    />
                  )}

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="text-xs">
                        <Columns className="w-3.5 h-3.5 mr-1" /> Columns ({displayColumns.length}/{D2S_COLUMNS.length})
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-2" align="end">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-semibold">Show/Hide Columns</span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setVisibleColumns(new Set(ALL_D2S_KEYS))}
                          >
                            All
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setVisibleColumns(new Set())}
                          >
                            None
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-0.5 mb-3">
                        {D2S_COLUMNS.map((col) => (
                          <label
                            key={col.key}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs"
                          >
                            <Checkbox
                              checked={visibleColumns.has(col.key)}
                              onCheckedChange={() =>
                                setVisibleColumns((prev) => {
                                  const n = new Set(prev);
                                  n.has(col.key) ? n.delete(col.key) : n.add(col.key);
                                  return n;
                                })
                              }
                              className="h-3.5 w-3.5"
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                      <div className="border-t pt-2 space-y-2">
                        <span className="text-xs font-semibold px-1">Saved Views (ส่วนตัว)</span>
                        {savedViews.map((v) => (
                          <div key={v.name} className="flex items-center gap-1 px-1">
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 justify-start" onClick={() => loadView(v)}>
                              <Eye className="w-3 h-3 mr-1" />{v.name}
                            </Button>
                            <button onClick={() => deleteView(v.name)} className="text-destructive hover:text-destructive/80"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                        <span className="text-xs font-semibold px-1 block pt-1">Public Views (ทุกคน)</span>
                        {publicViews.map((v) => (
                          <div key={v.id} className="flex items-center gap-1 px-1">
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 justify-start" onClick={() => loadView(v)}>
                              <Eye className="w-3 h-3 mr-1" />{v.name}
                            </Button>
                            <button onClick={() => deletePublicViewById(v.id, v.name)} className="text-destructive hover:text-destructive/80"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                        <div className="flex items-center gap-1 px-1">
                          <Input
                            placeholder="View name..."
                            value={newViewName}
                            onChange={(e) => setNewViewName(e.target.value)}
                            className="h-6 text-[10px] flex-1"
                            onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                          />
                        </div>
                        <div className="flex items-center gap-1 px-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 flex-1" onClick={saveCurrentView} disabled={!newViewName.trim()}>
                            <Save className="w-3 h-3 mr-1" /> Save Private
                          </Button>
                          <Button size="sm" variant="default" className="h-6 text-[10px] px-2 flex-1" onClick={saveCurrentViewPublic} disabled={!newViewName.trim()}>
                            <Save className="w-3 h-3 mr-1" /> Save Public
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="text-xs">
                        <Download className="w-3.5 h-3.5 mr-1" /> Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => exportTableData(false)}>
                        <Download className="w-3.5 h-3.5 mr-2" /> Export ทั้งหมด
                      </DropdownMenuItem>
                      {selectedRows.size > 0 && (
                        <DropdownMenuItem onClick={() => exportTableData(true)}>
                          <CheckSquare className="w-3.5 h-3.5 mr-2" /> Export ที่เลือก ({selectedRows.size})
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} className="text-xs">
                    <Save className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowData([]);
                      setSelectedRows(new Set());
                      setActiveCell(null);
                      setPage(0);
                    }}
                    className="text-xs"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Odoo-style chip search + Final > 0 toggle (Tab 2) */}
          {showData.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 border-b border-border">
              <TableChipSearch
                columns={TABLE_SEARCH_COLS}
                chips={tableSearchChips}
                onChipsChange={(chips) => {
                  setTableSearchChips(chips);
                  setPage(0);
                }}
                placeholder="ค้นหาในตาราง"
              />
              <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-2 select-none">
                <Checkbox
                  checked={showOnlyFinalGt0}
                  onCheckedChange={(c) => {
                    setShowOnlyFinalGt0(!!c);
                    setPage(0);
                  }}
                  className="h-3.5 w-3.5"
                />
                <span>Show FinalOrder &gt; 0</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-2 select-none">
                <Checkbox
                  checked={showOnlyMinGt0}
                  onCheckedChange={(c) => {
                    setShowOnlyMinGt0(!!c);
                    setPage(0);
                  }}
                  className="h-3.5 w-3.5"
                />
                <span>Show Min &gt; 0</span>
              </label>
            </div>
          )}

          <div ref={tableContainerRef} className="flex-1 overflow-auto">
            {showData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
                <Filter className="w-10 h-10 mb-2 opacity-30" />
                {vendorDocs.length === 0 ? (
                  <>
                    <p className="text-sm">กรุณากด "Read & Cal" ใน Tab 1 ก่อน</p>
                    <p className="text-xs mt-1">คำนวณ Per-Store แล้วกลับมากด "Show"</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">
                      เลือก SPC Name แล้วกด <strong>"Show"</strong>
                    </p>
                    <p className="text-xs mt-1">มี {vendorDocs.length} vendor documents พร้อมใช้งาน</p>
                  </>
                )}
              </div>
            ) : (
              renderTable(pagedData, true)
            )}
          </div>

          {showData.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">แสดง</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs px-2 min-w-[40px]">
                        {pageSize}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {[30, 50, 100, 200].map((size) => (
                        <DropdownMenuItem
                          key={size}
                          onClick={() => {
                            setPageSize(size);
                            setPage(0);
                          }}
                          className={cn("text-xs", pageSize === size && "font-bold")}
                        >
                          {size} แถว
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-xs text-muted-foreground">
                    / {filteredShowData.length.toLocaleString()} แถว
                    {tableSearchChips.length > 0 && filteredShowData.length !== showData.length && (
                      <span className="text-muted-foreground/60"> (จาก {showData.length.toLocaleString()})</span>
                    )}
                  </span>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* TAB 3 (List Import PO) — disabled, replaced by Doc dialog */}


        <TabsContent value="report2" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">
          <SRRReport2Tab mode="direct" />
        </TabsContent>
      </Tabs>

      {/* Documents popup — opened via "Doc" button */}
      {/* ===== Doc Final Dialog (D2S) ===== */}
      <FinalDocsPopupDialog
        open={finalDocsDialogOpen}
        onOpenChange={setFinalDocsDialogOpen}
        variant="direct"
        loading={finalDocsLoading}
        canDelete={canDeleteDoc}
        docs={finalDocs.map<FinalDocRow>((d: any) => ({
          id: d.id,
          saved_at: d.saved_at,
          date_key: d.date_key,
          spc_name: d.spc_name,
          vendor_code: d.vendor_code,
          vendor_display: d.vendor_display,
          item_count: d.item_count,
          suggest_count: d.suggest_count,
          edited_columns: d.edited_columns || [],
          source: (d.source || "filter") as "filter" | "vendor" | "import",
          saved_by: d.saved_by,
        }))}
        onOpenDoc={openFinalDoc}
        onOpenDocs={openFinalDocs}
        onDeleteDocs={deleteFinalDocs}
        onRefresh={loadFinalDocs}
      />

      <DocsPopupDialog
        open={docsDialogOpen}
        onOpenChange={setDocsDialogOpen}
        variant="direct"
        initialMode={importMode as "filter" | "vendor" | "import"}
        latestBatchValue={selectedBatchValuesByMode[importMode]?.[0] || ""}
        latestDocIds={latestImportedDocIds}
        canDelete={canDeleteDoc}
        cost0StorageKey={COST0_KEY_D2S}
        cost0RefreshKey={cost0RefreshKey}
        docs={vendorDocs.map<DocRow>((d) => {
          const vi = vendorMasterAll.find((v) => v.vendor_code === d.vendor_code);
          const order_value = (d.data || []).reduce(
            (s: number, r: any) => s + (Number(r.final_order_qty) || 0) * (Number(r.po_cost_unit) || 0),
            0,
          );
          return {
            id: d.id,
            doc_no: formatDocNo(d.created_at),
            spc_name: d.spc_name,
            vendor_code: d.vendor_code,
            vendor_display: d.vendor_display,
            supplier_currency: vi?.supplier_currency || "",
            type_store: d.type_store,
            store_name: d.store_name,
            item_count: d.item_count,
            suggest_count: d.suggest_count,
            order_value,
            user_id: d.user_id,
            source: (d.source || "filter") as "filter" | "vendor" | "import",
            raw: d,
          };
        })}
        onDeleteDoc={(d) => deleteVendorDoc(d.id)}
        onDeleteDocs={(ids) => deleteDocsByIds(ids)}
        onOpenDoc={async (d) => {
          const doc = vendorDocs.find((x) => x.id === d.id);
          if (!doc) return;
          const src = (doc.source || "filter") as "filter" | "vendor" | "import";
          setTab2Mode(src);
          setSelectedDocSpc([doc.spc_name]);
          setVendorFilter([doc.vendor_code]);
          setStoreFilter([doc.store_name]);
          setOrderDayFilter([]); setItemTypeFilter(["Basic"]); setTypeStoreFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]); setShowOnlyMinGt0(true);
          let rowData = doc.data;
          if (rowData.length === 0 && doc.item_count > 0) {
            const dataMap = await fetchSnapshotDataByIds([doc.id], "srr_d2s_snapshots");
            rowData = dataMap.get(doc.id) || [];
            setVendorDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, data: rowData } : x));
          }
          setShowData(rowData);
          setPage(0);
          setSelectedRows(new Set());
          setActiveCell(null);
          setActiveTab("show-edit");
          setDocsDialogOpen(false);
        }}
        onOpenDocs={async (ds) => {
          const docs = ds.map((d) => vendorDocs.find((x) => x.id === d.id)).filter(Boolean) as typeof vendorDocs;
          if (docs.length === 0) return;
          const src = (docs[0].source || "filter") as "filter" | "vendor" | "import";
          setTab2Mode(src);
          setSelectedDocSpc([...new Set(docs.map((x) => x.spc_name))]);
          setVendorFilter([...new Set(docs.map((x) => x.vendor_code))]);
          setStoreFilter([...new Set(docs.map((x) => x.store_name).filter(Boolean))]);
          setOrderDayFilter([]); setItemTypeFilter(["Basic"]); setTypeStoreFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]); setShowOnlyMinGt0(true);
          const unloadedDocs = docs.filter((x) => x.data.length === 0 && x.item_count > 0);
          let loadedMap = new Map<string, any[]>();
          if (unloadedDocs.length > 0) {
            loadedMap = await fetchSnapshotDataByIds(unloadedDocs.map((x) => x.id), "srr_d2s_snapshots");
            setVendorDocs((prev) => prev.map((x) => loadedMap.has(x.id) ? { ...x, data: loadedMap.get(x.id) as any[] } : x));
          }
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const doc of docs) {
            const rows = loadedMap.has(doc.id) ? loadedMap.get(doc.id) as any[] : doc.data;
            for (const r of rows) { if (seen.has(r.id)) continue; seen.add(r.id); merged.push(r); }
          }
          setShowData(merged);
          setPage(0);
          setSelectedRows(new Set());
          setActiveCell(null);
          setActiveTab("show-edit");
          setDocsDialogOpen(false);
        }}
      />

      {/* Preview */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">
              {previewDoc?.spc_name} · {previewDoc?.date_key} · {previewDoc?.vendor_display}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {previewDoc?.item_count} items · {previewDoc?.suggest_count} suggest &gt; 0
            </p>
          </DialogHeader>
          {previewDoc && <div className="flex-1 overflow-auto">{renderTable(previewDoc.data, false)}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save PO Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save PO (Direct to Store)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">จำนวนรายการต่อ 1 PO (ตัดพีโอ)</label>
              <Input
                type="number"
                min={0}
                value={exportMaxPerPO}
                onChange={(e) => setExportMaxPerPO(e.target.value)}
                className="h-8 text-xs"
                placeholder="ว่าง = ไม่ตัด (รวมทุกแถวเป็น PO เดียวต่อกลุ่ม)"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                หากกำหนดตัวเลข N: ทุก N แถวจะถูกตัดเป็น PO ใหม่ (แถวแรกของแต่ละชุดจะเป็น header)
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Picking Type จะถูก Mapping อัตโนมัติจาก Store Name → Store Type (ship_to)
            </p>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Description</label>
              <Input
                value={exportDescription}
                onChange={(e) => setExportDescription(e.target.value)}
                className="h-8 text-xs"
                placeholder="หมายเหตุ (ถ้ามี)"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {showData.filter((r) => r.final_order_qty > 0).length} รายการที่มี Suggest &gt; 0 จาก{" "}
              {new Set(showData.filter((r) => r.final_order_qty > 0).map((r) => r.vendor_code)).size} Vendor
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={doExportD2S}>
              <Download className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportSkipDialog
        open={importSkipDialogOpen}
        onOpenChange={setImportSkipDialogOpen}
        items={importedSkippedItems}
        title={importMode === "vendor" ? "srr_direct_vendor" : "srr_direct_sku"}
        closeLabel="ปิด แล้วไป Read & Cal"
      />

      {/* Confirm before Cal — choose all stores or pick stores first */}
      <Dialog open={calConfirmOpen} onOpenChange={setCalConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันการ Cal</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground py-2">
            {storeCal.length > 0
              ? <>คุณได้เลือก <b>{storeCal.length}</b> สาขาไว้แล้ว ต้องการ Cal เฉพาะสาขาที่เลือก หรือ Cal ทั้งหมด?</>
              : <>ต้องการ Cal ทุกสาขา หรือเลือกสาขาก่อน?</>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setCalConfirmOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCalConfirmOpen(false);
                toast({ title: "กรุณาเลือกสาขาที่ช่อง Store ด้านบน แล้วกด Cal อีกครั้ง" });
              }}
            >
              เลือกสาขาก่อน
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                setCalConfirmOpen(false);
                readAndCalc();
              }}
            >
              {storeCal.length > 0 ? `Cal (${storeCal.length} สาขา)` : "Cal ทั้งหมด"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
