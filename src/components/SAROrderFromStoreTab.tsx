import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSpreadsheet, Upload, Download, Loader2, AlertCircle, ClipboardPaste,
  RefreshCw, Calculator, Save, Search, Trash2, ChevronLeft, CheckCircle2,
  ChevronDown, ChevronRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import { SARRow, computeRow } from "@/lib/sarCalc";

// --------------- Types ---------------
type OfsSubTab = "import_docs" | "cal_table" | "result_docs";

interface ImportRow { code: string; qty: number; }

interface SkipRow {
  barcode: string; product_name_la: string;
  qty: number; reason: string; store_name: string;
  sku_code?: string; rank_sales?: string;
}

interface OfsImportLine {
  sku_code: string; main_barcode: string | null;
  product_name_la: string | null; qty: number;
}

interface OfsImportDoc {
  id: string; doc_name: string; store_name: string;
  import_count: number; pass_count: number; skip_count: number;
  data: OfsImportLine[]; skip_data: SkipRow[] | null; user_id: string | null; created_at: string;
}

interface OfsResultDoc {
  id: string; doc_name: string; doc_type: "RO" | "PO";
  store_name: string; source_doc_ids: string[];
  item_count: number; user_id: string | null; created_at: string;
}

interface ProcessedRow extends SARRow {
  qty_import: number; division_group: string;
  _doc_type?: string;
  stock_store_orig?: number;
  vendor_code?: string;
  vendor_name?: string;
  currency?: string;
  unit_barcode?: string;
  unit_uom?: string;
  ship_to?: string;
  po_cost_unit?: number | null;
}

// --------------- Columns ---------------
const COLS: { key: string; label: string; w: number; right?: boolean }[] = [
  { key: "store_name", label: "Store Name", w: 130 },
  { key: "type_store", label: "Type Store", w: 90 },
  { key: "division", label: "Division", w: 100 },
  { key: "department", label: "Department", w: 110 },
  { key: "sub_department", label: "Sub-Department", w: 130 },
  { key: "vendor_info", label: "Vendor", w: 230 },
  { key: "sku_code", label: "SKU Code", w: 100 },
  { key: "main_barcode", label: "Barcode", w: 120 },
  { key: "product_name_la", label: "Product Name (LA)", w: 200 },
  { key: "product_name_en", label: "Product Name (EN)", w: 200 },
  { key: "unit_of_measure", label: "UoM", w: 70 },
  { key: "item_type", label: "Item Type", w: 90 },
  { key: "buying_status", label: "Buying Status", w: 100 },
  { key: "unit_pick", label: "Unit Pick", w: 70, right: true },
  { key: "pack_qty", label: "Pack", w: 60, right: true },
  { key: "box_qty", label: "Box", w: 60, right: true },
  { key: "cost", label: "Cost", w: 80, right: true },
  { key: "price2km", label: "Price2km", w: 90, right: true },
  { key: "price_jm", label: "PriceJm", w: 90, right: true },
  { key: "avg_sale", label: "Avg Sale", w: 80, right: true },
  { key: "rank_sale", label: "Rank", w: 60 },
  { key: "rank_factor", label: "Rank Factor", w: 80, right: true },
  { key: "min_val", label: "Min", w: 70, right: true },
  { key: "max_val", label: "Max", w: 70, right: true },
  { key: "stock_dc", label: "Stock DC", w: 80, right: true },
  { key: "stock_store", label: "Store Stock", w: 130, right: true },
  { key: "sar_suggest1", label: "SAR Suggest1", w: 100, right: true },
  { key: "sar_suggest2", label: "SAR Suggest2", w: 100, right: true },
  { key: "on_order", label: "On Order", w: 80, right: true },
  { key: "tt_order", label: "TT Order", w: 80, right: true },
  { key: "pack_size", label: "Packsize", w: 80 },
  { key: "qty_import", label: "Qty Import", w: 90, right: true },
  { key: "suggest_order_edit", label: "Suggest Edit", w: 100, right: true },
  { key: "final_order_unit", label: "Final Order/Unit", w: 120, right: true },
  { key: "final_order_uom", label: "Final Order/UOM", w: 120, right: true },
  { key: "doh_min", label: "DOH MIN", w: 80, right: true },
  { key: "doh_max", label: "DOH MAX", w: 80, right: true },
  { key: "doh_stock", label: "DOH Stock", w: 80, right: true },
  { key: "doh_tobe", label: "DOH Tobe", w: 80, right: true },
];

const HIGHLIGHT_COLS = new Set(["sar_suggest1", "sar_suggest2", "tt_order", "final_order_unit", "final_order_uom", "qty_import"]);
const NUM_COLS = new Set(["unit_pick", "pack_qty", "box_qty", "cost", "price2km", "price_jm", "avg_sale", "rank_factor", "min_val", "max_val", "stock_dc", "stock_store", "sar_suggest1", "sar_suggest2", "on_order", "tt_order", "qty_import", "suggest_order_edit", "final_order_unit", "final_order_uom", "doh_min", "doh_max", "doh_stock", "doh_tobe"]);

// --------------- Helpers ---------------
// paginate ภายในแต่ละ chunk เพื่อกัน PostgREST 1000-row cap
// (500 SKU × หลาย packing > 1000 → เดิมถูกตัดทิ้ง ทำให้ vendor/metadata หาย)
async function queryInChunks<T>(table: string, field: string, values: string[], sel: string, extra?: (q: any) => any): Promise<T[]> {
  if (!values.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += 500) chunks.push(values.slice(i, i + 500));
  const batches = await Promise.all(chunks.map(async chunk => {
    const out: T[] = [];
    let off = 0;
    while (true) {
      let q = (supabase.from(table as any) as any).select(sel).in(field, chunk).range(off, off + 999);
      if (extra) q = extra(q);
      const { data } = await q;
      const rows = (data || []) as T[];
      out.push(...rows);
      if (rows.length < 1000) break;
      off += 1000;
    }
    return out;
  }));
  return batches.flat();
}

// ดึง get_sar_data_full แบบ paginate: หน้าแรกรู้ total → ยิงหน้าที่เหลือขนานทีละ 4
const SAR_FULL_PAGE = 5000;
async function fetchSarDataFullPaged(params: Record<string, any>): Promise<any[]> {
  const first = await (supabase as any).rpc("get_sar_data_full", { ...params, p_limit: SAR_FULL_PAGE, p_offset: 0 });
  if (first.error) throw first.error;
  const total = Number(first.data?.total) || 0;
  const all: any[] = Array.isArray(first.data?.rows) ? first.data.rows : [];
  if (total <= SAR_FULL_PAGE) return all;
  const offsets: number[] = [];
  for (let o = SAR_FULL_PAGE; o < total; o += SAR_FULL_PAGE) offsets.push(o);
  const CONCURRENCY = 4;
  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(off =>
      (supabase as any).rpc("get_sar_data_full", { ...params, p_limit: SAR_FULL_PAGE, p_offset: off })
    ));
    for (const r of res) {
      if (r.error) throw r.error;
      if (Array.isArray(r.data?.rows)) all.push(...r.data.rows);
    }
  }
  return all;
}

function fmtNum(v: any): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v !== "number") return String(v);
  if (v === 0) return "-";
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtFile(ts: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ts.getFullYear()}${p(ts.getMonth() + 1)}${p(ts.getDate())}${p(ts.getHours())}${p(ts.getMinutes())}`;
}

// --------------- Module-level cache (survives tab navigation) ---------------
const ofsCalCache: {
  hqRows: ProcessedRow[];
  hqFetched: boolean;
  hqCalculated: boolean;
  selectedDocIds: string[];
} = { hqRows: [], hqFetched: false, hqCalculated: false, selectedDocIds: [] };

const CAL_PAGE_SIZE = 100;

// module-level cache ป้องกัน re-fetch เมื่อ component unmount/remount
let _importDocsCache: OfsImportDoc[] = [];
let _userProfileMapCache: Record<string, string> = {};
let _resultDocsCache: OfsResultDoc[] = [];

// --------------- Component ---------------
export default function SAROrderFromStoreTab() {
  const { user, isAdmin, canDo } = useAuth();
  const { toast } = useToast();

  const canImport = isAdmin || canDo("ofs_import", "view");
  const canHQ = isAdmin || canDo("ofs_hq", "view");
  const canResult = isAdmin || canDo("ofs_result", "view");
  const hasAny = canImport || canHQ || canResult;


  const [subTab, setSubTab] = useState<OfsSubTab>("import_docs");
  const initialSet = useRef(false);
  useEffect(() => {
    if (initialSet.current || !hasAny) return;
    initialSet.current = true;
    if (!canImport && !canHQ) setSubTab("result_docs");
  }, [canImport, canHQ, canResult, hasAny]);

  // ---- Shared ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // ---- IMPORT TAB ----
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [storeSelectOpen, setStoreSelectOpen] = useState(false);
  const [storeComboOpen, setStoreComboOpen] = useState(false);
  const [storeList, setStoreList] = useState<string[]>([]);
  const [storeTypeCache, setStoreTypeCache] = useState<Record<string, string>>({});
  const [selectedStore, setSelectedStore] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const [importStatus, setImportStatus] = useState<string>("");
  const [importElapsed, setImportElapsed] = useState(0);
  const importTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importElapsedRef = useRef(0);
  const [lastSave, setLastSave] = useState<{ total: number; pass: number; skip: number } | null>(null);
  const [pendingSkips, setPendingSkips] = useState<SkipRow[]>([]);
  // multi-store
  const [multiStoreOpen, setMultiStoreOpen] = useState(false);
  const [multiStoreGroups, setMultiStoreGroups] = useState<{ store: string; rows: ImportRow[]; known: boolean }[]>([]);
  const [multiStoreSaving, setMultiStoreSaving] = useState(false);
  const [multiStoreProgress, setMultiStoreProgress] = useState({ current: 0, total: 0 });

  // Elapsed timer สำหรับ multi-store import
  const [multiStoreElapsedMs, setMultiStoreElapsedMs] = useState(0);
  const multiStoreStartRef = useRef<number | null>(null);
  const multiStoreTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMultiStoreTimer = () => {
    multiStoreStartRef.current = performance.now();
    setMultiStoreElapsedMs(0);
    if (multiStoreTimerRef.current) clearInterval(multiStoreTimerRef.current);
    multiStoreTimerRef.current = setInterval(() => {
      setMultiStoreElapsedMs(multiStoreStartRef.current ? Math.round(performance.now() - multiStoreStartRef.current) : 0);
    }, 100);
  };
  const stopMultiStoreTimer = () => {
    if (multiStoreTimerRef.current) { clearInterval(multiStoreTimerRef.current); multiStoreTimerRef.current = null; }
  };
  useEffect(() => () => stopMultiStoreTimer(), []);
  // user profile map
  const [userProfileMap, setUserProfileMap] = useState<Record<string, string>>(_userProfileMapCache);

  // ---- HQ TAB ----
  const [importDocs, setImportDocs] = useState<OfsImportDoc[]>(_importDocsCache);
  const [importDocsLoading, setImportDocsLoading] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [openDoc, setOpenDoc] = useState<OfsImportDoc | null>(null);
  const [docTimings, setDocTimings] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ofs_doc_timings") || "{}"); } catch { return {}; }
  });
  // Init from module-level cache → survives tab navigation
  const [hqRows, setHqRowsRaw] = useState<ProcessedRow[]>(ofsCalCache.hqRows);
  const [hqFetched, setHqFetchedRaw] = useState(ofsCalCache.hqFetched);
  const [hqCalculated, setHqCalculatedRaw] = useState(ofsCalCache.hqCalculated);
  const [calPage, setCalPage] = useState(0);
  // Wrappers that update both state and cache
  const setHqRows = (rows: ProcessedRow[]) => { ofsCalCache.hqRows = rows; setHqRowsRaw(rows); };
  const setHqFetched = (v: boolean) => { ofsCalCache.hqFetched = v; setHqFetchedRaw(v); };
  const setHqCalculated = (v: boolean) => { ofsCalCache.hqCalculated = v; setHqCalculatedRaw(v); };
  const [hqLoading, setHqLoading] = useState(false);
  const [hqCalculating, setHqCalculating] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchElapsedRef = useRef(0);
  const [calcElapsed, setCalcElapsed] = useState(0);
  const [useQtyImport, setUseQtyImport] = useState(false);
  const [hqSearch, setHqSearch] = useState("");
  const [importDocsSearch, setImportDocsSearch] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, label: "" });
  const [saveElapsedMs, setSaveElapsedMs] = useState(0);
  const saveStartRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startSaveTimer = () => {
    saveStartRef.current = performance.now();
    setSaveElapsedMs(0);
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    saveTimerRef.current = setInterval(() => {
      setSaveElapsedMs(saveStartRef.current ? Math.round(performance.now() - saveStartRef.current) : 0);
    }, 100);
  };
  const stopSaveTimer = () => {
    if (saveTimerRef.current) { clearInterval(saveTimerRef.current); saveTimerRef.current = null; }
  };
  useEffect(() => () => stopSaveTimer(), []);
  const [hqSaving, setHqSaving] = useState(false);

  // ---- RESULT DOCS TAB ----
  const [resultDocs, setResultDocs] = useState<OfsResultDoc[]>(_resultDocsCache);
  const [resultDocsLoading, setResultDocsLoading] = useState(false);
  const [selectedPoIds, setSelectedPoIds] = useState<Set<string>>(new Set());
  const [selectedRoIds, setSelectedRoIds] = useState<Set<string>>(new Set());
  const [viewItems, setViewItems] = useState<ProcessedRow[] | null>(null);
  const [viewTitle, setViewTitle] = useState("");
  const [viewDocType, setViewDocType] = useState<"RO" | "PO" | "MIXED" | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewPage, setViewPage] = useState(0);
  const [viewExportCount, setViewExportCount] = useState<{ dc: number; d2s: number }>({ dc: 0, d2s: 0 });
  const [summedRows, setSummedRows] = useState<ProcessedRow[] | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [listExportCount, setListExportCount] = useState<{ dc: number; d2s: number }>({ dc: 0, d2s: 0 });
  const [docExportCounts, setDocExportCounts] = useState<Map<string, number>>(new Map());
  const [vendorFilterOpen, setVendorFilterOpen] = useState(false);
  const [vendorList, setVendorList] = useState<{ vendor_code: string; vendor_name: string; spc_name: string }[]>([]);
  const [vendorFilterLoading, setVendorFilterLoading] = useState(false);
  const [vendorFilter, setVendorFilter] = useState<Set<string> | null>(null);
  const [vendorFilterSearch, setVendorFilterSearch] = useState("");
  const [perROChunk, setPerROChunk] = useState(50);
  const [perPOChunk, setPerPOChunk] = useState(50);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const [batchSearches, setBatchSearches] = useState<Record<string, string>>({});

  // ============================================================
  // IMPORT TAB — logic
  // ============================================================

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "Store Name": "121010003-Phonetong", "Barcode/SKUCode": "8857123456789", "Qty": 5 },
      { "Store Name": "121010006-Vangxaiy", "Barcode/SKUCode": "8857987654321", "Qty": 3 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "OFS_Template.xlsx");
  };

  const openStoreSelect = async (rows: ImportRow[]) => {
    setImportRows(rows);
    const { data } = await (supabase.from("store_type" as any) as any).select("store_name, type_store").order("store_name");
    const names: string[] = [...new Set((data || []).map((r: any) => r.store_name).filter(Boolean))];
    const typeMap: Record<string, string> = {};
    for (const r of (data || []) as any[]) { if (r.store_name) typeMap[r.store_name] = r.type_store || ""; }
    setStoreList(names);
    setStoreTypeCache(typeMap);
    setSelectedStore(names[0] ?? "");
    setStoreSelectOpen(true);
  };

  const handleFile = async (file: File) => {
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const rawRows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rawRows.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (rawRows[0] as string[]).map(h => String(h ?? "").toLowerCase().trim());
      const cIdx = headers.findIndex(h => h.includes("barcode") || h.includes("sku") || h.includes("code"));
      const qIdx = headers.findIndex(h => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      const sIdx = headers.findIndex(h => h.includes("store"));
      if (cIdx < 0 || qIdx < 0) { toast({ title: "ไม่พบคอลัมน์ barcode/qty", variant: "destructive" }); return; }

      if (sIdx >= 0) {
        // multi-store mode: group by store name
        const groups: Record<string, ImportRow[]> = {};
        for (const r of rawRows.slice(1)) {
          const storeName = String(r[sIdx] ?? "").trim();
          const code = String(r[cIdx] ?? "").trim();
          const qty = Number(r[qIdx]) || 0;
          if (storeName && code && qty > 0) {
            if (!groups[storeName]) groups[storeName] = [];
            groups[storeName].push({ code, qty });
          }
        }
        if (!Object.keys(groups).length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
        await openMultiStoreConfirm(groups);
      } else {
        // single-store mode
        const rows = rawRows.slice(1).map(r => ({ code: String(r[cIdx] ?? "").trim(), qty: Number(r[qIdx]) || 0 })).filter(r => r.code && r.qty > 0);
        if (!rows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
        await openStoreSelect(rows);
      }
    } catch (e: any) { toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  const openMultiStoreConfirm = async (groups: Record<string, ImportRow[]>) => {
    const { data } = await (supabase.from("store_type" as any) as any).select("store_name").order("store_name");
    const knownStores = new Set((data || []).map((r: any) => r.store_name as string));
    const groupList = Object.entries(groups).map(([store, rows]) => ({ store, rows, known: knownStores.has(store) }));
    setMultiStoreGroups(groupList);
    setMultiStoreOpen(true);
  };

  const runImportForStore = async (
    rows: ImportRow[],
    storeName: string,
    onStatus?: (s: string) => void
  ): Promise<{ docName: string; pass: number; skip: number; total: number; skips: SkipRow[]; docId?: string }> => {
    const codes = rows.map(r => r.code);
    onStatus?.(`ค้นหา Barcode/SKU ${codes.length.toLocaleString()} รายการ...`);
    const resSel = "sku_code,main_barcode,barcode";
    const [resByMainBarcode, resBySku, resByBarcode] = await Promise.all([
      queryInChunks<any>("data_master", "main_barcode", codes, resSel),
      queryInChunks<any>("data_master", "sku_code", codes, resSel),
      queryInChunks<any>("data_master", "barcode", codes, resSel),
    ]);
    const codeToSku = new Map<string, string>();
    resByMainBarcode.forEach((r: any) => { if (r.main_barcode && r.sku_code && !codeToSku.has(r.main_barcode)) codeToSku.set(r.main_barcode, r.sku_code); });
    resBySku.forEach((r: any) => { if (r.sku_code && !codeToSku.has(r.sku_code)) codeToSku.set(r.sku_code, r.sku_code); });
    resByBarcode.forEach((r: any) => { if (r.barcode && r.sku_code && !codeToSku.has(r.barcode)) codeToSku.set(r.barcode, r.sku_code); });

    const resolvedSkus = [...new Set(Array.from(codeToSku.values()))];
    onStatus?.(`ดึงข้อมูลสินค้า ${resolvedSkus.length.toLocaleString()} SKU...`);
    const dmSel = "sku_code,main_barcode,product_name_la,buying_status,item_type,product_owner";
    const [dmRows, rankRows] = await Promise.all([
      queryInChunks<any>("data_master", "sku_code", resolvedSkus, dmSel, q => q.eq("packing_size_qty", 1)),
      queryInChunks<any>("rank_sales", "item_id", resolvedSkus, "item_id,final_rank"),
    ]);
    const skuToDm = new Map<string, any>();
    dmRows.forEach((r: any) => { if (r.sku_code && !skuToDm.has(r.sku_code)) skuToDm.set(r.sku_code, r); });
    const skuToRank = new Map<string, string>();
    rankRows.forEach((r: any) => { if (r.item_id && r.final_rank) skuToRank.set(r.item_id, r.final_rank); });

    const dmMap: Record<string, any> = {};
    for (const [code, sku] of codeToSku.entries()) { const dm = skuToDm.get(sku); if (dm) dmMap[code] = dm; }

    const skuToCode: Record<string, string[]> = {};
    rows.forEach(r => { const sku = dmMap[r.code]?.sku_code; if (sku) (skuToCode[sku] ??= []).push(r.code); });
    const dupSkus = new Set(Object.entries(skuToCode).filter(([, arr]) => arr.length > 1).map(([s]) => s));

    const allSkus = [...new Set(Object.values(dmMap).map((r: any) => r.sku_code).filter(Boolean) as string[])];
    onStatus?.(`ตรวจสอบ Range Store ${allSkus.length.toLocaleString()} SKU...`);
    const storeCode = storeName.split("-")[0];
    const rsRows = await queryInChunks<any>("range_store", "sku_code", allSkus, "sku_code", q => q.eq("apply_yn", "Y").like("store_name", storeCode + "%"));
    const rangeSet = new Set(rsRows.map((r: any) => r.sku_code));

    onStatus?.(`ตรวจเงื่อนไข ${rows.length.toLocaleString()} รายการ...`);
    const skips: SkipRow[] = [];
    const valid: OfsImportLine[] = [];
    for (const r of rows) {
      const dm = dmMap[r.code];
      const pnLa = dm?.product_name_la ?? "";
      if (!dm) { skips.push({ barcode: r.code, product_name_la: "", qty: r.qty, reason: "ไม่พบใน Data master", store_name: storeName, sku_code: "", rank_sales: "" }); continue; }
      const bs = (dm.buying_status ?? "").trim();
      const skuCode = dm.sku_code ?? "";
      const rankSales = skuToRank.get(skuCode) ?? "";
      if (bs === "Inactive" || bs === "Discontinue") { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Buying Status: ${bs}`, store_name: storeName, sku_code: skuCode, rank_sales: rankSales }); continue; }
      if ((dm.item_type ?? "").trim() === "Non basic") { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: "Item type: Non basic", store_name: storeName, sku_code: skuCode, rank_sales: rankSales }); continue; }
      if (!(dm.product_owner ?? "").toLowerCase().includes("lanexang green property")) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Product owner: ${dm.product_owner || "-"}`, store_name: storeName, sku_code: skuCode, rank_sales: rankSales }); continue; }
      if (!rangeSet.has(dm.sku_code)) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `ไม่อยู่ใน Range store (${storeName})`, store_name: storeName, sku_code: skuCode, rank_sales: rankSales }); continue; }
      if (dupSkus.has(dm.sku_code)) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `SKU ซ้ำ (${dm.sku_code})`, store_name: storeName, sku_code: skuCode, rank_sales: rankSales }); continue; }
      valid.push({ sku_code: dm.sku_code, main_barcode: dm.main_barcode ?? null, product_name_la: pnLa, qty: r.qty });
    }

    onStatus?.(`บันทึก Doc (ผ่าน ${valid.length.toLocaleString()} / skip ${skips.length.toLocaleString()})...`);
    const docName = `OFS-${storeName}-${fmtFile(new Date())}`;
    const { data: inserted, error } = await (supabase as any).from("ofs_import_docs").insert({
      doc_name: docName, store_name: storeName,
      import_count: rows.length, pass_count: valid.length, skip_count: skips.length,
      data: valid, skip_data: skips, user_id: user?.id,
    }).select("id").single();
    if (error) throw error;
    return { docName, pass: valid.length, skip: skips.length, total: rows.length, skips, docId: inserted?.id };
  };

  const handleMultiStoreSave = async () => {
    const validGroups = multiStoreGroups.filter(g => g.known);
    if (!validGroups.length) return;
    setMultiStoreSaving(true);
    setMultiStoreProgress({ current: 0, total: validGroups.length });
    startMultiStoreTimer();
    const allSkips: SkipRow[] = [];
    let totalPass = 0, totalTotal = 0;
    try {
      for (let i = 0; i < validGroups.length; i++) {
        setMultiStoreProgress({ current: i + 1, total: validGroups.length });
        const result = await runImportForStore(validGroups[i].rows, validGroups[i].store);
        allSkips.push(...result.skips);
        totalPass += result.pass;
        totalTotal += result.total;
      }
      setPendingSkips(allSkips);
      setLastSave({ total: totalTotal, pass: totalPass, skip: allSkips.length });
      setMultiStoreOpen(false);
      toast({ title: "บันทึกสำเร็จ", description: `${validGroups.length} สาขา · ผ่าน ${totalPass} / skip ${allSkips.length}` });
      await loadImportDocs();
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally {
      setMultiStoreSaving(false);
      setMultiStoreProgress({ current: 0, total: 0 });
      stopMultiStoreTimer();
    }
  };

  const handlePasteImport = async () => {
    const lines = pasteText.trim().split(/\r?\n/).filter(l => l.trim());
    const rows: ImportRow[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const qty = Number(parts[1]);
      if (parts[0] && Number.isFinite(qty) && qty > 0) rows.push({ code: parts[0].trim(), qty });
    }
    if (!rows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
    setPasteOpen(false); setPasteText("");
    await openStoreSelect(rows);
  };

  const handleImportSave = async () => {
    if (!selectedStore) return;
    setImportSaving(true);
    setImportElapsed(0);
    importElapsedRef.current = 0;
    setImportStatus("เริ่มต้น...");
    importTimerRef.current = setInterval(() => {
      importElapsedRef.current += 1;
      setImportElapsed(importElapsedRef.current);
    }, 1000);
    try {
      const result = await runImportForStore(importRows, selectedStore, s => setImportStatus(s));
      setPendingSkips(result.skips);
      setLastSave({ total: result.total, pass: result.pass, skip: result.skip });
      setStoreSelectOpen(false);
      toast({ title: "บันทึกสำเร็จ", description: result.docName });
      await loadImportDocs();
      const elapsedNow = importElapsedRef.current;
      if (result.docId) {
        setDocTimings(prev => {
          const updated = { ...prev, [result.docId!]: elapsedNow };
          localStorage.setItem("ofs_doc_timings", JSON.stringify(updated));
          return updated;
        });
      }
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally {
      setImportSaving(false);
      setImportStatus("");
      if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
    }
  };

  const skipToRow = (r: SkipRow) => ({
    "SKU Code": r.sku_code || "",
    "Barcode Import": r.barcode,
    "Product Name LA": r.product_name_la,
    "Rank Sales": r.rank_sales || "",
    "Qty": r.qty,
    "Reason": r.reason,
    "Store Name": r.store_name,
  });

  const downloadSkipList = () => {
    if (!pendingSkips.length) return;
    const ws = XLSX.utils.json_to_sheet(pendingSkips.map(skipToRow));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skip List");
    XLSX.writeFile(wb, `OFS_Skip_${Date.now()}.xlsx`);
  };

  const downloadSkipListFromDoc = (d: OfsImportDoc) => {
    const skips = (d.skip_data || []) as SkipRow[];
    if (!skips.length) { toast({ title: "ไม่มี Skip List", description: "Doc นี้ไม่มีรายการที่ถูก Skip หรือข้อมูลเก่าก่อนอัปเดตระบบ", variant: "destructive" }); return; }
    const ws = XLSX.utils.json_to_sheet(skips.map(skipToRow));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skip List");
    XLSX.writeFile(wb, `OFS_Skip_${d.doc_name}.xlsx`);
  };


  // ============================================================
  // HQ TAB — logic
  // ============================================================

  const loadImportDocs = useCallback(async (force = false) => {
    const hasCache = _importDocsCache.length > 0;
    if (!hasCache || force) setImportDocsLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_import_docs")
        .select("id, doc_name, store_name, import_count, pass_count, skip_count, user_id, created_at, data, skip_data")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      _importDocsCache = data || [];
      setImportDocs(_importDocsCache);
      // load profiles for importer names
      const userIds = [...new Set((data || []).map((d: any) => d.user_id).filter(Boolean))] as string[];
      if (userIds.length) {
        const { data: profiles } = await (supabase as any).from("profiles").select("user_id,full_name,email").in("user_id", userIds);
        const map: Record<string, string> = {};
        for (const p of (profiles || []) as any[]) map[p.user_id] = p.full_name || p.email || "";
        _userProfileMapCache = map;
        setUserProfileMap(map);
      }
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setImportDocsLoading(false); }
  }, [toast]);

  useEffect(() => { if (subTab === "import_docs") loadImportDocs(); }, [subTab, loadImportDocs]);

  const getEffUnit = useCallback((r: ProcessedRow) => {
    const up = Math.max(r.unit_pick, 1);
    return useQtyImport ? Math.ceil(r.qty_import / up) * up : r.final_order_unit;
  }, [useQtyImport]);

  const filteredHqRows = useMemo(() => {
    setCalPage(0); // reset page on filter change
    if (!hqSearch.trim()) return hqRows;
    const q = hqSearch.toLowerCase();
    return hqRows.filter(r =>
      r.sku_code.toLowerCase().includes(q) ||
      (r.main_barcode || "").toLowerCase().includes(q) ||
      (r.product_name_la || "").toLowerCase().includes(q) ||
      r.store_name.toLowerCase().includes(q)
    );
  }, [hqRows, hqSearch]);

  const pagedHqRows = useMemo(() =>
    filteredHqRows.slice(calPage * CAL_PAGE_SIZE, (calPage + 1) * CAL_PAGE_SIZE),
    [filteredHqRows, calPage]
  );
  const totalCalPages = Math.max(1, Math.ceil(filteredHqRows.length / CAL_PAGE_SIZE));

  const pagedViewItems = useMemo(() =>
    viewItems ? viewItems.slice(viewPage * CAL_PAGE_SIZE, (viewPage + 1) * CAL_PAGE_SIZE) : [],
    [viewItems, viewPage]
  );
  const totalViewPages = viewItems ? Math.max(1, Math.ceil(viewItems.length / CAL_PAGE_SIZE)) : 1;

  const filteredImportDocs = useMemo(() => {
    if (!importDocsSearch.trim()) return importDocs;
    const q = importDocsSearch.toLowerCase();
    return importDocs.filter(d =>
      d.doc_name.toLowerCase().includes(q) ||
      d.store_name.toLowerCase().includes(q) ||
      (d.user_id && (userProfileMap[d.user_id] || "").toLowerCase().includes(q))
    );
  }, [importDocs, importDocsSearch, userProfileMap]);

  const saveSummary = useMemo(() => {
    if (!hqCalculated || !hqRows.length) return [];
    const byStore = new Map<string, { ro: number; po: number }>();
    for (const r of hqRows) {
      if (!byStore.has(r.store_name)) byStore.set(r.store_name, { ro: 0, po: 0 });
      const e = byStore.get(r.store_name)!;
      const eu = getEffUnit(r);
      if (r.stock_dc >= eu) e.ro++; else e.po++;
    }
    return Array.from(byStore.entries()).map(([store, { ro, po }]) => ({ store, ro, po }));
  }, [hqRows, hqCalculated, getEffUnit]);

  const handleFetchData = async () => {
    const selectedDocs = importDocs.filter(d => selectedDocIds.has(d.id));
    if (!selectedDocs.length) return;
    setHqLoading(true); setHqFetched(false); setHqCalculated(false); setHqRows([]);
    fetchElapsedRef.current = 0; setFetchElapsed(0);
    fetchTimerRef.current = setInterval(() => { fetchElapsedRef.current += 1; setFetchElapsed(fetchElapsedRef.current); }, 1000);
    setProgressPct(10); setProgressLabel("รวบรวมรายการ...");
    try {
      // Group by (store, sku), sum qty
      const storeSkuMap = new Map<string, { qty: number; main_barcode: string | null; product_name_la: string | null }>();
      for (const doc of selectedDocs) {
        for (const item of (doc.data || []) as OfsImportLine[]) {
          const key = `${doc.store_name}\x00${item.sku_code}`;
          if (!storeSkuMap.has(key)) storeSkuMap.set(key, { qty: item.qty, main_barcode: item.main_barcode, product_name_la: item.product_name_la });
          else storeSkuMap.get(key)!.qty += item.qty;
        }
      }
      const allSkus = [...new Set(Array.from(storeSkuMap.keys()).map(k => k.split("\x00")[1]))];
      const allStores = [...new Set(selectedDocs.map(d => d.store_name))];

      setProgressPct(30); setProgressLabel(`ดึงข้อมูล ${allSkus.length.toLocaleString()} SKU × ${allStores.length} store...`);

      // ⚡ ยิงทุกอย่างขนานพร้อมกัน (เหมือน SAR — อ่าน min/max จาก minmax table)
      //  P1 get_sar_data_full → min/max/avg/rank/price/pack/box/dm meta จาก "minmax table"
      //  P2 get_sar_calc_data → stock_dc / stock_store / on_order
      //  P3 data_master      → vendor + unit barcode/uom (packing=1) + division_group
      //  P4 po_cost          → po_cost_unit
      //  P5 store_type       → ship_to
      const shipToFetch = allStores.length
        ? (async () => {
            const chunks: string[][] = [];
            for (let i = 0; i < allStores.length; i += 500) chunks.push(allStores.slice(i, i + 500));
            const results = await Promise.all(chunks.map(ch => (supabase.from("store_type" as any) as any).select("store_name,ship_to").in("store_name", ch).then(({ data }: any) => data || [])));
            return results.flat();
          })()
        : Promise.resolve([] as any[]);

      // ⏱ จับเวลาแยกแต่ละ phase เพื่อหา bottleneck
      const _t = (label: string, p: Promise<any>) => {
        const s = performance.now();
        return p.then(r => { console.log(`[OFS] ${label}: ${Math.round(performance.now() - s)}ms`); return r; });
      };
      const [fullArr, calcRes, dmExtraRows, poCostRows, shipToRows] = await Promise.all([
        _t("P1 get_sar_data_full", fetchSarDataFullPaged({ p_skus: allSkus, p_stores: allStores })),
        _t("P2 get_sar_calc_data (stock/on_order)", (supabase as any).rpc("get_sar_calc_data", { p_sku_codes: allSkus, p_store_names: allStores })),
        _t("P3 data_master meta", queryInChunks<any>("data_master", "sku_code", allSkus, "sku_code,main_barcode,unit_of_measure,vendor_code,vendor_display_name,division_group,division,department,sub_department,item_type,buying_status,product_name_en,product_name_la,standard_price,list_price,jmart_price,packing_size_qty")),
        _t("P4 po_cost", queryInChunks<any>("po_cost", "item_id", allSkus, "item_id,po_cost_unit")),
        _t("P5 ship_to", shipToFetch),
      ]);
      if (calcRes.error) throw calcRes.error;

      setProgressPct(85); setProgressLabel("สร้าง rows...");

      // P1 — minmax table rows (key = sku\x00store)
      const mmMap = new Map<string, any>();
      for (const r of fullArr) { const k = `${r.sku_code}\x00${r.store_name}`; if (!mmMap.has(k)) mmMap.set(k, r); }

      // P2 — stock / on_order
      const calcData = calcRes.data || {};
      const stockDCMap = new Map<string, number>();
      for (const r of (calcData.stock_dc || []) as any[]) stockDCMap.set(r.item_id, Number(r.qty) || 0);
      const stockStoreMap = new Map<string, number>();
      for (const r of (calcData.stock_store || []) as any[]) stockStoreMap.set(`${r.item_id}\x00${r.company}`, Number(r.qty) || 0);
      const onOrderMap = new Map<string, number>();
      for (const r of (calcData.on_order || []) as any[]) onOrderMap.set(`${r.sku_code}\x00${r.store_name}`, Number(r.qty) || 0);

      // P3 — vendor + unit barcode/uom (packing=1) + division_group + metadata fallback จาก data_master
      const skuToUnitBarcode = new Map<string, string>();
      const skuToUnitUom = new Map<string, string>();
      const skuToVendorCode = new Map<string, string>();
      const skuToVendorName = new Map<string, string>();
      const skuToDivGroup = new Map<string, string>();
      // metadata fallback ใช้เมื่อ SKU×Store ไม่อยู่ใน minmax table → คง field ไม่ให้ว่าง (เหมือนของเดิม)
      const skuToMeta = new Map<string, any>();      // packing=1 row (priority)
      const skuToMetaAny = new Map<string, any>();   // any row (fallback)
      for (const r of dmExtraRows) {
        if (!r.sku_code) continue;
        if (!skuToMetaAny.has(r.sku_code)) skuToMetaAny.set(r.sku_code, r);
        if (Number(r.packing_size_qty) === 1 && !skuToUnitBarcode.has(r.sku_code)) {
          skuToUnitBarcode.set(r.sku_code, r.main_barcode || "");
          skuToUnitUom.set(r.sku_code, r.unit_of_measure || "");
          skuToMeta.set(r.sku_code, r);
        }
        if (r.vendor_code && !skuToVendorCode.has(r.sku_code)) {
          skuToVendorCode.set(r.sku_code, r.vendor_code);
          skuToVendorName.set(r.sku_code, r.vendor_display_name || "");
        }
        if (r.division_group && !skuToDivGroup.has(r.sku_code)) skuToDivGroup.set(r.sku_code, r.division_group);
      }

      // vendor currency (ขึ้นกับ vendor codes → รอ P3)
      const allVendorCodes = [...new Set(Array.from(skuToVendorCode.values()).filter(Boolean))];
      const vendorMasterRows = allVendorCodes.length ? await queryInChunks<any>("vendor_master", "vendor_code", allVendorCodes, "vendor_code,currency") : [];
      const vendorCurrencyMap = new Map<string, string>();
      for (const r of vendorMasterRows) { if (r.vendor_code) vendorCurrencyMap.set(r.vendor_code, r.currency || ""); }

      // P4 — po_cost_unit
      const skuToPoCostUnit = new Map<string, number | null>();
      for (const r of poCostRows) {
        if (r.item_id && !skuToPoCostUnit.has(r.item_id)) {
          skuToPoCostUnit.set(r.item_id, r.po_cost_unit != null ? Number(r.po_cost_unit) : null);
        }
      }

      // P5 — ship_to
      const storeShipToMap = new Map<string, string>();
      for (const r of shipToRows as any[]) { if (r.store_name) storeShipToMap.set(r.store_name, r.ship_to || ""); }

      const rows: ProcessedRow[] = [];
      for (const [key, { qty, main_barcode: mb, product_name_la: pnLa }] of storeSkuMap) {
        const [storeName, sku] = key.split("\x00");
        const lookupKey = `${sku}\x00${storeName}`;
        const mm = mmMap.get(lookupKey);
        // fallback metadata จาก data_master เมื่อ SKU×Store ไม่อยู่ใน minmax table
        const meta = skuToMeta.get(sku) ?? skuToMetaAny.get(sku);
        const up = Number(mm?.unit_pick ?? 1) || 1;
        const rank = mm?.rank_sale || "D";
        const sarRow: SARRow = {
          sku_code: sku, main_barcode: mm?.main_barcode ?? meta?.main_barcode ?? mb ?? null,
          product_name_la: mm?.product_name_la ?? meta?.product_name_la ?? pnLa ?? null,
          product_name_en: mm?.product_name_en ?? meta?.product_name_en ?? null,
          unit_of_measure: mm?.unit_of_measure ?? meta?.unit_of_measure ?? null, store_name: storeName,
          type_store: mm?.type_store || "",
          division: mm?.division || meta?.division || "",
          department: mm?.department || meta?.department || "",
          sub_department: mm?.sub_department || meta?.sub_department || "",
          item_type: mm?.item_type || meta?.item_type || "",
          buying_status: mm?.buying_status || meta?.buying_status || "",
          unit_pick: up, pack_qty: mm?.pack_qty ?? null, box_qty: mm?.box_qty ?? null,
          cost: mm?.standard_price != null ? Number(mm.standard_price) : (meta?.standard_price != null ? Number(meta.standard_price) : null),
          price2km: mm?.list_price != null ? Number(mm.list_price) : (meta?.list_price != null ? Number(meta.list_price) : null),
          price_jm: mm?.jmart_price != null ? Number(mm.jmart_price) : (meta?.jmart_price != null ? Number(meta.jmart_price) : null),
          pack_size: up === 1 ? "Unit" : `1x${up}`,
          avg_sale: Number(mm?.avg_sale) || 0, rank_sale: rank,
          rank_factor: rank === "A" ? 21 : rank === "B" ? 14 : rank === "C" ? 10 : 7,
          min_val: Number(mm?.min_val ?? 0) || 0, max_val: Number(mm?.max_val ?? 0) || 0,
          stock_dc: stockDCMap.get(sku) || 0, stock_store: stockStoreMap.get(lookupKey) || 0,
          on_order: onOrderMap.get(lookupKey) || 0,
          sar_suggest1: 0, sar_suggest2: 0, tt_order: 0, suggest_order_edit: null,
          final_order_unit: 0, final_order_uom: 0, doh_min: 0, doh_max: 0, doh_stock: 0, doh_tobe: 0, calculated: false,
        };
        const vCode = skuToVendorCode.get(sku) || "";
        const vName = skuToVendorName.get(sku) || "";
        const vCurr = vendorCurrencyMap.get(vCode) || "";
        const uBarcode = skuToUnitBarcode.get(sku) || mm?.main_barcode || meta?.main_barcode || mb || "";
        const uUom = skuToUnitUom.get(sku) || mm?.unit_of_measure || meta?.unit_of_measure || "";
        const shipTo = storeShipToMap.get(storeName) || "";
        const poCostUnit = skuToPoCostUnit.has(sku) ? skuToPoCostUnit.get(sku)! : null;
        rows.push({ ...sarRow, qty_import: qty, division_group: skuToDivGroup.get(sku) ?? "", stock_store_orig: sarRow.stock_store, vendor_code: vCode, vendor_name: vName, currency: vCurr, unit_barcode: uBarcode, unit_uom: uUom, ship_to: shipTo, po_cost_unit: poCostUnit });
      }

      setHqRows(rows); setHqFetched(true); setProgressPct(100);
      toast({ title: "ดึงข้อมูลสำเร็จ", description: `${rows.length} รายการ · ${fetchElapsedRef.current}s` });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally {
      setHqLoading(false);
      if (fetchTimerRef.current) { clearInterval(fetchTimerRef.current); fetchTimerRef.current = null; }
      setTimeout(() => { setProgressPct(0); setProgressLabel(""); }, 800);
    }
  };

  const handleCalculate = async () => {
    if (!hqFetched || !hqRows.length) return;
    setHqCalculating(true);
    setCalcElapsed(0);
    const start = Date.now();
    await new Promise(r => setTimeout(r, 10)); // ให้ UI update ก่อน
    const next = hqRows.map(r => ({ ...computeRow(r), qty_import: r.qty_import, division_group: r.division_group, stock_store_orig: r.stock_store_orig, vendor_code: r.vendor_code, vendor_name: r.vendor_name, currency: r.currency, unit_barcode: r.unit_barcode, unit_uom: r.unit_uom, ship_to: r.ship_to, po_cost_unit: r.po_cost_unit }));
    const elapsed = Math.round((Date.now() - start) / 100) / 10;
    setCalcElapsed(elapsed);
    setHqRows(next); setHqCalculated(true);
    setHqCalculating(false);
    toast({ title: "คำนวณเสร็จ", description: `${next.length} แถว · ${elapsed}s` });
  };

  const updateSuggestEdit = (storeName: string, skuCode: string, val: number | null) => {
    setHqRows(ofsCalCache.hqRows.map(r => {
      if (r.sku_code !== skuCode || r.store_name !== storeName) return r;
      const updated = computeRow({ ...r, suggest_order_edit: val });
      return { ...updated, qty_import: r.qty_import, division_group: r.division_group, stock_store_orig: r.stock_store_orig, vendor_code: r.vendor_code, vendor_name: r.vendor_name, currency: r.currency, unit_barcode: r.unit_barcode, unit_uom: r.unit_uom, ship_to: r.ship_to, po_cost_unit: r.po_cost_unit };
    }));
  };

  const updateStockStore = (storeName: string, skuCode: string, val: number) => {
    setHqRows(ofsCalCache.hqRows.map(r => {
      if (r.sku_code !== skuCode || r.store_name !== storeName) return r;
      const updated = computeRow({ ...r, stock_store: val });
      return { ...updated, qty_import: r.qty_import, division_group: r.division_group, stock_store_orig: r.stock_store_orig, vendor_code: r.vendor_code, vendor_name: r.vendor_name, currency: r.currency, unit_barcode: r.unit_barcode, unit_uom: r.unit_uom, ship_to: r.ship_to, po_cost_unit: r.po_cost_unit };
    }));
  };

  const clearAllStockStore = () => {
    setHqRows(ofsCalCache.hqRows.map(r => {
      const updated = computeRow({ ...r, stock_store: 0 });
      return { ...updated, qty_import: r.qty_import, division_group: r.division_group, stock_store_orig: r.stock_store_orig, vendor_code: r.vendor_code, vendor_name: r.vendor_name, currency: r.currency, unit_barcode: r.unit_barcode, unit_uom: r.unit_uom, ship_to: r.ship_to, po_cost_unit: r.po_cost_unit };
    }));
  };

  const restoreAllStockStore = () => {
    setHqRows(ofsCalCache.hqRows.map(r => {
      const orig = r.stock_store_orig ?? 0;
      const updated = computeRow({ ...r, stock_store: orig });
      return { ...updated, qty_import: r.qty_import, division_group: r.division_group, stock_store_orig: r.stock_store_orig, vendor_code: r.vendor_code, vendor_name: r.vendor_name, currency: r.currency, unit_barcode: r.unit_barcode, unit_uom: r.unit_uom, ship_to: r.ship_to, po_cost_unit: r.po_cost_unit };
    }));
  };

  const handleClearCalTable = () => {
    setHqRows([]); setHqFetched(false); setHqCalculated(false);
    setCalPage(0); setHqSearch(""); setCalcElapsed(0);
  };

  const exportCalTableExcel = () => {
    if (!filteredHqRows.length) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    const ws = XLSX.utils.json_to_sheet(filteredHqRows.map(r => {
      const obj: Record<string, any> = {};
      for (const col of COLS) {
        if (col.key === "vendor_info") obj["Vendor"] = [r.currency, r.vendor_code, r.vendor_name].filter(Boolean).join(" - ");
        else obj[col.label] = (r as any)[col.key];
      }
      return obj;
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cal Table");
    XLSX.writeFile(wb, `OFS_CalTable_${fmtFile(new Date())}.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${filteredHqRows.length.toLocaleString()} แถว` });
  };

  const handleHQSave = async () => {
    if (!user) return;
    setHqSaving(true);
    setSaveProgress({ current: 0, total: 0, label: "เตรียมข้อมูล..." });
    startSaveTimer();
    try {
      const ts = fmtFile(new Date());
      const prefix = saveName.trim() || ts;
      const srcIds = Array.from(selectedDocIds);
      const byStore = new Map<string, ProcessedRow[]>();
      for (const r of hqRows) { if (!byStore.has(r.store_name)) byStore.set(r.store_name, []); byStore.get(r.store_name)!.push(r); }
      // count total docs to insert
      let totalDocs = 0;
      for (const [, rows] of byStore) {
        const savedRows = rows.map(r => { const eu = getEffUnit(r); return { ...r, final_order_unit: eu }; });
        if (savedRows.some(r => r.stock_dc >= r.final_order_unit)) totalDocs++;
        if (savedRows.some(r => r.stock_dc < r.final_order_unit)) totalDocs++;
      }
      setSaveProgress({ current: 0, total: totalDocs, label: `เตรียม 0 / ${totalDocs} doc...` });
      let saved = 0;
      for (const [storeName, rows] of byStore) {
        const savedRows = rows.map(r => {
          const eu = getEffUnit(r);
          return { ...r, final_order_unit: eu, final_order_uom: eu / Math.max(r.unit_pick, 1) };
        });
        // RO = stock_dc >= final_order_unit, PO = stock_dc < final_order_unit
        const roRows = savedRows.filter(r => r.stock_dc >= r.final_order_unit);
        const poRows = savedRows.filter(r => r.stock_dc < r.final_order_unit);
        if (roRows.length > 0) {
          setSaveProgress(p => ({ ...p, label: `บันทึก RO-${storeName} (${roRows.length} รายการ)...` }));
          const { error } = await (supabase as any).from("ofs_result_docs").insert({ doc_name: `${prefix}-RO-${storeName}`, doc_type: "RO", store_name: storeName, source_doc_ids: srcIds, item_count: roRows.length, data: roRows, user_id: user.id });
          if (error) throw error;
          saved++;
          setSaveProgress(p => ({ ...p, current: saved, label: `บันทึก RO-${storeName} สำเร็จ ✓` }));
        }
        if (poRows.length > 0) {
          setSaveProgress(p => ({ ...p, label: `บันทึก PO-${storeName} (${poRows.length} รายการ)...` }));
          const { error } = await (supabase as any).from("ofs_result_docs").insert({ doc_name: `${prefix}-PO-${storeName}`, doc_type: "PO", store_name: storeName, source_doc_ids: srcIds, item_count: poRows.length, data: poRows, user_id: user.id });
          if (error) throw error;
          saved++;
          setSaveProgress(p => ({ ...p, current: saved, label: `บันทึก PO-${storeName} สำเร็จ ✓` }));
        }
      }
      toast({ title: "บันทึกสำเร็จ", description: `${saved} Doc` });
      setSaveOpen(false); setSaveName(""); setHqRows([]); setHqFetched(false); setHqCalculated(false);
      setSelectedDocIds(new Set()); setUseQtyImport(false); await loadImportDocs();
    } catch (e: any) { toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" }); }
    finally { setHqSaving(false); stopSaveTimer(); setSaveProgress({ current: 0, total: 0, label: "" }); }
  };

  const deleteImportDoc = async (id: string, name: string) => {
    if (!confirm(`ลบ "${name}"?`)) return;
    await (supabase as any).from("ofs_import_docs").delete().eq("id", id);
    setImportDocs(d => d.filter(x => x.id !== id));
    setSelectedDocIds(s => { const n = new Set(s); n.delete(id); return n; });
  };

  // ============================================================
  // RESULT DOCS TAB — logic
  // ============================================================

  const loadResultDocs = useCallback(async (force = false) => {
    const hasCache = _resultDocsCache.length > 0;
    if (!hasCache || force) setResultDocsLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_result_docs")
        .select("id,doc_name,doc_type,store_name,source_doc_ids,item_count,user_id,created_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      _resultDocsCache = data || [];
      setResultDocs(_resultDocsCache);
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setResultDocsLoading(false); }
  }, [toast]);

  useEffect(() => { if (subTab === "result_docs") loadResultDocs(); }, [subTab, loadResultDocs]);

  const openResultDoc = async (doc: OfsResultDoc) => {
    setViewLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_result_docs").select("data,doc_name,doc_type").eq("id", doc.id).single();
      if (error) throw error;
      setViewItems((data.data || []) as ProcessedRow[]);
      setViewTitle(data.doc_name); setViewDocType(data.doc_type as "RO" | "PO"); setViewPage(0); setViewExportCount({ dc: 0, d2s: 0 });
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setViewLoading(false); }
  };

  const showSelectedResultDocs = async () => {
    const ids = [...Array.from(selectedPoIds), ...Array.from(selectedRoIds)];
    if (!ids.length) return;
    setViewLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_result_docs").select("data,doc_name,doc_type").in("id", ids);
      if (error) throw error;
      const merged: ProcessedRow[] = (data || []).flatMap((d: any) =>
        ((d.data || []) as ProcessedRow[]).map(r => ({ ...r, _doc_type: d.doc_type }))
      );
      const types = new Set((data || []).map((d: any) => d.doc_type));
      setViewItems(merged);
      const poCount = (data || []).filter((d: any) => d.doc_type === "PO").length;
      const roCount = (data || []).filter((d: any) => d.doc_type === "RO").length;
      const parts = [poCount > 0 && `PO ${poCount}`, roCount > 0 && `RO ${roCount}`].filter(Boolean);
      setViewTitle(`Open All Selected — ${parts.join(" + ")}`);
      setViewDocType(types.size === 1 ? (types.values().next().value as "RO" | "PO") : "MIXED");
      setViewPage(0); setViewExportCount({ dc: 0, d2s: 0 });
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setViewLoading(false); }
  };

  const deleteResultDoc = async (id: string, name: string) => {
    if (!confirm(`ลบ "${name}"?`)) return;
    await (supabase as any).from("ofs_result_docs").delete().eq("id", id);
    setResultDocs(d => d.filter(x => x.id !== id));
    setSelectedPoIds(s => { const n = new Set(s); n.delete(id); return n; });
    setSelectedRoIds(s => { const n = new Set(s); n.delete(id); return n; });
    if (viewItems) { setViewItems(null); setViewTitle(""); setViewDocType(null); }
  };

  const toRaw = (r: ProcessedRow) => ({
    division_group: r.division_group, division: r.division, department: r.department,
    sku_code: r.sku_code, main_barcode: r.main_barcode,
    product_name_la: r.product_name_la, product_name_en: r.product_name_en,
    qty: r.final_order_unit, stock_dc: r.stock_dc,
  });

  const exportExcelItems = (rows: ProcessedRow[], label: string) => {
    if (!rows.length) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    const ws = XLSX.utils.json_to_sheet(rows.map(r => {
      const obj: Record<string, any> = {};
      for (const col of COLS) obj[col.label] = (r as any)[col.key];
      return obj;
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `OFS_${label}_${Date.now()}.xlsx`);
  };

  // Template RO — format เดียวกับ SAR exportListRO
  // Group by Store → Sub-Department, header row ต่อ chunk, perROChunk items/chunk
  const exportTemplateRO = (rows: ProcessedRow[]) => {
    const target = rows.filter(r => (!r._doc_type || r._doc_type === "RO") && r.final_order_unit > 0);
    if (!target.length) { toast({ title: "ไม่มีรายการ RO ที่มี Final Order > 0", variant: "destructive" }); return; }
    try {
      const COLS_RO = [
        "Company", "Partner", "RPM Type", "Currency", "Order Group",
        "Order Lines/Barcode", "Order Lines/Product", "Order Lines/Unit of Measure",
        "Order Lines/Quantity", "Order Lines/Exclude In Package", "Order Lines/Unit Price",
      ];
      const perChunk = Math.max(1, perROChunk);
      const byStore = new Map<string, Map<string, ProcessedRow[]>>();
      for (const r of target) {
        const s = r.store_name || "(no store)";
        const sd = r.sub_department || "(no sub-dept)";
        if (!byStore.has(s)) byStore.set(s, new Map());
        const m = byStore.get(s)!;
        if (!m.has(sd)) m.set(sd, []);
        m.get(sd)!.push(r);
      }
      const out: any[] = [];
      for (const [store, sdMap] of byStore.entries()) {
        for (const [sd, items] of sdMap.entries()) {
          for (let start = 0; start < items.length; start += perChunk) {
            const chunk = items.slice(start, start + perChunk);
            chunk.forEach((r, idx) => {
              const isHeader = idx === 0;
              out.push({
                "Company": isHeader ? store : "",
                "Partner": isHeader ? "Lanexang Green Property Sole Co.,Ltd" : "",
                "RPM Type": isHeader ? "DC Item" : "",
                "Currency": isHeader ? "LAK" : "",
                "Order Group": isHeader ? sd : "",
                "Order Lines/Barcode": r.main_barcode || "",
                "Order Lines/Product": r.main_barcode || "",
                "Order Lines/Unit of Measure": "Unit",
                "Order Lines/Quantity": r.final_order_unit,
                "Order Lines/Exclude In Package": "TRUE",
                "Order Lines/Unit Price": 0,
              });
            });
          }
        }
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(out, { header: COLS_RO });
      XLSX.utils.book_append_sheet(wb, ws, "Import RO");
      XLSX.writeFile(wb, `OFS_Import_RO_${fmtFile(new Date())}.xlsx`);
      toast({ title: "Export RO สำเร็จ", description: `${out.length} rows` });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  // helper: build SRR-format row (ใช้กับทั้ง DC และ D2S PO)
  const toSrrPoRow = (r: ProcessedRow, qty: number, isFirst: boolean, groupKey: string, isD2S: boolean) => {
    const barcode = r.unit_barcode || r.main_barcode || "";
    const uom = r.unit_uom || r.unit_of_measure || "Unit";
    const pickingId = isD2S ? (r.ship_to || "") : "2540";
    const interTransfer = isD2S ? "true" : "";
    const unitPrice = r.po_cost_unit != null ? r.po_cost_unit : (r.cost || 0);
    const row: Record<string, any> = {
      "partner_id": isFirst ? (r.vendor_code || "") : "",
      "Vendor Name": r.vendor_name || "",
      "Picking Type / Database ID": isFirst ? pickingId : "",
      "Inter Transfer": isFirst ? interTransfer : "",
      "PO Group": isFirst ? groupKey : "",
      "Products to Purchase/barcode": barcode,
      "Products to Purchase/Product": barcode,
      "Product name": r.product_name_la || "",
      "Products to Purchase/UoM": uom,
      "Products to Purchase/Exclude In Package": "True",
      "Products to Purchase/Quantity": qty,
      "Products to Purchase/Unit Price": unitPrice,
      "assigned_to": isFirst ? "SPC manager01" : "",
      "description": isFirst ? "" : "",
    };
    if (isD2S) row["Store Name"] = r.store_name;
    return row;
  };

  // helper: fill missing fields for rows saved before vendor/ship_to/po_cost_unit were added
  const enrichRowsForExport = async (rows: ProcessedRow[]): Promise<ProcessedRow[]> => {
    const allSkus = [...new Set(rows.map(r => r.sku_code))];
    const allStores = [...new Set(rows.map(r => r.store_name).filter(Boolean))];

    const [dmRows, stRows, poCostRows] = await Promise.all([
      allSkus.length ? queryInChunks<any>("data_master", "sku_code", allSkus, "sku_code,vendor_code,vendor_display_name,main_barcode,unit_of_measure,po_group") : Promise.resolve([]),
      allStores.length ? (async () => {
        const chunks: string[][] = [];
        for (let i = 0; i < allStores.length; i += 500) chunks.push(allStores.slice(i, i + 500));
        const res = await Promise.all(chunks.map(ch => (supabase.from("store_type" as any) as any).select("store_name,ship_to").in("store_name", ch).then(({ data }: any) => data || [])));
        return res.flat();
      })() : Promise.resolve([]),
      allSkus.length ? queryInChunks<any>("po_cost", "item_id", allSkus, "item_id,po_cost_unit") : Promise.resolve([]),
    ]);

    const vcMap = new Map<string, any>();
    for (const r of dmRows) { if (r.sku_code && r.vendor_code && !vcMap.has(r.sku_code)) vcMap.set(r.sku_code, r); }
    const shipMap = new Map<string, string>();
    for (const r of stRows as any[]) { if (r.store_name) shipMap.set(r.store_name, r.ship_to || ""); }
    const poCostMap = new Map<string, number | null>();
    for (const r of poCostRows) { if (r.item_id && !poCostMap.has(r.item_id)) poCostMap.set(r.item_id, r.po_cost_unit != null ? Number(r.po_cost_unit) : null); }

    return rows.map(r => ({
      ...r,
      vendor_code: r.vendor_code || vcMap.get(r.sku_code)?.vendor_code || "",
      vendor_name: r.vendor_name || vcMap.get(r.sku_code)?.vendor_display_name || "",
      unit_barcode: r.unit_barcode || vcMap.get(r.sku_code)?.main_barcode || r.main_barcode || "",
      unit_uom: r.unit_uom || vcMap.get(r.sku_code)?.unit_of_measure || r.unit_of_measure || "Unit",
      ship_to: r.ship_to || shipMap.get(r.store_name) || "",
      po_cost_unit: r.po_cost_unit != null ? r.po_cost_unit : (poCostMap.has(r.sku_code) ? poCostMap.get(r.sku_code)! : null),
      po_group: (r as any).po_group || vcMap.get(r.sku_code)?.po_group || "",
    }));
  };

  // PO DC — group by vendor_code → sub-group by po_group → split by perPOChunk (เหมือน SRR)
  const exportPODC = async (rows: ProcessedRow[]) => {
    const target = rows.filter(r => (!r._doc_type || r._doc_type === "PO") && r.qty_import > 0);
    if (!target.length) { toast({ title: "ไม่มีรายการ PO", variant: "destructive" }); return; }
    try {
      const perChunk = Math.max(1, perPOChunk);
      const enriched = await enrichRowsForExport(target);
      if (vendorFilter !== null && vendorFilter.size === 0) { toast({ title: "ไม่มี Vendor ที่เลือก", description: "กรุณาเลือก Vendor อย่างน้อย 1 รายการ", variant: "destructive" }); return; }
      const filtered = vendorFilter !== null ? enriched.filter(r => vendorFilter.has(r.vendor_code || "")) : enriched;

      // vendor_code → sku_code → { qty, row } (merge qty ถ้า sku ซ้ำ)
      const byVendor = new Map<string, Map<string, { qty: number; row: ProcessedRow }>>();
      for (const r of filtered) {
        const vc = r.vendor_code || "(no vendor)";
        if (!byVendor.has(vc)) byVendor.set(vc, new Map());
        const skuMap = byVendor.get(vc)!;
        const rowQty = r.final_order_unit > 0 ? r.final_order_unit : r.qty_import;
        if (!skuMap.has(r.sku_code)) skuMap.set(r.sku_code, { qty: rowQty, row: r });
        else skuMap.get(r.sku_code)!.qty += rowQty;
      }

      const out: any[] = [];
      for (const [vc, skuMap] of byVendor) {
        // sub-group by po_group (fallback: vendor_code) — เหมือน SRR
        const groupMap = new Map<string, { qty: number; row: ProcessedRow }[]>();
        for (const item of skuMap.values()) {
          const pg = ((item.row as any).po_group || "").trim() || vc;
          if (!groupMap.has(pg)) groupMap.set(pg, []);
          groupMap.get(pg)!.push(item);
        }
        for (const [groupKey, gItems] of groupMap) {
          const chunks: { qty: number; row: ProcessedRow }[][] = [];
          for (let i = 0; i < gItems.length; i += perChunk) chunks.push(gItems.slice(i, i + perChunk));
          chunks.forEach((chunk, ci) => {
            const chunkGroupKey = chunks.length > 1 ? `${groupKey}-${ci + 1}` : groupKey;
            chunk.forEach(({ qty, row }, idx) => {
              out.push(toSrrPoRow(row, qty, idx === 0, chunkGroupKey, false));
            });
          });
        }
      }
      const mapped = await remapRowsByTemplate("srr_dc_po", out);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PO_DC");
      XLSX.writeFile(wb, `OFS_PO_DC_${fmtFile(new Date())}.xlsx`);
      toast({ title: "Export PO DC สำเร็จ", description: `${out.length} rows` });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  // PO D2S — group by vendor_code → store, split by perPOChunk → srr_d2s_po template
  const exportPOD2S = async (rows: ProcessedRow[]) => {
    const target = rows.filter(r => (!r._doc_type || r._doc_type === "PO") && r.qty_import > 0);
    if (!target.length) { toast({ title: "ไม่มีรายการ PO", variant: "destructive" }); return; }
    try {
      const perChunk = Math.max(1, perPOChunk);
      const enriched = await enrichRowsForExport(target);
      if (vendorFilter !== null && vendorFilter.size === 0) { toast({ title: "ไม่มี Vendor ที่เลือก", description: "กรุณาเลือก Vendor อย่างน้อย 1 รายการ", variant: "destructive" }); return; }
      const filtered = vendorFilter !== null ? enriched.filter(r => vendorFilter.has(r.vendor_code || "")) : enriched;
      // vendor_code → store → rows
      const byVendor = new Map<string, Map<string, ProcessedRow[]>>();
      for (const r of filtered) {
        const vc = r.vendor_code || "(no vendor)";
        const s = r.store_name || "(no store)";
        if (!byVendor.has(vc)) byVendor.set(vc, new Map());
        const byStore = byVendor.get(vc)!;
        if (!byStore.has(s)) byStore.set(s, []);
        byStore.get(s)!.push(r);
      }
      const out: any[] = [];
      for (const [vc, byStore] of byVendor) {
        for (const [, items] of byStore) {
          const totalChunks = Math.ceil(items.length / perChunk);
          for (let start = 0; start < items.length; start += perChunk) {
            const chunkNum = Math.floor(start / perChunk) + 1;
            const groupKey = totalChunks > 1 ? `${vc}-${chunkNum}` : vc;
            items.slice(start, start + perChunk).forEach((r, idx) => {
              const qty = r.final_order_unit > 0 ? r.final_order_unit : r.qty_import;
              out.push(toSrrPoRow(r, qty, idx === 0, groupKey, true));
            });
          }
        }
      }
      const mapped = await remapRowsByTemplate("srr_d2s_po", out);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PO_D2S");
      XLSX.writeFile(wb, `OFS_PO_D2S_${fmtFile(new Date())}.xlsx`);
      toast({ title: "Export PO D2S สำเร็จ", description: `${out.length} rows` });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  const loadVendorListForFilter = async () => {
    const poIds = Array.from(selectedPoIds);
    if (!poIds.length) return;
    setVendorFilterLoading(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < poIds.length; i += 500) chunks.push(poIds.slice(i, i + 500));
      const fetched = await Promise.all(chunks.map(ch => (supabase as any).from("ofs_result_docs").select("data").in("id", ch).then(({ data }: any) => data || [])));
      const allRows: any[] = fetched.flat().flatMap((d: any) => d.data || []);
      // get unique SKUs then fetch vendor_code
      const allSkus = [...new Set(allRows.map((r: any) => r.sku_code).filter(Boolean))];
      const dmRows = await queryInChunks<any>("data_master", "sku_code", allSkus, "sku_code,vendor_code,vendor_display_name");
      const skuToVc = new Map<string, string>();
      const skuToVn = new Map<string, string>();
      for (const r of dmRows) { if (r.sku_code && r.vendor_code && !skuToVc.has(r.sku_code)) { skuToVc.set(r.sku_code, r.vendor_code); skuToVn.set(r.sku_code, r.vendor_display_name || ""); } }
      // merge with existing vendor_code on row
      const vcSet = new Map<string, string>(); // vendor_code → vendor_name
      for (const r of allRows) {
        const vc = r.vendor_code || skuToVc.get(r.sku_code) || "";
        const vn = r.vendor_name || skuToVn.get(r.sku_code) || "";
        if (vc && !vcSet.has(vc)) vcSet.set(vc, vn);
      }
      const vCodes = [...vcSet.keys()];
      const vmRows = await queryInChunks<any>("vendor_master", "vendor_code", vCodes, "vendor_code,spc_name");
      const spcMap = new Map<string, string>();
      for (const r of vmRows) { if (r.vendor_code) spcMap.set(r.vendor_code, r.spc_name || ""); }
      const list = vCodes.map(vc => ({ vendor_code: vc, vendor_name: vcSet.get(vc) || "", spc_name: spcMap.get(vc) || "" }))
        .sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));
      setVendorList(list);
    } finally { setVendorFilterLoading(false); }
  };

  const handleSumDocQty = async () => {
    const poIds = Array.from(selectedPoIds);
    if (!poIds.length) return;
    setSumLoading(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < poIds.length; i += 500) chunks.push(poIds.slice(i, i + 500));
      const fetched = await Promise.all(chunks.map(ch => (supabase as any).from("ofs_result_docs").select("data").in("id", ch).then(({ data }: any) => data || [])));
      let allRows: ProcessedRow[] = fetched.flat().flatMap((d: any) => d.data || []);
      // apply vendor filter if set
      if (vendorFilter !== null) {
        if (vendorFilter.size === 0) { toast({ title: "ไม่มี Vendor ที่เลือก", variant: "destructive" }); return; }
        const enriched = await enrichRowsForExport(allRows);
        allRows = enriched.filter(r => vendorFilter.has(r.vendor_code || ""));
      }
      // Group by sku_code, sum qty
      const skuMap = new Map<string, { qty: number; row: ProcessedRow }>();
      for (const r of allRows) {
        const qty = r.final_order_unit > 0 ? r.final_order_unit : r.qty_import;
        if (!skuMap.has(r.sku_code)) skuMap.set(r.sku_code, { qty, row: r });
        else skuMap.get(r.sku_code)!.qty += qty;
      }
      // Fetch MOQ from po_cost
      const skus = Array.from(skuMap.keys());
      const moqRows = await queryInChunks<any>("po_cost", "item_id", skus, "item_id,moq");
      const moqMap = new Map<string, number>();
      for (const r of moqRows) { if (r.item_id) moqMap.set(r.item_id, Math.max(1, Number(r.moq) || 1)); }
      // Round up to MOQ
      const result: ProcessedRow[] = Array.from(skuMap.values()).map(({ qty, row }) => {
        const moq = moqMap.get(row.sku_code) || 1;
        const rounded = Math.ceil(qty / moq) * moq;
        return { ...row, final_order_unit: rounded, store_name: row.store_name, qty_import: rounded };
      });
      setSummedRows(result);
      setListExportCount({ dc: 0, d2s: 0 });
      toast({ title: "Sum Doc Qty สำเร็จ", description: `${result.length} SKU · ปัดขึ้น MOQ แล้ว` });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSumLoading(false); }
  };

  const openListCal = (doc: OfsImportDoc) => {
    // ถ้า doc นี้ยังไม่ได้ถูก select → add เข้าไป (ไม่ reset selection เดิม)
    // ถ้า selected อยู่แล้ว → ไป Cal Table พร้อม selection ที่มีอยู่
    setSelectedDocIds(s => s.has(doc.id) ? s : new Set([...s, doc.id]));
    setHqFetched(false); setHqCalculated(false); setHqRows([]);
    setSubTab("cal_table");
  };

  // ============================================================
  // renderTable (shared for HQ + result docs detail)
  // ============================================================
  const renderTable = (rows: ProcessedRow[], showToggle = false) => (
    <div className="flex-1 overflow-auto">
      <table className="text-xs border-collapse w-max">
        <thead className="sticky top-0 z-10 bg-muted shadow-sm">
          <tr>
            {COLS.map(col => (
              <th key={col.key} className={cn("px-2 py-1.5 font-semibold border-b whitespace-nowrap", col.right ? "text-right" : "text-left", HIGHLIGHT_COLS.has(col.key) && "bg-amber-100")} style={{ width: col.w, minWidth: col.w }}>
                {showToggle && col.key === "final_order_unit" ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <span>{col.label}</span>
                    <button
                      onClick={() => setUseQtyImport(v => !v)}
                      className={cn("text-[9px] px-1.5 py-0.5 rounded border font-normal leading-none", useQtyImport ? "bg-amber-200 text-amber-800 border-amber-400" : "bg-primary/10 text-primary border-primary/30")}
                      title="Toggle: ใช้ค่าที่คำนวณ หรือ Qty Import"
                    >
                      {useQtyImport ? "▶ Qty Import" : "▶ Calculated"}
                    </button>
                  </div>
                ) : showToggle && col.key === "stock_store" ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <span>{col.label}</span>
                    <div className="flex gap-0.5">
                      <button onClick={clearAllStockStore} className="text-[9px] px-1 py-0.5 rounded border font-normal leading-none bg-red-50 text-red-700 border-red-200 hover:bg-red-100" title="Clear Stock Store ทุกแถว">Clear All</button>
                      <button onClick={restoreAllStockStore} className="text-[9px] px-1 py-0.5 rounded border font-normal leading-none bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" title="Restore Stock Store ทุกแถว">Restore All</button>
                    </div>
                  </div>
                ) : col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={COLS.length} className="text-center p-8 text-muted-foreground">ไม่มีรายการ</td></tr>
            : rows.map((r, i) => {
              const eu = showToggle ? getEffUnit(r) : r.final_order_unit;
              return (
                <tr key={`${r.sku_code}-${r.store_name}-${i}`} className="border-b hover:bg-emerald-100/70 focus-within:bg-emerald-100/70">
                  {COLS.map(col => {
                    let v: any = (r as any)[col.key];
                    if (col.key === "final_order_unit") v = eu;
                    else if (col.key === "final_order_uom") v = eu / Math.max(r.unit_pick, 1);
                    const isHL = HIGHLIGHT_COLS.has(col.key);
                    const isQA = showToggle && useQtyImport && col.key === "qty_import";
                    const isFA = showToggle && useQtyImport && col.key === "final_order_unit";

                    // stock_store — editable + Clear/Restore เฉพาะ HQ tab (showToggle=true)
                    if (showToggle && col.key === "stock_store") {
                      const isModified = r.stock_store_orig !== undefined && r.stock_store !== r.stock_store_orig;
                      return (
                        <td key={col.key} className="px-1 py-0.5 border-r border-r-border/40" style={{ width: col.w, minWidth: col.w }}>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              step="any"
                              value={r.stock_store}
                              onChange={e => updateStockStore(r.store_name, r.sku_code, Number(e.target.value) || 0)}
                              onFocus={e => e.currentTarget.select()}
                              className={cn("w-full h-6 px-1 text-right border rounded text-xs bg-background", isModified && "border-orange-400 bg-orange-50")}
                            />
                            {isModified ? (
                              <button
                                onClick={() => updateStockStore(r.store_name, r.sku_code, r.stock_store_orig ?? 0)}
                                className="shrink-0 text-[10px] px-1 h-5 rounded border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                title="Restore"
                              >↺</button>
                            ) : (
                              <button
                                onClick={() => updateStockStore(r.store_name, r.sku_code, 0)}
                                className="shrink-0 text-[10px] px-1 h-5 rounded border bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                                title="Clear"
                              >✕</button>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // vendor_info — combined display
                    if (col.key === "vendor_info") {
                      const parts = [r.currency, r.vendor_code, r.vendor_name].filter(Boolean);
                      const display = parts.join(" - ");
                      return (
                        <td key={col.key} className="px-2 py-1 border-r border-r-border/40" style={{ width: col.w, minWidth: col.w, maxWidth: col.w }}>
                          <div className="truncate text-xs" title={display}>{display || "-"}</div>
                        </td>
                      );
                    }

                    // suggest_order_edit — editable เฉพาะ HQ tab (showToggle=true)
                    if (showToggle && col.key === "suggest_order_edit") {
                      return (
                        <td key={col.key} className="px-1 py-0.5 border-r border-r-border/40" style={{ width: col.w, minWidth: col.w }}>
                          <input
                            type="number"
                            step="any"
                            value={r.suggest_order_edit ?? ""}
                            onChange={e => updateSuggestEdit(r.store_name, r.sku_code, e.target.value === "" ? null : Number(e.target.value))}
                            onFocus={e => e.currentTarget.select()}
                            className="w-full h-6 px-1 text-right border rounded text-xs bg-background"
                            placeholder="-"
                          />
                        </td>
                      );
                    }

                    return (
                      <td key={col.key} className={cn("px-2 py-1 border-r border-r-border/40", col.right && "text-right tabular-nums", isHL && "bg-amber-50 font-semibold", (isQA || isFA) && "!bg-amber-200 font-bold")} style={{ width: col.w, minWidth: col.w, maxWidth: col.w }} title={typeof v === "string" ? v : undefined}>
                        <div className="truncate">{NUM_COLS.has(col.key) ? fmtNum(v) : (v ?? "")}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );

  // ============================================================
  // RENDER
  // ============================================================

  if (!hasAny) return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      ไม่มีสิทธิ์เข้าใช้งาน Order From Store
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ---- Shared Dialogs ---- */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>วางข้อมูล</DialogTitle><DialogDescription>รูปแบบ: barcode qty (คั่นด้วย space, 1 บรรทัดต่อรายการ)</DialogDescription></DialogHeader>
          <Textarea placeholder={"8857123456789 5\n8857987654321 10"} value={pasteText} onChange={e => setPasteText(e.target.value)} className="font-mono text-xs min-h-[200px]" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasteOpen(false); setPasteText(""); }}>ยกเลิก</Button>
            <Button onClick={handlePasteImport} disabled={!pasteText.trim()}><ClipboardPaste className="w-4 h-4 mr-1" />นำเข้า</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doc Detail Dialog */}
      <Dialog open={!!openDoc} onOpenChange={o => { if (!o) setOpenDoc(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{openDoc?.doc_name}</DialogTitle>
            <DialogDescription className="flex gap-2 flex-wrap">
              <Badge variant="secondary">Import {openDoc?.import_count}</Badge>
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">ผ่าน {openDoc?.pass_count}</Badge>
              <Badge className={openDoc?.skip_count ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-muted text-muted-foreground"}>Skip {openDoc?.skip_count}</Badge>
              {openDoc && docTimings[openDoc.id] != null && (
                <Badge variant="outline">⏱ {docTimings[openDoc.id] >= 60 ? `${Math.floor(docTimings[openDoc.id]/60)}m ${docTimings[openDoc.id]%60}s` : `${docTimings[openDoc.id]}s`}</Badge>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => {
              if (!openDoc) return;
              const items = (openDoc.data || []) as OfsImportLine[];
              const ws = XLSX.utils.json_to_sheet(items.map((r, i) => ({
                "#": i + 1, "SKU Code": r.sku_code, "Barcode": r.main_barcode, "Product Name LA": r.product_name_la, "Qty": r.qty,
              })));
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Items");
              XLSX.writeFile(wb, `${openDoc.doc_name}.xlsx`);
            }}>
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Excel
            </Button>
          </div>
          <div className="overflow-auto flex-1 border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">SKU Code</th>
                  <th className="px-2 py-1.5 text-left">Barcode</th>
                  <th className="px-2 py-1.5 text-left">Product Name LA</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {((openDoc?.data || []) as OfsImportLine[]).map((item, idx) => (
                  <tr key={idx} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1 font-mono">{item.sku_code}</td>
                    <td className="px-2 py-1 text-muted-foreground">{item.main_barcode}</td>
                    <td className="px-2 py-1">{item.product_name_la}</td>
                    <td className="px-2 py-1 text-right font-medium">{item.qty?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Multi-store confirm dialog */}
      <Dialog open={multiStoreOpen} onOpenChange={o => { if (!multiStoreSaving) setMultiStoreOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import หลายสาขา</DialogTitle>
            <DialogDescription>ตรวจสอบรายการสาขาก่อนบันทึก</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {multiStoreGroups.map(g => (
              <div key={g.store} className={cn("flex items-center justify-between px-3 py-2 rounded border text-xs", g.known ? "bg-background" : "bg-destructive/10 border-destructive/30")}>
                <span className={cn("font-mono", !g.known && "text-destructive")}>{g.store}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{g.rows.length} รายการ</Badge>
                  {!g.known && <span className="text-destructive text-[10px]">ไม่พบในระบบ</span>}
                </div>
              </div>
            ))}
          </div>
          {multiStoreSaving && multiStoreProgress.total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>กำลัง import สาขา {multiStoreProgress.current} / {multiStoreProgress.total}...</span>
                <span className="font-mono font-semibold text-primary text-sm tabular-nums">
                  {(multiStoreElapsedMs / 1000).toFixed(1)} s
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(multiStoreProgress.current / multiStoreProgress.total) * 100}%` }} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMultiStoreOpen(false)} disabled={multiStoreSaving}>ยกเลิก</Button>
            <Button onClick={handleMultiStoreSave} disabled={multiStoreSaving || !multiStoreGroups.some(g => g.known)}>
              {multiStoreSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              บันทึก {multiStoreGroups.filter(g => g.known).length} สาขา
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={storeSelectOpen} onOpenChange={setStoreSelectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>เลือก Store Name</DialogTitle><DialogDescription>Import {importRows.length} รายการ</DialogDescription></DialogHeader>
          <div className="py-2 space-y-1">
            <Label className="text-xs">Store Name</Label>
            <Popover open={storeComboOpen} onOpenChange={setStoreComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className={selectedStore ? "" : "text-muted-foreground"}>{selectedStore || "เลือก Store..."}</span>
                  <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-full min-w-[280px]" align="start">
                <Command>
                  <CommandInput placeholder="ค้นหาสาขา..." />
                  <CommandList className="max-h-60">
                    <CommandEmpty>ไม่พบสาขา</CommandEmpty>
                    <CommandGroup>
                      {storeList.map(s => (
                        <CommandItem key={s} value={s} onSelect={() => { setSelectedStore(s); setStoreComboOpen(false); }}>
                          {s}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {importSaving && (
            <div className="py-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{importStatus}</span>
                <span className="ml-2 font-mono shrink-0">{importElapsed}s</span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-pulse w-full" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoreSelectOpen(false)} disabled={importSaving}>ยกเลิก</Button>
            <Button onClick={handleImportSave} disabled={importSaving || !selectedStore}>
              {importSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>บันทึก RO/PO</DialogTitle><DialogDescription>{useQtyImport ? "ใช้ Qty Import" : "ใช้ Calculated"}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">ชื่อ prefix (ไม่ใส่ = auto timestamp)</Label><Input className="mt-1" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={fmtFile(new Date())} disabled={hqSaving} /></div>
            <div className="text-xs font-medium">สรุปที่จะบันทึก:</div>
            <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {saveSummary.map(({ store, ro, po }) => (
                <div key={store} className="flex items-center gap-2">
                  <span className="text-muted-foreground flex-1 truncate">{store}</span>
                  {ro > 0 && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">RO {ro}</Badge>}
                  {po > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px]">PO {po}</Badge>}
                </div>
              ))}
            </div>
            {hqSaving && saveProgress.total > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate flex-1">{saveProgress.label}</span>
                  <span className="ml-3 font-mono font-semibold text-primary tabular-nums shrink-0">
                    {(saveElapsedMs / 1000).toFixed(1)} s
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-200"
                    style={{ width: `${Math.round((saveProgress.current / saveProgress.total) * 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  {saveProgress.current} / {saveProgress.total} doc · {Math.round((saveProgress.current / saveProgress.total) * 100)}%
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={hqSaving}>ยกเลิก</Button>
            <Button onClick={handleHQSave} disabled={hqSaving}>{hqSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}<Save className="w-4 h-4 mr-1" />บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

      {/* ---- Sub-tabs ---- */}
      <Tabs value={subTab} onValueChange={v => setSubTab(v as OfsSubTab)} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-2 bg-background shrink-0">
          <TabsList>
            {(canImport || canHQ) && <TabsTrigger value="import_docs">Import Docs</TabsTrigger>}
            {canHQ && <TabsTrigger value="cal_table">Cal Table{hqFetched && <span className="ml-1.5 text-[10px] bg-primary/15 text-primary px-1 rounded">{hqRows.length.toLocaleString()}</span>}</TabsTrigger>}
            {canResult && <TabsTrigger value="result_docs">Result Docs</TabsTrigger>}
          </TabsList>
        </div>

        {/* ============ IMPORT DOCS TAB ============ */}
        {(canImport || canHQ) && (
          <TabsContent value="import_docs" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            {/* Import section */}
            <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-background">
              <span className="text-xs font-medium text-muted-foreground">Import:</span>
              <Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" />Excel</Button>
              <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}><ClipboardPaste className="w-3.5 h-3.5 mr-1" />Paste</Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={downloadTemplate}><Download className="w-3.5 h-3.5 mr-1" />Template</Button>
              {lastSave && (
                <div className="flex items-center gap-1 ml-2">
                  <Badge variant="secondary" className="text-[10px]">Import {lastSave.total}</Badge>
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">ผ่าน {lastSave.pass}</Badge>
                  {lastSave.skip > 0 && (
                    <>
                      <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">Skip {lastSave.skip}</Badge>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={downloadSkipList}>
                        <AlertCircle className="w-3 h-3 mr-1 text-amber-500" /><Download className="w-3 h-3 mr-1" />Skip List
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {/* Toolbar */}
            <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
              <div className="text-sm font-semibold">Import Docs</div>
              {selectedDocIds.size > 0 && <Badge variant="secondary" className="text-xs">เลือก {selectedDocIds.size}</Badge>}
              <Button size="sm" variant="outline" onClick={loadImportDocs} disabled={importDocsLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", importDocsLoading && "animate-spin")} />Refresh</Button>
              <div className="flex items-center gap-1 ml-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="เสิร์ช Doc / Store / ผู้นำเข้า..."
                  value={importDocsSearch}
                  onChange={e => setImportDocsSearch(e.target.value)}
                  className="h-7 text-xs w-60"
                />
                {importDocsSearch && (
                  <button onClick={() => setImportDocsSearch("")} className="text-muted-foreground hover:text-foreground text-xs px-1">✕</button>
                )}
              </div>
              {importDocsSearch && (
                <span className="text-xs text-muted-foreground">{filteredImportDocs.length.toLocaleString()} / {importDocs.length.toLocaleString()}</span>
              )}
            </div>

            {/* Doc list */}
            <div className="overflow-y-auto border-b flex-1">
              {importDocsLoading ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="px-2 py-1.5 w-8 border-r">
                        <Checkbox checked={filteredImportDocs.length > 0 && filteredImportDocs.every(d => selectedDocIds.has(d.id))} onCheckedChange={c => setSelectedDocIds(s => { const n = new Set(s); filteredImportDocs.forEach(d => c ? n.add(d.id) : n.delete(d.id)); return n; })} />
                      </th>
                      <th className="px-2 py-1.5 text-left border-r">Doc Name</th>
                      <th className="px-2 py-1.5 text-left border-r">Store</th>
                      <th className="px-2 py-1.5 text-center border-r">สถานะ Import</th>
                      <th className="px-2 py-1.5 text-left border-r">วันที่ / ผู้นำเข้า</th>
                      <th className="px-2 py-1.5 w-20 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredImportDocs.length === 0
                      ? <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">{importDocs.length > 0 ? "ไม่พบผลลัพธ์" : "ยังไม่มี Doc"}</td></tr>
                      : filteredImportDocs.map(d => {
                        const isExpanded = expandedDocIds.has(d.id);
                        const lineItems = (d.data || []) as OfsImportLine[];
                        return (
                          <Fragment key={d.id}>
                            <tr
                              className={cn("border-t hover:bg-muted/40 cursor-pointer", selectedDocIds.has(d.id) && "bg-primary/5")}
                              onClick={() => setSelectedDocIds(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })}
                            >
                              <td className="px-2 py-1 text-center border-r" onClick={e => e.stopPropagation()}>
                                <Checkbox checked={selectedDocIds.has(d.id)} onCheckedChange={() => setSelectedDocIds(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
                              </td>
                              <td className="px-2 py-1 font-mono border-r">
                                <div>{d.doc_name}</div>
                                {docTimings[d.id] != null && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    ⏱ {docTimings[d.id] >= 60
                                      ? `${Math.floor(docTimings[d.id] / 60)}m ${docTimings[d.id] % 60}s`
                                      : `${docTimings[d.id]}s`}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1 border-r">{d.store_name}</td>
                              <td className="px-2 py-1 border-r">
                                <div className="flex items-center gap-1 justify-center flex-wrap">
                                  <Badge variant="secondary" className="text-[10px] px-1">Import {d.import_count}</Badge>
                                  <span className="text-muted-foreground text-[10px]">/</span>
                                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px] px-1">ผ่าน {d.pass_count}</Badge>
                                  <span className="text-muted-foreground text-[10px]">/</span>
                                  {d.skip_count > 0 ? (
                                    <Badge
                                      className="text-[10px] px-1 border bg-amber-100 text-amber-700 border-amber-300 cursor-pointer hover:bg-amber-200"
                                      onClick={e => { e.stopPropagation(); downloadSkipListFromDoc(d); }}
                                      title="คลิกเพื่อ Download Skip List"
                                    >Skip {d.skip_count} ↓</Badge>
                                  ) : (
                                    <Badge className="text-[10px] px-1 border bg-muted text-muted-foreground">Skip {d.skip_count}</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1 border-r">
                                <div className="text-muted-foreground">{new Date(d.created_at).toLocaleString()}</div>
                                {d.user_id && userProfileMap[d.user_id] && (
                                  <div className="text-[10px] text-blue-600 mt-0.5 truncate max-w-[160px]" title={userProfileMap[d.user_id]}>
                                    👤 {userProfileMap[d.user_id]}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-1 justify-center">
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setOpenDoc(d)}>Open</Button>
                                  {canHQ && (
                                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-primary border-primary/40 hover:bg-primary/10" onClick={() => openListCal(d)}>
                                      List Cal.
                                    </Button>
                                  )}
                                  {canHQ && <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteImportDoc(d.id, d.doc_name)}><Trash2 className="w-3 h-3" /></Button>}
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

          </TabsContent>
        )}

        {/* ============ CAL TABLE TAB ============ */}
        {canHQ && (
          <TabsContent value="cal_table" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
              <div className="text-sm font-semibold">Cal Table</div>
              {selectedDocIds.size > 0 && <Badge variant="secondary" className="text-xs">เลือก {selectedDocIds.size} doc</Badge>}
              {selectedDocIds.size > 0 && (
                <Button size="sm" variant={hqFetched ? "outline" : "default"} onClick={handleFetchData} disabled={hqLoading}>
                  {hqLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}{hqFetched ? "ดึงใหม่" : "ดึงข้อมูล"}
                </Button>
              )}
              {hqFetched && (
                <Button size="sm" onClick={handleCalculate} disabled={hqCalculating || hqCalculated}>
                  {hqCalculating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}คำนวณ
                </Button>
              )}
              {hqCalculated && (
                <Button size="sm" onClick={() => setSaveOpen(true)}><Save className="w-4 h-4 mr-1" />Save</Button>
              )}
              {hqFetched && (
                <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={exportCalTableExcel} disabled={!filteredHqRows.length}>
                  <FileSpreadsheet className="w-4 h-4 mr-1" />Export Excel
                </Button>
              )}
              {hqFetched && (
                <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleClearCalTable}>
                  <Trash2 className="w-4 h-4 mr-1" />Clear
                </Button>
              )}
              {hqFetched && (
                <>
                  <div className="flex items-center gap-1 ml-2">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <Input placeholder="ค้นหา SKU/Barcode/Store..." value={hqSearch} onChange={e => setHqSearch(e.target.value)} className="h-7 text-xs w-52" />
                  </div>
                  <span className="text-xs text-muted-foreground">{filteredHqRows.length.toLocaleString()} แถว</span>
                </>
              )}
              {(hqLoading || hqCalculating) && (
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {hqLoading ? progressLabel : "กำลังคำนวณ..."}
                  </span>
                  {hqLoading && <span className="text-xs font-mono tabular-nums text-primary font-semibold">{fetchElapsed}s</span>}
                </div>
              )}
              {!hqLoading && !hqCalculating && hqCalculated && calcElapsed > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">คำนวณ {calcElapsed}s</span>
              )}
            </div>
            {(hqLoading || progressPct > 0) && (
              <Progress value={progressPct} className="h-1 rounded-none shrink-0" />
            )}
            {!hqFetched && !hqLoading && (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                กด "List Cal." ในหน้า Import Docs เพื่อเลือก Doc แล้วกด ดึงข้อมูล
              </div>
            )}
            {hqFetched && (
              <>
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/30 border-b shrink-0 select-none flex items-center justify-between">
                  <span>ตารางคำนวณ — {filteredHqRows.length.toLocaleString()} รายการ (แสดง {CAL_PAGE_SIZE}/หน้า)</span>
                  <div className="flex items-center gap-2">
                    <button disabled={calPage === 0} onClick={() => setCalPage(0)} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">«</button>
                    <button disabled={calPage === 0} onClick={() => setCalPage(p => Math.max(0, p - 1))} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">‹</button>
                    <span className="tabular-nums text-[11px]">{calPage + 1} / {totalCalPages}</span>
                    <button disabled={calPage >= totalCalPages - 1} onClick={() => setCalPage(p => Math.min(totalCalPages - 1, p + 1))} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">›</button>
                    <button disabled={calPage >= totalCalPages - 1} onClick={() => setCalPage(totalCalPages - 1)} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">»</button>
                  </div>
                </div>
                {renderTable(pagedHqRows, true)}
              </>
            )}
          </TabsContent>
        )}

        {/* ============ RESULT DOCS TAB ============ */}
        {canResult && (
          <TabsContent value="result_docs" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            {viewItems === null ? (
              // List view
              <>
                <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
                  <div className="text-sm font-semibold">Result Docs</div>
                  {(selectedPoIds.size + selectedRoIds.size) > 0 && <Badge variant="secondary" className="text-xs">เลือก {selectedPoIds.size + selectedRoIds.size}</Badge>}
                  <Button size="sm" variant="outline" onClick={loadResultDocs} disabled={resultDocsLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", resultDocsLoading && "animate-spin")} />Refresh</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCollapsedBatches(new Set())}>Expand All</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                    const allKeys = new Set(resultDocs.map(doc => new Date(doc.created_at).toLocaleDateString("en-CA")));
                    setCollapsedBatches(allKeys);
                  }}>Collapse All</Button>
                  {(selectedPoIds.size + selectedRoIds.size) >= 1 && (
                    <Button size="sm" variant="default" onClick={showSelectedResultDocs} disabled={viewLoading}
                      className="h-7 text-xs bg-primary hover:bg-primary/90"
                    >
                      {viewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                      Open All Selected
                      <span className="ml-1.5 flex items-center gap-0.5">
                        {selectedPoIds.size > 0 && <span className="bg-blue-400/40 text-white text-[9px] px-1 rounded">PO {selectedPoIds.size}</span>}
                        {selectedRoIds.size > 0 && <span className="bg-emerald-400/40 text-white text-[9px] px-1 rounded">RO {selectedRoIds.size}</span>}
                      </span>
                    </Button>
                  )}
                  {/* Multi-PO actions: show when ≥2 PO docs selected */}
                  {(() => {
                    const selPoIds = Array.from(selectedPoIds);
                    if (selPoIds.length < 1) return null;
                    return (
                      <div className="flex items-center gap-1.5 ml-1 pl-2 border-l flex-wrap">
                        <span className="text-[10px] text-muted-foreground">PO {selPoIds.length} docs:</span>
                        {/* Vendor Filter Dropdown */}
                        <Popover open={vendorFilterOpen} onOpenChange={open => { setVendorFilterOpen(open); if (open && !vendorList.length) loadVendorListForFilter(); }}>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className={cn("h-7 text-xs", vendorFilter && vendorFilter.size > 0 && "border-primary text-primary bg-primary/5")}>
                              <ChevronDown className="w-3.5 h-3.5 mr-1" />
                              {vendorFilter && vendorFilter.size > 0 ? `Vendor ${vendorFilter.size}` : "All Vendor"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-0" align="start">
                            <div className="p-2 border-b flex items-center gap-1">
                              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <input
                                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                                placeholder="ค้นหา vendor code / name / SPC..."
                                value={vendorFilterSearch}
                                onChange={e => setVendorFilterSearch(e.target.value)}
                                autoFocus
                              />
                            </div>
                            {(() => {
                              const visibleVendors = vendorList.filter(v => {
                                if (!vendorFilterSearch.trim()) return true;
                                const q = vendorFilterSearch.toLowerCase();
                                return v.vendor_code.toLowerCase().includes(q) || v.vendor_name.toLowerCase().includes(q) || v.spc_name.toLowerCase().includes(q);
                              });
                              const selectedCount = vendorFilter === null ? vendorList.length : vendorFilter.size;
                              return (
                                <>
                                  <div className="flex gap-1 px-2 py-1 border-b items-center">
                                    <button className="text-[10px] text-primary hover:underline" onClick={() => {
                                      // ถ้า search active → เลือกเฉพาะที่กรองเห็น, ถ้าไม่ search → เลือกทั้งหมด
                                      if (vendorFilterSearch.trim()) {
                                        setVendorFilter(new Set(visibleVendors.map(v => v.vendor_code)));
                                      } else {
                                        setVendorFilter(null);
                                      }
                                    }}>Select All{vendorFilterSearch.trim() ? ` (${visibleVendors.length})` : ""}</button>
                                    <span className="text-muted-foreground text-[10px]">·</span>
                                    <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => setVendorFilter(new Set())}>Clear</button>
                                    <span className="text-[10px] text-primary ml-auto">{selectedCount} / {vendorList.length} selected</span>
                                  </div>
                                  <div className="max-h-60 overflow-y-auto">
                                    {vendorFilterLoading ? (
                                      <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                                    ) : visibleVendors.map(v => {
                                      const checked = vendorFilter === null || vendorFilter.has(v.vendor_code);
                                      const toggle = () => setVendorFilter(prev => {
                                        const base = prev === null ? new Set(vendorList.map(x => x.vendor_code)) : new Set(prev);
                                        base.has(v.vendor_code) ? base.delete(v.vendor_code) : base.add(v.vendor_code);
                                        return base.size === vendorList.length ? null : base;
                                      });
                                      return (
                                        <label key={v.vendor_code} className={cn("flex items-start gap-2 px-3 py-1.5 hover:bg-muted/40 cursor-pointer text-xs select-none", checked && "bg-primary/5")}>
                                          <input type="checkbox" checked={checked} onChange={toggle} className="mt-0.5 shrink-0 accent-primary cursor-pointer" />
                                          <div className="min-w-0">
                                            <div className="font-mono font-semibold truncate">{v.vendor_code}</div>
                                            <div className="text-muted-foreground truncate">{v.vendor_name}</div>
                                            {v.spc_name && <div className="text-[10px] text-blue-600 truncate">SPC: {v.spc_name}</div>}
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </>
                              );
                            })()}
                          </PopoverContent>
                        </Popover>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">ตัด</span>
                          <input type="number" min={1} value={perPOChunk} onChange={e => setPerPOChunk(Math.max(1, Number(e.target.value) || 1))}
                            className="w-14 h-6 px-1 text-xs text-right border rounded bg-background" />
                          <span className="text-[10px] text-muted-foreground">รายการ/group</span>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                          onClick={async () => {
                            // load all selected PO rows then exportPOD2S
                            setSumLoading(true);
                            try {
                              const chunks: string[][] = [];
                              for (let i = 0; i < selPoIds.length; i += 500) chunks.push(selPoIds.slice(i, i + 500));
                              const fetched = await Promise.all(chunks.map(ch => (supabase as any).from("ofs_result_docs").select("data,doc_type").in("id", ch).then(({ data }: any) => data || [])));
                              const rows: ProcessedRow[] = fetched.flat().flatMap((d: any) => ((d.data || []) as ProcessedRow[]).map(r => ({ ...r, _doc_type: d.doc_type })));
                              await exportPOD2S(rows);
                              setListExportCount(c => ({ ...c, d2s: c.d2s + 1 }));
                              setDocExportCounts(prev => { const next = new Map(prev); selPoIds.forEach(id => next.set(id, (next.get(id) || 0) + 1)); return next; });
                            } finally { setSumLoading(false); }
                          }}
                          disabled={sumLoading}
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export PO D2S
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                          onClick={handleSumDocQty} disabled={sumLoading}
                        >
                          {sumLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1" />}Sum Doc Qty
                        </Button>
                        {summedRows && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                            onClick={async () => { await exportPODC(summedRows); setListExportCount(c => ({ ...c, dc: c.dc + 1 })); }}
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export PO DC ({summedRows.length} SKU)
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {/* Date-grouped panel */}
                {(() => {
                  const getDateKey = (doc: OfsResultDoc): string =>
                    new Date(doc.created_at).toLocaleDateString("en-CA"); // YYYY-MM-DD
                  const formatDateLabel = (key: string): string => {
                    const [y, mo, d] = key.split("-");
                    return `${d}/${mo}/${y}`;
                  };
                  const clearExtra = () => { setSummedRows(null); setListExportCount({ dc: 0, d2s: 0 }); setVendorFilter(null); setVendorList([]); };
                  const togglePoDoc = (id: string) => { setSelectedPoIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); clearExtra(); };
                  const toggleRoDoc = (id: string) => { setSelectedRoIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); clearExtra(); };

                  // Group by date
                  const dateMap = new Map<string, OfsResultDoc[]>();
                  for (const doc of resultDocs) {
                    const key = getDateKey(doc);
                    if (!dateMap.has(key)) dateMap.set(key, []);
                    dateMap.get(key)!.push(doc);
                  }
                  const batches = Array.from(dateMap.entries())
                    .map(([key, docs]) => ({ key, docs, latestAt: docs.reduce((mx, d) => d.created_at > mx ? d.created_at : mx, "") }))
                    .sort((a, b) => b.key.localeCompare(a.key));

                  if (resultDocsLoading) return (
                    <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  );
                  if (batches.length === 0) return (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">ยังไม่มี Result Doc</div>
                  );

                  return (
                    <div className="flex-1 overflow-auto">
                      {batches.map(({ key, docs }) => {
                        const isCollapsed = collapsedBatches.has(key);
                        const search = (batchSearches[key] ?? "").toLowerCase().trim();

                        // Build store rows: each store may have multiple PO/RO from different save times
                        // Group by store → collect all PO and RO docs sorted by created_at
                        const storeMap = new Map<string, { po: OfsResultDoc[]; ro: OfsResultDoc[] }>();
                        for (const doc of docs) {
                          if (!storeMap.has(doc.store_name)) storeMap.set(doc.store_name, { po: [], ro: [] });
                          if (doc.doc_type === "PO") storeMap.get(doc.store_name)!.po.push(doc);
                          else storeMap.get(doc.store_name)!.ro.push(doc);
                        }
                        // Expand into rows: max(po.length, ro.length) rows per store
                        type StoreRow = { store: string; po?: OfsResultDoc; ro?: OfsResultDoc; rowIdx: number };
                        const allStoreRows: StoreRow[] = [];
                        for (const [store, { po, ro }] of storeMap) {
                          const len = Math.max(po.length, ro.length, 1);
                          for (let i = 0; i < len; i++) {
                            allStoreRows.push({ store, po: po[i], ro: ro[i], rowIdx: i });
                          }
                        }

                        const filteredRows = search
                          ? allStoreRows.filter(r =>
                              r.store.toLowerCase().includes(search) ||
                              (r.po?.doc_name ?? "").toLowerCase().includes(search) ||
                              (r.ro?.doc_name ?? "").toLowerCase().includes(search)
                            )
                          : allStoreRows;

                        const poDocs = docs.filter(d => d.doc_type === "PO");
                        const roDocs = docs.filter(d => d.doc_type === "RO");
                        const uniqueStores = storeMap.size;
                        const poDocIds = poDocs.map(d => d.id);
                        const roDocIds = roDocs.map(d => d.id);
                        const allPoSelected = poDocIds.length > 0 && poDocIds.every(id => selectedPoIds.has(id));
                        const somePoSelected = !allPoSelected && poDocIds.some(id => selectedPoIds.has(id));
                        const allRoSelected = roDocIds.length > 0 && roDocIds.every(id => selectedRoIds.has(id));
                        const someRoSelected = !allRoSelected && roDocIds.some(id => selectedRoIds.has(id));

                        const toggleBatchPO = () => { setSelectedPoIds(s => { const n = new Set(s); if (allPoSelected) poDocIds.forEach(id => n.delete(id)); else poDocIds.forEach(id => n.add(id)); return n; }); clearExtra(); };
                        const toggleBatchRO = () => { setSelectedRoIds(s => { const n = new Set(s); if (allRoSelected) roDocIds.forEach(id => n.delete(id)); else roDocIds.forEach(id => n.add(id)); return n; }); clearExtra(); };

                        return (
                          <div key={key} className="border-b last:border-b-0">
                            {/* Date header */}
                            <div className="px-3 py-2 flex items-center gap-2 bg-slate-700 text-white border-b text-xs font-semibold select-none">
                              {/* PO select-all */}
                              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                <div
                                  className={cn("w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer", allPoSelected ? "bg-blue-400 border-blue-400" : somePoSelected ? "bg-blue-200 border-blue-400" : "border-slate-400 bg-transparent")}
                                  onClick={toggleBatchPO}
                                  title="Select All PO"
                                >
                                  {(allPoSelected || somePoSelected) && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                </div>
                                <span className="text-[10px] text-blue-300 font-normal">PO</span>
                              </div>
                              {/* RO select-all */}
                              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                <div
                                  className={cn("w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer", allRoSelected ? "bg-emerald-400 border-emerald-400" : someRoSelected ? "bg-emerald-200 border-emerald-400" : "border-slate-400 bg-transparent")}
                                  onClick={toggleBatchRO}
                                  title="Select All RO"
                                >
                                  {(allRoSelected || someRoSelected) && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                </div>
                                <span className="text-[10px] text-emerald-300 font-normal">RO</span>
                              </div>
                              <button
                                className="flex items-center gap-1.5 hover:text-slate-200 shrink-0"
                                onClick={() => setCollapsedBatches(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                              >
                                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                                <span className="font-mono text-sm">{formatDateLabel(key)}</span>
                              </button>
                              <span className="font-normal text-slate-300 shrink-0">— {uniqueStores} สาขา</span>
                              {poDocs.length > 0 && <Badge className="bg-blue-400/30 text-blue-100 border-blue-400/50 text-[10px] font-normal shrink-0">PO {poDocs.length}</Badge>}
                              {roDocs.length > 0 && <Badge className="bg-emerald-400/30 text-emerald-100 border-emerald-400/50 text-[10px] font-normal shrink-0">RO {roDocs.length}</Badge>}
                              {/* Search input */}
                              <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                                <Search className="w-3 h-3 text-slate-400 shrink-0" />
                                <input
                                  type="text"
                                  value={batchSearches[key] ?? ""}
                                  onChange={e => setBatchSearches(prev => ({ ...prev, [key]: e.target.value }))}
                                  placeholder="เสิร์ช Store / Doc..."
                                  className="h-6 px-2 text-[11px] border border-slate-500 rounded bg-slate-600 text-white placeholder:text-slate-400 font-normal w-44 focus:outline-none focus:ring-1 focus:ring-slate-300"
                                />
                                {(batchSearches[key] ?? "") && (
                                  <button className="text-slate-300 hover:text-white text-xs" onClick={() => setBatchSearches(prev => ({ ...prev, [key]: "" }))}>✕</button>
                                )}
                                {search && <span className="text-[10px] text-slate-300 font-normal">{filteredRows.length}/{allStoreRows.length}</span>}
                              </div>
                            </div>

                            {/* Store rows */}
                            {!isCollapsed && (
                              <table className="w-full text-xs">
                                <thead className="bg-muted/20">
                                  <tr className="border-b">
                                    <th className="px-3 py-1 text-left font-medium">Store</th>
                                    <th className="px-2 py-1 w-6 border-l"></th>
                                    <th className="px-2 py-1 text-left font-medium text-blue-700">PO Doc</th>
                                    <th className="px-2 py-1 text-right font-medium w-16">Items</th>
                                    <th className="px-2 py-1 w-20"></th>
                                    <th className="px-2 py-1 w-6 border-l"></th>
                                    <th className="px-2 py-1 text-left font-medium text-emerald-700">RO Doc</th>
                                    <th className="px-2 py-1 text-right font-medium w-16">Items</th>
                                    <th className="px-2 py-1 w-20"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredRows.length === 0
                                    ? <tr><td colSpan={9} className="text-center py-4 text-muted-foreground">ไม่พบผลลัพธ์</td></tr>
                                    : filteredRows.map(({ store, po, ro, rowIdx }) => {
                                    return (() => {
                                      const poSelected = po ? selectedPoIds.has(po.id) : false;
                                      const roSelected = ro ? selectedRoIds.has(ro.id) : false;
                                      return (
                                        <tr key={`${store}-${rowIdx}`} className="border-t"
                                          onClick={(e) => {
                                            const td = (e.target as HTMLElement).closest("td");
                                            if (!td) return;
                                            const idx = (td as HTMLTableCellElement).cellIndex;
                                            if (idx >= 1 && idx <= 3 && po) togglePoDoc(po.id);
                                            else if (idx >= 5 && idx <= 7 && ro) toggleRoDoc(ro.id);
                                          }}
                                        >
                                          <td className="px-3 py-1.5 font-medium truncate max-w-[160px]" title={store}>
                                            {rowIdx === 0 ? store.replace(/^\d+-/, "") : <span className="text-muted-foreground/40">↳</span>}
                                          </td>
                                          {/* PO side */}
                                          <td data-side="po" className={cn("px-2 py-1.5 border-l text-center cursor-pointer select-none", po && (poSelected ? "bg-blue-100" : "hover:bg-blue-50"))}>
                                            {po && (
                                              <div className={cn("w-4 h-4 rounded border-2 mx-auto flex items-center justify-center", poSelected ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white")}>
                                                {poSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                                              </div>
                                            )}
                                          </td>
                                          <td data-side="po" className={cn("px-2 py-1.5 font-mono cursor-pointer select-none", po && (poSelected ? "bg-blue-100" : "hover:bg-blue-50"))}>
                                            {po
                                              ? <div className="flex items-center gap-1">
                                                  <span className="truncate max-w-[160px]" title={po.doc_name}>{po.doc_name}</span>
                                                  {(docExportCounts.get(po.id) ?? 0) > 0 && <span className="shrink-0 text-[9px] bg-blue-100 text-blue-700 border border-blue-300 px-1 rounded">{docExportCounts.get(po.id)}x</span>}
                                                </div>
                                              : <span className="text-muted-foreground/50 italic text-[11px]">—</span>
                                            }
                                          </td>
                                          <td data-side="po" className={cn("px-2 py-1.5 text-right tabular-nums text-muted-foreground cursor-pointer select-none", po && (poSelected ? "bg-blue-100" : "hover:bg-blue-50"))}>
                                            {po ? po.item_count.toLocaleString() : ""}
                                          </td>
                                          <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                                            {po && <div className="flex gap-0.5 justify-end">
                                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => openResultDoc(po)} disabled={viewLoading}>Open</Button>
                                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteResultDoc(po.id, po.doc_name)}><Trash2 className="w-3 h-3" /></Button>
                                            </div>}
                                          </td>
                                          {/* RO side */}
                                          <td data-side="ro" className={cn("px-2 py-1.5 border-l text-center cursor-pointer select-none", ro && (roSelected ? "bg-emerald-100" : "hover:bg-emerald-50"))}>
                                            {ro && (
                                              <div className={cn("w-4 h-4 rounded border-2 mx-auto flex items-center justify-center", roSelected ? "bg-emerald-600 border-emerald-600" : "border-gray-400 bg-white")}>
                                                {roSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                                              </div>
                                            )}
                                          </td>
                                          <td data-side="ro" className={cn("px-2 py-1.5 font-mono cursor-pointer select-none", ro && (roSelected ? "bg-emerald-100" : "hover:bg-emerald-50"))}>
                                            {ro
                                              ? <span className="truncate block max-w-[160px]" title={ro.doc_name}>{ro.doc_name}</span>
                                              : <span className="text-muted-foreground/50 italic text-[11px]">—</span>
                                            }
                                          </td>
                                          <td data-side="ro" className={cn("px-2 py-1.5 text-right tabular-nums text-muted-foreground cursor-pointer select-none", ro && (roSelected ? "bg-emerald-100" : "hover:bg-emerald-50"))}>
                                            {ro ? ro.item_count.toLocaleString() : ""}
                                          </td>
                                          <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                                            {ro && <div className="flex gap-0.5 justify-end">
                                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => openResultDoc(ro)} disabled={viewLoading}>Open</Button>
                                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteResultDoc(ro.id, ro.doc_name)}><Trash2 className="w-3 h-3" /></Button>
                                            </div>}
                                          </td>
                                        </tr>
                                      );
                                    })();
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            ) : (
              // Detail view
              <>
                <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
                  <Button size="sm" variant="ghost" onClick={() => { setViewItems(null); setViewTitle(""); setViewDocType(null); setViewExportCount({ dc: 0, d2s: 0 }); }}><ChevronLeft className="w-4 h-4 mr-1" />กลับ</Button>
                  <div className="text-sm font-semibold truncate max-w-xs">{viewTitle}</div>
                  {viewDocType && viewDocType !== "MIXED" && <Badge className={cn("text-[10px] px-1.5 border", viewDocType === "RO" ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-blue-100 text-blue-700 border-blue-300")}>{viewDocType}</Badge>}
                  <span className="text-xs text-muted-foreground">{viewItems.length.toLocaleString()} แถว</span>
                  <div className="ml-auto flex gap-1.5 flex-wrap items-center">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportExcelItems(viewItems, "Result")}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Excel</Button>
                    {(viewDocType === "RO" || viewDocType === "MIXED") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" onClick={() => exportTemplateRO(viewItems)}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Template RO</Button>
                    )}
                    {(viewDocType === "PO" || viewDocType === "MIXED") && (
                      <>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">ตัด</span>
                          <input type="number" min={1} value={perPOChunk} onChange={e => setPerPOChunk(Math.max(1, Number(e.target.value) || 1))}
                            className="w-14 h-6 px-1 text-xs text-right border rounded bg-background" title="จำนวนรายการต่อ 1 group" />
                          <span className="text-[10px] text-muted-foreground">รายการ/group</span>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={async () => { await exportPODC(viewItems); setViewExportCount(c => ({ ...c, dc: c.dc + 1 })); }}>
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />PO DC
                          {viewExportCount.dc > 0 && <span className="ml-1 text-[9px] bg-blue-200 text-blue-800 px-1 rounded">{viewExportCount.dc}x</span>}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={async () => { await exportPOD2S(viewItems); setViewExportCount(c => ({ ...c, d2s: c.d2s + 1 })); }}>
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />PO D2S
                          {viewExportCount.d2s > 0 && <span className="ml-1 text-[9px] bg-blue-200 text-blue-800 px-1 rounded">{viewExportCount.d2s}x</span>}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/30 border-b shrink-0 select-none flex items-center justify-between">
                  <span>แสดง {CAL_PAGE_SIZE}/หน้า (แถวที่ {(viewPage * CAL_PAGE_SIZE + 1).toLocaleString()}–{Math.min((viewPage + 1) * CAL_PAGE_SIZE, viewItems!.length).toLocaleString()} จาก {viewItems!.length.toLocaleString()})</span>
                  <div className="flex items-center gap-2">
                    <button disabled={viewPage === 0} onClick={() => setViewPage(0)} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">«</button>
                    <button disabled={viewPage === 0} onClick={() => setViewPage(p => Math.max(0, p - 1))} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">‹</button>
                    <span className="tabular-nums text-[11px]">{viewPage + 1} / {totalViewPages}</span>
                    <button disabled={viewPage >= totalViewPages - 1} onClick={() => setViewPage(p => Math.min(totalViewPages - 1, p + 1))} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">›</button>
                    <button disabled={viewPage >= totalViewPages - 1} onClick={() => setViewPage(totalViewPages - 1)} className="px-1.5 py-0.5 rounded border text-[10px] disabled:opacity-30">»</button>
                  </div>
                </div>
                {renderTable(pagedViewItems, false)}
              </>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
