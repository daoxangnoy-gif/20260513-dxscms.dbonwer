import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, Calculator, Upload, Save, Download, FileText, Trash2,
  RotateCcw, Search, Settings2, X, Store, Tag, Activity, Layers,
  ChevronRight, ChevronDown as ChevronDownIcon, Eye, BarChart3, StopCircle, Database,
} from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

interface CalcRow {
  sku_code: string;
  product_name_la: string | null;
  product_name_en: string | null;
  main_barcode: string | null;
  unit_of_measure: string | null;
  store_name: string;
  type_store: string;
  size_store: string;
  unit_pick: number;
  avg_sale: number;
  rank_sale: string;
  rank_factor: number;
  min_cal: number;
  max_cal: number;
  is_default_min: boolean;
  min_floored?: boolean; // true เมื่อ avg*rank > 0 แต่ < 3 → ปัดขึ้นเป็น 3 (highlight สีฟ้า)
  item_type: string;
  buying_status: string;
  division: string;
  department: string;
  sub_department: string;
  class: string;
  pack_qty: number | null;
  box_qty: number | null;
  min_edit?: number | null;
  max_edit?: number | null;
  // when row comes from previous Doc (filtered out of current calc), keep its final
  from_doc?: boolean;
  doc_min_final?: number;
  doc_max_final?: number;
}

interface DocRow {
  id: string;
  doc_name: string;
  user_id: string;
  n_factor: number;
  item_count: number;
  created_at: string;
  data: any;
}

const PAGE_SIZE = 100;
// PostgREST hard cap on this project = 1000. We loop until batch < 1000.
const RPC_BATCH = 1000;
// Self-hosted gateways often keep a 1 MB body limit + short proxy timeouts.
// Keep Save Doc RPC requests small so each merge_minmax_doc call finishes fast.
const SAVE_DOC_MAX_CHUNK_BYTES = 1024 * 1024; // 1MB per chunk
const SAVE_DOC_MAX_CHUNK_ROWS = 1000;
const SAVE_DOC_CONCURRENCY = 4;
// Retry transient network failures (TypeError: Failed to fetch) from gateway/proxy.
const SAVE_DOC_MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function rpcWithRetry(fn: () => Promise<{ data: any; error: any }>, label: string) {
  let lastErr: any;
  for (let attempt = 1; attempt <= SAVE_DOC_MAX_RETRIES; attempt++) {
    try {
      const res = await fn();
      if (res.error) throw res.error;
      return res;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient = msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ETIMEDOUT") || msg.includes("502") || msg.includes("504");
      if (!transient || attempt === SAVE_DOC_MAX_RETRIES) throw e;
      console.warn(`[${label}] retry ${attempt}/${SAVE_DOC_MAX_RETRIES} after error:`, msg);
      await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

const jsonByteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function chunkByJsonSize<T>(items: T[], maxBytes = SAVE_DOC_MAX_CHUNK_BYTES, maxRows = SAVE_DOC_MAX_CHUNK_ROWS): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2; // []

  for (const item of items) {
    const itemBytes = jsonByteSize(item) + (current.length ? 1 : 0);
    const shouldFlush = current.length > 0 && (current.length >= maxRows || currentBytes + itemBytes > maxBytes);
    if (shouldFlush) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

interface UPRow {
  sku_code: string;
  size_store: string;
  unit_pick: number;
  main_barcode: string | null;
  product_name_la: string | null;
  product_name_en: string | null;
  pack_qty: number | null;
  box_qty: number | null;
  division: string | null;
  department: string | null;
  sub_department: string | null;
}

// Searchable columns for Odoo-style search
const SEARCH_COLUMNS: { key: keyof CalcRow; label: string }[] = [
  { key: "sku_code", label: "SKU Code" },
  { key: "main_barcode", label: "Barcode" },
  { key: "product_name_la", label: "Product Name (LA)" },
  { key: "product_name_en", label: "Product Name (EN)" },
  { key: "store_name", label: "Store Name" },
  { key: "type_store", label: "Type Store" },
  { key: "size_store", label: "Size Store" },
];

interface SearchChip { col: keyof CalcRow; value: string; label: string; }

function fmtDocName() {
  const d = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-minmaxcal`;
}

// Fetch RPC in batches to bypass PostgREST 1000-row limit.
// PostgREST hard caps each response at 1000 even when range asks for more.
async function fetchAllCalc(params: any, onProgress?: (loaded: number, batches: number) => void, isCancelled?: () => boolean): Promise<any[]> {
  const CONCURRENCY = 4;
  const all: any[] = [];
  let batches = 0;

  const fetchRange = async (from: number): Promise<any[]> => {
    if (isCancelled?.()) throw new Error("__CANCELLED__");
    const { data, error } = await (supabase as any)
      .rpc("get_minmax_calc_all", params)
      .range(from, from + RPC_BATCH - 1);
    if (error) throw error;
    return data || [];
  };

  // probe แรก
  const first = await fetchRange(0);
  all.push(...first);
  batches++;
  onProgress?.(all.length, batches);
  if (first.length < RPC_BATCH) return all;

  // ดึงที่เหลือแบบ parallel CONCURRENCY batch พร้อมกัน
  let nextFrom = RPC_BATCH;
  let done = false;
  while (!done) {
    if (isCancelled?.()) throw new Error("__CANCELLED__");
    const offsets: number[] = [];
    for (let i = 0; i < CONCURRENCY; i++) offsets.push(nextFrom + i * RPC_BATCH);
    const results = await Promise.all(offsets.map(off => fetchRange(off)));
    for (const chunk of results) {
      all.push(...chunk);
      batches++;
      onProgress?.(all.length, batches);
      if (chunk.length < RPC_BATCH) { done = true; break; }
    }
    nextFrom += CONCURRENCY * RPC_BATCH;
  }
  return all;
}

export default function MinmaxCalPage() {
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const canDelete = hasPermission("delete_minmax");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [hasData, setHasData] = useState(false);

  // Calc state
  const [rows, setRows] = useState<CalcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState<string>("");
  const [phasePct, setPhasePct] = useState<number>(0);
  const [phaseTimes, setPhaseTimes] = useState<{ fetch?: number; merge?: number; rowCount?: number; docCount?: number; readBatches?: number }>({});

  // Elapsed timer (อัปเดตทุก 100ms ขณะ loading หรือ viewLoading)
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedStartRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startElapsedTimer = () => {
    elapsedStartRef.current = performance.now();
    setElapsedMs(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(elapsedStartRef.current ? Math.round(performance.now() - elapsedStartRef.current) : 0);
    }, 100);
  };
  const stopElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };
  useEffect(() => () => stopElapsedTimer(), []);
  const [nFactor, setNFactor] = useState<number>(3);
  const [nInput, setNInput] = useState<string>("3");
  const [page, setPage] = useState(0);
  const [forceCal, setForceCal] = useState<Record<string, { min?: boolean; max?: boolean }>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const rowKey = (r: CalcRow) => `${r.sku_code}|${r.store_name}`;

  // Filters
  const [storeFilter, setStoreFilter] = useState<string[]>([]);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>([]);
  const [buyingFilter, setBuyingFilter] = useState<string[]>([]);
  const [divisionFilter, setDivisionFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [subDeptFilter, setSubDeptFilter] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [skuFilter, setSkuFilter] = useState<string[]>([]);
  const [barcodeFilter, setBarcodeFilter] = useState<string[]>([]);
  const [filterOpts, setFilterOpts] = useState<{
    stores: { store_name: string; type_store: string }[];
    types: string[];
    itemTypes: string[];
    buyingStatuses: string[];
    divisions: string[];
    departments: string[];
    subDepartments: string[];
    classes: string[];
  }>({ stores: [], types: [], itemTypes: [], buyingStatuses: [], divisions: [], departments: [], subDepartments: [], classes: [] });

  // Odoo-style search
  const [searchValue, setSearchValue] = useState("");
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Report tab state (replaces old Doc tab)
  const [reportRows, setReportRows] = useState<{ division: string; department: string; store_name: string; type_store: string; sku_count: number; sum_min: number; sum_max: number }[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ loaded: number; total: number; label: string }>({ loaded: 0, total: 0, label: "" });
  const cancelExportRef = useRef(false);

  // Tree expand/collapse state (Division → Department → Store)
  const [expandedDiv, setExpandedDiv] = useState<Set<string>>(new Set());
  const [expandedDept, setExpandedDept] = useState<Set<string>>(new Set());

  // dialogs
  const [setNOpen, setSetNOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [savePct, setSavePct] = useState(0);
  const [saveStep, setSaveStep] = useState<{ idx: number; total: number; label: string }>({ idx: 0, total: 5, label: "" });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"calc" | "report" | "unitpick">("calc");

  // Cancel flag for Calculate
  const cancelCalcRef = useRef(false);

  // Staging mode state (Calculate → DB staging → server-side pagination)
  const [hasStaging, setHasStaging] = useState(false);
  const [stagingTotal, setStagingTotal] = useState(0);
  const [stagingFilteredCount, setStagingFilteredCount] = useState(0);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [editsMap, setEditsMap] = useState<Map<string, { min_edit?: number | null; max_edit?: number | null; max_cal?: number }>>(new Map());

  // Unit Pick Override (loaded from DB, applied to rows)
  const unitPickOverrideRef = useRef<Map<string, number>>(new Map());
  // Cache enrichment data (data_master) — rarely changes, no need to re-fetch on every Refresh
  type UPEnrich = {
    rsvMap: Map<string, { main_barcode: string | null; product_name_la: string | null; product_name_en: string | null; pack_qty: number | null; box_qty: number | null; division: string | null; department: string | null; sub_department: string | null }>;
  };
  const upEnrichRef = useRef<UPEnrich | null>(null);
  const [upRows, setUpRows] = useState<UPRow[]>([]);
  const [upLoading, setUpLoading] = useState(false);
  const [upHasLoaded, setUpHasLoaded] = useState(false);
  const [upSearch, setUpSearch] = useState("");
  const [upSelected, setUpSelected] = useState<Set<string>>(new Set());
  const [upImporting, setUpImporting] = useState(false);
  const upFileRef = useRef<HTMLInputElement>(null);
  const [upFilterSize, setUpFilterSize] = useState<string[]>([]);
  const [upFilterDiv, setUpFilterDiv] = useState<string[]>([]);
  const [upFilterDept, setUpFilterDept] = useState<string[]>([]);
  const [upFilterSubDept, setUpFilterSubDept] = useState<string[]>([]);
  const [upPage, setUpPage] = useState(0);
  const UP_PAGE_SIZE = 100;
  useEffect(() => { setUpPage(0); }, [upSearch, upFilterSize, upFilterDiv, upFilterDept, upFilterSubDept]);

  // View paging state (View → server-side pagination from minmax table)
  const [hasViewPaging, setHasViewPaging] = useState(false);
  const [viewPagingTotal, setViewPagingTotal] = useState(0);
  const [viewPagingLoading, setViewPagingLoading] = useState(false);

  // View button loading (load filtered store rows from minmax)
  const [viewLoading, setViewLoading] = useState(false);

  // Report tab filters (affect Report + Export)
  const [docStoreFilter, setDocStoreFilter] = useState<string[]>([]);
  const [docTypeFilter, setDocTypeFilter] = useState<string[]>([]);
  const [docItemTypeFilter, setDocItemTypeFilter] = useState<string[]>([]);
  const [docBuyingFilter, setDocBuyingFilter] = useState<string[]>([]);
  const [docDivisionFilter, setDocDivisionFilter] = useState<string[]>([]);
  const [docDepartmentFilter, setDocDepartmentFilter] = useState<string[]>([]);
  const [docSubDeptFilter, setDocSubDeptFilter] = useState<string[]>([]);
  const [docClassFilter, setDocClassFilter] = useState<string[]>([]);

  // ====== load filter options ======
  const loadFilterOpts = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any).rpc("get_minmax_filter_options").single();
      if (error) throw error;
      const stores = (data?.stores || []) as { store_name: string; type_store: string }[];
      const types = Array.from(new Set(stores.map(s => s.type_store).filter(Boolean))).sort();
      setFilterOpts({
        stores,
        types,
        itemTypes: data?.item_types || [],
        buyingStatuses: data?.buying_statuses || [],
        divisions: data?.divisions || [],
        departments: data?.departments || [],
        subDepartments: data?.sub_departments || [],
        classes: data?.classes || [],
      });
    } catch (err: any) {
      console.error("load filter opts", err);
    }
  }, []);

  useEffect(() => { loadFilterOpts(); }, [loadFilterOpts]);

  // ====== Load latest MinMax View rows (from minmax table, joined with data_master) ======
  // ใช้ตอน Calc เพื่อ merge ค่าเดิมของ SKU/Store ที่ไม่อยู่ใน filter ปัจจุบัน

  const hasFilters = storeFilter.length > 0 || typeStoreFilter.length > 0
    || itemTypeFilter.length > 0 || buyingFilter.length > 0
    || divisionFilter.length > 0 || departmentFilter.length > 0
    || subDeptFilter.length > 0 || classFilter.length > 0
    || skuFilter.length > 0 || barcodeFilter.length > 0;

  // ====== Staging helpers ======
  const mapStagingRow = (r: any): CalcRow => ({
    sku_code: r.sku_code,
    product_name_la: r.product_name_la,
    product_name_en: r.product_name_en,
    main_barcode: r.main_barcode,
    unit_of_measure: r.unit_of_measure,
    store_name: r.store_name,
    type_store: r.type_store || "",
    size_store: r.size_store || "",
    unit_pick: Number(r.unit_pick) || 1,
    avg_sale: Number(r.avg_sale) || 0,
    rank_sale: r.rank_sale || "D",
    rank_factor: Number(r.rank_factor) || 7,
    min_cal: Number(r.min_cal) || 0,
    max_cal: Number(r.max_cal) || 0,
    is_default_min: Boolean(r.is_default_min),
    min_floored: Boolean(r.min_floored),
    item_type: r.item_type || "",
    buying_status: r.buying_status || "",
    division: r.division || "",
    department: r.department || "",
    sub_department: r.sub_department || "",
    class: r.class || "",
    pack_qty: r.pack_qty == null ? null : Number(r.pack_qty),
    box_qty: r.box_qty == null ? null : Number(r.box_qty),
    min_edit: null,
    max_edit: null,
  });

  // Apply unit_pick override from DB to a single CalcRow, recompute max_cal
  const applyUPOverride = (r: CalcRow, n = nFactor): CalcRow => {
    const override = unitPickOverrideRef.current.get(`${r.sku_code}|${r.size_store}`);
    if (override == null) return r;
    const up = override;
    const avg = r.avg_sale;
    const minCal = r.min_cal;
    let newMax = Math.ceil(minCal + avg * n + up);
    if (avg === 0 && newMax < 4) newMax = 4;
    else if (r.min_floored && newMax < 6) newMax = 6;
    return { ...r, unit_pick: up, max_cal: newMax };
  };

  // helper: fetch all rows from a paginated query (bypass PostgREST 1000-row cap)
  const fetchAllPaged = async (queryFn: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>, pageSize = 1000): Promise<any[]> => {
    const all: any[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await queryFn(offset, offset + pageSize - 1);
      if (error) throw error;
      all.push(...(data || []));
      if ((data || []).length < pageSize) break;
      offset += pageSize;
    }
    return all;
  };

  const loadUnitPickOverrideRef = async () => {
    const all = await fetchAllPaged((from, to) =>
      supabase.from("unit_pick_override" as any).select("sku_code, size_store, unit_pick").range(from, to) as any
    );
    const map = new Map<string, number>();
    for (const r of all) map.set(`${r.sku_code}|${r.size_store}`, Number(r.unit_pick));
    unitPickOverrideRef.current = map;
  };

  const loadUPRows = async (refreshEnrich = false) => {
    setUpLoading(true);
    try {
      // Step 1: Load override list only (fast, always fresh)
      const list = await fetchAllPaged((from, to) =>
        supabase.from("unit_pick_override" as any).select("sku_code, size_store, unit_pick").order("sku_code").range(from, to) as any,
        1000
      );
      if (list.length === 0) { setUpRows([]); return; }

      const skuCodes = [...new Set(list.map((r: any) => r.sku_code as string))];

      // Step 2: Enrichment (data_master only — no store needed)
      const cachedEnrich = upEnrichRef.current;
      const hasNewSkus = !cachedEnrich || skuCodes.some(s => !cachedEnrich.rsvMap.has(s));
      const needEnrich = refreshEnrich || hasNewSkus;

      let enrich: UPEnrich;
      if (needEnrich) {
        const dmChunks: string[][] = [];
        for (let i = 0; i < skuCodes.length; i += 500) dmChunks.push(skuCodes.slice(i, i + 500));

        const dmResults = await Promise.all(dmChunks.map(slice =>
          supabase
            .from("data_master")
            .select("sku_code, main_barcode, product_name_la, product_name_en, division, department, sub_department, unit_of_measure, packing_size_qty")
            .in("sku_code", slice)
            .then(({ data }) => data || [])
        ));

        type RsvEntry = { main_barcode: string | null; product_name_la: string | null; product_name_en: string | null; pack_qty: number | null; box_qty: number | null; division: string | null; department: string | null; sub_department: string | null };
        const rsvMap = new Map<string, RsvEntry>();
        for (const d of dmResults.flat()) {
          const sku = (d as any).sku_code as string;
          const uom = ((d as any).unit_of_measure || "").toString().trim().toLowerCase();
          const pqty = (d as any).packing_size_qty != null ? Number((d as any).packing_size_qty) : null;

          if (!rsvMap.has(sku)) {
            rsvMap.set(sku, {
              main_barcode: null, product_name_la: (d as any).product_name_la ?? null,
              product_name_en: (d as any).product_name_en ?? null,
              pack_qty: null, box_qty: null,
              division: (d as any).division ?? null, department: (d as any).department ?? null,
              sub_department: (d as any).sub_department ?? null,
            });
          }
          const entry = rsvMap.get(sku)!;
          if (pqty === 1 && !entry.main_barcode) entry.main_barcode = (d as any).main_barcode ?? null;
          if (uom === "pack" && pqty != null) entry.pack_qty = entry.pack_qty == null ? pqty : Math.min(entry.pack_qty, pqty);
          if (uom === "box" && pqty != null) entry.box_qty = entry.box_qty == null ? pqty : Math.min(entry.box_qty, pqty);
        }

        enrich = { rsvMap };
        upEnrichRef.current = enrich;
      } else {
        enrich = cachedEnrich!;
      }

      const { rsvMap } = enrich;

      const rows: UPRow[] = list.map((r: any) => ({
        sku_code: r.sku_code,
        size_store: r.size_store,
        unit_pick: r.unit_pick,
        main_barcode: rsvMap.get(r.sku_code)?.main_barcode ?? null,
        product_name_la: rsvMap.get(r.sku_code)?.product_name_la ?? null,
        product_name_en: rsvMap.get(r.sku_code)?.product_name_en ?? null,
        pack_qty: rsvMap.get(r.sku_code)?.pack_qty ?? null,
        box_qty: rsvMap.get(r.sku_code)?.box_qty ?? null,
        division: rsvMap.get(r.sku_code)?.division ?? null,
        department: rsvMap.get(r.sku_code)?.department ?? null,
        sub_department: rsvMap.get(r.sku_code)?.sub_department ?? null,
      }));
      setUpRows(rows);
      setUpHasLoaded(true);
      // Also refresh override ref
      const map = new Map<string, number>();
      for (const r of list) map.set(`${r.sku_code}|${r.size_store}`, Number(r.unit_pick));
      unitPickOverrideRef.current = map;
    } catch (err: any) {
      toast({ title: "Error loading Unit Pick", description: err.message, variant: "destructive" });
    } finally {
      setUpLoading(false);
    }
  };

  const importUnitPickExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUpImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_\-]+/g, "");
      const sample = json[0] || {};
      const keyMap: Record<string, string> = {};
      for (const k of Object.keys(sample)) {
        const n = norm(k);
        if (n === "skucode" || n === "sku") keyMap[k] = "sku_code";
        else if (n === "barcode" || n === "mainbarcode") keyMap[k] = "barcode";
        else if (n === "sizestore" || n === "size") keyMap[k] = "size_store";
        else if (n === "unitpick" || n === "unitpicking") keyMap[k] = "unit_pick";
      }
      const skuColKey = Object.keys(keyMap).find(k => keyMap[k] === "sku_code");
      const bcColKey = Object.keys(keyMap).find(k => keyMap[k] === "barcode");
      const sizeColKey = Object.keys(keyMap).find(k => keyMap[k] === "size_store");
      const upColKey = Object.keys(keyMap).find(k => keyMap[k] === "unit_pick");
      if (!upColKey) throw new Error("ไม่พบคอลัมน์ unit_pick");
      if (!sizeColKey) throw new Error("ไม่พบคอลัมน์ size_store (Super หรือ Mini)");
      if (!skuColKey && !bcColKey) throw new Error("ไม่พบคอลัมน์ sku_code หรือ barcode");

      // Collect raw rows
      const rawRows: { lookup: string; isBc: boolean; size_store: string; unit_pick: number }[] = [];
      for (const row of json) {
        const sku = skuColKey ? String(row[skuColKey] ?? "").trim() : "";
        const bc = bcColKey ? String(row[bcColKey] ?? "").trim() : "";
        const lookup = sku || bc;
        if (!lookup) continue;
        const size = sizeColKey ? String(row[sizeColKey] ?? "").trim() : "";
        if (!size) continue;
        const up = Number(row[upColKey]);
        if (!Number.isFinite(up) || up < 1) continue;
        rawRows.push({ lookup, isBc: !sku && !!bc, size_store: size, unit_pick: up });
      }

      // Resolve barcodes → sku_code (parallel chunks)
      const bcSet = new Set(rawRows.filter(r => r.isBc).map(r => r.lookup));
      const barcodeToSku = new Map<string, string>();
      if (bcSet.size > 0) {
        const all = Array.from(bcSet);
        const chunks: string[][] = [];
        for (let i = 0; i < all.length; i += 500) chunks.push(all.slice(i, i + 500));
        const results = await Promise.all(chunks.map(slice => {
          const inExpr = slice.map(s => `"${String(s).replace(/"/g, '""')}"`).join(",");
          return supabase.from("data_master").select("sku_code, main_barcode, barcode")
            .or(`main_barcode.in.(${inExpr}),barcode.in.(${inExpr})`);
        }));
        for (const { data: dm } of results) {
          for (const m of (dm || [])) {
            if (!m.sku_code) continue;
            if (m.main_barcode && bcSet.has(m.main_barcode)) barcodeToSku.set(m.main_barcode, m.sku_code);
            if (m.barcode && bcSet.has(m.barcode)) barcodeToSku.set(m.barcode, m.sku_code);
          }
        }
      }

      // Build upsert payload (distinct by sku_code × size_store, last row wins)
      const upsertMap = new Map<string, { sku_code: string; size_store: string; unit_pick: number }>();
      for (const r of rawRows) {
        const sku = r.isBc ? (barcodeToSku.get(r.lookup) || "") : r.lookup;
        if (!sku) continue;
        upsertMap.set(`${sku}|${r.size_store}`, { sku_code: sku, size_store: r.size_store, unit_pick: r.unit_pick });
      }
      const payload = Array.from(upsertMap.values());
      if (payload.length === 0) throw new Error("ไม่มีข้อมูลที่ valid สำหรับ import");

      // Upsert in chunks of 500 rows (parallel, max 4 concurrent)
      const UPSERT_CHUNK = 500;
      const UPSERT_CONCURRENCY = 4;
      const upsertChunks: typeof payload[] = [];
      for (let i = 0; i < payload.length; i += UPSERT_CHUNK) upsertChunks.push(payload.slice(i, i + UPSERT_CHUNK));
      for (let i = 0; i < upsertChunks.length; i += UPSERT_CONCURRENCY) {
        const batch = upsertChunks.slice(i, i + UPSERT_CONCURRENCY);
        await Promise.all(batch.map(chunk =>
          (supabase as any).from("unit_pick_override").upsert(chunk, { onConflict: "sku_code,size_store" })
            .then(({ error }: any) => { if (error) throw error; })
        ));
      }
      toast({ title: `Import สำเร็จ ${payload.length.toLocaleString()} แถว` });
      await loadUnitPickOverrideRef(); // update override map used by Cal (fast — no enrichment)
      if (upHasLoaded) await loadUPRows(true); // refresh table only if user had already clicked Show
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    } finally {
      setUpImporting(false);
    }
  };

  const deleteUPSelected = async () => {
    if (upSelected.size === 0) return;
    const pairs = Array.from(upSelected).map(k => {
      const [sku_code, ...rest] = k.split("|");
      return { sku_code, size_store: rest.join("|") };
    });
    try {
      for (const p of pairs) {
        const { error } = await (supabase as any)
          .from("unit_pick_override")
          .delete()
          .eq("sku_code", p.sku_code)
          .eq("size_store", p.size_store);
        if (error) throw error;
      }
      toast({ title: `ลบ ${pairs.length} แถวเรียบร้อย` });
      setUpSelected(new Set());
      await loadUPRows();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    }
  };

  const buildStagingParams = (pageNum: number) => {
    const p: any = { p_user_id: user?.id, p_limit: PAGE_SIZE, p_offset: pageNum * PAGE_SIZE };
    if (storeFilter.length) p.p_store_names = storeFilter;
    if (typeStoreFilter.length) p.p_type_stores = typeStoreFilter;
    if (itemTypeFilter.length) p.p_item_types = itemTypeFilter;
    if (buyingFilter.length) p.p_buying_statuses = buyingFilter;
    if (divisionFilter.length) p.p_divisions = divisionFilter;
    if (departmentFilter.length) p.p_departments = departmentFilter;
    if (subDeptFilter.length) p.p_sub_departments = subDeptFilter;
    if (classFilter.length) p.p_classes = classFilter;
    if (skuFilter.length) p.p_sku_codes = skuFilter;
    if (barcodeFilter.length) p.p_barcodes = barcodeFilter;
    // รวม searchChips + searchValue เป็น p_search_any (ค้นข้ามทุก field)
    const searchTerm = searchChips.map(c => c.value).join(" ").trim() || searchValue.trim();
    if (searchTerm) p.p_search_any = searchTerm;
    return p;
  };

  const loadStagingPage = useCallback(async (pageNum: number) => {
    if (!user || !hasStaging) return;
    setStagingLoading(true);
    try {
      const params = buildStagingParams(pageNum);
      const { data, error } = await (supabase as any).rpc("get_staged_minmax", params);
      if (error) throw error;
      const result = data as { total: number; rows: any[] };
      setStagingFilteredCount(result.total);
      const currentEditsMap = editsMap;
      const mapped = (result.rows || []).map((r: any) => {
        const base = mapStagingRow(r);
        const edit = currentEditsMap.get(rowKey(base));
        return edit ? { ...base, ...edit } : base;
      });
      setRows(mapped);
      setPage(pageNum);
      setHasData(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setStagingLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasStaging, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter,
      divisionFilter, departmentFilter, subDeptFilter, classFilter, skuFilter,
      barcodeFilter, searchChips, searchValue, editsMap]);

  // ====== Calculate ======
  const calculate = useCallback(async (n: number) => {
    cancelCalcRef.current = false;
    const checkCancel = () => { if (cancelCalcRef.current) throw new Error("__CANCELLED__"); };
    setLoading(true);
    setPhaseTimes({});
    setPhaseLabel("กำลังคำนวณ Min/Max ใน DB...");
    setPhasePct(5);
    startElapsedTimer();
    try {
      const t0 = performance.now();

      // Calculate in DB → save to staging → return first 100 rows
      setPhasePct(15);
      setPhaseLabel("กำลังคำนวณใน DB...");
      checkCancel();
      if (!user) throw new Error("ต้องเข้าสู่ระบบ");
      const stageParams: any = {
        p_user_id: user.id,
        p_n_factor: n,
      };
      if (storeFilter.length) stageParams.p_store_names = storeFilter;
      if (typeStoreFilter.length) stageParams.p_type_stores = typeStoreFilter;
      if (itemTypeFilter.length) stageParams.p_item_types = itemTypeFilter;
      if (buyingFilter.length) stageParams.p_buying_statuses = buyingFilter;
      if (divisionFilter.length) stageParams.p_divisions = divisionFilter;
      if (departmentFilter.length) stageParams.p_departments = departmentFilter;
      if (subDeptFilter.length) stageParams.p_sub_departments = subDeptFilter;
      if (classFilter.length) stageParams.p_classes = classFilter;
      if (skuFilter.length) stageParams.p_sku_codes = skuFilter;
      if (barcodeFilter.length) stageParams.p_barcodes = barcodeFilter;
      const { data: stageData, error: stageErr } = await (supabase as any).rpc("calculate_and_stage_minmax", stageParams);
      if (stageErr) throw stageErr;
      const stageResult = stageData as { total: number; rows: any[] };
      const lastBatchCount = 1;
      const fetchMs = Math.round(performance.now() - t0);
      setPhasePct(60);
      setPhaseLabel(`คำนวณเสร็จ ${stageResult.total.toLocaleString()} แถว · ${fetchMs}ms`);
      checkCancel();

      // Set staging state
      setHasStaging(true);
      setHasViewPaging(false);
      setStagingTotal(stageResult.total);
      setStagingFilteredCount(stageResult.total);
      setEditsMap(new Map());
      setPage(0);

      // unit_pick override is now applied inside get_minmax_calc_all (DB-side)
      const calcRows: CalcRow[] = (stageResult.rows || []).map(mapStagingRow);

      // Phase 2 (Doc merge) — removed: Cal returns ONLY computed rows.
      const finalRows: CalcRow[] = calcRows;
      const mergeMs = 0;
      const mergedFromDoc = 0;

      setPhaseTimes({ fetch: fetchMs, merge: mergeMs, rowCount: stageResult.total, docCount: mergedFromDoc, readBatches: lastBatchCount });

      const _excluded = await (await import("@/lib/filterTemplates")).applyExcludeFilters(finalRows as any[], "minmax_cal");
      setRows(_excluded as any);
      setHasData(true);
      setPage(0);
      setPhasePct(100); setPhaseLabel("");
      toast({
        title: "คำนวณเสร็จสิ้น",
        description: `Calc ${stageResult.total.toLocaleString()} แถว`,
      });
    } catch (err: any) {
      if (err?.message === "__CANCELLED__") {
        toast({ title: "ยกเลิกการคำนวณแล้ว", variant: "destructive" });
      } else {
        console.error(err);
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      cancelCalcRef.current = false;
      setPhasePct(0);
      setPhaseLabel("");
      setLoading(false);
      stopElapsedTimer();
    }
  }, [toast, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, divisionFilter, departmentFilter, subDeptFilter, classFilter, skuFilter, barcodeFilter]);

  // ====== load Report summary (per Division/Department/Store from `minmax` + data_master) ======
  const buildReportParams = useCallback(() => {
    const params: any = {};
    if (docStoreFilter.length) params.p_stores = docStoreFilter;
    if (docTypeFilter.length) params.p_type_stores = docTypeFilter;
    if (docItemTypeFilter.length) params.p_item_types = docItemTypeFilter;
    if (docBuyingFilter.length) params.p_buying_statuses = docBuyingFilter;
    if (docDivisionFilter.length) params.p_divisions = docDivisionFilter;
    if (docDepartmentFilter.length) params.p_departments = docDepartmentFilter;
    if (docSubDeptFilter.length) params.p_sub_departments = docSubDeptFilter;
    if (docClassFilter.length) params.p_classes = docClassFilter;
    return params;
  }, [docStoreFilter, docTypeFilter, docItemTypeFilter, docBuyingFilter, docDivisionFilter, docDepartmentFilter, docSubDeptFilter, docClassFilter]);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const params = buildReportParams();
      const all: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await (supabase as any)
          .rpc("get_minmax_report_grouped", params)
          .range(offset, offset + RPC_BATCH - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < RPC_BATCH) break;
        offset += RPC_BATCH;
      }
      setReportRows(all.map((r: any) => ({
        division: r.division || "(No Division)",
        department: r.department || "(No Department)",
        store_name: r.store_name || "",
        type_store: r.type_store || "",
        sku_count: Number(r.sku_count) || 0,
        sum_min: Number(r.sum_min) || 0,
        sum_max: Number(r.sum_max) || 0,
      })));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setReportLoading(false);
    }
  }, [toast, buildReportParams]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // ====== Report: Delete filtered minmax rows ======
  const hasReportFilter = (docStoreFilter.length + docTypeFilter.length + docItemTypeFilter.length + docBuyingFilter.length + docDivisionFilter.length + docDepartmentFilter.length + docSubDeptFilter.length + docClassFilter.length) > 0;

  const handleDeleteFiltered = useCallback(async () => {
    if (!hasReportFilter) return;
    setDeleting(true);
    try {
      const params = buildReportParams();
      const { data, error } = await (supabase as any).rpc("delete_minmax_by_filter", params);
      if (error) throw error;
      const n = Number(data) || 0;
      toast({ title: "Deleted", description: `ลบ Min/Max ${n.toLocaleString()} แถวเรียบร้อย` });
      setDeleteOpen(false);
      await loadReport();
    } catch (err: any) {
      toast({ title: "ลบไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }, [hasReportFilter, buildReportParams, toast, loadReport]);


  // ====== View button: load filtered store rows from `minmax` ======
  const buildViewParams = (pageNum: number) => {
    const p: any = { p_limit: PAGE_SIZE, p_offset: pageNum * PAGE_SIZE };
    if (storeFilter.length) p.p_stores = storeFilter;
    if (typeStoreFilter.length) p.p_type_stores = typeStoreFilter;
    if (itemTypeFilter.length) p.p_item_types = itemTypeFilter;
    if (buyingFilter.length) p.p_buying_statuses = buyingFilter;
    if (divisionFilter.length) p.p_divisions = divisionFilter;
    if (departmentFilter.length) p.p_departments = departmentFilter;
    if (subDeptFilter.length) p.p_sub_departments = subDeptFilter;
    if (classFilter.length) p.p_classes = classFilter;
    if (skuFilter.length) p.p_skus = skuFilter;
    if (barcodeFilter.length) p.p_barcodes = barcodeFilter;
    const searchTerm = searchChips.map(c => c.value).join(" ").trim() || searchValue.trim();
    if (searchTerm) p.p_search_any = searchTerm;
    return p;
  };

  const mapViewRow = (r: any): CalcRow => ({
    sku_code: r.sku_code,
    product_name_la: r.product_name_la,
    product_name_en: r.product_name_en,
    main_barcode: r.main_barcode,
    unit_of_measure: r.unit_of_measure,
    store_name: r.store_name,
    type_store: r.type_store || "",
    size_store: "",
    unit_pick: r.unit_pick == null || r.unit_pick === "" ? 1 : Number(r.unit_pick),
    avg_sale: 0,
    rank_sale: "D",
    rank_factor: 7,
    min_cal: Number(r.min_val) || 0,
    max_cal: Number(r.max_val) || 0,
    is_default_min: false,
    item_type: r.item_type || "",
    buying_status: r.buying_status || "",
    division: r.division || "",
    department: r.department || "",
    sub_department: r.sub_department || "",
    class: r.class || "",
    pack_qty: r.pack_qty ?? null,
    box_qty: r.box_qty ?? null,
    min_edit: null,
    max_edit: null,
    from_doc: true,
    doc_min_final: r.min_val ?? null,
    doc_max_final: r.max_val ?? null,
  });

  const loadViewPage = useCallback(async (pageNum: number) => {
    if (!hasViewPaging) return;
    setViewPagingLoading(true);
    try {
      const params = buildViewParams(pageNum);
      const { data, error } = await (supabase as any).rpc("get_minmax_view_page", params);
      if (error) throw error;
      const result = data as { total: number; rows: any[] };
      setViewPagingTotal(result.total);
      setRows((result.rows || []).map(mapViewRow));
      setPage(pageNum);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setViewPagingLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasViewPaging, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter,
      divisionFilter, departmentFilter, subDeptFilter, classFilter, skuFilter,
      barcodeFilter, searchChips, searchValue]);

  const handleView = useCallback(async () => {
    const hasAny = storeFilter.length || typeStoreFilter.length || itemTypeFilter.length || buyingFilter.length
      || divisionFilter.length || departmentFilter.length || subDeptFilter.length || classFilter.length
      || skuFilter.length || barcodeFilter.length;
    if (!hasAny) {
      toast({ title: "ใส่ Filter ก่อน", description: "เลือก Store หรือกรอก SKU/Barcode หรือเลือก filter อื่นก่อนกด View", variant: "destructive" });
      return;
    }
    setViewLoading(true);
    setPhaseTimes({});
    setPhaseLabel("กำลังดึงข้อมูล Min/Max จาก View...");
    setPhasePct(20);
    startElapsedTimer();
    try {
      const t0 = performance.now();
      // Reload override ref so latest unit_pick data is applied
      const params = buildViewParams(0);
      const { data, error } = await (supabase as any).rpc("get_minmax_view_page", params);
      if (error) throw error;
      const result = data as { total: number; rows: any[] };
      const ms = Math.round(performance.now() - t0);
      const mapped = (result.rows || []).map(mapViewRow);
      setRows(mapped);
      setHasData(true);
      setPage(0);
      setHasStaging(false);
      setHasViewPaging(true);
      setViewPagingTotal(result.total);
      setPhaseTimes({ fetch: ms, rowCount: result.total });
      setPhasePct(100); setPhaseLabel("");
      toast({ title: "ดึงข้อมูลสำเร็จ", description: `${result.total.toLocaleString()} แถว (${ms}ms)` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setViewLoading(false);
      setPhasePct(0);
      setPhaseLabel("");
      stopElapsedTimer();
    }
  }, [storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, divisionFilter, departmentFilter, subDeptFilter, classFilter, skuFilter, barcodeFilter, toast]);


  // ====== finals (Min / Max) ======
  const getFinal = (r: CalcRow): { min: number; max: number; minSrc: "edit" | "cal" | "doc"; maxSrc: "edit" | "cal" | "doc" } => {
    if (r.from_doc) {
      return {
        min: Number(r.doc_min_final ?? r.min_cal),
        max: Number(r.doc_max_final ?? r.max_cal),
        minSrc: "doc", maxSrc: "doc",
      };
    }
    const k = `${r.sku_code}|${r.store_name}`;
    const force = forceCal[k] || {};
    const useMinCal = force.min === true || r.min_edit == null;
    const useMaxCal = force.max === true || r.max_edit == null;
    return {
      min: useMinCal ? r.min_cal : Number(r.min_edit),
      max: useMaxCal ? r.max_cal : Number(r.max_edit),
      minSrc: useMinCal ? "cal" : "edit",
      maxSrc: useMaxCal ? "cal" : "edit",
    };
  };

  // ====== filter + paginate ======
  const filtered = useMemo(() => {
    if (searchChips.length === 0 && !searchValue.trim()) return rows;
    return rows.filter(r => {
      // chips: each chip must match
      for (const c of searchChips) {
        const v = String(r[c.col] ?? "").toLowerCase();
        if (!v.includes(c.value.toLowerCase())) return false;
      }
      // Free-text search (any column)
      const q = searchValue.trim().toLowerCase();
      if (q) {
        const hit = SEARCH_COLUMNS.some(c => String(r[c.key] ?? "").toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, searchChips, searchValue]);

  const isServerPaging = hasStaging || hasViewPaging;
  const pageRows = useMemo(() => {
    if (isServerPaging) return rows; // server-side: rows = current page from DB
    return filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [rows, filtered, page, isServerPaging]);
  const serverPagingTotal = hasStaging ? stagingFilteredCount : viewPagingTotal;
  const totalPages = isServerPaging
    ? Math.max(1, Math.ceil(serverPagingTotal / PAGE_SIZE))
    : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const addSearchChip = (col: keyof CalcRow) => {
    if (!searchValue.trim()) return;
    const colLabel = SEARCH_COLUMNS.find(c => c.key === col)?.label || String(col);
    setSearchChips(prev => [...prev, { col, value: searchValue.trim(), label: colLabel }]);
    setSearchValue("");
    setShowSearchDropdown(false);
    setPage(0);
  };

  // ====== Import Min/Max edits ======
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = "";
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "");
      const sample = json[0] || {};
      const keyMap: Record<string, string> = {};
      for (const k of Object.keys(sample)) {
        const n = norm(k);
        if (n === "skucode" || n === "sku") keyMap[k] = "sku_code";
        else if (n === "barcode" || n === "mainbarcode" || n === "barcodeunit" || n === "barcodeskucode" || n === "skucodebarcode") keyMap[k] = "barcode";
        else if (n === "minqty" || n === "min" || n === "minval") keyMap[k] = "min_qty";
        else if (n === "maxqty" || n === "max" || n === "maxval") keyMap[k] = "max_qty";
        else if (n === "storename" || n === "store") keyMap[k] = "store_name";
      }
      const skuColKey = Object.keys(keyMap).find(k => keyMap[k] === "sku_code");
      const bcColKey = Object.keys(keyMap).find(k => keyMap[k] === "barcode");
      const minColKey = Object.keys(keyMap).find(k => keyMap[k] === "min_qty");
      const maxColKey = Object.keys(keyMap).find(k => keyMap[k] === "max_qty");
      const storeColKey = Object.keys(keyMap).find(k => keyMap[k] === "store_name");

      // editMap key = "<lookupKey>|<store>" where lookupKey is sku OR barcode (whichever provided)
      const editMap = new Map<string, { min?: number; max?: number; storeFilter?: string }>();
      const barcodeKeys = new Set<string>();
      for (const row of json) {
        const sku = skuColKey ? String(row[skuColKey] ?? "").trim() : "";
        const bc = bcColKey ? String(row[bcColKey] ?? "").trim() : "";
        const lookupKey = sku || bc;
        if (!lookupKey) continue;
        if (!sku && bc) barcodeKeys.add(bc);
        const minRaw = minColKey ? row[minColKey] : undefined;
        const maxRaw = maxColKey ? row[maxColKey] : undefined;
        const storeRaw = storeColKey ? row[storeColKey] : undefined;
        const min = minRaw === undefined || minRaw === "" ? undefined : Number(minRaw);
        const max = maxRaw === undefined || maxRaw === "" ? undefined : Number(maxRaw);
        const storeFilter = storeRaw ? String(storeRaw).trim() : undefined;
        editMap.set(lookupKey + "|" + (storeFilter || ""), { min, max, storeFilter });
      }

      // Resolve barcodes → sku_code via data_master (main_barcode, barcode)
      const barcodeToSku = new Map<string, string>();
      if (barcodeKeys.size > 0) {
        const all = Array.from(barcodeKeys);
        const chunkSize = 500;
        for (let i = 0; i < all.length; i += chunkSize) {
          const slice = all.slice(i, i + chunkSize);
          const inExpr = slice.map(s => `"${String(s).replace(/"/g, '""')}"`).join(",");
          const { data, error } = await supabase
            .from("data_master")
            .select("sku_code, main_barcode, barcode")
            .or(`main_barcode.in.(${inExpr}),barcode.in.(${inExpr})`);
          if (error) throw error;
          for (const m of data || []) {
            if (!m.sku_code) continue;
            if (m.main_barcode && slice.includes(m.main_barcode)) barcodeToSku.set(m.main_barcode, m.sku_code);
            if (m.barcode && slice.includes(m.barcode)) barcodeToSku.set(m.barcode, m.sku_code);
          }
        }
      }

      let updated = 0;
      const next = rows.map(r => {
        const tryKeys: string[] = [
          `${r.sku_code}|${r.store_name}`,
          `${r.sku_code}|`,
        ];
        if (r.main_barcode) {
          tryKeys.push(`${r.main_barcode}|${r.store_name}`, `${r.main_barcode}|`);
        }
        // also try barcodes that resolved to this sku
        for (const [bc, sku] of barcodeToSku.entries()) {
          if (sku === r.sku_code) {
            tryKeys.push(`${bc}|${r.store_name}`, `${bc}|`);
          }
        }
        for (const k of tryKeys) {
          const e = editMap.get(k);
          if (e) {
            updated++;
            const newMinEdit = e.min ?? r.min_edit;
            const merged = {
              ...r,
              min_edit: newMinEdit,
              max_edit: e.max ?? r.max_edit,
            };
            return merged;
          }
        }
        return r;

      });
      setRows(next);
      setForceCal({});
      toast({ title: "Import สำเร็จ", description: `อัปเดต ${updated} แถว` });
      setImportOpen(false);
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    }
  };

  // ====== Save to MinMax View (UPSERT into minmax table) ======
  const saveDoc = async () => {
    if (!user) { toast({ title: "ต้องเข้าสู่ระบบ", variant: "destructive" }); return; }
    if (rows.length === 0) { toast({ title: "ยังไม่มีข้อมูลให้บันทึก", variant: "destructive" }); return; }
    setSaving(true);
    const TOTAL_STEPS = 4;
    const step = (i: number, label: string, basePct: number) => {
      setSaveStep({ idx: i, total: TOTAL_STEPS, label });
      setSaveStatus(label);
      setSavePct(basePct);
    };
    try {
      // STEP 1/3 — เตรียม Payload
      let sourceRows: CalcRow[];
      if (hasStaging) {
        step(1, `ดึงข้อมูลทั้งหมดจาก Staging...`, 5);
        const { data: allStaged, error: allErr } = await (supabase as any)
          .rpc("get_staged_minmax_all", { p_user_id: user.id });
        if (allErr) throw allErr;
        const currentEdits = editsMap;
        sourceRows = (Array.isArray(allStaged) ? allStaged : []).map((r: any) => {
          const base = mapStagingRow(r);
          const edit = currentEdits.get(rowKey(base));
          return edit ? { ...base, ...edit } : base;
        });
      } else {
        sourceRows = rows;
      }
      step(1, `เตรียม Payload จาก ${sourceRows.length.toLocaleString()} แถว`, 5);
      await new Promise(r => setTimeout(r, 0));
      const payload = sourceRows.map(r => {
        const f = getFinal(r);
        return {
          sku_code: r.sku_code,
          store_name: r.store_name,
          type_store: r.type_store || null,
          unit_pick: String(r.unit_pick ?? 1),
          min_final: f.min,
          max_final: f.max,
        };
      });
      setSavePct(10);

      // STEP 1.5 — ลบค่าเก่าตาม scope ที่ใช้ Cal จริง ป้องกัน SKU ค้างจากรอบก่อน
      // - ไม่มี filter → ลบทั้งหมด (full recalc)
      // - มี typeStoreFilter → ลบทุกสาขาใน type นั้น (ครอบคลุม SKU ที่หลุดออกจาก range)
      // - มี storeFilter → ลบเฉพาะสาขาที่เลือก
      {
        const hasStoreScope = storeFilter.length > 0 || typeStoreFilter.length > 0;
        step(2, `ลบค่าเก่าตาม scope ก่อนบันทึก`, 12);
        let delCnt = 0;
        if (!hasStoreScope) {
          // ไม่มี filter = full recalc → ลบทั้งหมด (ส่ง null เพื่อให้ PostgREST จับคู่ function signature ได้ถูก)
          const { data, error: delErr } = await (supabase as any)
            .rpc("delete_minmax_by_filter", { p_stores: null });
          if (delErr) throw delErr;
          delCnt = Number(data) || 0;
        } else if (typeStoreFilter.length > 0) {
          // มี type filter → ลบทุกสาขาใน type (ไม่จำกัดแค่ที่อยู่ใน payload)
          const scopeStores = filterOpts.stores
            .filter(s => typeStoreFilter.includes(s.type_store))
            .map(s => s.store_name);
          if (scopeStores.length > 0) {
            const { data, error: delErr } = await (supabase as any)
              .rpc("delete_minmax_by_stores", { p_store_names: scopeStores });
            if (delErr) throw delErr;
            delCnt = Number(data) || 0;
          }
        } else {
          // มีแค่ storeFilter → ลบเฉพาะสาขาที่เลือก
          const { data, error: delErr } = await (supabase as any)
            .rpc("delete_minmax_by_stores", { p_store_names: storeFilter });
          if (delErr) throw delErr;
          delCnt = Number(data) || 0;
        }
        console.log(`[saveDoc] deleted ${delCnt} stale rows`);
      }

      // STEP 2/3 — UPSERT เข้าตาราง minmax แบบ parallel chunk
      step(2, `กำลังบันทึก ${payload.length.toLocaleString()} แถว → ตาราง Min/Max`, 15);
      const chunks = chunkByJsonSize(payload);
      const totalChunks = Math.max(1, chunks.length);
      const t0 = performance.now();
      let sentRows = 0;
      let upsertTotal = 0;
      for (let i = 0; i < chunks.length; i += SAVE_DOC_CONCURRENCY) {
        const batch = chunks.slice(i, i + SAVE_DOC_CONCURRENCY);
        const sec = ((performance.now() - t0) / 1000).toFixed(1);
        step(2, `บันทึก batch ${i + 1}-${Math.min(i + SAVE_DOC_CONCURRENCY, totalChunks)}/${totalChunks} · ${sec}s`,
          15 + Math.round((sentRows / Math.max(1, payload.length)) * 60));
        const results = await Promise.all(batch.map((slice, j) =>
          rpcWithRetry(
            () => (supabase as any).rpc("upsert_minmax_view", { p_rows: slice }),
            `upsert_minmax_view chunk ${i + j + 1}/${totalChunks}`,
          )
        ));
        results.forEach(({ data: cnt }) => { upsertTotal += Number(cnt) || 0; });
        sentRows += batch.reduce((s, sl) => s + sl.length, 0);
      }
      const totalSec = ((performance.now() - t0) / 1000).toFixed(1);

      // STEP 3/4 — sync minmax_cal_documents
      // chunk 0: สร้าง doc ใหม่ (sequential เพื่อรับ doc_id)
      // chunk 1-N: parallel SAVE_DOC_CONCURRENCY
      let syncDocId: string | null = null;
      if (chunks.length > 0) {
        step(3, `อัปเดต Min/Max Document... batch 1/${totalChunks}`, 90);
        const { data: firstResult } = await rpcWithRetry(
          () => (supabase as any).rpc("upsert_minmax_doc_chunk", {
            p_payload: chunks[0],
            p_doc_id: null,
            p_doc_name: saveName || null,
            p_user_id: user.id,
            p_n_factor: nFactor,
            p_create_new: true,
          }),
          `upsert_minmax_doc_chunk batch 1/${totalChunks}`,
        );
        syncDocId = firstResult?.[0]?.doc_id ?? null;

        for (let i = 1; i < chunks.length; i += SAVE_DOC_CONCURRENCY) {
          const batch = chunks.slice(i, i + SAVE_DOC_CONCURRENCY);
          const pct = 90 + Math.round(((i + batch.length) / chunks.length) * 8);
          step(3, `อัปเดต Min/Max Document... batch ${i + 1}-${Math.min(i + SAVE_DOC_CONCURRENCY, totalChunks)}/${totalChunks}`, pct);
          await Promise.all(batch.map((slice, j) =>
            rpcWithRetry(
              () => (supabase as any).rpc("upsert_minmax_doc_chunk", {
                p_payload: slice,
                p_doc_id: syncDocId,
                p_doc_name: null,
                p_user_id: user.id,
                p_n_factor: nFactor,
                p_create_new: false,
              }),
              `upsert_minmax_doc_chunk batch ${i + j + 1}/${totalChunks}`,
            )
          ));
        }
      }

      // STEP 4/4 — เสร็จ
      step(4, `บันทึกสำเร็จ · ${payload.length.toLocaleString()} แถว (${totalSec}s)`, 95);
      toast({
        title: "บันทึก Min/Max View สำเร็จ",
        description: `${payload.length.toLocaleString()} แถว → ตาราง minmax (${totalSec}s)`,
      });

      setSavePct(100);
      setSaveStatus(`เสร็จสิ้น · ${payload.length.toLocaleString()} แถวอัปเดตในตาราง Min/Max`);
      await new Promise(r => setTimeout(r, 400));
      setSaveOpen(false);
      setSaveName("");
      loadReport();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setSaveStatus("");
      setSavePct(0);
      setSaveStep({ idx: 0, total: 3, label: "" });
    }
  };

  // ====== Report: Export full Min/Max View to Excel ======
  // Pulls all rows from `minmax` (filtered by docStoreFilter/docTypeFilter if set)
  // using get_minmax_view_by_stores (already joins data_master deduped).
  const exportReportExcel = async () => {
    cancelExportRef.current = false;
    setExportingReport(true);
    setExportProgress({ loaded: 0, total: 0, label: "เตรียมข้อมูล..." });
    try {
      const t0 = performance.now();
      const all: any[] = [];
      const params = buildReportParams();
      const CONCURRENCY_EXP = 4;
      const fetchExpRange = async (from: number): Promise<any[]> => {
        if (cancelExportRef.current) throw new Error("__CANCELLED__");
        const { data, error } = await (supabase as any)
          .rpc("get_minmax_view_by_stores", params)
          .range(from, from + RPC_BATCH - 1);
        if (error) throw error;
        return data || [];
      };
      const firstExp = await fetchExpRange(0);
      all.push(...firstExp);
      setExportProgress({ loaded: all.length, total: all.length, label: `ดึงข้อมูล... ${all.length.toLocaleString()} แถว` });
      if (firstExp.length >= RPC_BATCH) {
        let nextFrom = RPC_BATCH;
        let done = false;
        while (!done) {
          if (cancelExportRef.current) throw new Error("__CANCELLED__");
          const offsets = Array.from({ length: CONCURRENCY_EXP }, (_, i) => nextFrom + i * RPC_BATCH);
          const results = await Promise.all(offsets.map(off => fetchExpRange(off)));
          for (const chunk of results) {
            all.push(...chunk);
            setExportProgress({ loaded: all.length, total: all.length, label: `ดึงข้อมูล... ${all.length.toLocaleString()} แถว` });
            if (chunk.length < RPC_BATCH) { done = true; break; }
          }
          nextFrom += CONCURRENCY_EXP * RPC_BATCH;
        }
      }
      // RPC already applied all filters; cancel check
      if (cancelExportRef.current) throw new Error("__CANCELLED__");
      const data = all;
      if (data.length === 0) {
        toast({ title: "ไม่มีข้อมูลตาม Filter", variant: "destructive" });
        return;
      }

      setExportProgress({ loaded: 0, total: data.length, label: "สร้างไฟล์ Excel..." });
      const sheet: any[] = [];
      const CHUNK = 2000;
      for (let i = 0; i < data.length; i += CHUNK) {
        if (cancelExportRef.current) throw new Error("__CANCELLED__");
        const slice = data.slice(i, i + CHUNK);
        for (const r of slice) {
          sheet.push({
            "SKU Code": r.sku_code,
            "Product Name (LA)": r.product_name_la,
            "Product Name (EN)": r.product_name_en,
            "Barcode": r.main_barcode,
            "UoM": r.unit_of_measure,
            "Division": r.division ?? "",
            "Department": r.department ?? "",
            "Sub-Department": r.sub_department ?? "",
            "Class": r.class ?? "",
            "Store Name": r.store_name,
            "Type Store": r.type_store,
            "Item Type": r.item_type,
            "Buying Status": r.buying_status,
            "Unit Pick": r.unit_pick,
            "Pack": r.pack_qty ?? null,
            "Box": r.box_qty ?? null,
            "Min": r.min_val,
            "Max": r.max_val,
          });
        }
        setExportProgress({
          loaded: Math.min(data.length, i + slice.length),
          total: data.length,
          label: `เตรียมแถว ${Math.min(data.length, i + slice.length).toLocaleString()}/${data.length.toLocaleString()}`,
        });
        await new Promise(r => setTimeout(r, 0));
      }

      setExportProgress({ loaded: data.length, total: data.length, label: "เขียนไฟล์..." });
      await new Promise(r => setTimeout(r, 0));

      const ws = XLSX.utils.json_to_sheet(sheet);
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      const header = sheet[0] ? Object.keys(sheet[0]) : [];
      const textCols = ["SKU Code", "Barcode"];
      textCols.forEach(name => {
        const colIdx = header.indexOf(name);
        if (colIdx < 0) return;
        for (let R = 1; R <= range.e.r; R++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: colIdx });
          const cell = ws[addr];
          if (cell && cell.v != null && cell.v !== "") {
            cell.t = "s";
            cell.v = String(cell.v);
            cell.z = "@";
          }
        }
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "MinMax_View");

      // Also add a Summary sheet (per-store)
      const sumMap = new Map<string, { sku: number; minTot: number; maxTot: number; type: string }>();
      for (const r of data) {
        const k = String(r.store_name || "");
        const cur = sumMap.get(k) || { sku: 0, minTot: 0, maxTot: 0, type: String(r.type_store || "") };
        cur.sku += 1;
        cur.minTot += Number(r.min_val) || 0;
        cur.maxTot += Number(r.max_val) || 0;
        sumMap.set(k, cur);
      }
      const summarySheet = [...sumMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([store, s]) => ({
          "Store Name": store,
          "Type Store": s.type,
          "SKU Count": s.sku,
          "Sum Min": s.minTot,
          "Sum Max (Qty)": s.maxTot,
        }));
      const ws2 = XLSX.utils.json_to_sheet(summarySheet);
      XLSX.utils.book_append_sheet(wb, ws2, "Summary");

      const ms = ((performance.now() - t0) / 1000).toFixed(1);
      const ts = fmtDocName().replace("-minmaxcal", "");
      const hasFilter = Object.keys(params).length > 0;
      const filterSuffix = hasFilter ? `_filtered_${data.length}` : `_${data.length}`;
      XLSX.writeFile(wb, `minmax_view_${ts}${filterSuffix}.xlsx`);
      toast({ title: "Export สำเร็จ", description: `${data.length.toLocaleString()} แถว (${ms}s)` });
    } catch (err: any) {
      if (err?.message === "__CANCELLED__") {
        toast({ title: "ยกเลิก Export แล้ว", variant: "destructive" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setExportingReport(false);
      setExportProgress({ loaded: 0, total: 0, label: "" });
    }
  };



  const exportTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ sku_code: "", barcode: "", store_name: "", min_qty: "", max_qty: "" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MinMax_Import");
    XLSX.writeFile(wb, "minmax_import_template.xlsx");
  };

  // Export current rows (Calc + Doc merged) — supports 3 modes
  const exportRows = async (mode: "page" | "selected" | "all") => {
    let source: CalcRow[] = [];
    if (mode === "page") source = pageRows;
    else if (mode === "selected") source = filtered.filter(r => selectedKeys.has(rowKey(r)));
    else if (hasStaging && mode === "all") {
      // staging mode: fetch all from DB
      try {
        const { data: allStaged, error: allErr } = await (supabase as any)
          .rpc("get_staged_minmax_all", { p_user_id: user?.id });
        if (allErr) throw allErr;
        const currentEdits = editsMap;
        source = (Array.isArray(allStaged) ? allStaged : []).map((r: any) => {
          const base = mapStagingRow(r);
          const edit = currentEdits.get(rowKey(base));
          return edit ? { ...base, ...edit } : base;
        });
      } catch (err: any) {
        toast({ title: "Export Error", description: err.message, variant: "destructive" });
        return;
      }
    } else if (hasViewPaging && mode === "all") {
      // view paging mode: fetch all from DB with large limit
      try {
        const params = buildViewParams(0);
        params.p_limit = 999999;
        const { data: viewAll, error: viewErr } = await (supabase as any)
          .rpc("get_minmax_view_page", params);
        if (viewErr) throw viewErr;
        const result = viewAll as { total: number; rows: any[] };
        source = (result.rows || []).map(mapViewRow);
      } catch (err: any) {
        toast({ title: "Export Error", description: err.message, variant: "destructive" });
        return;
      }
    } else source = filtered;

    if (source.length === 0) {
      toast({ title: "ไม่มีข้อมูลให้ Export", variant: "destructive" });
      return;
    }
    const sheet = source.map(r => {
      const f = getFinal(r);
      return {
        "SKU Code": r.sku_code,
        "Product Name (LA)": r.product_name_la,
        "Product Name (EN)": r.product_name_en,
        "Barcode": r.main_barcode,
        "UoM": r.unit_of_measure,
        "Store Name": r.store_name,
        "Type Store": r.type_store,
        "Size Store": r.size_store,
        "Item Type": r.item_type,
        "Buying Status": r.buying_status,
        "Unit Pick": r.unit_pick,
        "Pack": r.pack_qty ?? null,
        "Box": r.box_qty ?? null,
        "Avg Sale": r.avg_sale,
        "Rank": r.rank_sale,
        "Rank Factor": r.rank_factor,
        "Min Cal": r.min_cal,
        "Max Cal": r.max_cal,
        "Min Edit": r.min_edit,
        "Max Edit": r.max_edit,
        "Min": f.min,
        "Max": f.max,
        "Source": r.from_doc ? "Doc" : "Calc",
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MinMax");
    const ts = fmtDocName().replace("-minmaxcal", "");
    const suffix = mode === "page" ? "page" : mode === "selected" ? "selected" : "all";
    XLSX.writeFile(wb, `minmax_${suffix}_${ts}.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${sheet.length.toLocaleString()} แถว (${suffix})` });
  };

  // ====== inline edit ======
  const setEdit = (r: CalcRow, field: "min_edit" | "max_edit", value: string) => {
    const v = value === "" ? null : Number(value);
    const cleaned = Number.isNaN(v as any) ? null : v;
    setRows(prev => prev.map(x =>
      x.sku_code === r.sku_code && x.store_name === r.store_name
        ? { ...x, [field]: cleaned }
        : x
    ));
    if (hasStaging) {
      setEditsMap(prev => {
        const next = new Map(prev);
        const key = rowKey(r);
        next.set(key, { ...next.get(key), [field]: cleaned });
        return next;
      });
    }
    setForceCal(prev => {
      const k = `${r.sku_code}|${r.store_name}`;
      const cur = prev[k] || {};
      const next = { ...cur, [field === "min_edit" ? "min" : "max"]: false };
      return { ...prev, [k]: next };
    });
  };

  // Keyboard nav: Enter/Arrow keys to move between editable cells
  const NAV_COLS = ["min_edit", "max_edit"] as const;
  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, col: typeof NAV_COLS[number]) => {
    const k = e.key;
    if (!["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(k)) return;
    e.preventDefault();
    let nextRow = rowIdx;
    let nextColIdx = NAV_COLS.indexOf(col);
    if (k === "Enter" || k === "ArrowDown") nextRow = Math.min(pageRows.length - 1, rowIdx + 1);
    else if (k === "ArrowUp") nextRow = Math.max(0, rowIdx - 1);
    else if (k === "ArrowLeft") nextColIdx = Math.max(0, nextColIdx - 1);
    else if (k === "ArrowRight") nextColIdx = Math.min(NAV_COLS.length - 1, nextColIdx + 1);
    const sel = `input[data-nav="r${nextRow}-c${NAV_COLS[nextColIdx]}"]`;
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el) { el.focus(); el.select(); }
  };

  const toggleSrc = (r: CalcRow, which: "min" | "max") => {
    if (r.from_doc) return;
    const k = `${r.sku_code}|${r.store_name}`;
    setForceCal(prev => {
      const cur = prev[k] || {};
      const useEditNow = (which === "min" ? r.min_edit != null && cur.min !== true : r.max_edit != null && cur.max !== true);
      const nextVal = useEditNow ? true : false;
      return { ...prev, [k]: { ...cur, [which]: nextVal } };
    });
  };

  const calcCount = useMemo(() => rows.filter(r => !r.from_doc).length, [rows]);
  const docCount = useMemo(() => rows.filter(r => r.from_doc).length, [rows]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">Min/Max Calculator</h1>
          <p className="text-xs text-muted-foreground">
            Data Control · คำนวณ Min/Max ต่อ SKU × Store · N = {nFactor}
            {rows.length > 0 && (
              <> · {rows.length.toLocaleString()} แถว
                {hasFilters && docCount > 0 && (
                  <> (Calc {calcCount.toLocaleString()} + Doc {docCount.toLocaleString()})</>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={loading ? "destructive" : "default"}
            onClick={() => {
              if (loading) {
                cancelCalcRef.current = true;
              } else {
                calculate(nFactor);
              }
            }}
            className="text-xs"
          >
            {loading ? (
              <>
                <X className="w-3.5 h-3.5 mr-1" /> Stop
              </>
            ) : (
              <>
                <Calculator className="w-3.5 h-3.5 mr-1" /> Calculate
              </>
            )}
          </Button>
          {(() => {
            const viewCount = storeFilter.length + skuFilter.length + barcodeFilter.length;
            const hasAnyFilter = viewCount > 0 || typeStoreFilter.length > 0 || itemTypeFilter.length > 0
              || buyingFilter.length > 0 || divisionFilter.length > 0 || departmentFilter.length > 0
              || subDeptFilter.length > 0 || classFilter.length > 0;
            return (
              <Button
                size="sm"
                variant="outline"
                onClick={handleView}
                disabled={viewLoading || viewPagingLoading || loading || !hasAnyFilter}
                className="text-xs"
                title={!hasAnyFilter ? "ใส่ Filter ก่อน (Store, SKU, Barcode ฯลฯ)" : "ดึงข้อมูล Min/Max ที่บันทึกไว้ตาม Filter"}
              >
                {viewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                View ({viewCount})
              </Button>
            );
          })()}
          <Button size="sm" variant="outline" onClick={() => { setNInput(String(nFactor)); setSetNOpen(true); }} className="text-xs">
            <Settings2 className="w-3.5 h-3.5 mr-1" /> Set N ({nFactor})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="text-xs" disabled={rows.length === 0}>
            <Upload className="w-3.5 h-3.5 mr-1" /> Import Min/Max
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs" disabled={rows.length === 0}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export Data <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => exportRows("page")}>
                <FileText className="w-3.5 h-3.5 mr-2" /> Export This Page ({pageRows.length.toLocaleString()})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRows("selected")} disabled={selectedKeys.size === 0}>
                <Tag className="w-3.5 h-3.5 mr-2" /> Export Selected ({selectedKeys.size.toLocaleString()})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportRows("all")}>
                <Download className="w-3.5 h-3.5 mr-2" /> Export All Filtered ({(hasStaging ? stagingFilteredCount : filtered.length).toLocaleString()})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="default" onClick={() => { setSaveName(fmtDocName()); setSaveOpen(true); }}
            disabled={rows.length === 0} className="text-xs">
            <Save className="w-3.5 h-3.5 mr-1" /> Save Doc
          </Button>
        </div>
      </div>

      {/* Phase Progress */}
      {(loading || viewLoading || phaseTimes.fetch != null) && (
        <div className="px-6 py-2 bg-muted/30 border-b border-border space-y-1">
          {(loading || viewLoading) && (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{phaseLabel || (viewLoading ? "กำลังโหลด View..." : "พร้อม")}</span>
                <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                  <span className="font-mono font-semibold text-primary text-sm">
                    {(elapsedMs / 1000).toFixed(1)} s
                  </span>
                  <span>{phasePct}%</span>
                </div>
              </div>
              <Progress value={phasePct} className="h-1.5" />
            </>
          )}
          <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap items-center">
            {phaseTimes.fetch != null && (
              <span className="font-medium">
                <span className="text-foreground">① Read Cal:</span> {phaseTimes.fetch}ms · {phaseTimes.readBatches ?? 0} batches → <span className="text-primary font-bold">{(phaseTimes.rowCount ?? 0).toLocaleString()}</span> แถว
              </span>
            )}
            {phaseTimes.merge != null && (
              <span className="font-medium">
                <span className="text-foreground">② Merge Doc:</span> {phaseTimes.merge}ms{(phaseTimes.docCount ?? 0) > 0 && <> · +<span className="text-amber-600 dark:text-amber-400 font-bold">{(phaseTimes.docCount ?? 0).toLocaleString()}</span> จาก Doc</>}
              </span>
            )}
            {(isServerPaging ? serverPagingTotal > 0 : rows.length > 0) && (
              <span className="font-medium ml-auto">
                <span className="text-foreground">③ แสดง:</span>{" "}
                <span className="text-primary font-bold">
                  {isServerPaging ? serverPagingTotal.toLocaleString() : filtered.length.toLocaleString()}
                </span>
                {" "}/ รวม {isServerPaging ? (hasStaging ? stagingTotal : viewPagingTotal).toLocaleString() : rows.length.toLocaleString()} แถว · หน้า {page + 1}/{totalPages} ({pageRows.length} แถวบนหน้านี้)
              </span>
            )}
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger value="calc" className="text-xs">Calc</TabsTrigger>
          <TabsTrigger value="report" className="text-xs">
            <BarChart3 className="w-3 h-3 mr-1" /> Report ({reportRows.length})
          </TabsTrigger>
          <TabsTrigger value="unitpick" className="text-xs">
            Unit Pick {upRows.length > 0 && `(${upRows.length})`}
          </TabsTrigger>
        </TabsList>

        {/* ============== Calc TAB ============== */}
        <TabsContent value="calc" className="flex-1 flex flex-col overflow-hidden mt-2 data-[state=inactive]:hidden">
          {/* Filter Row */}
          <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            <MultiSelectFilter
              label="Store"
              icon={<Store className="w-3 h-3 mr-1" />}
              options={filterOpts.stores.map(s => s.store_name)}
              selected={storeFilter}
              onChange={setStoreFilter}
              width="w-80"
            />
            <MultiSelectFilter
              label="Type Store"
              icon={<Layers className="w-3 h-3 mr-1" />}
              options={filterOpts.types}
              selected={typeStoreFilter}
              onChange={setTypeStoreFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Item Type"
              icon={<Tag className="w-3 h-3 mr-1" />}
              options={filterOpts.itemTypes}
              selected={itemTypeFilter}
              onChange={setItemTypeFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Buying Status"
              icon={<Activity className="w-3 h-3 mr-1" />}
              options={filterOpts.buyingStatuses}
              selected={buyingFilter}
              onChange={setBuyingFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Division"
              options={filterOpts.divisions}
              selected={divisionFilter}
              onChange={setDivisionFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Department"
              options={filterOpts.departments}
              selected={departmentFilter}
              onChange={setDepartmentFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Sub-Department"
              options={filterOpts.subDepartments}
              selected={subDeptFilter}
              onChange={setSubDeptFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Class"
              options={filterOpts.classes}
              selected={classFilter}
              onChange={setClassFilter}
              width="w-56"
            />
            <Input
              placeholder="SKU Code (คั่นด้วย ,)"
              className="h-7 text-xs w-48"
              defaultValue={skuFilter.join(",")}
              onBlur={(e) => {
                const arr = e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                setSkuFilter(arr);
              }}
            />
            <Input
              placeholder="Barcode (คั่นด้วย ,)"
              className="h-7 text-xs w-48"
              defaultValue={barcodeFilter.join(",")}
              onBlur={(e) => {
                const arr = e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                setBarcodeFilter(arr);
              }}
            />
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => {
                  setStoreFilter([]); setTypeStoreFilter([]); setItemTypeFilter([]); setBuyingFilter([]);
                  setDivisionFilter([]); setDepartmentFilter([]); setSubDeptFilter([]); setClassFilter([]);
                  setSkuFilter([]); setBarcodeFilter([]);
                }}>
                <X className="w-3 h-3 mr-1" /> Clear Filters
              </Button>
            )}
            {(hasStaging || hasViewPaging) && (
              <Button size="sm" variant="default" className="h-7 text-xs ml-auto"
                disabled={stagingLoading || viewPagingLoading}
                onClick={() => hasStaging ? loadStagingPage(0) : loadViewPage(0)}>
                {(stagingLoading || viewPagingLoading) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Eye className="w-3 h-3 mr-1" />}
                Show
              </Button>
            )}
            {!hasStaging && hasFilters && (
              <Badge variant="outline" className="text-[10px] ml-auto">
                💡 Calc เฉพาะที่ Filter · ที่เหลือดึงจาก Doc ล่าสุด (เมื่อ Calculate)
              </Badge>
            )}
          </div>

          {/* Odoo-style Search */}
          <div className="px-6 pb-2 flex items-center gap-2 flex-wrap bg-muted/20 mx-6 rounded-md py-2 mb-2">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {searchChips.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs gap-1 pl-2 pr-1 py-0.5">
                <span className="font-medium">{c.label}:</span>
                <span className="font-semibold">{c.value}</span>
                <button onClick={() => setSearchChips(p => p.filter((_, idx) => idx !== i))}
                  className="ml-0.5 hover:bg-destructive/20 rounded p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            <div className="relative flex-1 min-w-[200px]">
              <Input
                ref={searchInputRef}
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                placeholder="พิมพ์เพื่อค้นหา..."
                value={searchValue}
                onChange={e => { setSearchValue(e.target.value); setShowSearchDropdown(true); setPage(0); }}
                onFocus={() => setShowSearchDropdown(true)}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
              />
              {showSearchDropdown && searchValue.trim() && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg w-80 max-h-80 overflow-y-auto">
                  {SEARCH_COLUMNS.map(col => (
                    <button
                      key={col.key}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-primary/10 text-left transition-colors"
                      onClick={() => addSearchChip(col.key)}
                    >
                      <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span>Search <span className="font-semibold text-primary">{col.label}</span> for: <span className="font-mono">{searchValue}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(searchChips.length > 0 || searchValue) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setSearchChips([]); setSearchValue(""); setPage(0); }}>
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
            {filtered.length > 0 && (
              <span className="text-xs text-muted-foreground">
                แสดง {Math.min(filtered.length, (page + 1) * PAGE_SIZE).toLocaleString()} / {filtered.length.toLocaleString()}
              </span>
            )}
          </div>

          {/* Table with frozen header */}
          <div className="flex-1 overflow-hidden px-6 pb-3">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> กำลังคำนวณ...
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Calculator className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">กดปุ่ม "Calculate" เพื่อคำนวณ Min/Max</p>
              </div>
            ) : (
              <div className="border border-border rounded-md overflow-auto h-full">
                <table className="text-xs w-full border-collapse">
                  <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-2 py-1.5 w-8 border-b border-border bg-muted">
                        <Checkbox
                          checked={pageRows.length > 0 && pageRows.every(r => selectedKeys.has(rowKey(r)))}
                          onCheckedChange={(v) => {
                            setSelectedKeys(prev => {
                              const next = new Set(prev);
                              if (v) pageRows.forEach(r => next.add(rowKey(r)));
                              else pageRows.forEach(r => next.delete(rowKey(r)));
                              return next;
                            });
                          }}
                        />
                      </th>
                      {[
                        "SKU Code", "Product Name", "Store", "Type", "Size", "Item Type", "Buying",
                        "Pack", "Box", "Unit Pick",
                        "Avg Sale", "Rank", "Min Cal", "Max Cal", "Min Edit", "Max Edit", "Min", "Max", "DOH Min", "DOH Max", "Source",
                      ].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap bg-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => {
                      const f = getFinal(r);
                      return (
                        <tr key={`${r.sku_code}|${r.store_name}|${i}`}
                          className={cn(
                            "hover:bg-muted/30 border-b border-border/40",
                            r.from_doc && "bg-amber-50/30 dark:bg-amber-950/10",
                            selectedKeys.has(rowKey(r)) && "bg-primary/5"
                          )}>
                          <td className="px-2 py-1 w-8">
                            <Checkbox
                              checked={selectedKeys.has(rowKey(r))}
                              onCheckedChange={(v) => {
                                setSelectedKeys(prev => {
                                  const next = new Set(prev);
                                  const k = rowKey(r);
                                  if (v) next.add(k); else next.delete(k);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">{r.sku_code}</td>
                          <td className="px-2 py-1 max-w-[260px] truncate" title={r.product_name_la || r.product_name_en || ""}>
                            {r.product_name_la || r.product_name_en}
                          </td>
                          <td className="px-2 py-1">{r.store_name}</td>
                          <td className="px-2 py-1">{r.type_store}</td>
                          <td className="px-2 py-1">{r.size_store}</td>
                          <td className="px-2 py-1 text-[10px]">{r.item_type}</td>
                          <td className="px-2 py-1 text-[10px]">{r.buying_status}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.pack_qty ?? "-"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.box_qty ?? "-"}</td>
                          <td className="px-2 py-1 text-right">{r.unit_pick}</td>
                          <td className="px-2 py-1 text-right">{r.avg_sale.toFixed(2)}</td>
                          <td className="px-2 py-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {r.rank_sale}·{r.rank_factor}
                            </Badge>
                          </td>
                          <td className={cn("px-2 py-1 text-right tabular-nums",
                            r.is_default_min && "text-warning",
                            r.min_floored && "text-sky-600 dark:text-sky-400 font-semibold")}
                            title={r.min_floored ? "ปัดขึ้นเป็น 3 (avg×rank < 3)" : undefined}>
                            {r.min_cal}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.max_cal}</td>
                          <td className="px-2 py-1 w-20">
                            <Input
                              type="number" value={r.min_edit ?? ""}
                              disabled={r.from_doc}
                              data-nav={`r${i}-cmin_edit`}
                              onChange={(e) => setEdit(r, "min_edit", e.target.value)}
                              onKeyDown={(e) => handleEditKeyDown(e, i, "min_edit")}
                              className="h-6 text-xs px-1 text-right"
                            />
                          </td>
                          <td className="px-2 py-1 w-20">
                            <Input
                              type="number" value={r.max_edit ?? ""}
                              disabled={r.from_doc}
                              data-nav={`r${i}-cmax_edit`}
                              onChange={(e) => setEdit(r, "max_edit", e.target.value)}
                              onKeyDown={(e) => handleEditKeyDown(e, i, "max_edit")}
                              className="h-6 text-xs px-1 text-right"
                            />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <button onClick={() => toggleSrc(r, "min")}
                              className={cn("px-1.5 py-0.5 rounded font-semibold w-full text-right",
                                f.minSrc === "edit" ? "bg-primary/15 text-primary" :
                                f.minSrc === "doc" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                                "bg-muted")}
                              title={`${f.minSrc.toUpperCase()}`}>
                              {f.min}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <button onClick={() => toggleSrc(r, "max")}
                              className={cn("px-1.5 py-0.5 rounded font-semibold w-full text-right",
                                f.maxSrc === "edit" ? "bg-primary/15 text-primary" :
                                f.maxSrc === "doc" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                                "bg-muted")}
                              title={`${f.maxSrc.toUpperCase()}`}>
                              {f.max}
                            </button>
                          </td>
                          {(() => {
                            const avg = Number(r.avg_sale) || 0;
                            const dohMin = avg > 0 ? f.min / avg : 0;
                            const dohMax = avg > 0 ? f.max / avg : 0;
                            const cellCls = "px-2 py-1 text-right tabular-nums";
                            const noSale = "text-muted-foreground italic text-[10px]";
                            return (
                              <>
                                <td className={cn(cellCls, dohMin === 0 && noSale)}>
                                  {dohMin === 0 ? "No Sales" : dohMin.toFixed(1)}
                                </td>
                                <td className={cn(cellCls, dohMax === 0 && noSale)}>
                                  {dohMax === 0 ? "No Sales" : dohMax.toFixed(1)}
                                </td>
                              </>
                            );
                          })()}
                          <td className="px-2 py-1 text-[10px]">
                            {r.from_doc ? (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300">Doc</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-4 px-1">Calc</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(isServerPaging ? serverPagingTotal > PAGE_SIZE : filtered.length > PAGE_SIZE) && (
            <div className="px-6 py-2 border-t border-border flex items-center justify-between bg-card">
              <span className="text-xs text-muted-foreground">หน้า {page + 1} / {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline"
                  disabled={page === 0 || stagingLoading || viewPagingLoading}
                  onClick={() => {
                    if (hasStaging) loadStagingPage(page - 1);
                    else if (hasViewPaging) loadViewPage(page - 1);
                    else setPage(p => p - 1);
                  }}
                  className="h-7 text-xs">ก่อนหน้า</Button>
                <Button size="sm" variant="outline"
                  disabled={page >= totalPages - 1 || stagingLoading || viewPagingLoading}
                  onClick={() => {
                    if (hasStaging) loadStagingPage(page + 1);
                    else if (hasViewPaging) loadViewPage(page + 1);
                    else setPage(p => p + 1);
                  }}
                  className="h-7 text-xs">ถัดไป</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============== REPORT TAB ============== */}
        <TabsContent value="report" className="flex-1 min-h-0 flex flex-col overflow-hidden px-6 !mt-2 data-[state=inactive]:hidden data-[state=active]:flex">
          {/* Filter Row (mirrors Calc) */}
          <div className="pb-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            <MultiSelectFilter label="Store" icon={<Store className="w-3 h-3 mr-1" />}
              options={filterOpts.stores.map(s => s.store_name)} selected={docStoreFilter} onChange={setDocStoreFilter} width="w-80" />
            <MultiSelectFilter label="Type Store" icon={<Layers className="w-3 h-3 mr-1" />}
              options={filterOpts.types} selected={docTypeFilter} onChange={setDocTypeFilter} width="w-56" />
            <MultiSelectFilter label="Item Type" icon={<Tag className="w-3 h-3 mr-1" />}
              options={filterOpts.itemTypes} selected={docItemTypeFilter} onChange={setDocItemTypeFilter} width="w-56" />
            <MultiSelectFilter label="Buying Status" icon={<Activity className="w-3 h-3 mr-1" />}
              options={filterOpts.buyingStatuses} selected={docBuyingFilter} onChange={setDocBuyingFilter} width="w-56" />
            <MultiSelectFilter label="Division" options={filterOpts.divisions} selected={docDivisionFilter} onChange={setDocDivisionFilter} width="w-56" />
            <MultiSelectFilter label="Department" options={filterOpts.departments} selected={docDepartmentFilter} onChange={setDocDepartmentFilter} width="w-56" />
            <MultiSelectFilter label="Sub-Department" options={filterOpts.subDepartments} selected={docSubDeptFilter} onChange={setDocSubDeptFilter} width="w-56" />
            <MultiSelectFilter label="Class" options={filterOpts.classes} selected={docClassFilter} onChange={setDocClassFilter} width="w-56" />
            {(docStoreFilter.length + docTypeFilter.length + docItemTypeFilter.length + docBuyingFilter.length + docDivisionFilter.length + docDepartmentFilter.length + docSubDeptFilter.length + docClassFilter.length) > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setDocStoreFilter([]); setDocTypeFilter([]); setDocItemTypeFilter([]); setDocBuyingFilter([]); setDocDivisionFilter([]); setDocDepartmentFilter([]); setDocSubDeptFilter([]); setDocClassFilter([]); }}>
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {canDelete && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  disabled={!hasReportFilter || deleting || reportLoading}
                  title={!hasReportFilter ? "เลือก Filter ก่อนกด Delete" : "ลบ Min/Max ตาม Filter ปัจจุบัน"}
                  className="text-xs h-7"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={loadReport} disabled={reportLoading} className="text-xs h-7">
                <RotateCcw className={cn("w-3.5 h-3.5 mr-1", reportLoading && "animate-spin")} /> Refresh
              </Button>
              <Button size="sm" variant={exportingReport ? "destructive" : "default"}
                onClick={() => { if (exportingReport) { cancelExportRef.current = true; } else { exportReportExcel(); } }}
                disabled={!exportingReport && reportRows.length === 0} className="text-xs h-7">
                {exportingReport ? (
                  <><StopCircle className="w-3.5 h-3.5 mr-1" /> Stop · {exportProgress.label || "..."}</>
                ) : (
                  <><Download className="w-3.5 h-3.5 mr-1" /> Export Excel</>
                )}
              </Button>
            </div>
          </div>

          {(() => {
            // Group reportRows: Store → Division → Department
            type Row = typeof reportRows[number];
            const storeMap = new Map<string, { type_store: string; divs: Map<string, Row[]> }>();
            for (const r of reportRows) {
              if (!storeMap.has(r.store_name)) storeMap.set(r.store_name, { type_store: r.type_store, divs: new Map() });
              const s = storeMap.get(r.store_name)!;
              if (!s.divs.has(r.division)) s.divs.set(r.division, []);
              s.divs.get(r.division)!.push(r);
            }
            const grandSku = reportRows.reduce((a, b) => a + b.sku_count, 0);
            const grandMin = reportRows.reduce((a, b) => a + b.sum_min, 0);
            const grandMax = reportRows.reduce((a, b) => a + b.sum_max, 0);
            const storeCount = storeMap.size;

            if (reportLoading) return (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-50" />
                <p className="text-sm">กำลังโหลดสรุป...</p>
              </div>
            );
            if (reportRows.length === 0) return (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">ยังไม่มีข้อมูล Min/Max ใน View</p>
              </div>
            );

            const sortedStores = [...storeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

            return (
              <div className="flex-1 min-h-0 overflow-auto border border-border rounded-md">
                <table className="text-xs w-full">
                  <thead className="bg-muted sticky top-0 z-20 shadow-sm">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold w-[40%]">Store / Division / Department</th>
                      <th className="px-3 py-2 text-left font-semibold">Type Store</th>
                      <th className="px-3 py-2 text-right font-semibold">SKU Count</th>
                      <th className="px-3 py-2 text-right font-semibold">Sum Min</th>
                      <th className="px-3 py-2 text-right font-semibold">Sum Max (Qty)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStores.map(([storeName, { type_store, divs }]) => {
                      const storeOpen = expandedDiv.has(storeName);
                      const allRows = [...divs.values()].flat();
                      const sSku = allRows.reduce((a, b) => a + b.sku_count, 0);
                      const sMin = allRows.reduce((a, b) => a + b.sum_min, 0);
                      const sMax = allRows.reduce((a, b) => a + b.sum_max, 0);
                      const sortedDivs = [...divs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                      return (
                        <Fragment key={storeName}>
                          <tr className="bg-primary/5 border-t-2 border-border hover:bg-primary/10 cursor-pointer"
                            onClick={() => setExpandedDiv(p => { const n = new Set(p); n.has(storeName) ? n.delete(storeName) : n.add(storeName); return n; })}>
                            <td className="px-3 py-1.5 font-bold">
                              <span className="inline-flex items-center gap-1">
                                {storeOpen ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                🏬 {storeName}
                                <span className="text-[10px] text-muted-foreground font-normal ml-1">({sortedDivs.length} Div · {allRows.length} Dept)</span>
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-[11px]">{type_store}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-bold">{sSku.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-bold">{sMin.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-bold">{sMax.toLocaleString()}</td>
                          </tr>
                          {storeOpen && sortedDivs.map(([divName, depts]) => {
                            const divKey = `${storeName}|${divName}`;
                            const divOpen = expandedDept.has(divKey);
                            const dSku = depts.reduce((a, b) => a + b.sku_count, 0);
                            const dMin = depts.reduce((a, b) => a + b.sum_min, 0);
                            const dMax = depts.reduce((a, b) => a + b.sum_max, 0);
                            const sortedDepts = [...depts].sort((a, b) => a.department.localeCompare(b.department));
                            return (
                              <Fragment key={divKey}>
                                <tr className="bg-muted/40 hover:bg-muted/60 cursor-pointer"
                                  onClick={() => setExpandedDept(p => { const n = new Set(p); n.has(divKey) ? n.delete(divKey) : n.add(divKey); return n; })}>
                                  <td className="px-3 py-1.5 font-semibold pl-8">
                                    <span className="inline-flex items-center gap-1">
                                      {divOpen ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                      📁 {divName}
                                      <span className="text-[10px] text-muted-foreground font-normal ml-1">({sortedDepts.length} Dept)</span>
                                    </span>
                                  </td>
                                  <td></td>
                                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{dSku.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{dMin.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{dMax.toLocaleString()}</td>
                                </tr>
                                {divOpen && sortedDepts.map(d => (
                                  <tr key={`${divKey}|${d.department}`} className="hover:bg-muted/20">
                                    <td className="px-3 py-1 text-[11px] pl-14">📂 {d.department}</td>
                                    <td></td>
                                    <td className="px-3 py-1 text-right tabular-nums">{d.sku_count.toLocaleString()}</td>
                                    <td className="px-3 py-1 text-right tabular-nums">{d.sum_min.toLocaleString()}</td>
                                    <td className="px-3 py-1 text-right tabular-nums">{d.sum_max.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted sticky bottom-0 border-t-2 border-border">
                    <tr>
                      <td className="px-3 py-2 font-bold" colSpan={2}>Grand Total ({storeCount} Stores)</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{grandSku.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{grandMin.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{grandMax.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}
        </TabsContent>

        {/* ============== UNIT PICK TAB ============== */}
        <TabsContent value="unitpick" className="flex-1 min-h-0 flex flex-col overflow-hidden px-6 !mt-2 data-[state=inactive]:hidden data-[state=active]:flex">
          {/* Toolbar row 1: action buttons */}
          {(() => {
            const upHasFilter = upSearch.trim() !== "" || upFilterSize.length > 0 || upFilterDiv.length > 0 || upFilterDept.length > 0 || upFilterSubDept.length > 0;
            return (
          <div className="pb-1 flex items-center gap-2 flex-wrap">
            <Button size="sm" className="text-xs h-7 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => { setUpPage(0); loadUPRows(false); }}
              disabled={upLoading || !upHasFilter}
              title={!upHasFilter ? "ใส่ Filter หรือพิมพ์ค้นหาก่อนกด Show" : "ดึงข้อมูลจาก DB"}>
              {upLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
              Show
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7"
              onClick={() => upFileRef.current?.click()}
              disabled={upImporting}>
              {upImporting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
              Import Upsert
            </Button>
            <input ref={upFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importUnitPickExcel} />
            <Button size="sm" variant="outline" className="text-xs h-7"
              onClick={() => {
                const ws = XLSX.utils.json_to_sheet([{ sku_code: "", barcode: "", size_store: "Super", unit_pick: "" }, { sku_code: "", barcode: "", size_store: "Mini", unit_pick: "" }]);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "UnitPick_Import");
                XLSX.writeFile(wb, "unit_pick_import_template.xlsx");
              }}>
              <Download className="w-3.5 h-3.5 mr-1" /> Download Template
            </Button>
            <Button size="sm" variant="destructive" className="text-xs h-7"
              onClick={deleteUPSelected}
              disabled={upSelected.size === 0}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete ({upSelected.size})
            </Button>
            {upHasLoaded && upRows.length > 0 && (() => {
              const q = upSearch.trim().toLowerCase();
              const filtered = upRows.filter(r => {
                if (upFilterSize.length && !upFilterSize.includes(r.size_store)) return false;
                if (upFilterDiv.length && !upFilterDiv.includes(r.division ?? "")) return false;
                if (upFilterDept.length && !upFilterDept.includes(r.department ?? "")) return false;
                if (upFilterSubDept.length && !upFilterSubDept.includes(r.sub_department ?? "")) return false;
                if (q) return r.sku_code.toLowerCase().includes(q) || r.size_store.toLowerCase().includes(q) || (r.main_barcode || "").toLowerCase().includes(q) || (r.product_name_la || "").toLowerCase().includes(q) || (r.product_name_en || "").toLowerCase().includes(q);
                return true;
              });
              const exportToXlsx = (exportRows: UPRow[], filename: string) => {
                const data = exportRows.map(r => ({
                  "Size Store": r.size_store,
                  "SKU Code": r.sku_code,
                  "Barcode": r.main_barcode ?? "",
                  "Product Name (LA)": r.product_name_la ?? "",
                  "Product Name (EN)": r.product_name_en ?? "",
                  "Division": r.division ?? "",
                  "Department": r.department ?? "",
                  "Sub Dept": r.sub_department ?? "",
                  "Pack": r.pack_qty ?? "",
                  "Box": r.box_qty ?? "",
                  "Unit Pick": r.unit_pick,
                }));
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "UnitPick");
                XLSX.writeFile(wb, filename);
              };
              const selectedRows = upRows.filter(r => upSelected.has(`${r.sku_code}|${r.size_store}`));
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="text-xs h-7">
                      <Download className="w-3.5 h-3.5 mr-1" /> Export <ChevronDown className="w-3 h-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem className="text-xs" onClick={() => exportToXlsx(filtered, "unit_pick_page.xlsx")}>
                      Export this page ({filtered.length.toLocaleString()} แถว)
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" disabled={selectedRows.length === 0} onClick={() => exportToXlsx(selectedRows, "unit_pick_selected.xlsx")}>
                      Export selected ({selectedRows.length.toLocaleString()} แถว)
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" onClick={() => exportToXlsx(upRows, "unit_pick_all.xlsx")}>
                      Export all ({upRows.length.toLocaleString()} แถว)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}
          </div>
            );
          })()}

          {/* Toolbar row 2: filters + search */}
          {(() => {
            const allSizes = ["Mini", "Super"];
            const allDivs = [...new Set(upRows.map(r => r.division).filter(Boolean) as string[])].sort();
            const allDepts = [...new Set(upRows.map(r => r.department).filter(Boolean) as string[])].sort();
            const allSubDepts = [...new Set(upRows.map(r => r.sub_department).filter(Boolean) as string[])].sort();
            return (
              <div className="pb-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">Filter:</span>
                <MultiSelectFilter label="Size" icon={<Layers className="w-3 h-3 mr-1" />}
                  options={allSizes} selected={upFilterSize} onChange={setUpFilterSize} width="w-44" />
                <MultiSelectFilter label="Division" icon={<Tag className="w-3 h-3 mr-1" />}
                  options={allDivs} selected={upFilterDiv} onChange={setUpFilterDiv} width="w-52" />
                <MultiSelectFilter label="Department" options={allDepts} selected={upFilterDept} onChange={setUpFilterDept} width="w-52" />
                <MultiSelectFilter label="Sub Dept" options={allSubDepts} selected={upFilterSubDept} onChange={setUpFilterSubDept} width="w-52" />
                {(upFilterSize.length || upFilterDiv.length || upFilterDept.length || upFilterSubDept.length) ? (
                  <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={() => { setUpFilterSize([]); setUpFilterDiv([]); setUpFilterDept([]); setUpFilterSubDept([]); }}>
                    <X className="w-3 h-3" /> Clear
                  </button>
                ) : null}
                <div className="flex-1" />
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={upSearch}
                    onChange={e => setUpSearch(e.target.value)}
                    placeholder="SKU / Barcode / ชื่อสินค้า / Store..."
                    className="pl-7 h-7 text-xs w-72"
                  />
                  {upSearch && (
                    <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setUpSearch("")}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Table */}
          <div className="flex-1 overflow-auto border border-border rounded-md">
            {upLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-5 h-5 animate-spin" /> กำลังโหลด...
              </div>
            ) : !upHasLoaded ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Database className="w-8 h-8 opacity-30" />
                <p className="text-sm">กด <span className="font-semibold text-blue-600">Show</span> เพื่อดึงข้อมูลจาก DB</p>
                <p className="text-xs opacity-60">สามารถ Filter ก่อนกด Show เพื่อแสดงเฉพาะข้อมูลที่ต้องการ</p>
              </div>
            ) : (() => {
              const q = upSearch.trim().toLowerCase();
              const filtered = upRows.filter(r => {
                if (upFilterSize.length && !upFilterSize.includes(r.size_store)) return false;
                if (upFilterDiv.length && !upFilterDiv.includes(r.division ?? "")) return false;
                if (upFilterDept.length && !upFilterDept.includes(r.department ?? "")) return false;
                if (upFilterSubDept.length && !upFilterSubDept.includes(r.sub_department ?? "")) return false;
                if (q) {
                  return r.sku_code.toLowerCase().includes(q) ||
                    r.size_store.toLowerCase().includes(q) ||
                    (r.main_barcode || "").toLowerCase().includes(q) ||
                    (r.product_name_la || "").toLowerCase().includes(q) ||
                    (r.product_name_en || "").toLowerCase().includes(q);
                }
                return true;
              });
              const totalPages = Math.max(1, Math.ceil(filtered.length / UP_PAGE_SIZE));
              const safePage = Math.min(upPage, totalPages - 1);
              const pageRows = filtered.slice(safePage * UP_PAGE_SIZE, (safePage + 1) * UP_PAGE_SIZE);
              const missingCount = filtered.filter(r => !r.main_barcode).length;
              return (
                <>
                  <div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border bg-muted/50 flex items-center gap-3">
                    <span>กรอง {filtered.length.toLocaleString()} / {upRows.length.toLocaleString()} แถว</span>
                    {upSelected.size > 0 && <span className="text-primary font-medium">· เลือก {upSelected.size} แถว</span>}
                    {missingCount > 0 && <span className="text-amber-600 font-medium">⚠ {missingCount} แถวไม่พบใน range_store_view</span>}
                    <div className="flex-1" />
                    <span>หน้า {safePage + 1} / {totalPages}</span>
                    <button
                      className="px-1.5 py-0.5 rounded border border-border text-[11px] hover:bg-muted disabled:opacity-40"
                      disabled={safePage === 0}
                      onClick={() => setUpPage(p => Math.max(0, p - 1))}>
                      ◀ Prev
                    </button>
                    <button
                      className="px-1.5 py-0.5 rounded border border-border text-[11px] hover:bg-muted disabled:opacity-40"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setUpPage(p => Math.min(totalPages - 1, p + 1))}>
                      Next ▶
                    </button>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 w-8 border-b border-border bg-muted">
                          <Checkbox
                            checked={pageRows.length > 0 && pageRows.every(r => upSelected.has(`${r.sku_code}|${r.size_store}`))}
                            onCheckedChange={v => {
                              setUpSelected(prev => {
                                const next = new Set(prev);
                                if (v) pageRows.forEach(r => next.add(`${r.sku_code}|${r.size_store}`));
                                else pageRows.forEach(r => next.delete(`${r.sku_code}|${r.size_store}`));
                                return next;
                              });
                            }}
                          />
                        </th>
                        {["Size Store", "SKU Code", "Barcode", "Product Name (LA)", "Product Name (EN)", "Division", "Department", "Sub Dept", "Pack", "Box", "Unit Pick"].map(h => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap bg-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">ไม่มีข้อมูล</td></tr>
                      ) : pageRows.map(r => {
                        const key = `${r.sku_code}|${r.size_store}`;
                        return (
                          <tr key={key} className={cn("border-b border-border/40 hover:bg-muted/30", upSelected.has(key) && "bg-primary/5", !r.main_barcode && "bg-amber-50/60 dark:bg-amber-950/20")}>
                            <td className="px-2 py-1 w-8">
                              <Checkbox
                                checked={upSelected.has(key)}
                                onCheckedChange={v => {
                                  setUpSelected(prev => {
                                    const next = new Set(prev);
                                    if (v) next.add(key); else next.delete(key);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="px-2 py-1 text-[11px] font-medium">{r.size_store}</td>
                            <td className="px-2 py-1 font-mono">{r.sku_code}</td>
                            <td className="px-2 py-1 font-mono text-muted-foreground">{r.main_barcode ?? "-"}</td>
                            <td className="px-2 py-1 max-w-[180px] truncate" title={r.product_name_la ?? ""}>{r.product_name_la ?? "-"}</td>
                            <td className="px-2 py-1 max-w-[180px] truncate" title={r.product_name_en ?? ""}>{r.product_name_en ?? "-"}</td>
                            <td className="px-2 py-1 text-[11px]">{r.division ?? "-"}</td>
                            <td className="px-2 py-1 text-[11px]">{r.department ?? "-"}</td>
                            <td className="px-2 py-1 text-[11px]">{r.sub_department ?? "-"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.pack_qty ?? "-"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.box_qty ?? "-"}</td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums">{r.unit_pick}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>

          {/* Import hint */}
          <p className="text-[11px] text-muted-foreground mt-1">
            ไฟล์ Excel ต้องมีคอลัมน์: <code>size_store</code> (Super / Mini), <code>unit_pick</code> และ <code>sku_code</code> หรือ <code>barcode</code>
          </p>
        </TabsContent>
      </Tabs>

      {/* ===== Set N dialog ===== */}
      <Dialog open={setNOpen} onOpenChange={setSetNOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Set N (ตัวคูณ Avg Sale สำหรับ Max Cal)</DialogTitle>
            <DialogDescription>สูตร Max = RoundUp((Min + Avg × N) / UnitPick) × UnitPick</DialogDescription>
          </DialogHeader>
          <Input type="number" value={nInput} onChange={e => setNInput(e.target.value)} className="text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetNOpen(false)}>ยกเลิก</Button>
            <Button onClick={() => {
              const v = Number(nInput);
              if (!Number.isFinite(v) || v <= 0) {
                toast({ title: "ค่า N ไม่ถูกต้อง", variant: "destructive" }); return;
              }
              setNFactor(v); setSetNOpen(false);
              if (rows.length > 0) calculate(v);
            }}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Import dialog ===== */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Import Min/Max</DialogTitle>
            <DialogDescription>
              ไฟล์ Excel ต้องมีคอลัมน์: <code>sku_code</code>, <code>min_qty</code>, <code>max_qty</code>
              (ใส่ <code>store_name</code> เพิ่มเพื่อระบุร้าน ถ้าไม่ใส่จะ apply ทุกร้านของ SKU นั้น)
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={exportTemplate} className="text-xs self-start">
              <Download className="w-3.5 h-3.5 mr-1" /> Download Template
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="text-xs" />
            <p className="text-[11px] text-muted-foreground">
              * ต้องกด Calculate ก่อนเพื่อให้มีรายการในตาราง แล้วค่อย Import จะนำไปอัปเดตช่อง Min Edit / Max Edit
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Save dialog ===== */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Save Document</DialogTitle>
            <DialogDescription>
              SRR จะดึงค่า Min/Max จาก Doc ล่าสุด · บันทึก {rows.length.toLocaleString()} แถว
              {hasFilters && docCount > 0 && (
                <> ({calcCount.toLocaleString()} จาก Calc + {docCount.toLocaleString()} จาก Doc เดิม)</>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input value={saveName} onChange={e => setSaveName(e.target.value)} className="text-sm font-mono" disabled={saving} />
          {saving && (
            <div className="space-y-2 bg-muted px-3 py-2.5 rounded border border-border">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Step {saveStep.idx}/{saveStep.total}{saveStep.label ? ` · ${saveStep.label}` : ""}
                </span>
                <span className="font-mono tabular-nums text-primary font-semibold">{savePct}%</span>
              </div>
              <div className="h-2 w-full bg-background rounded overflow-hidden border border-border">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${savePct}%` }}
                />
              </div>
              {saveStatus && (
                <div className="text-[11px] text-muted-foreground leading-relaxed">{saveStatus}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={saveDoc} disabled={saving}>{saving ? "กำลังบันทึก..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Filtered Min/Max confirm */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" /> ลบ Min/Max ตาม Filter
            </DialogTitle>
            <DialogDescription>
              ระบบจะลบแถวใน Min/Max ที่ตรงกับ Filter ปัจจุบันออกจากฐานข้อมูล (ไม่สามารถกู้คืนได้)
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs space-y-1 bg-muted/40 rounded p-3">
            {docStoreFilter.length > 0 && <div><span className="font-semibold">Store:</span> {docStoreFilter.join(", ")}</div>}
            {docTypeFilter.length > 0 && <div><span className="font-semibold">Type Store:</span> {docTypeFilter.join(", ")}</div>}
            {docItemTypeFilter.length > 0 && <div><span className="font-semibold">Item Type:</span> {docItemTypeFilter.join(", ")}</div>}
            {docBuyingFilter.length > 0 && <div><span className="font-semibold">Buying Status:</span> {docBuyingFilter.join(", ")}</div>}
            {docDivisionFilter.length > 0 && <div><span className="font-semibold">Division:</span> {docDivisionFilter.join(", ")}</div>}
            {docDepartmentFilter.length > 0 && <div><span className="font-semibold">Department:</span> {docDepartmentFilter.join(", ")}</div>}
            {docSubDeptFilter.length > 0 && <div><span className="font-semibold">Sub-Department:</span> {docSubDeptFilter.join(", ")}</div>}
            {docClassFilter.length > 0 && <div><span className="font-semibold">Class:</span> {docClassFilter.join(", ")}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDeleteFiltered} disabled={deleting || !hasReportFilter}>
              {deleting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> กำลังลบ...</> : <><Trash2 className="w-4 h-4 mr-1" /> ยืนยันลบ</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
