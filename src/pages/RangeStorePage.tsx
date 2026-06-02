import { useEffect, useMemo, useState, useRef, Fragment, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Upload, RefreshCw, Search, Save, Download, FileText, Eye, Trash2, Columns3, Store, Eraser, ChevronLeft, ChevronRight, Building2, X, Pencil, Filter, Play, Database, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { useAuth } from "@/hooks/useAuth";

type SearchFilter = { column: string; value: string };

const SEARCH_COL_LABEL: Record<string, string> = {
  sku_code: "SKU Code",
  main_barcode: "Barcode",
  product_name_la: "Name (LA)",
  product_name_en: "Name (EN)",
  buyer_code: "Buyer Code",
  gm_buyer_code: "GM Buyer",
  product_owner: "Product Owner",
};
const SEARCHABLE_COLS = Object.keys(SEARCH_COL_LABEL);

type Row = Record<string, any>;
interface RangeCell { apply_yn: string; min_display: number | null; unit_picking_super: number | null; unit_picking_mart: number | null }

const COL_GROUPS = {
  master: { label: "Master Info", fields: ["division_group", "division", "department", "sub_department", "class", "gm_buyer_code", "buyer_code", "product_owner", "product_bu", "sku_code", "main_barcode", "product_name_la", "product_name_en"] },
  packbox: { label: "Barcode / Pack", fields: ["barcode_pack", "pack_qty", "barcode_box", "box_qty", "unit_of_measure", "packing_size_qty"] },
  price: { label: "Price", fields: ["standard_price", "list_price"] },
  status: { label: "Item Status", fields: ["item_status", "item_type", "buying_status", "rank_sale"] },
  unit_pick: { label: "Unit Picking", fields: ["unit_picking_super", "unit_picking_mart"] },
  avg_type: { label: "Avg Sales (by Type)", fields: ["avg_jmart", "avg_kokkok", "avg_kokkok_fc", "avg_udee", "store_apply"] },
  per_store: { label: "Per-Store (Range)", fields: ["per_store"] },
} as const;

type GroupKey = keyof typeof COL_GROUPS;

const COL_LABEL: Record<string, string> = {
  division_group: "Division Group", division: "Division", department: "Department", sub_department: "Sub-Dept",
  class: "Class", gm_buyer_code: "GM Buyer", buyer_code: "Buyer", product_owner: "Owner", product_bu: "BU",
  sku_code: "SKU", main_barcode: "Barcode", product_name_la: "Name (LA)", product_name_en: "Name (EN)",
  barcode_pack: "BC Pack", pack_qty: "Pack", barcode_box: "BC Box", box_qty: "Box",
  unit_of_measure: "UoM", packing_size_qty: "Pkg Qty",
  standard_price: "Cost", list_price: "Price",
  item_status: "Status", item_type: "Type", buying_status: "Buying", rank_sale: "Rank",
  unit_picking_super: "Unit Pick Super", unit_picking_mart: "Unit Pick Mart",
  avg_jmart: "Avg Jmart", avg_kokkok: "Avg Kokkok", avg_kokkok_fc: "Avg KKK-FC", avg_udee: "Avg U-dee",
  store_apply: "Store Apply",
};

// Default column widths (px) — used for initial render and resizing
const DEFAULT_COL_W: Record<string, number> = {
  division_group: 100, division: 100, department: 110, sub_department: 110, class: 90,
  gm_buyer_code: 80, buyer_code: 80, product_owner: 90, product_bu: 80,
  sku_code: 90, main_barcode: 110, product_name_la: 180, product_name_en: 180,
  barcode_pack: 100, pack_qty: 60, barcode_box: 100, box_qty: 60, unit_of_measure: 60, packing_size_qty: 70,
  standard_price: 80, list_price: 80,
  item_status: 80, item_type: 70, buying_status: 80, rank_sale: 60,
  unit_picking_super: 80, unit_picking_mart: 80,
  avg_jmart: 80, avg_kokkok: 80, avg_kokkok_fc: 90, avg_udee: 80, store_apply: 70,
};

// Module-level cache (in-memory, reset on refresh)
const cache: {
  master: Row[]; packbox: Row[]; status: Row[]; avgType: Row[]; perStore: Row[];
  stores: { name: string; type_store: string }[];
  // List ของ store ทั้งหมดที่ดึงมาเร็ว ๆ ก่อน Prepare ให้ผู้ใช้เลือก
  storeList: { store_name: string; type_store: string }[];
  loaded: { master: boolean; packbox: boolean; status: boolean; avgType: boolean; perStore: boolean; stores: boolean; storeList: boolean };
  // Filter ที่ส่งเข้า DB ตอน Prepare (Filter-first pattern)
  prepareFilter: {
    avgStores: string[];      // store ที่จะดึง avg_per_store (empty = ทั้งหมด)
    rangeStores: string[];    // store ที่จะดึง range_data (empty = ทั้งหมด)
    typeStores: string[];     // type_store filter (override avg/range ถ้าระบุ)
  };
  // เก็บ snapshot ของ filter ที่ใช้ตอน Prepare ครั้งล่าสุด — เทียบกับ prepareFilter ปัจจุบันเพื่อรู้ว่า "dirty"
  lastPreparedFilter: null | { avgStores: string[]; rangeStores: string[]; typeStores: string[] };
  // SKU ที่มาจาก MV จริง ๆ ตอน Prepare (ไม่รวม snapshot/import recovery) — ใช้สำหรับนับ "SKU ตามเงื่อนไข"
  mvSkuSet: Set<string>;
  ui: {
    activeTab: string; search: string;
    selectedGroups: GroupKey[];
    selectedStores: string[]; selectedTypeStores: string[];
    selectedDepartments: string[];
    filters: { division_group: string[]; division: string[]; sub_department: string[]; class: string[]; item_type: string[]; buying_status: string[]; product_owner: string[] };
    searchFilters: SearchFilter[];
    hiddenFields: string[];
    rangeMap: Map<string, Map<string, RangeCell>>;
    page: number; pageSize: number;
    selectedSkus: Set<string>; selectAllMode: boolean;
    colWidths: Record<string, number>;
    // Snapshot of filters applied (Show button) — UI ที่กำลังพิมพ์ไม่กรองทันที
    applied: {
      search: string;
      searchFilters: SearchFilter[];
      filters: { division_group: string[]; division: string[]; sub_department: string[]; class: string[]; item_type: string[]; buying_status: string[]; product_owner: string[] };
      selectedDepartments: string[];
      selectedStores: string[];
      selectedTypeStores: string[];
    };
  };
} = {
  master: [], packbox: [], status: [], avgType: [], perStore: [], stores: [],
  storeList: [],
  loaded: { master: false, packbox: false, status: false, avgType: false, perStore: false, stores: false, storeList: false },
  prepareFilter: { avgStores: [], rangeStores: [], typeStores: [] },
  lastPreparedFilter: null as null | { avgStores: string[]; rangeStores: string[]; typeStores: string[] },
  mvSkuSet: new Set<string>(),
  ui: {
    activeTab: "data", search: "",
    selectedGroups: ["master", "status", "price"],
    selectedStores: [], selectedTypeStores: [],
    selectedDepartments: [],
    filters: { division_group: [], division: [], sub_department: [], class: [], item_type: [], buying_status: [], product_owner: [] },
    searchFilters: [],
    hiddenFields: [],
    rangeMap: new Map(),
    page: 1, pageSize: 100,
    selectedSkus: new Set(), selectAllMode: false,
    colWidths: { ...DEFAULT_COL_W },
    applied: {
      search: "", searchFilters: [],
      filters: { division_group: [], division: [], sub_department: [], class: [], item_type: [], buying_status: [], product_owner: [] },
      selectedDepartments: [], selectedStores: [], selectedTypeStores: [],
    },
  },
};

const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));

// Batched RPC: PostgREST caps RPC results at db-max-rows (1000).
// ต้องใช้ batch=1000 สำหรับ RPC ไม่งั้นจะได้ rows น้อยกว่า batch แล้ว loop จะหยุด
async function rpcAll(rpcName: string, batch = 1000): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.rpc(rpcName as any).range(from, from + batch - 1);
    if (error) throw error;
    const arr = (data || []) as any[];
    all.push(...arr);
    if (arr.length < batch) break;
    from += batch;
    if (from > 200000) break; // safety
  }
  return all;
}

// Parallel batched RPC: ดึงหลาย batch พร้อมกันเพื่อความเร็ว + รายงาน progress
// onProgress(loadedRows, totalEstimate?) — totalEstimate = null ตอนยังไม่รู้
async function rpcAllParallel(
  rpcName: string,
  params: Record<string, any> | null,
  opts: {
    batch?: number;
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, totalEst: number | null) => void;
  } = {}
): Promise<any[]> {
  const batch = opts.batch ?? 1000;
  const concurrency = opts.concurrency ?? 6;
  const all: any[] = [];
  let loaded = 0;

  const fetchRange = async (from: number): Promise<any[]> => {
    if (opts.signal?.aborted) throw new Error("ABORTED");
    const q = params ? supabase.rpc(rpcName as any, params) : supabase.rpc(rpcName as any);
    const { data, error } = await q.range(from, from + batch - 1);
    if (error) throw error;
    return (data || []) as any[];
  };

  // Probe ลูกแรกก่อน เพื่อดูว่ามีข้อมูลไหม
  const first = await fetchRange(0);
  all.push(...first);
  loaded += first.length;
  opts.onProgress?.(loaded, null);
  if (first.length < batch) return all;

  // Continue ดึงเป็นกลุ่มๆ ละ `concurrency` batch พร้อมกัน
  let nextFrom = batch;
  let done = false;
  while (!done) {
    if (opts.signal?.aborted) throw new Error("ABORTED");
    const offsets: number[] = [];
    for (let i = 0; i < concurrency; i++) {
      offsets.push(nextFrom + i * batch);
    }
    const results = await Promise.all(offsets.map(off => fetchRange(off)));
    for (const arr of results) {
      all.push(...arr);
      loaded += arr.length;
      if (arr.length < batch) done = true;
    }
    opts.onProgress?.(loaded, null);
    nextFrom += concurrency * batch;
    if (nextFrom > 500000) break; // safety
  }
  return all;
}

export default function RangeStorePage() {
  const { canDo } = useAuth();
  const canImportRange = canDo("range_store", "import");
  const canDeleteRange = canDo("range_store", "delete");
  const [forceTick, force] = useState(0);
  const rerender = () => force(x => x + 1);

  const [activeTab, setActiveTab] = useState(cache.ui.activeTab);
  const [search, setSearch] = useState(cache.ui.search);
  const [searchFilters, setSearchFilters] = useState<SearchFilter[]>(cache.ui.searchFilters);
  const [hiddenFields, setHiddenFields] = useState<string[]>(cache.ui.hiddenFields);
  const [selectedGroups, setSelectedGroups] = useState<GroupKey[]>(cache.ui.selectedGroups);
  const [selectedStores, setSelectedStores] = useState<string[]>(cache.ui.selectedStores);
  const [selectedTypeStores, setSelectedTypeStores] = useState<string[]>(cache.ui.selectedTypeStores);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(cache.ui.selectedDepartments);
  const [filters, setFilters] = useState(cache.ui.filters);
  const [page, setPage] = useState(cache.ui.page);
  const [pageSize, setPageSize] = useState(cache.ui.pageSize);
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set(cache.ui.selectedSkus));
  const [selectAllMode, setSelectAllMode] = useState(cache.ui.selectAllMode);
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...cache.ui.colWidths });

  // Applied filters (only update when "Show" is clicked)
  const [applied, setApplied] = useState(cache.ui.applied);

  // Pre-Prepare filter (เลือก store ก่อนกด Prepare → ส่งเข้า DB ลด payload)
  const [prepAvgStores, setPrepAvgStores] = useState<string[]>(cache.prepareFilter.avgStores);
  const [prepRangeStores, setPrepRangeStores] = useState<string[]>(cache.prepareFilter.rangeStores);
  const [prepTypeStores, setPrepTypeStores] = useState<string[]>(cache.prepareFilter.typeStores);
  // Pre-Prepare row filter (Hierarchy + Attributes + SKU) — บังคับเลือก ≥1 อย่างก่อน Read
  const [prepDivGroups, setPrepDivGroups] = useState<string[]>([]);
  const [prepDivisions, setPrepDivisions] = useState<string[]>([]);
  const [prepDepartments, setPrepDepartments] = useState<string[]>([]);
  const [prepSubDepts, setPrepSubDepts] = useState<string[]>([]);
  const [prepClasses, setPrepClasses] = useState<string[]>([]);
  const [prepItemTypes, setPrepItemTypes] = useState<string[]>([]);
  const [prepBuyings, setPrepBuyings] = useState<string[]>([]);
  const [prepOwners, setPrepOwners] = useState<string[]>([]);
  const [prepSkuText, setPrepSkuText] = useState<string>("");
  const [filterLists, setFilterLists] = useState<{
    division_groups: string[]; divisions: string[]; departments: string[];
    sub_departments: string[]; classes: string[]; item_types: string[];
    buying_statuses: string[]; owners: string[];
  }>({ division_groups: [], divisions: [], departments: [], sub_departments: [], classes: [], item_types: [], buying_statuses: [], owners: [] });
  // Post-import dialog (Save to Doc / Download Skip)
  const [importDoneDialog, setImportDoneDialog] = useState<null | {
    kind: "range" | "super" | "mart"; saved: number; skipped: number; skus: number; stores: number; fileName: string;
    yPerStore?: Array<{ store: string; oldY: number; addedY: number; removedY: number; totalY: number }>;
  }>(null);

  const [loadingPhase, setLoadingPhase] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [previewSnap, setPreviewSnap] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [latestSnapFull, setLatestSnapFull] = useState<any | null>(null);
  const [latestSnapLoading, setLatestSnapLoading] = useState(false);
  // Pivot/Report — SKU → SPC map (โหลดครั้งเดียวสำหรับ filter SPC)
  const [skuSpcMap, setSkuSpcMap] = useState<Map<string, string>>(new Map());
  const [skuSpcLoading, setSkuSpcLoading] = useState(false);
  const [skuSpcProgress, setSkuSpcProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [pivotSpcFilter, setPivotSpcFilter] = useState<string[]>([]);
  const [pivotTypeStoreFilter, setPivotTypeStoreFilter] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<{ kind: "range" | "super" | "mart"; phase: string; current: number; total: number } | null>(null);
  const [lastImportResult, setLastImportResult] = useState<{ kind: "range" | "super" | "mart"; saved: number; skipped: number; stores: number; skus: number; note: string } | null>(null);
  // Progress for clear (Min/Y) batch deletes
  const [clearProgress, setClearProgress] = useState<{ phase: string; current: number; total: number; mode: "y" | "min" } | null>(null);
  // Progress for re-cal/re-count after clear
  const [recalcProgress, setRecalcProgress] = useState<{ stage: string; current: number; total: number; pct: number } | null>(null);
  // Skip list จาก import ครั้งล่าสุด — เก็บเพื่อ Export ดูรายการที่ถูกข้าม
  const [skippedRows, setSkippedRows] = useState<{
    kind: "range" | "super" | "mart";
    fileName: string;
    rows: Array<{ rowNum: number; raw: string; reason: string; detail: string; product_name_en: string; original: Record<string, any> }>;
  } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  // (removed clearStores — ใช้ filter Stores แทน)
  // Track ว่า session นี้ user ได้ touch (import/clear) สาขาไหนไปแล้ว
  // → Y count ของสาขาเหล่านี้ใช้ค่าจาก rangeMap ปัจจุบัน
  // → สาขาอื่นใช้ค่าจาก snapshot doc ล่าสุด
  const [touchedStores, setTouchedStores] = useState<Set<string>>(new Set());
  const markStoresTouched = (stores: Iterable<string>) => {
    setTouchedStores(prev => {
      const next = new Set(prev);
      for (const s of stores) if (s) next.add(s);
      return next;
    });
  };
  const [savingDoc, setSavingDoc] = useState<string | null>(null); // null | "loading-prev" | "saving" 
  // ใช้ AbortController เพื่อหยุด Prepare กลางคัน
  const prepareAbortRef = useRef<AbortController | null>(null);

  // Search dropdown
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Persist to cache
  useEffect(() => { cache.ui.activeTab = activeTab; }, [activeTab]);
  useEffect(() => { cache.ui.search = search; }, [search]);
  useEffect(() => { cache.ui.searchFilters = searchFilters; }, [searchFilters]);
  useEffect(() => { cache.ui.hiddenFields = hiddenFields; }, [hiddenFields]);
  useEffect(() => { cache.ui.selectedGroups = selectedGroups; }, [selectedGroups]);
  useEffect(() => { cache.ui.selectedStores = selectedStores; }, [selectedStores]);
  useEffect(() => { cache.ui.selectedTypeStores = selectedTypeStores; }, [selectedTypeStores]);
  useEffect(() => { cache.ui.selectedDepartments = selectedDepartments; }, [selectedDepartments]);
  useEffect(() => { cache.ui.filters = filters; }, [filters]);
  useEffect(() => { cache.ui.page = page; }, [page]);
  useEffect(() => { cache.ui.pageSize = pageSize; }, [pageSize]);
  useEffect(() => { cache.ui.selectedSkus = selectedSkus; }, [selectedSkus]);
  useEffect(() => { cache.ui.selectAllMode = selectAllMode; }, [selectAllMode]);
  useEffect(() => { cache.ui.colWidths = colWidths; }, [colWidths]);
  useEffect(() => { cache.ui.applied = applied; }, [applied]);
  useEffect(() => { cache.prepareFilter.avgStores = prepAvgStores; }, [prepAvgStores]);
  useEffect(() => { cache.prepareFilter.rangeStores = prepRangeStores; }, [prepRangeStores]);
  useEffect(() => { cache.prepareFilter.typeStores = prepTypeStores; }, [prepTypeStores]);

  // No auto-load — user clicks Prepare. Pre-load store list + department list for filter UI.
  useEffect(() => {
    if (cache.loaded.master) rerender();
    loadStoreList();
    // loadSnapshots removed — Save Document feature deleted
    loadFilterLists();
  }, []);

  async function loadFilterLists() {
    try {
      const { data, error } = await supabase.rpc("get_range_store_filter_lists" as any);
      if (error) throw error;
      const d = (data || {}) as any;
      setFilterLists({
        division_groups: d.division_groups || [],
        divisions: d.divisions || [],
        departments: d.departments || [],
        sub_departments: d.sub_departments || [],
        classes: d.classes || [],
        item_types: d.item_types || [],
        buying_statuses: d.buying_statuses || [],
        owners: d.owners || [],
      });
    } catch (err: any) {
      console.warn("[loadFilterLists]", err);
    }
  }

  // ดึง list store มาให้ผู้ใช้เลือกก่อน Prepare (เร็ว, ดึงครั้งเดียว)
  async function loadStoreList() {
    if (cache.loaded.storeList) return;
    try {
      const { data, error } = await supabase.rpc("get_range_store_lists" as any);
      if (error) throw error;
      cache.storeList = (data || []) as { store_name: string; type_store: string }[];
      cache.loaded.storeList = true;
      rerender();
    } catch (err: any) {
      console.error("[loadStoreList]", err);
    }
  }

  // ============== Data fetching (batched to avoid 1000-row cap) ==============
  async function fetchPhase(name: keyof typeof cache.loaded, rpc: string) {
    if (cache.loaded[name]) return;
    setLoadingPhase(name);
    const t0 = performance.now();
    try {
      const data = await rpcAll(rpc);
      (cache as any)[name] = data;
      cache.loaded[name] = true;
      console.log(`[RangeStore] ${name}: ${data.length} rows in ${Math.round(performance.now() - t0)}ms`);
    } catch (err: any) {
      toast.error(`${name}: ${err.message}`);
    }
  }

  async function fetchStores() {
    if (cache.loaded.stores) return;
    setLoadingPhase("stores");
    const { data } = await supabase.from("store_type").select("store_name,type_store").not("store_name", "is", null);
    const map = new Map<string, string>();
    (data || []).forEach((r: any) => {
      if (r.store_name && r.type_store !== "DC" && !map.has(r.store_name)) {
        map.set(r.store_name, r.type_store || "");
      }
    });
    cache.stores = Array.from(map.entries()).map(([name, type_store]) => ({ name, type_store })).sort((a, b) => a.name.localeCompare(b.name));
    cache.loaded.stores = true;
  }

  // Fast prepare: ดึงจาก MV โดยส่ง filter เข้า DB ก่อน → DB ตัด jsonb keys ที่ไม่ต้องการ → payload เล็ก
  // Incremental: ถ้ามีข้อมูลเดิมอยู่แล้ว → merge per_store/avg_per_store เข้ากับของเดิม (ไม่ทับ)
  function stopPrepare() {
    if (prepareAbortRef.current) {
      prepareAbortRef.current.abort();
      prepareAbortRef.current = null;
    }
    setLoadingPhase(null);
    setLoadProgress(null);
    toast.info("ยุดการโหลดแล้ว");
  }

  async function prepareData() {
    const t0 = performance.now();
    // Parse SKU text → array
    const prepSkus = prepSkuText
      .split(/[\s,;\n\r]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const hasStoreFilter = prepAvgStores.length > 0 || prepRangeStores.length > 0 || prepTypeStores.length > 0;
    const hasRowFilter =
      prepDivGroups.length > 0 || prepDivisions.length > 0 || prepDepartments.length > 0 ||
      prepSubDepts.length > 0 || prepClasses.length > 0 || prepItemTypes.length > 0 ||
      prepBuyings.length > 0 || prepOwners.length > 0 || prepSkus.length > 0;

    // ❗ บังคับเลือก ≥1 filter ก่อน Read (Tab Data ไม่ดึงทุกอย่างอีกแล้ว)
    if (!hasStoreFilter && !hasRowFilter) {
      toast.error("เลือก Filter ก่อน Read (Type/Store หรือ Hierarchy/Attribute หรือ SKU)");
      return;
    }

    // Detect filter change: ถ้า filter เปลี่ยนจากครั้งล่าสุด → ต้อง reload จาก scratch (ไม่ merge)
    const eqArr = (a: string[], b: string[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const lpf = cache.lastPreparedFilter || { avgStores: [], rangeStores: [], typeStores: [] };
    const filterChanged =
      !eqArr([...prepAvgStores].sort(), [...lpf.avgStores].sort()) ||
      !eqArr([...prepRangeStores].sort(), [...lpf.rangeStores].sort()) ||
      !eqArr([...prepTypeStores].sort(), [...lpf.typeStores].sort());

    const isIncremental = cache.loaded.master && cache.master.length > 0 && !filterChanged;
    const ctrl = new AbortController();
    prepareAbortRef.current = ctrl;
    setLoadingPhase("read-view");
    setLoadProgress({ loaded: 0, total: null });
    try {
      const onProgress = (loaded: number, totalEst: number | null) => {
        setLoadProgress(prev => ({
          loaded,
          total: prev?.total ?? totalEst ?? null,
        }));
      };

      const params = {
        p_division_groups: prepDivGroups.length > 0 ? prepDivGroups : null,
        p_divisions: prepDivisions.length > 0 ? prepDivisions : null,
        p_departments: prepDepartments.length > 0 ? prepDepartments : null,
        p_sub_departments: prepSubDepts.length > 0 ? prepSubDepts : null,
        p_classes: prepClasses.length > 0 ? prepClasses : null,
        p_item_types: prepItemTypes.length > 0 ? prepItemTypes : null,
        p_buying_statuses: prepBuyings.length > 0 ? prepBuyings : null,
        p_owners: prepOwners.length > 0 ? prepOwners : null,
        p_skus: prepSkus.length > 0 ? prepSkus : null,
        p_avg_stores: prepAvgStores.length > 0 ? prepAvgStores : null,
        p_range_stores: prepRangeStores.length > 0 ? prepRangeStores : null,
        p_type_stores: prepTypeStores.length > 0 ? prepTypeStores : null,
      };
      const rawRows: any[] = await rpcAllParallel("read_range_store_view", params, {
        batch: 1000, concurrency: 6, signal: ctrl.signal, onProgress,
      });
      if (ctrl.signal.aborted) throw new Error("ABORTED");
      const rows: any[] = await (await import("@/lib/filterTemplates")).applyExcludeFilters(rawRows, "range_store");

      // Helper: merge ใหม่เข้ากับ existing (ใช้ sku_code เป็น key)
      const mergeBySku = (existing: any[], incoming: any[], merger?: (old: any, neu: any) => any): any[] => {
        const map = new Map<string, any>(existing.map(r => [r.sku_code, r]));
        for (const r of incoming) {
          const old = map.get(r.sku_code);
          if (old && merger) map.set(r.sku_code, merger(old, r));
          else map.set(r.sku_code, r);
        }
        return Array.from(map.values());
      };

      const newMaster = rows.map((r: any) => ({
        sku_code: r.sku_code, main_barcode: r.main_barcode,
        product_name_la: r.product_name_la, product_name_en: r.product_name_en,
        division_group: r.division_group, division: r.division,
        department: r.department, sub_department: r.sub_department, class: r.class,
        gm_buyer_code: r.gm_buyer_code, buyer_code: r.buyer_code,
        product_owner: r.product_owner, product_bu: r.product_bu,
      }));
      const newStatus = rows.map((r: any) => ({
        sku_code: r.sku_code, standard_price: r.standard_price, list_price: r.list_price,
        item_status: r.item_status, item_type: r.item_type,
        buying_status: r.buying_status, rank_sale: r.rank_sale,
      }));
      const newPackbox = rows.map((r: any) => ({
        sku_code: r.sku_code, barcode_pack: r.barcode_pack, pack_qty: r.pack_qty,
        barcode_box: r.barcode_box, box_qty: r.box_qty,
        unit_of_measure: r.unit_of_measure, packing_size_qty: r.packing_size_qty,
      }));
      const newAvgType = rows.map((r: any) => ({
        sku_code: r.sku_code,
        avg_jmart: r.avg_jmart, avg_kokkok: r.avg_kokkok,
        avg_kokkok_fc: r.avg_kokkok_fc, avg_udee: r.avg_udee,
      }));
      const newPerStore = rows.map((r: any) => ({
        sku_code: r.sku_code,
        avg_per_store: r.avg_per_store || {}, range_data: r.range_data || {},
      }));

      if (isIncremental) {
        cache.master = mergeBySku(cache.master, newMaster);
        cache.status = mergeBySku(cache.status, newStatus);
        cache.packbox = mergeBySku(cache.packbox, newPackbox);
        cache.avgType = mergeBySku(cache.avgType, newAvgType);
        // Per-store: รวม jsonb keys เดิม+ใหม่ (ไม่ทับ store ที่ดึงไว้แล้ว)
        cache.perStore = mergeBySku(cache.perStore, newPerStore, (old, neu) => ({
          sku_code: old.sku_code,
          avg_per_store: { ...(old.avg_per_store || {}), ...(neu.avg_per_store || {}) },
          range_data: { ...(old.range_data || {}), ...(neu.range_data || {}) },
        }));
        // mvSkuSet: union กับของเดิม
        for (const r of newMaster) if (r.sku_code) cache.mvSkuSet.add(r.sku_code);
      } else {
        cache.master = newMaster;
        cache.status = newStatus;
        cache.packbox = newPackbox;
        cache.avgType = newAvgType;
        cache.perStore = newPerStore;
        // reset mvSkuSet — เก็บเฉพาะ SKU ที่มาจาก Prepare รอบนี้
        cache.mvSkuSet = new Set(newMaster.map((r: any) => r.sku_code).filter(Boolean));
      }
      cache.loaded.master = true;
      cache.loaded.status = true;
      cache.loaded.packbox = true;
      cache.loaded.avgType = true;
      cache.loaded.perStore = true;
      // สร้าง stores list — incremental: union กับของเดิม
      const allowedStores = new Set<string>(isIncremental ? cache.stores.map(s => s.name) : []);
      if (hasStoreFilter) {
        prepAvgStores.forEach(s => allowedStores.add(s));
        prepRangeStores.forEach(s => allowedStores.add(s));
        if (prepTypeStores.length > 0) {
          cache.storeList.filter(s => prepTypeStores.includes(s.type_store)).forEach(s => allowedStores.add(s.store_name));
        }
      }
      const baseStores = cache.storeList.length > 0
        ? cache.storeList.map(s => ({ name: s.store_name, type_store: s.type_store }))
        : [];
      cache.stores = (allowedStores.size > 0)
        ? baseStores.filter(s => allowedStores.has(s.name))
        : baseStores;
      cache.stores.sort((a, b) => a.name.localeCompare(b.name));
      cache.loaded.stores = true;

      rebuildRangeMap();
      // บันทึก snapshot ของ filter ที่เพิ่ง prepare → ใช้เทียบ "dirty" กับ filter ปัจจุบัน
      cache.lastPreparedFilter = {
        avgStores: [...prepAvgStores],
        rangeStores: [...prepRangeStores],
        typeStores: [...prepTypeStores],
      };
      setLoadingPhase(null);
      setLoadProgress(null);
      rerender();
      const ms = Math.round(performance.now() - t0);
      const filterTag = hasStoreFilter ? `· filtered (${cache.stores.length} stores)` : "· ALL stores";
      const mode = isIncremental ? "merged" : "loaded";
      toast.success(`Prepare ${mode} ${cache.master.length.toLocaleString()} SKU ${filterTag} · ${ms}ms`);
      console.log(`[RangeStore] prepare ${mode}: +${rows.length} rows, total ${cache.master.length} · ${ms}ms · hasStoreFilter=${hasStoreFilter}`);
    } catch (err: any) {
      setLoadingPhase(null);
      setLoadProgress(null);
      if (err?.message === "ABORTED") {
        console.log("[Prepare] aborted by user");
      } else {
        toast.error(`Prepare error: ${err.message}`);
        console.error("[Prepare]", err);
      }
    } finally {
      prepareAbortRef.current = null;
    }
  }

  async function refreshMV() {
    if (!confirm("Sync Range Store View ใหม่ทั้งหมด? (ใช้หลัง import master/avg_sale ใหม่ ใช้เวลา ~5-10 วิ)")) return;
    setLoadingPhase("sync-view");
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.rpc("sync_range_store_view" as any);
      if (error) throw error;
      const result = Array.isArray(data) && data[0] ? `${data[0].rows_synced?.toLocaleString()} rows in ${data[0].ms}ms` : String(data);
      Object.keys(cache.loaded).forEach(k => { if (k !== "storeList") (cache.loaded as any)[k] = false; });
      cache.ui.rangeMap.clear();
      setLoadingPhase(null);
      toast.success(`✅ Sync View: ${result} · ${Math.round(performance.now() - t0)}ms — กด Read เพื่อโหลดใหม่`);
      rerender();
    } catch (err: any) {
      setLoadingPhase(null);
      toast.error(`Sync error: ${err.message}`);
    }
  }

  function clearAllData() {
    if (!confirm("Clear ข้อมูลที่โหลดทั้งหมดออกจากหน้านี้? (ไม่กระทบ DB)")) return;
    cache.master = []; cache.packbox = []; cache.status = []; cache.avgType = []; cache.perStore = [];
    cache.stores = [];
    cache.mvSkuSet = new Set();
    cache.loaded = { master: false, packbox: false, status: false, avgType: false, perStore: false, stores: false, storeList: cache.loaded.storeList };
    cache.ui.rangeMap.clear();
    setSelectedSkus(new Set()); setSelectAllMode(false);
    rerender();
    toast.info("Clear ข้อมูลออกจาก memory แล้ว");
  }

  function applyFilters() {
    setApplied({
      search, searchFilters: [...searchFilters],
      filters: { ...filters },
      selectedDepartments: [...selectedDepartments],
      selectedStores: [...selectedStores],
      selectedTypeStores: [...selectedTypeStores],
    });
    setPage(1);
    toast.success("Show: ใช้ Filter ใหม่แล้ว");
  }

  async function readAvgSale() {
    if (cache.loaded.avgType) { toast.info("Avg Sale โหลดแล้ว"); return; }
    const t0 = performance.now();
    await fetchPhase("avgType", "get_range_store_avg_type");
    setLoadingPhase(null);
    if (!selectedGroups.includes("avg_type")) setSelectedGroups(p => [...p, "avg_type"]);
    rerender();
    toast.success(`Avg Sale ${Math.round(performance.now() - t0)}ms`);
  }

  async function readRangePerStore() {
    if (cache.loaded.perStore) { rebuildRangeMap(); rerender(); return; }
    const t0 = performance.now();
    await fetchPhase("perStore", "get_range_store_perstore");
    rebuildRangeMap();
    setLoadingPhase(null);
    if (!selectedGroups.includes("per_store")) setSelectedGroups(p => [...p, "per_store"]);
    rerender();
    toast.success(`Range Per-Store ${Math.round(performance.now() - t0)}ms`);
  }

  const normalizeImportKey = (v: any) => String(v ?? "").trim();

  const readImportValue = (row: Record<string, any>, candidates: string[]) => {
    const want = new Set(candidates.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, "")));
    for (const [key, value] of Object.entries(row)) {
      const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (want.has(norm)) return value;
    }
    return undefined;
  };

  const resolveImportedSku = (raw: string, indexes: { skuByBarcode: Map<string, string>; skuBySecondaryBarcode: Map<string, string>; skuSet: Set<string> }) => {
    const key = normalizeImportKey(raw);
    if (!key) return undefined;
    return indexes.skuByBarcode.get(key) || indexes.skuBySecondaryBarcode.get(key) || (indexes.skuSet.has(key) ? key : undefined);
  };

  function ensureImportedSkuVisible(sku: string, master?: any) {
    if (!sku) return;
    if (!cache.master.some((r: any) => r.sku_code === sku)) {
      cache.master.push({
        sku_code: sku,
        main_barcode: master?.main_barcode || master?.barcode || "",
        product_name_en: master?.product_name_en || "",
        product_name_la: master?.product_name_la || "",
        product_owner: master?.product_owner || "",
        buying_status: master?.buying_status || "",
        department: master?.department || "",
        sub_department: master?.sub_department || "",
        class: master?.class || "",
      } as any);
      cache.loaded.master = true;
    }
    if (!cache.status.some((r: any) => r.sku_code === sku)) {
      cache.status.push({ sku_code: sku, buying_status: master?.buying_status || "", item_status: master?.item_status || "", item_type: master?.item_type || "" } as any);
      cache.loaded.status = true;
    }
    if (!cache.packbox.some((r: any) => r.sku_code === sku)) {
      cache.packbox.push({ sku_code: sku } as any);
      cache.loaded.packbox = true;
    }
    if (!cache.avgType.some((r: any) => r.sku_code === sku)) {
      cache.avgType.push({ sku_code: sku } as any);
      cache.loaded.avgType = true;
    }
  }

  function rebuildRangeMap() {
    cache.ui.rangeMap.clear();
    for (const r of cache.perStore) {
      const m = new Map<string, RangeCell>();
      for (const [store, cell] of Object.entries(r.range_data || {})) m.set(store, cell as RangeCell);
      cache.ui.rangeMap.set(r.sku_code, m);
    }
  }

  // ============== Joined view ==============
  const joined = useMemo(() => {
    const pbMap = new Map(cache.packbox.map(r => [r.sku_code, r]));
    const stMap = new Map(cache.status.map(r => [r.sku_code, r]));
    const avgMap = new Map(cache.avgType.map(r => [r.sku_code, r]));
    const psMap = new Map(cache.perStore.map(r => [r.sku_code, r]));
    return cache.master.map(m => {
      const pb = pbMap.get(m.sku_code) || {};
      const st = stMap.get(m.sku_code) || {};
      const av = avgMap.get(m.sku_code) || {};
      const ps = psMap.get(m.sku_code) || {};
      const rangeData = (ps.range_data || {}) as Record<string, RangeCell>;
      // Single-pass loop: count storeApply + find first upSuper/upMart
      let storeApply = 0;
      let upSuper: number | null = null;
      let upMart: number | null = null;
      for (const key in rangeData) {
        const cell = rangeData[key];
        if (!cell) continue;
        if (cell.apply_yn === "Y") storeApply++;
        if (upSuper == null && cell.unit_picking_super != null) upSuper = cell.unit_picking_super;
        if (upMart == null && cell.unit_picking_mart != null) upMart = cell.unit_picking_mart;
      }
      return { ...m, ...pb, ...st, ...av, avg_per_store: ps.avg_per_store || {}, range_data: rangeData, store_apply: storeApply, unit_picking_super: upSuper, unit_picking_mart: upMart };
    });
  }, [cache.loaded.master, cache.loaded.packbox, cache.loaded.status, cache.loaded.avgType, cache.loaded.perStore, cache.master.length, cache.perStore.length, forceTick]);

  // Pre-build indexes ONCE per master/status load — avoid re-scanning 41K rows on every filter change.
  // Index ใช้ build deptOpts/subDeptOpts/opts/* แบบ O(1) lookup แทน O(n) scan
  const masterIndex = useMemo(() => {
    const divGrpSet = new Set<string>();
    const divSet = new Set<string>();
    const deptSet = new Set<string>();
    const subDeptSet = new Set<string>();
    const classSet = new Set<string>();
    const ownerSet = new Set<string>();
    // Nested map: divGrp -> div -> dept -> Set<subDept>
    // Used to compute deptOpts/subDeptOpts based on selected filters without scanning all rows
    const tree: Map<string, Map<string, Map<string, Set<string>>>> = new Map();
    for (const r of cache.master as any[]) {
      const dg = r.division_group || "";
      const d = r.division || "";
      const dept = r.department || "";
      const sd = r.sub_department || "";
      if (dg) divGrpSet.add(dg);
      if (d) divSet.add(d);
      if (dept) deptSet.add(dept);
      if (sd) subDeptSet.add(sd);
      if (r.class) classSet.add(r.class);
      if (r.product_owner) ownerSet.add(r.product_owner);
      let l1 = tree.get(dg);
      if (!l1) { l1 = new Map(); tree.set(dg, l1); }
      let l2 = l1.get(d);
      if (!l2) { l2 = new Map(); l1.set(d, l2); }
      let l3 = l2.get(dept);
      if (!l3) { l3 = new Set(); l2.set(dept, l3); }
      if (sd) l3.add(sd);
    }
    return {
      divGrp: Array.from(divGrpSet).sort(),
      div: Array.from(divSet).sort(),
      dept: Array.from(deptSet).sort(),
      subDept: Array.from(subDeptSet).sort(),
      cls: Array.from(classSet).sort(),
      owner: Array.from(ownerSet).sort(),
      tree,
    };
  }, [cache.loaded.master, cache.master.length]);

  const statusIndex = useMemo(() => {
    const itSet = new Set<string>();
    const bsSet = new Set<string>();
    for (const r of cache.status as any[]) {
      if (r.item_type) itSet.add(r.item_type);
      if (r.buying_status) bsSet.add(r.buying_status);
    }
    return { itemType: Array.from(itSet).sort(), buyingStatus: Array.from(bsSet).sort() };
  }, [cache.loaded.status, cache.status.length]);

  const opts = useMemo(() => ({
    division_group: masterIndex.divGrp,
    division: masterIndex.div,
    department: masterIndex.dept,
    sub_department: masterIndex.subDept,
    class: masterIndex.cls,
  }), [masterIndex]);

  // Department options narrow by other filters — uses pre-built tree (O(branches), not O(rows))
  const deptOpts = useMemo(() => {
    const dgFilter = filters.division_group;
    const dFilter = filters.division;
    if (dgFilter.length === 0 && dFilter.length === 0) return masterIndex.dept;
    const set = new Set<string>();
    const dgKeys = dgFilter.length > 0 ? dgFilter : Array.from(masterIndex.tree.keys());
    for (const dg of dgKeys) {
      const l1 = masterIndex.tree.get(dg);
      if (!l1) continue;
      const dKeys = dFilter.length > 0 ? dFilter : Array.from(l1.keys());
      for (const d of dKeys) {
        const l2 = l1.get(d);
        if (!l2) continue;
        for (const dept of l2.keys()) if (dept) set.add(dept);
      }
    }
    return Array.from(set).sort();
  }, [masterIndex, filters.division_group, filters.division]);

  // Sub-Dept narrows by Dept selection — uses pre-built tree
  const subDeptOpts = useMemo(() => {
    const dgFilter = filters.division_group;
    const dFilter = filters.division;
    const deptFilter = selectedDepartments;
    if (dgFilter.length === 0 && dFilter.length === 0 && deptFilter.length === 0) return masterIndex.subDept;
    const set = new Set<string>();
    const dgKeys = dgFilter.length > 0 ? dgFilter : Array.from(masterIndex.tree.keys());
    for (const dg of dgKeys) {
      const l1 = masterIndex.tree.get(dg);
      if (!l1) continue;
      const dKeys = dFilter.length > 0 ? dFilter : Array.from(l1.keys());
      for (const d of dKeys) {
        const l2 = l1.get(d);
        if (!l2) continue;
        const deptKeys = deptFilter.length > 0 ? deptFilter : Array.from(l2.keys());
        for (const dept of deptKeys) {
          const sds = l2.get(dept);
          if (!sds) continue;
          for (const sd of sds) set.add(sd);
        }
      }
    }
    return Array.from(set).sort();
  }, [masterIndex, filters.division_group, filters.division, selectedDepartments]);

  const itemTypeOpts = statusIndex.itemType;
  const buyingStatusOpts = statusIndex.buyingStatus;
  const productOwnerOpts = masterIndex.owner;

  const filtered = useMemo(() => {
    let rows = joined;
    for (const [k, v] of Object.entries(applied.filters)) {
      const arr = v as string[];
      if (arr.length > 0) {
        const set = new Set(arr);
        rows = rows.filter((r: any) => set.has(r[k]));
      }
    }
    if (applied.selectedDepartments.length > 0) {
      const set = new Set(applied.selectedDepartments);
      rows = rows.filter((r: any) => set.has(r.department));
    }
    for (const sf of applied.searchFilters) {
      if (!sf.value) continue;
      const q = sf.value.toLowerCase();
      rows = rows.filter((r: any) => String(r[sf.column] ?? "").toLowerCase().includes(q));
    }
    if (applied.search.trim()) {
      const q = applied.search.toLowerCase();
      rows = rows.filter((r: any) =>
        SEARCHABLE_COLS.some(c => String(r[c] ?? "").toLowerCase().includes(q))
      );
    }
    return rows;
  }, [joined, applied]);

  // Reset page on applied/group change
  useEffect(() => { setPage(1); }, [applied, pageSize, selectedGroups]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const visibleCols = useMemo(() => {
    const cols: string[] = [];
    selectedGroups.forEach(g => { if (g !== "per_store" && g !== "unit_pick") cols.push(...COL_GROUPS[g].fields); });
    return cols.filter(c => !hiddenFields.includes(c));
  }, [selectedGroups, hiddenFields]);

  // All available fields across selected groups (for "Filter Columns" multi-select)
  const allAvailableFields = useMemo(() => {
    const fields: string[] = [];
    selectedGroups.forEach(g => { if (g !== "per_store" && g !== "unit_pick") fields.push(...COL_GROUPS[g].fields); });
    return fields;
  }, [selectedGroups]);


  const showStores = selectedGroups.includes("per_store");

  // Stores to display: filter by APPLIED type_store + selectedStores
  const storesToShow = useMemo(() => {
    if (!showStores) return [];
    let list = cache.stores;
    if (applied.selectedTypeStores.length > 0) {
      const ts = new Set(applied.selectedTypeStores);
      list = list.filter(s => ts.has(s.type_store));
    }
    if (applied.selectedStores.length > 0) {
      const ss = new Set(applied.selectedStores);
      list = list.filter(s => ss.has(s.name));
    }
    return list.map(s => s.name);
  }, [showStores, applied.selectedTypeStores, applied.selectedStores, cache.loaded.stores]);

  const typeStoreOpts = useMemo(() => {
    const set = new Set<string>();
    cache.stores.forEach(s => { if (s.type_store) set.add(s.type_store); });
    return Array.from(set).sort();
  }, [cache.loaded.stores]);

  // Y count per store — สาขาที่ user touched (import/clear) ใช้ค่า live จาก rangeMap
  // สาขาอื่นใช้ค่าจาก snapshot doc ล่าสุด → กดลบหรือ import เฉพาะบางสาขา สาขาอื่นเลขไม่กระตุก
  const yCountByStore = useMemo(() => {
    const map = new Map<string, number>();
    if (!showStores || storesToShow.length === 0) return map;
    const storeSet = new Set(storesToShow);
    for (const s of storesToShow) map.set(s, 0);

    // 1) Live count จาก rangeMap (เฉพาะสาขาที่ touched หรือทั้งหมด ถ้ายังไม่มี snapshot)
    const snapMeta = snapshots[0];
    const snap = latestSnapFull?.id === snapMeta?.id ? latestSnapFull : null;
    const useSnapshot = !!snap;
    for (const skuMap of cache.ui.rangeMap.values()) {
      for (const [store, cell] of skuMap) {
        if (!storeSet.has(store)) continue;
        if (useSnapshot && !touchedStores.has(store)) continue; // ใช้ snapshot ของสาขานี้แทน
        if (cell?.apply_yn === "Y") map.set(store, (map.get(store) || 0) + 1);
      }
    }

    // 2) Snapshot count สำหรับสาขาที่ยังไม่ touched
    if (useSnapshot) {
      const snapData: any[] = (snap.data as any[]) || [];
      for (const r of snapData) {
        const rd = r?.range_data || {};
        for (const store in rd) {
          if (!storeSet.has(store)) continue;
          if (touchedStores.has(store)) continue; // สาขานี้ใช้ live แล้ว
          if (rd[store]?.apply_yn === "Y") map.set(store, (map.get(store) || 0) + 1);
        }
      }
    }
    return map;
  }, [showStores, storesToShow, cache.ui.rangeMap, forceTick, cache.perStore.length, touchedStores, snapshots, latestSnapFull]);

  // ============== Selection helpers ==============
  const effectiveSelectedSkus = useMemo(() => {
    if (selectAllMode) return new Set(filtered.map((r: any) => r.sku_code));
    return selectedSkus;
  }, [selectAllMode, filtered, selectedSkus]);

  const pageAllSelected = pageRows.length > 0 && pageRows.every((r: any) => effectiveSelectedSkus.has(r.sku_code));
  const pageSomeSelected = pageRows.some((r: any) => effectiveSelectedSkus.has(r.sku_code));

  const togglePageSelect = (checked: boolean) => {
    setSelectAllMode(false);
    setSelectedSkus(prev => {
      const next = new Set(prev);
      pageRows.forEach((r: any) => { if (checked) next.add(r.sku_code); else next.delete(r.sku_code); });
      return next;
    });
  };

  const toggleSku = (sku: string, checked: boolean) => {
    setSelectAllMode(false);
    setSelectedSkus(prev => {
      const next = new Set(prev);
      if (checked) next.add(sku); else next.delete(sku);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectAllMode(true);
    setSelectedSkus(new Set(filtered.map((r: any) => r.sku_code)));
    toast.success(`เลือกทั้งหมด ${filtered.length.toLocaleString()} SKU`);
  };

  const clearSelection = () => {
    setSelectAllMode(false);
    setSelectedSkus(new Set());
  };

  // ============== Mutations ==============
  async function toggleApply(sku: string, store: string) {
    const map = cache.ui.rangeMap.get(sku) || new Map();
    const cur = map.get(store) || { apply_yn: "N", min_display: 0, unit_picking_super: null, unit_picking_mart: null };
    const next = { ...cur, apply_yn: cur.apply_yn === "Y" ? "N" : "Y" };
    map.set(store, next);
    cache.ui.rangeMap.set(sku, map);
    rerender();
    const { error } = await supabase.from("range_store").upsert({
      sku_code: sku, store_name: store, apply_yn: next.apply_yn, min_display: next.min_display ?? 0,
    }, { onConflict: "sku_code,store_name" });
    if (error) toast.error(error.message);
  }

  async function setMinDisplay(sku: string, store: string, value: string) {
    const v = num(value) ?? 0;
    const map = cache.ui.rangeMap.get(sku) || new Map();
    const cur = map.get(store) || { apply_yn: "N", min_display: 0, unit_picking_super: null, unit_picking_mart: null };
    const next = { ...cur, min_display: v };
    map.set(store, next);
    cache.ui.rangeMap.set(sku, map);
    rerender();
    const { error } = await supabase.from("range_store").upsert({
      sku_code: sku, store_name: store, apply_yn: next.apply_yn || "N", min_display: v,
    }, { onConflict: "sku_code,store_name" });
    if (error) toast.error(error.message);
  }

  // SKU-level: เขียนค่าเดียวกันให้ทุก store ของ SKU นั้น
  async function setUnitPickSku(sku: string, kind: "super" | "mart", value: string) {
    const v = value === "" ? null : Number(value);
    const field = kind === "super" ? "unit_picking_super" : "unit_picking_mart";
    const map = cache.ui.rangeMap.get(sku) || new Map<string, RangeCell>();
    // ทุก store ที่แสดงอยู่ (ถ้าไม่มี → ใช้ stores ที่ load มา)
    const targetStores = storesToShow.length > 0 ? storesToShow : cache.stores.map(s => s.name);
    const upserts: any[] = [];
    for (const s of targetStores) {
      const cur = map.get(s) || { apply_yn: "N", min_display: 0, unit_picking_super: null, unit_picking_mart: null };
      const next: RangeCell = { ...cur, [field]: v } as RangeCell;
      map.set(s, next);
      upserts.push({
        sku_code: sku, store_name: s,
        apply_yn: cur.apply_yn || "N",
        min_display: cur.min_display ?? 0,
        [field]: v,
      });
    }
    cache.ui.rangeMap.set(sku, map);
    rerender();
    // upsert in chunks
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await supabase.from("range_store").upsert(upserts.slice(i, i + 200), { onConflict: "sku_code,store_name" });
      if (error) { toast.error(error.message); return; }
    }
  }

  async function clearRange(scope: "filtered" | "selected" | "all", stores?: string[], mode: "y" | "min" = "y") {
    let skus: string[] | null;
    let label: string;
    if (scope === "all") { skus = null; label = "ทั้งหมด"; }
    else if (scope === "selected") {
      skus = Array.from(effectiveSelectedSkus);
      if (skus.length === 0) { toast.error("ยังไม่ได้เลือก SKU"); return; }
      label = `${skus.length} SKU ที่เลือก`;
    } else {
      skus = filtered.map((r: any) => r.sku_code);
      label = `${skus.length} SKU ที่กรอง`;
    }
    const storeFilter = stores && stores.length > 0 ? stores : null;
    const storeLabel = storeFilter ? ` · ${storeFilter.length} ร้านค้า` : " · ทุกร้านค้า";
    const action = mode === "min" ? "ลบ Min display" : "ลบ Y";
    if (!confirm(`${action} (${label})${storeLabel} ?`)) return;

    // ---- Optimistic UI: snapshot prev state, then update in-memory immediately ----
    const skuScope: string[] | null = skus; // null = all SKUs
    const storeScope: string[] | null = storeFilter; // null = all stores
    type Backup = { sku: string; store: string; cell: RangeCell }[];
    const backup: Backup = [];

    const applyClearLocal = () => {
      const targetSkus: Iterable<string> = skuScope ?? cache.ui.rangeMap.keys();
      for (const sku of targetSkus) {
        const m = cache.ui.rangeMap.get(sku);
        if (!m) continue;
        const stores: string[] = storeScope ?? Array.from(m.keys());
        for (const s of stores) {
          const cur = m.get(s);
          if (!cur) continue;
          backup.push({ sku, store: s, cell: { ...cur } });
          if (mode === "min") {
            m.set(s, { ...cur, min_display: 0 });
          } else {
            m.set(s, { ...cur, apply_yn: "N", min_display: 0 });
          }
        }
        // also mirror in cache.perStore so joined view recomputes correctly
        const ps = cache.perStore.find((r: any) => r.sku_code === sku);
        if (ps?.range_data) {
          for (const s of stores) {
            const c = ps.range_data[s];
            if (!c) continue;
            if (mode === "min") c.min_display = 0;
            else { c.apply_yn = "N"; c.min_display = 0; }
          }
        }
      }
    };

    applyClearLocal();
    rerender();

    setLoadingPhase("clearing");
    let dbError: any = null;
    let affectedRows = 0;

    const skuList: string[] | null = skus;
    const totalSkus = skuList ? skuList.length : (cache.ui.rangeMap.size || 1);
    setClearProgress({
      phase: mode === "min" ? "Sending delete request (Min)..." : "Sending delete request (Y)...",
      current: 0, total: totalSkus, mode,
    });
    // ให้ progress bar เริ่มแสดงก่อน fire request
    await new Promise(r => setTimeout(r, 0));

    if (mode === "y") {
      // ลบ Y: UPDATE apply_yn='N', min_display=0 WHERE apply_yn='Y' (เก็บ row + unit_picking_*)
      // Single RPC — เร็วกว่า batch มาก
      const { data, error } = await supabase.rpc("clear_range_store" as any, {
        p_skus: skuList, p_stores: storeFilter,
      });
      dbError = error; affectedRows = (data as number) || 0;
    } else {
      // ลบ Min: UPDATE min_display=0 WHERE min_display>0 (ไม่สน Y/N)
      // Single RPC — server กรองเฉพาะ row ที่ค่า > 0 → เร็วและ count ถูกต้อง
      const { data, error } = await supabase.rpc("clear_range_min" as any, {
        p_skus: skuList, p_stores: storeFilter,
      });
      dbError = error; affectedRows = (data as number) || 0;
    }
    // mark progress 100%
    setClearProgress(p => p ? { ...p, current: totalSkus } : p);

    setLoadingPhase(null);
    if (dbError) {
      // Revert optimistic update on failure
      for (const b of backup) {
        const m = cache.ui.rangeMap.get(b.sku);
        if (m) m.set(b.store, b.cell);
        const ps = cache.perStore.find((r: any) => r.sku_code === b.sku);
        if (ps?.range_data?.[b.store]) {
          ps.range_data[b.store].apply_yn = b.cell.apply_yn;
          ps.range_data[b.store].min_display = b.cell.min_display;
        }
      }
      rerender();
      setClearProgress(null);
      toast.error(dbError.message);
      return;
    }

    // Show "Delete complete ✓" briefly
    setClearProgress({ phase: "Delete complete ✓", current: totalSkus, total: totalSkus, mode });
    setTimeout(() => setClearProgress(null), 2000);

    // ===== Re-count / Re-cal stages =====
    setRecalcProgress({ stage: "Preparing data...", current: 0, total: 0, pct: 0 });
    await new Promise(r => setTimeout(r, 0));

    // Mark touched stores (สำหรับ Y count merge กับ doc)
    // หมายเหตุ: ไม่ invalidate cache.loaded.perStore เพราะ optimistic update
    // ได้ mirror การเปลี่ยนแปลงไปยัง cache.perStore แล้ว (lines 987-995)
    // ถ้า invalidate จะทำให้ header แสดง "กำลังโหลด..." ค้างจนกว่าจะกด Read ใหม่
    const touched = storeFilter ?? Array.from(new Set(backup.map(b => b.store)));
    if (touched.length > 0) markStoresTouched(touched);

    // Stage 2: walk affected SKUs and update progress (re-count locally)
    const affectedSkus = skuList ?? Array.from(cache.ui.rangeMap.keys());
    const totalCalc = affectedSkus.length;
    const STEP = Math.max(1, Math.floor(totalCalc / 20)); // ~20 UI ticks
    for (let i = 0; i < totalCalc; i += STEP) {
      const done = Math.min(i + STEP, totalCalc);
      const pct = Math.round((done / totalCalc) * 100);
      setRecalcProgress({ stage: `Calculating ${done.toLocaleString()} / ${totalCalc.toLocaleString()} items`, current: done, total: totalCalc, pct });
      await new Promise(r => setTimeout(r, 0));
    }

    // Stage 3: write to state
    setRecalcProgress({ stage: "Updating table...", current: totalCalc, total: totalCalc, pct: 100 });
    await new Promise(r => setTimeout(r, 0));
    rerender();

    // Stage 4: done — auto dismiss
    setRecalcProgress({ stage: "Done ✓", current: totalCalc, total: totalCalc, pct: 100 });
    setTimeout(() => setRecalcProgress(null), 2000);

    toast.success(`${action} สำเร็จ · ${affectedRows.toLocaleString()} rows`);
  }

  // ============== Snapshots — REMOVED (Save Document feature deleted) ==============

  // Export "Range Y/N + Min + Avg/Day per store" XLSX (used by doExport)
  async function exportRangeXLSX(
    source: any[],
    stores: string[],
    baseName: string,
    onProgress?: (cur: number, total: number) => void,
  ) {
    if (!source.length) { toast.error("ไม่มีข้อมูลจะ Export"); return; }
    const allStores = stores.slice();
    const baseKeys = Object.keys(source[0]).filter(k => k !== "range_data" && k !== "avg_per_store");
    const headers: string[] = [
      ...baseKeys.map(k => COL_LABEL[k] || k),
      ...allStores.flatMap(s => [`${s} - Y/N`, `${s} - Min`, `${s} - Avg/Day`]),
    ];
    const aoa: any[][] = [headers];
    for (let i = 0; i < source.length; i++) {
      const row = source[i];
      const rangeData = row?.range_data || {};
      const avgPerStore = row?.avg_per_store || {};
      const out: any[] = baseKeys.map(k => {
        const v = row?.[k];
        if (v == null) return "";
        if (typeof v === "object") return "";
        return v;
      });
      for (const s of allStores) {
        const cell = rangeData?.[s] || {};
        const minV = cell?.min_display;
        const avgV = avgPerStore?.[s];
        out.push(
          cell?.apply_yn || "",
          (minV === 0 || minV == null) ? "" : minV,
          (avgV === 0 || avgV == null) ? "" : Number(avgV),
        );
      }
      aoa.push(out);
      if ((i + 1) % 2000 === 0) {
        onProgress?.(i + 1, source.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    onProgress?.(source.length, source.length);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    (ws as any)["!views"] = [{ state: "frozen", ySplit: 1 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Range");
    XLSX.writeFile(wb, `${baseName}.xlsx`);
  }


  // ============== Import / Export ==============
  function exportTemplate(kind: "range" | "super" | "mart") {
    let headers: string[] = [];
    let example: any[][] = [];
    if (kind === "range") {
      headers = ["Barcode&SkuCode", "Y/N", "Min", "StoreName"];
      example = [["8851234567890", "Y", 2, "Jmart-01"], ["SKU123456", "N", 0, "Kokkok-02"]];
    }
    else if (kind === "super") { headers = ["Barcode&SkuCode", "Number"]; example = [["8851234567890", 12]]; }
    else { headers = ["Barcode&SkuCode", "Number"]; example = [["8851234567890", 6]]; }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `range_store_${kind}_template.xlsx`);
  }

  async function doExport(scope: "all" | "selected" | "page") {
    try {
      setExporting(scope);
      let source: any[];
      let label: string;
      if (scope === "all") { source = filtered; label = "All (filtered)"; }
      else if (scope === "selected") {
        const skuSet = effectiveSelectedSkus;
        if (skuSet.size === 0) { toast.error("ยังไม่ได้เลือก SKU"); setExporting(null); return; }
        source = filtered.filter((r: any) => skuSet.has(r.sku_code));
        label = "Selected";
      } else {
        source = pageRows; label = "This Page";
      }
      if (source.length === 0) { toast.error("ไม่มีข้อมูลจะ Export"); setExporting(null); return; }

      const storeCols = showStores ? storesToShow : [];
      const baseName = `range_store_${scope}_${new Date().toISOString().slice(0,10)}`;
      const tId = toast.loading(`กำลัง Export ${source.length.toLocaleString()} แถว · ${storeCols.length} stores → XLSX…`);
      await new Promise(r => setTimeout(r, 50));
      await exportRangeXLSX(source, storeCols, baseName, (cur, total) => {
        toast.loading(`Export ${cur.toLocaleString()} / ${total.toLocaleString()} แถว…`, { id: tId });
      });
      toast.success(`✓ Export ${label}: ${source.length.toLocaleString()} แถว → ${baseName}.xlsx`, { id: tId });
    } catch (err: any) {
      toast.error(`Export failed: ${err.message || err}`);
      console.error("[Export]", err);
    } finally {
      setExporting(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>, kind: "range" | "super" | "mart") {
    const file = e.target.files?.[0]; if (!file) return;
    setImportBusy(true);
    setSkippedRows(null);
    setLastImportResult(null);
    setImportProgress({ kind, phase: "อ่านไฟล์...", current: 0, total: 0 });
    // Persistent toast — update ตาม progress (ผู้ใช้เห็นทุกขั้นตอนแม้ Popover ปิด)
    const toastId = toast.loading(`📥 IMPORT ${kind.toUpperCase()} · เริ่มต้น...`);
    const updateToast = (msg: string) => toast.loading(msg, { id: toastId });
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      updateToast(`📥 IMPORT ${kind.toUpperCase()} · อ่านไฟล์ ${rows.length.toLocaleString()} แถว`);
      setImportProgress({ kind, phase: "เตรียมข้อมูล...", current: 0, total: rows.length });
      const skuByBarcode = new Map(cache.master.map((m: any) => [normalizeImportKey(m.main_barcode), m.sku_code]).filter(([k, v]) => k && v) as [string, string][]);
      const skuBySecondaryBarcode = new Map(cache.master.map((m: any) => [normalizeImportKey(m.barcode), m.sku_code]).filter(([k, v]) => k && v) as [string, string][]);
      const skuSet = new Set(cache.master.map((m: any) => normalizeImportKey(m.sku_code)).filter(Boolean));
      // Map sku_code / barcode → product_name_en (จาก master cache) — สำหรับใส่ใน skip list
      const nameBySku = new Map(cache.master.map((m: any) => [normalizeImportKey(m.sku_code), m.product_name_en || ""]));
      const nameByBarcode = new Map(cache.master.map((m: any) => [normalizeImportKey(m.main_barcode), m.product_name_en || ""]));

      const upserts: any[] = [];
      const skipped: Array<{ rowNum: number; raw: string; reason: string; detail: string; product_name_en: string; original: Record<string, any> }> = [];
      if (kind !== "range" && cache.stores.length === 0) {
        await loadStoreList();
        cache.stores = cache.storeList.map(s => ({ name: s.store_name, type_store: s.type_store })).sort((a, b) => a.name.localeCompare(b.name));
        cache.loaded.stores = true;
      }
      // Ensure storeList loaded (for range kind validation)
      if (kind === "range" && cache.storeList.length === 0) await loadStoreList();
      // Build store name lookup: exact + by store code prefix (e.g. "121010003")
      const validStoreNames = new Set(cache.storeList.map(s => s.store_name));
      const storeCodeToName = new Map<string, string>();
      for (const s of cache.storeList) {
        const code = s.store_name.split("-")[0];
        if (code) storeCodeToName.set(code, s.store_name);
      }
      const remappedStores = new Map<string, string>(); // original → canonical
      let rowIdx = 0;
      for (const r of rows) {
        rowIdx++;
        const raw = normalizeImportKey(readImportValue(r, ["Barcode&SkuCode", "Barcode", "SkuCode", "SKU Code", "sku_code", "barcode"]));
        const nameFromCache = nameByBarcode.get(raw) || nameBySku.get(raw) || "";
        if (!raw) {
          skipped.push({ rowNum: rowIdx + 1, raw: "", reason: "Barcode/SKU ว่าง", detail: "ช่อง Barcode&SkuCode ไม่มีค่า", product_name_en: "", original: r });
          continue;
        }
        const sku = resolveImportedSku(raw, { skuByBarcode, skuBySecondaryBarcode, skuSet });
        if (!sku) {
          skipped.push({ rowNum: rowIdx + 1, raw, reason: "ไม่พบใน SKU Master", detail: "รอตรวจสอบใน data_master...", product_name_en: nameFromCache, original: r });
          continue;
        }
        if (kind === "range") {
          const ynRaw = String(readImportValue(r, ["Y/N", "YN", "Apply YN", "Apply", "apply_yn"]) ?? "").trim().toUpperCase();
          const yn = ynRaw === "Y" || ynRaw === "YES" || ynRaw === "1" || ynRaw === "TRUE" ? "Y" : "N";
          const storeRaw = normalizeImportKey(readImportValue(r, ["StoreName", "Store Name", "Store", "store_name"]));
          if (!storeRaw) {
            skipped.push({ rowNum: rowIdx + 1, raw, reason: "StoreName ว่าง", detail: "ช่อง StoreName ไม่มีค่า", product_name_en: nameBySku.get(sku) || nameFromCache, original: r });
            continue;
          }
          let store = storeRaw;
          if (!validStoreNames.has(storeRaw)) {
            // ลองหาจากรหัสสาขา (prefix ก่อน "-")
            const code = storeRaw.split("-")[0];
            const canonical = storeCodeToName.get(code);
            if (canonical) {
              store = canonical;
              remappedStores.set(storeRaw, canonical);
            } else {
              skipped.push({ rowNum: rowIdx + 1, raw, reason: "StoreName ไม่พบในระบบ", detail: `"${storeRaw}" ไม่มีในตาราง Store — ชื่อที่ถูกต้องในระบบ: ${[...validStoreNames].filter(n => n.includes(code)).join(", ") || "ไม่พบรหัสสาขานี้เลย"}`, product_name_en: nameBySku.get(sku) || nameFromCache, original: r });
              continue;
            }
          }
          const minV = Number(readImportValue(r, ["Min", "Min Display", "min", "min_display"]) ?? 0) || 0;
          upserts.push({ sku_code: sku, store_name: store, apply_yn: yn, min_display: minV });
        } else {
          const n = Number(readImportValue(r, ["Number", "Unit Picking", "UnitPick", "Value", "Qty", "number"]) ?? 0);
          for (const s of cache.stores) {
            const obj: any = { sku_code: sku, store_name: s.name, apply_yn: "N", min_display: 0 };
            obj[kind === "super" ? "unit_picking_super" : "unit_picking_mart"] = n;
            upserts.push(obj);
          }
        }
        if (rowIdx % 2000 === 0) {
          setImportProgress({ kind, phase: `ตรวจไฟล์ ${rowIdx.toLocaleString()}/${rows.length.toLocaleString()}`, current: rowIdx, total: rows.length });
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // Enrich reason สำหรับ "ไม่พบใน SKU Master" — ดึง data_master ดูว่าเข้าเงื่อนไขไหน
      // ✅ ใหม่: ถ้าเจอใน DB และตรงเงื่อนไข → auto-resolve sku แล้วใส่กลับเข้า upserts (ไม่ skip)
      // ✅ ใหม่: ค้นหาใน barcode (secondary) ด้วย — ไม่ใช่แค่ main_barcode/sku_code
      const unmatched = skipped.filter(s => s.reason === "ไม่พบใน SKU Master");
      let recoveredCount = 0;
      if (unmatched.length > 0) {
        setImportProgress({ kind, phase: `วิเคราะห์ skip (${unmatched.length})...`, current: 0, total: unmatched.length });
        const keys = [...new Set(unmatched.map(s => s.raw))];
        const found = new Map<string, any>();
        for (let i = 0; i < keys.length; i += 500) {
          const batch = keys.slice(i, i + 500);
          // ค้น 3 fields แบบ parallel: main_barcode, sku_code, barcode (secondary)
          const [byBcRes, bySkuRes, bySecBcRes] = await Promise.all([
            supabase.from("data_master")
              .select("sku_code, main_barcode, barcode, product_owner, buying_status, item_status, item_type, product_name_en, product_name_la, department, sub_department, class")
              .in("main_barcode", batch),
            supabase.from("data_master")
              .select("sku_code, main_barcode, barcode, product_owner, buying_status, item_status, item_type, product_name_en, product_name_la, department, sub_department, class")
              .in("sku_code", batch),
            supabase.from("data_master")
              .select("sku_code, main_barcode, barcode, product_owner, buying_status, item_status, item_type, product_name_en, product_name_la, department, sub_department, class")
              .in("barcode", batch),
          ]);
          for (const r of byBcRes.data || []) {
            if (r.main_barcode) found.set(normalizeImportKey(r.main_barcode), r);
          }
          for (const r of bySkuRes.data || []) {
            const k = normalizeImportKey(r.sku_code);
            if (k && !found.has(k)) found.set(k, r);
          }
          for (const r of bySecBcRes.data || []) {
            const k = normalizeImportKey(r.barcode);
            if (k && !found.has(k)) found.set(k, r);
          }
          setImportProgress({ kind, phase: `วิเคราะห์ skip`, current: Math.min(i + 500, keys.length), total: keys.length });
        }
        // Build recovered upserts list — ของที่ DB มีและตรงเงื่อนไข แม้ cache จะไม่มี
        const LANEXANG_OWNER = "Lanexang Green Property Sole Co.,Ltd";
        const recoveredSkips: typeof skipped = [];
        for (const s of unmatched) {
          const m = found.get(s.raw);
          if (!m) {
            s.detail = "ไม่มี barcode/sku นี้ใน data_master เลย (ตรวจทั้ง main_barcode, sku_code, barcode)";
            continue;
          }
          if (!s.product_name_en) s.product_name_en = m.product_name_en || "";
          // ❌ Skip: Product Owner ไม่ใช่ Lanexang
          if (m.product_owner && m.product_owner !== LANEXANG_OWNER) {
            s.reason = "Product Owner ไม่ใช่ Lanexang";
            s.detail = `owner = "${m.product_owner}" (รับเฉพาะ ${LANEXANG_OWNER})`;
            continue;
          }
          // ❌ Skip: buying_status = Inactive
          if (m.buying_status && String(m.buying_status).trim().toLowerCase() === "inactive") {
            s.reason = "Buying Status = Inactive";
            s.detail = `buying_status = "${m.buying_status}"`;
            continue;
          }
          if (m.sku_code) {
            // ✅ DB มี SKU/Barcode นี้ + ผ่านเงื่อนไข owner/status → import ตรงเข้า range_store ทันที
            const sku = normalizeImportKey(m.sku_code);
            const r = s.original;
            if (kind === "range") {
              const ynRaw = String(readImportValue(r, ["Y/N", "YN", "Apply YN", "Apply", "apply_yn"]) ?? "").trim().toUpperCase();
              const yn = ynRaw === "Y" || ynRaw === "YES" || ynRaw === "1" || ynRaw === "TRUE" ? "Y" : "N";
              const store = normalizeImportKey(readImportValue(r, ["StoreName", "Store Name", "Store", "store_name"]));
              if (!store) {
                s.reason = "StoreName ว่าง";
                s.detail = "ช่อง StoreName ไม่มีค่า";
                recoveredSkips.push(s);
                continue;
              }
              const minV = Number(readImportValue(r, ["Min", "Min Display", "min", "min_display"]) ?? 0) || 0;
              upserts.push({ sku_code: sku, store_name: store, apply_yn: yn, min_display: minV });
            } else {
              const n = Number(readImportValue(r, ["Number", "Unit Picking", "UnitPick", "Value", "Qty", "number"]) ?? 0);
              for (const st of cache.stores) {
                const obj: any = { sku_code: sku, store_name: st.name, apply_yn: "N", min_display: 0 };
                obj[kind === "super" ? "unit_picking_super" : "unit_picking_mart"] = n;
                upserts.push(obj);
              }
            }
            recoveredCount++;
            ensureImportedSkuVisible(sku, m);
            skuByBarcode.set(normalizeImportKey(m.main_barcode), sku);
            skuBySecondaryBarcode.set(normalizeImportKey(m.barcode), sku);
            skuSet.add(sku);
            nameBySku.set(sku, m.product_name_en || "");
          } else {
            s.detail = "เจอใน data_master แต่ไม่มี sku_code";
            recoveredSkips.push(s);
          }
        }
        // เอาเฉพาะที่ skip จริง + ของที่ skip ด้วย reason อื่น
        const trulySkipped = skipped.filter(s => s.reason !== "ไม่พบใน SKU Master" || !found.has(s.raw) || (() => {
          const m = found.get(s.raw);
          return !m.sku_code;
        })());
        // Replace skipped array
        skipped.length = 0;
        skipped.push(...trulySkipped);
      }
      if (recoveredCount > 0) {
        toast.success(`กู้คืน ${recoveredCount.toLocaleString()} รายการ จาก data_master (cache เก่า/secondary barcode)`);
      }
      if (remappedStores.size > 0) {
        const details = [...remappedStores.entries()].map(([o, c]) => `"${o}" → "${c}"`).join(", ");
        toast.warning(`⚠️ Auto-correct StoreName ${remappedStores.size} ชื่อ: ${details}`, { duration: 10000 });
      }

      // Dedupe upserts by (sku_code, store_name) — last entry wins.
      // Postgres UPSERT รอบเดียวห้ามมี (sku, store) ซ้ำกัน ไม่งั้น "ON CONFLICT DO UPDATE
      // command cannot affect row a second time". รวม field ของ entry เก่าไว้ด้วย เพื่อไม่ให้
      // ค่า unit_picking_super/mart ถูกล้างเป็น undefined โดยไม่ตั้งใจ.
      {
        const dedup = new Map<string, any>();
        for (const u of upserts) {
          const key = `${u.sku_code}||${u.store_name}`;
          const prev = dedup.get(key);
          dedup.set(key, prev ? { ...prev, ...u } : u);
        }
        upserts.length = 0;
        for (const v of dedup.values()) upserts.push(v);
      }

      const totalUpserts = upserts.length;
      setImportProgress({ kind, phase: `เตรียมบันทึก ${totalUpserts.toLocaleString()} rows`, current: 0, total: totalUpserts });
      updateToast(`📥 IMPORT ${kind.toUpperCase()} · เตรียมบันทึก ${totalUpserts.toLocaleString()} rows`);
      if (totalUpserts === 0) {
        setLastImportResult({ kind, saved: 0, skipped: skipped.length, stores: 0, skus: 0, note: "ไม่พบแถวที่นำเข้าได้ — ตรวจ header Barcode&SkuCode / Y/N / Min / StoreName หรือกด Skip เพื่อดูสาเหตุ" });
        if (skipped.length > 0) setSkippedRows({ kind, fileName: file.name, rows: skipped });
        toast.warning(`Import ${kind.toUpperCase()}: ไม่มีข้อมูลถูกบันทึก · ข้าม ${skipped.length.toLocaleString()} rows`, { id: toastId, duration: 8000 });
        return;
      }
      const CHUNK = 500;
      const POOL = 4; // parallel batch upserts
      const totalBatches = Math.ceil(totalUpserts / CHUNK);
      let done = 0;
      let batchIdx = 0;
      // ⚡ Stream UI updates: merge in-memory ของแต่ละ wave ทันทีหลัง upsert สำเร็จ
      // → ผู้ใช้เห็น Y/N/Min ขึ้นทันทีโดยไม่ต้องรอจบทั้งไฟล์
      const psIndex = new Map(cache.perStore.map((r: any) => [r.sku_code, r]));
      // Snapshot Y count per store ก่อน import (สำหรับ popup "Y เดิม")
      const preYPerStore = new Map<string, number>();
      for (const row of cache.perStore) {
        const rd = row?.range_data || {};
        for (const store of Object.keys(rd)) {
          if ((rd as any)[store]?.apply_yn === "Y") {
            preYPerStore.set(store, (preYPerStore.get(store) || 0) + 1);
          }
        }
      }
      // Snapshot ค่า apply_yn เดิม per (sku|store) ก่อน import — เพื่อคำนวณ Added/Removed
      const preCellYN = new Map<string, "Y" | "N">(); // key = `${sku}|${store}`
      if (kind === "range") {
        for (const row of cache.perStore) {
          const sku = (row as any)?.sku_code;
          const rd = (row as any)?.range_data || {};
          for (const store of Object.keys(rd)) {
            preCellYN.set(`${sku}|${store}`, rd[store]?.apply_yn === "Y" ? "Y" : "N");
          }
        }
      }
      // นับ Added/Removed ต่อ store จากไฟล์ที่ import (เฉพาะ kind === "range")
      const addedYPerStore = new Map<string, number>();
      const removedYPerStore = new Map<string, number>();
      if (kind === "range") {
        for (const u of upserts) {
          if (!u.store_name || !u.sku_code) continue;
          const prev = preCellYN.get(`${u.sku_code}|${u.store_name}`) || "N";
          const next = u.apply_yn === "Y" ? "Y" : "N";
          if (prev === "N" && next === "Y") {
            addedYPerStore.set(u.store_name, (addedYPerStore.get(u.store_name) || 0) + 1);
          } else if (prev === "Y" && next === "N") {
            removedYPerStore.set(u.store_name, (removedYPerStore.get(u.store_name) || 0) + 1);
          }
        }
      }
      const allTouchedStores = new Set<string>();
      const mergeChunkIntoMemory = (chunk: any[]) => {
        // ⚡ ทำงานเสมอ — แม้ user ยังไม่กด Read Range/Store (cache.loaded.perStore = false)
        // เพื่อให้ rangeMap มีข้อมูลและ Cell แสดงค่าทันทีเมื่อเปิด Per-Store columns
        for (const u of chunk) {
          allTouchedStores.add(u.store_name);
          let row = psIndex.get(u.sku_code);
          if (!row) {
            row = { sku_code: u.sku_code, range_data: {}, avg_per_store: {} };
            psIndex.set(u.sku_code, row);
            cache.perStore.push(row);
          }
          const rd = (row.range_data ||= {});
          const cell = (rd[u.store_name] ||= { apply_yn: "N", min_display: 0 });
          if (kind === "range") {
            cell.apply_yn = u.apply_yn;
            cell.min_display = u.min_display;
          } else if (kind === "super") {
            cell.unit_picking_super = u.unit_picking_super;
          } else if (kind === "mart") {
            cell.unit_picking_mart = u.unit_picking_mart;
          }
          // sync rangeMap (live source สำหรับ cell render)
          let m = cache.ui.rangeMap.get(u.sku_code);
          if (!m) { m = new Map<string, RangeCell>(); cache.ui.rangeMap.set(u.sku_code, m); }
          m.set(u.store_name, { ...cell });
        }
      };

      for (let i = 0; i < upserts.length; i += CHUNK * POOL) {
        const wave: Promise<void>[] = [];
        const waveChunks: any[][] = [];
        for (let p = 0; p < POOL && i + p * CHUNK < upserts.length; p++) {
          const start = i + p * CHUNK;
          const chunk = upserts.slice(start, start + CHUNK);
          waveChunks.push(chunk);
          batchIdx++;
          wave.push(
            (async () => {
              const { error } = await supabase.from("range_store").upsert(chunk, { onConflict: "sku_code,store_name" });
              if (error) throw error;
              done += chunk.length;
              mergeChunkIntoMemory(chunk);
            })()
          );
        }
        setImportProgress({
          kind,
          phase: `Batch ${batchIdx}/${totalBatches}`,
          current: done,
          total: totalUpserts,
        });
        await Promise.all(wave);
        setImportProgress({ kind, phase: `Batch ${batchIdx}/${totalBatches}`, current: done, total: totalUpserts });
        // Live UI refresh ทุก wave — ผู้ใช้เห็นข้อมูลขึ้นทันที
        if (allTouchedStores.size > 0) markStoresTouched(allTouchedStores);
        const typeByStore = new Map(cache.storeList.map(s => [s.store_name, s.type_store || ""]));
        for (const s of allTouchedStores) {
          if (s && !cache.stores.some(st => st.name === s)) cache.stores.push({ name: s, type_store: typeByStore.get(s) || "" });
        }
        cache.stores.sort((a, b) => a.name.localeCompare(b.name));
        cache.loaded.stores = true;
        rerender();
        const pct = Math.round((done / totalUpserts) * 100);
        updateToast(`📥 IMPORT ${kind.toUpperCase()} · บันทึก ${done.toLocaleString()}/${totalUpserts.toLocaleString()} (${pct}%)`);
      }
      setImportProgress({ kind, phase: "อัปเดตตารางให้แสดงทันที...", current: done, total: totalUpserts });
      updateToast(`📥 IMPORT ${kind.toUpperCase()} · กำลังอัปเดตตารางให้แสดงทันที...`);
      // Mark touched stores — Y count ของสาขาเหล่านี้ใช้ค่า live (อื่นๆ ใช้ snapshot doc)
      const touchedStoreSet = new Set<string>(upserts.map((u: any) => u.store_name).filter(Boolean));
      if (touchedStoreSet.size > 0) markStoresTouched(touchedStoreSet);
      // Mark perStore loaded — UI จะแสดง Y/Min ทันทีโดยไม่ต้องรอ "กำลังโหลด..."
      if (!cache.loaded.perStore) cache.loaded.perStore = true;
      if (!selectedGroups.includes("per_store")) setSelectedGroups(p => p.includes("per_store") ? p : [...p, "per_store"]);
      if (touchedStoreSet.size > 0 && applied.selectedStores.length > 0) {
        const mergedStores = Array.from(new Set([...applied.selectedStores, ...touchedStoreSet]));
        setSelectedStores(mergedStores);
        setApplied(prev => ({ ...prev, selectedStores: mergedStores }));
      }
      const importedSkuCount = new Set(upserts.map((u: any) => u.sku_code).filter(Boolean)).size;
      const hasActiveFilter = applied.search.trim() || applied.searchFilters.some(f => f.value) || applied.selectedDepartments.length > 0 || applied.selectedTypeStores.length > 0 || Object.values(applied.filters).some(v => v.length > 0);
      setLastImportResult({
        kind,
        saved: done,
        skipped: skipped.length,
        stores: touchedStoreSet.size,
        skus: importedSkuCount,
        note: hasActiveFilter
          ? `บันทึกแล้วและอัปเดต memory แล้ว · มี filter/search ทำงานอยู่ ถ้าแถวไม่ขึ้นให้กด Reset หรือ Show ใหม่`
          : `แสดงในตารางแล้ว: ${importedSkuCount.toLocaleString()} SKU · ${touchedStoreSet.size.toLocaleString()} store`,
      });
      if (skipped.length > 0) {
        setSkippedRows({ kind, fileName: file.name, rows: skipped });
      }
      // Sync range_store_view เฉพาะ SKU ที่ touched (incremental — เร็ว)
      const importedSkus = [...new Set(upserts.map((u: any) => u.sku_code).filter(Boolean))] as string[];
      if (importedSkus.length > 0) {
        setImportProgress({ kind, phase: `Sync View ${importedSkus.length.toLocaleString()} SKU...`, current: done, total: totalUpserts });
        updateToast(`📥 IMPORT ${kind.toUpperCase()} · กำลัง sync view (${importedSkus.length.toLocaleString()} SKU)...`);
        try {
          const { data: syncCount, error: syncErr } = await supabase.rpc("sync_range_store_view_skus" as any, { p_skus: importedSkus });
          if (syncErr) throw syncErr;
          console.log(`[Import] sync_range_store_view_skus: ${syncCount} rows`);
        } catch (e: any) {
          console.warn("[Import] sync view error:", e?.message);
        }
      }
      // คำนวณ Y ต่อ store หลัง import (สำหรับ popup)
      const totalYPerStore = new Map<string, number>();
      for (const row of psIndex.values()) {
        const rd = (row as any)?.range_data || {};
        for (const store of Object.keys(rd)) {
          if (rd[store]?.apply_yn === "Y") {
            totalYPerStore.set(store, (totalYPerStore.get(store) || 0) + 1);
          }
        }
      }
      const storesForPopup = new Set<string>([
        ...touchedStoreSet,
        ...(kind === "range" ? Array.from(addedYPerStore.keys()) : []),
        ...(kind === "range" ? Array.from(removedYPerStore.keys()) : []),
      ] as string[]);
      const yPerStore = Array.from(storesForPopup).sort((a, b) => a.localeCompare(b)).map(store => ({
        store,
        oldY: preYPerStore.get(store) || 0,
        addedY: kind === "range" ? (addedYPerStore.get(store) || 0) : 0,
        removedY: kind === "range" ? (removedYPerStore.get(store) || 0) : 0,
        totalY: totalYPerStore.get(store) || 0,
      }));
      // เปิด Popup สรุปผล Import
      setImportDoneDialog({
        kind, saved: done, skipped: skipped.length, skus: importedSkuCount,
        stores: touchedStoreSet.size, fileName: file.name,
        yPerStore,
      });
      toast.success(`✅ Import ${done.toLocaleString()} rows สำเร็จ${skipped.length > 0 ? ` · ข้าม ${skipped.length.toLocaleString()}` : ""}`, {
        id: toastId, duration: 5000,
      });
      rerender();
    } catch (err: any) {
      toast.error(`❌ Import ผิดพลาด: ${err.message}`, { id: toastId, duration: 8000 });
    }
    finally { setImportBusy(false); setImportProgress(null); e.target.value = ""; }
  }

  function exportSkipList() {
    if (!skippedRows || skippedRows.rows.length === 0) {
      toast.info("ไม่มี skip list");
      return;
    }
    const exportRows = skippedRows.rows.map(s => ({
      "Row #": s.rowNum,
      "Barcode&SkuCode": s.raw,
      "Product Name EN": s.product_name_en || "",
      "Y/N": s.original["Y/N"] ?? s.original.YN ?? "",
      "Min": s.original.Min ?? s.original.min ?? "",
      "StoreName": s.original.StoreName ?? s.original.Store ?? s.original.store_name ?? "",
      "Skip Reason": s.reason,
      "Detail": s.detail,
    }));
    // Group summary
    const byReason = new Map<string, number>();
    for (const s of skippedRows.rows) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
    const summary = [...byReason.entries()].map(([reason, count]) => ({ "Skip Reason": reason, "Count": count }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "Skipped Rows");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `skip_list_${skippedRows.kind}_${stamp}.xlsx`);
    toast.success(`Export ${exportRows.length.toLocaleString()} rows`);
  }

  // ============== Pivot — ใช้ข้อมูลจาก range_store_view (live joined) ==============
  // Live source (สำหรับ Get Report button)
  const liveSnapData: any[] = useMemo(() => {
    const LANEXANG = "Lanexang Green Property Sole Co.,Ltd";
    return (joined as any[]).filter((r: any) => r?.product_owner === LANEXANG);
  }, [joined]);
  const liveSnapStores: string[] = useMemo(() => cache.stores.map(s => s.name), [cache.stores, forceTick]);

  // Frozen snapshot ที่ user กด "Get Report" — Pivot ทั้งหมดอ้างอิงจากนี้ (ไม่ใช่ live)
  const [pivotSnapshot, setPivotSnapshot] = useState<{ data: any[]; stores: string[]; ts: number } | null>(null);
  const latestSnapData: any[] = pivotSnapshot?.data || [];
  const latestSnapStores: string[] = pivotSnapshot?.stores || [];
  const latestSnapMeta: any = pivotSnapshot ? { id: "live", ts: pivotSnapshot.ts } : null;
  const latestSnap: any = pivotSnapshot ? { name: `Live @ ${new Date(pivotSnapshot.ts).toLocaleString()}`, item_count: pivotSnapshot.data.length } : null;

  const runPivotReport = () => {
    if (liveSnapData.length === 0) { toast.warning("ยังไม่มีข้อมูลใน Prepare — กด Read Range/Store ก่อน"); return; }
    setPivotSnapshot({ data: liveSnapData, stores: liveSnapStores, ts: Date.now() });
    toast.success(`Get Report: ${liveSnapData.length.toLocaleString()} SKU · ${liveSnapStores.length} stores`);
  };

  // Snapshot loaders removed — no-op stubs to satisfy any remaining call sites.
  const loadSnapshotData = async (_id: string) => null;
  const openSnapshotPreview = (_meta: any) => { toast.info("Save Document feature ถูกยกเลิกแล้ว"); };
  const deleteSnapshot = async (_id: string) => { /* no-op */ };
  const saveSnapshot = async () => { toast.info("Save Document feature ถูกยกเลิกแล้ว"); };
  const exportSnapshotXLSX = async (_snap: any) => { toast.info("Save Document feature ถูกยกเลิกแล้ว"); };


  // โหลด SKU → SPC map ครั้งเดียว (background, ไม่บล็อก) เมื่อมี snapshot และยังไม่ได้โหลด
  useEffect(() => {
    if (!latestSnapMeta || latestSnapLoading || latestSnapData.length === 0 || skuSpcMap.size > 0) return;
    let cancelled = false;
    setSkuSpcLoading(true);
    setSkuSpcProgress({ phase: "เตรียมข้อมูล", pct: 0 });
    (async () => {
      try {
        const skus = [...new Set(latestSnapData.map((r: any) => r.sku_code).filter(Boolean))];
        if (!skus.length) { setSkuSpcLoading(false); setSkuSpcProgress(null); return; }
        // SKU → vendor_code (batched)
        const skuToVendor = new Map<string, string>();
        for (let i = 0; i < skus.length; i += 1000) {
          if (cancelled) return;
          const batch = skus.slice(i, i + 1000);
          const { data } = await supabase
            .from("data_master").select("sku_code, vendor_code").in("sku_code", batch);
          for (const r of data || []) if (r.sku_code && r.vendor_code) skuToVendor.set(r.sku_code, r.vendor_code);
          setSkuSpcProgress({
            phase: "โหลด Vendor",
            pct: Math.floor(((i + batch.length) / skus.length) * 50),
          });
        }
        // vendor_code → spc_name
        const vendors = [...new Set([...skuToVendor.values()])];
        const vendorToSpc = new Map<string, string>();
        for (let i = 0; i < vendors.length; i += 1000) {
          if (cancelled) return;
          const batch = vendors.slice(i, i + 1000);
          const { data } = await supabase
            .from("vendor_master").select("vendor_code, spc_name").in("vendor_code", batch);
          for (const v of data || []) if (v.vendor_code) vendorToSpc.set(v.vendor_code, v.spc_name || "—");
          setSkuSpcProgress({
            phase: "โหลด SPC",
            pct: 50 + Math.floor(((i + batch.length) / Math.max(vendors.length, 1)) * 50),
          });
        }
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const sku of skus) {
          const v = skuToVendor.get(sku);
          map.set(sku, (v && vendorToSpc.get(v)) || "—");
        }
        setSkuSpcMap(map);
      } catch (e) {
        console.warn("[SPC map] load failed", e);
      } finally {
        if (!cancelled) { setSkuSpcLoading(false); setSkuSpcProgress(null); }
      }
    })();
    return () => { cancelled = true; setSkuSpcLoading(false); setSkuSpcProgress(null); };
  }, [latestSnapMeta?.id, latestSnapLoading, latestSnapData.length, skuSpcMap.size]);

  // store → type_store map (จาก cache.storeList ที่โหลดอยู่แล้ว)
  const storeTypeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of cache.storeList) m.set(s.store_name, s.type_store || "—");
    return m;
  }, [cache.storeList.length]);

  // SKU ที่ผ่าน SPC filter
  const allowedSkuSet = useMemo(() => {
    if (!pivotSpcFilter.length) return null; // null = all
    const s = new Set<string>();
    for (const r of latestSnapData) {
      const spc = skuSpcMap.get(r.sku_code) || "—";
      if (pivotSpcFilter.includes(spc)) s.add(r.sku_code);
    }
    return s;
  }, [pivotSpcFilter, latestSnapData, skuSpcMap]);

  // Stores ที่ผ่าน Type filter
  const visibleStores = useMemo(() => {
    if (!pivotTypeStoreFilter.length) return latestSnapStores;
    return latestSnapStores.filter(s => pivotTypeStoreFilter.includes(storeTypeMap.get(s) || "—"));
  }, [latestSnapStores, pivotTypeStoreFilter, storeTypeMap]);

  // ===== Per-store breakdown (count Y + by rank/status/type) =====
  type StoreBreakdown = {
    store: string;
    type_store: string;
    total: number;
    rank: { A: number; B: number; C: number; D: number; Blank: number };
    status: { Active: number; Discontinue: number; Other: number };
    type: { Basic: number; NonBasic: number };
  };

  const storeBreakdowns: StoreBreakdown[] = useMemo(() => {
    const result: StoreBreakdown[] = visibleStores.map(s => ({
      store: s,
      type_store: storeTypeMap.get(s) || "—",
      total: 0,
      rank: { A: 0, B: 0, C: 0, D: 0, Blank: 0 },
      status: { Active: 0, Discontinue: 0, Other: 0 },
      type: { Basic: 0, NonBasic: 0 },
    }));
    const idx = new Map(result.map((b, i) => [b.store, i]));
    for (const r of latestSnapData) {
      if (allowedSkuSet && !allowedSkuSet.has(r.sku_code)) continue;
      const rd = r.range_data || {};
      const rk = (r.rank_sale || "").toUpperCase().trim();
      const st = (r.item_status || "").toLowerCase();
      const it = (r.item_type || "").toLowerCase();
      for (const store of visibleStores) {
        const cell = rd[store];
        if (!cell || cell.apply_yn !== "Y") continue;
        const i = idx.get(store)!;
        const b = result[i];
        b.total++;
        if (rk === "A" || rk === "B" || rk === "C" || rk === "D") b.rank[rk]++;
        else b.rank.Blank++;
        if (st.includes("active")) b.status.Active++;
        else if (st.includes("discont")) b.status.Discontinue++;
        else b.status.Other++;
        if (it.includes("basic") && !it.includes("non")) b.type.Basic++;
        else b.type.NonBasic++;
      }
    }
    return result.sort((a, b) => b.total - a.total);
  }, [latestSnapData, visibleStores, allowedSkuSet, storeTypeMap]);

  const pivotGrandTotal = useMemo(() => storeBreakdowns.reduce((s, b) => s + b.total, 0), [storeBreakdowns]);

  // Department × Store (apply filter)
  const pivotByDeptStore = useMemo(() => {
    const dept: Record<string, Record<string, number>> = {};
    for (const r of latestSnapData) {
      if (allowedSkuSet && !allowedSkuSet.has(r.sku_code)) continue;
      const d = r.department || "(ว่าง)";
      if (!dept[d]) dept[d] = {};
      for (const store of visibleStores) {
        const c = (r.range_data || {})[store];
        if (c && c.apply_yn === "Y") dept[d][store] = (dept[d][store] || 0) + 1;
      }
    }
    return dept;
  }, [latestSnapData, visibleStores, allowedSkuSet]);

  // Filter options
  const pivotSpcOptions = useMemo(
    () => [...new Set([...skuSpcMap.values()])].filter(Boolean).sort(),
    [skuSpcMap]
  );
  const pivotTypeStoreOptions = useMemo(
    () => [...new Set(latestSnapStores.map(s => storeTypeMap.get(s) || "—"))].filter(Boolean).sort(),
    [latestSnapStores, storeTypeMap]
  );

  // Export Excel breakdown
  const exportPivotXLSX = () => {
    if (!storeBreakdowns.length) { toast.error("ไม่มีข้อมูล"); return; }
    const rows = storeBreakdowns.map(b => ({
      "Store": b.store,
      "Type Store": b.type_store,
      "Y Total": b.total,
      "Rank A": b.rank.A, "Rank B": b.rank.B, "Rank C": b.rank.C, "Rank D": b.rank.D, "Rank Blank": b.rank.Blank,
      "Active": b.status.Active, "Discontinue": b.status.Discontinue, "Other Status": b.status.Other,
      "Basic Item": b.type.Basic, "Non Basic": b.type.NonBasic,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `range_report_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success(`✓ Export ${rows.length} stores`);
  };

  const totalSku = cache.master.length;
  const mvSkuCount = cache.mvSkuSet.size;
  const extraSkuCount = Math.max(0, totalSku - mvSkuCount);
  const showingFrom = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, filtered.length);

  // ============== Column resize ==============
  const resizeRef = useRef<{ field: string; startX: number; startW: number } | null>(null);
  const onResizeStart = (field: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[field] ?? DEFAULT_COL_W[field] ?? 100;
    resizeRef.current = { field, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const w = Math.max(40, resizeRef.current.startW + dx);
      setColWidths(prev => ({ ...prev, [resizeRef.current!.field]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      {/* COMPACT HEADER + PRE-PREPARE FILTER (รวมเป็นแถบเดียว) */}
      <div className="flex items-center gap-2 flex-wrap border-b pb-2">
        <h1 className="text-base font-bold whitespace-nowrap">Range Store</h1>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          <b className="text-foreground">{(mvSkuCount > 0 ? mvSkuCount : totalSku).toLocaleString()}</b> SKU · {cache.stores.length} st
          {extraSkuCount > 0 && mvSkuCount > 0 && (
            <span title="SKU เพิ่มเติมจาก snapshot/import (ไม่ตรงเงื่อนไข MV ปัจจุบัน)">
              {" "}<span className="text-muted-foreground/70">(+{extraSkuCount.toLocaleString()})</span>
            </span>
          )}
          {filtered.length !== joined.length && <> · กรอง <b className="text-foreground">{filtered.length.toLocaleString()}</b></>}
          {effectiveSelectedSkus.size > 0 && <> · เลือก <b className="text-primary">{effectiveSelectedSkus.size.toLocaleString()}</b></>}
        </span>
        {loadingPhase && (
          <span className="text-[11px] inline-flex items-center gap-1.5 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{loadingPhase}</span>
            {loadProgress && (() => {
              const { loaded, total } = loadProgress;
              const pct = total && total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums font-medium">
                    {loaded.toLocaleString()}{total ? ` / ${total.toLocaleString()}` : ""}
                    {pct !== null && <span className="ml-1 text-muted-foreground">({pct}%)</span>}
                  </span>
                  <span className="inline-block w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                    <span
                      className="block h-full bg-primary transition-all"
                      style={{ width: pct !== null ? `${pct}%` : "30%" }}
                    />
                  </span>
                </span>
              );
            })()}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 ml-0.5"
              onClick={stopPrepare}
              title="ยุดการโหลด"
            >
              <X className="h-2.5 w-2.5 mr-0.5" />ยุด
            </Button>
          </span>
        )}
        {importProgress && (
          <span className="text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
            <Upload className="h-3 w-3 animate-pulse" />
            <span className="font-semibold">IMPORT {importProgress.kind.toUpperCase()}</span>
            <span>· {importProgress.phase}</span>
            {importProgress.total > 0 && (() => {
              const pct = Math.min(100, Math.round((importProgress.current / importProgress.total) * 100));
              return (
                <>
                  <span className="tabular-nums font-medium">
                    {importProgress.current.toLocaleString()} / {importProgress.total.toLocaleString()}
                    <span className="ml-1 text-muted-foreground">({pct}%)</span>
                  </span>
                  <span className="inline-block w-28 h-1.5 bg-muted rounded-full overflow-hidden">
                    <span className="block h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </span>
                </>
              );
            })()}
          </span>
        )}
        {!importProgress && lastImportResult && (
          <span className="text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            <Upload className="h-3 w-3" />
            <span className="font-semibold">IMPORT {lastImportResult.kind.toUpperCase()} ✓</span>
            <span>{lastImportResult.saved.toLocaleString()} saved</span>
            {lastImportResult.skipped > 0 && <span>· skip {lastImportResult.skipped.toLocaleString()}</span>}
            <span className="text-muted-foreground">· {lastImportResult.note}</span>
          </span>
        )}
        {savingDoc && (
          <span className="text-[11px] inline-flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {savingDoc === "loading-prev" ? "กำลังโหลด Doc เดิม…" : "กำลังบันทึก Doc…"}
          </span>
        )}
        {exporting && (
          <span className="text-[11px] inline-flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />กำลัง Export ({exporting})…
          </span>
        )}
        {clearProgress && (() => {
          const pct = clearProgress.total > 0 ? Math.min(100, Math.round((clearProgress.current / clearProgress.total) * 100)) : 0;
          const done = clearProgress.phase.startsWith("Delete complete");
          return (
            <span className={`text-[11px] inline-flex items-center gap-1.5 ${done ? "text-emerald-600" : "text-destructive"}`}>
              {!done && <Loader2 className="h-3 w-3 animate-spin" />}
              <span className="font-medium">{clearProgress.phase}</span>
              {!done && (
                <span className="tabular-nums">
                  {clearProgress.current.toLocaleString()} / {clearProgress.total.toLocaleString()} records ({pct}%)
                </span>
              )}
              <span className="inline-block w-28 h-1.5 bg-muted rounded-full overflow-hidden">
                <span className={`block h-full transition-all ${done ? "bg-emerald-500" : "bg-destructive"}`} style={{ width: `${pct}%` }} />
              </span>
            </span>
          );
        })()}
        {recalcProgress && (
          <span className={`text-[11px] inline-flex items-center gap-1.5 ${recalcProgress.stage === "Done ✓" ? "text-emerald-600" : "text-primary"}`}>
            {recalcProgress.stage !== "Done ✓" && <Loader2 className="h-3 w-3 animate-spin" />}
            <span className="font-medium">{recalcProgress.stage}</span>
            <span className="tabular-nums text-muted-foreground">({recalcProgress.pct}%)</span>
            <span className="inline-block w-28 h-1.5 bg-muted rounded-full overflow-hidden">
              <span className={`block h-full transition-all ${recalcProgress.stage === "Done ✓" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${recalcProgress.pct}%` }} />
            </span>
          </span>
        )}

        <div className="h-5 w-px bg-border mx-1" />

        {/* Store filters */}
        <MultiSelectFilter
          label={`Type Store (${prepTypeStores.length || "all"})`}
          options={Array.from(new Set(cache.storeList.map(s => s.type_store).filter(Boolean))).sort()}
          selected={prepTypeStores}
          onChange={(next) => {
            setPrepTypeStores(next);
            if (next.length > 0) {
              const allowed = new Set(cache.storeList.filter(s => next.includes(s.type_store)).map(s => s.store_name));
              setPrepAvgStores(prev => prev.filter(s => allowed.has(s)));
              setPrepRangeStores(prev => prev.filter(s => allowed.has(s)));
            }
          }}
        />
        <MultiSelectFilter
          label={`Store (${prepAvgStores.length || "all"})`}
          options={(prepTypeStores.length > 0 ? cache.storeList.filter(s => prepTypeStores.includes(s.type_store)) : cache.storeList).map(s => s.store_name)}
          selected={prepAvgStores}
          onChange={(next) => { setPrepAvgStores(next); setPrepRangeStores(next); }}
          emptyHint={prepTypeStores.length > 0 ? `ไม่มี store ใน type [${prepTypeStores.join(",")}]` : undefined}
        />
        <div className="h-5 w-px bg-border mx-1" />
        {/* Hierarchy */}
        <MultiSelectFilter label={`Div Grp (${prepDivGroups.length || "all"})`}  options={filterLists.division_groups} selected={prepDivGroups}  onChange={setPrepDivGroups} />
        <MultiSelectFilter label={`Division (${prepDivisions.length || "all"})`} options={filterLists.divisions}       selected={prepDivisions} onChange={setPrepDivisions} />
        <MultiSelectFilter label={`Dept (${prepDepartments.length || "all"})`}   options={filterLists.departments}     selected={prepDepartments} onChange={setPrepDepartments} />
        <MultiSelectFilter label={`Sub-Dept (${prepSubDepts.length || "all"})`}  options={filterLists.sub_departments} selected={prepSubDepts} onChange={setPrepSubDepts} />
        <MultiSelectFilter label={`Class (${prepClasses.length || "all"})`}      options={filterLists.classes}         selected={prepClasses} onChange={setPrepClasses} />
        <div className="h-5 w-px bg-border mx-1" />
        {/* Attributes */}
        <MultiSelectFilter label={`Item Type (${prepItemTypes.length || "all"})`} options={filterLists.item_types}      selected={prepItemTypes} onChange={setPrepItemTypes} />
        <MultiSelectFilter label={`Buying (${prepBuyings.length || "all"})`}      options={filterLists.buying_statuses} selected={prepBuyings}   onChange={setPrepBuyings} />
        <MultiSelectFilter label={`Owner (${prepOwners.length || "all"})`}        options={filterLists.owners}          selected={prepOwners}    onChange={setPrepOwners} />
        <Input
          placeholder="SKU/Barcode (คั่นด้วย ,)"
          value={prepSkuText}
          onChange={(e) => setPrepSkuText(e.target.value)}
          className="h-7 w-44 text-xs"
        />
        {(prepAvgStores.length > 0 || prepRangeStores.length > 0 || prepTypeStores.length > 0 ||
          prepDivGroups.length > 0 || prepDivisions.length > 0 || prepDepartments.length > 0 ||
          prepSubDepts.length > 0 || prepClasses.length > 0 || prepItemTypes.length > 0 ||
          prepBuyings.length > 0 || prepOwners.length > 0 || prepSkuText) && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Clear filter"
            onClick={() => {
              setPrepAvgStores([]); setPrepRangeStores([]); setPrepTypeStores([]);
              setPrepDivGroups([]); setPrepDivisions([]); setPrepDepartments([]);
              setPrepSubDepts([]); setPrepClasses([]); setPrepItemTypes([]);
              setPrepBuyings([]); setPrepOwners([]); setPrepSkuText("");
            }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {(() => {
            const hasAnyFilter =
              prepAvgStores.length > 0 || prepRangeStores.length > 0 || prepTypeStores.length > 0 ||
              prepDivGroups.length > 0 || prepDivisions.length > 0 || prepDepartments.length > 0 ||
              prepSubDepts.length > 0 || prepClasses.length > 0 || prepItemTypes.length > 0 ||
              prepBuyings.length > 0 || prepOwners.length > 0 || prepSkuText.trim().length > 0;
            const prev = cache.lastPreparedFilter;
            const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
            const dirty = !!prev && (
              !sameArr(prev.avgStores, prepAvgStores) ||
              !sameArr(prev.rangeStores, prepRangeStores) ||
              !sameArr(prev.typeStores, prepTypeStores)
            );
            const label = !cache.loaded.master ? "Read" : (dirty ? "Re-Read" : "+ Read");
            const variant: "default" | "secondary" | "destructive" = !cache.loaded.master
              ? "default"
              : (dirty ? "destructive" : "secondary");
            const cls = dirty ? "h-7 px-2 text-xs ring-2 ring-amber-400 bg-amber-500 hover:bg-amber-600 text-white" : "h-7 px-2 text-xs";
            const title = !hasAnyFilter
              ? "เลือก Filter ก่อน (Type/Store หรือ Hierarchy/Attribute หรือ SKU)"
              : !cache.loaded.master
                ? "ดึงข้อมูลตาม filter"
                : (dirty ? "Filter เปลี่ยน — กดเพื่อโหลดใหม่" : "เพิ่มข้อมูลเข้ากับของเดิม");
            return (
              <Button size="sm" className={cls} onClick={prepareData} disabled={!!loadingPhase || !hasAnyFilter} variant={dirty ? "default" : variant} title={title}>
                <Database className="h-3 w-3 mr-1" />{label}
              </Button>
            );
          })()}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={refreshMV} disabled={!!loadingPhase} title="Refresh DB view (หลัง import)">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs">More</Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="end">
              <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" onClick={readAvgSale} disabled={!!loadingPhase || !cache.loaded.master}>
                {cache.loaded.avgType ? "✓ " : ""}Read Avg Sale
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" onClick={readRangePerStore} disabled={!!loadingPhase || !cache.loaded.master}>
                {cache.loaded.perStore ? "✓ " : ""}Read Range/Store
              </Button>
              {/* Save All — REMOVED (Save Document feature deleted) */}
              <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs text-destructive" onClick={clearAllData} disabled={!!loadingPhase}>
                <Trash2 className="h-3 w-3 mr-2" />Clear Data
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {(prepAvgStores.length > 0 || prepRangeStores.length > 0 || prepTypeStores.length > 0 || (cache.loaded.master && cache.master.length > 0)) && (
          <div className="basis-full text-[10px] text-muted-foreground flex items-center gap-2 -mt-0.5">
            {cache.loaded.master && cache.master.length > 0 && (
              <span className="text-primary">✓ Prepared · กด Prepare อีกครั้งเพื่อ merge store เพิ่ม</span>
            )}
            {(prepAvgStores.length > 0 || prepRangeStores.length > 0 || prepTypeStores.length > 0) && (
              <span>→ {[
                prepTypeStores.length > 0 && `type [${prepTypeStores.join(",")}]`,
                prepAvgStores.length > 0 && `avg ${prepAvgStores.length}`,
                prepRangeStores.length > 0 && `range ${prepRangeStores.length}`,
              ].filter(Boolean).join(" · ")}</span>
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8">
          <TabsTrigger value="data" className="text-xs h-6">Data View</TabsTrigger>
          <TabsTrigger value="pivot" className="text-xs h-6">Pivot + Dashboard</TabsTrigger>
          {/* Save Document tab — REMOVED */}
        </TabsList>

        {/* ============ TAB 1 ============ */}
        <TabsContent value="data" className="space-y-2 mt-2">
          {/* COMPACT TOOLBAR — Search + 3 popovers */}
          <Card className="p-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              {searchFilters.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1 pl-2 pr-1 py-0.5">
                  <span className="font-medium">{SEARCH_COL_LABEL[f.column] || f.column}</span>
                  <span className="text-muted-foreground">contains</span>
                  <span className="font-semibold">{f.value}</span>
                  <button onClick={() => setSearchFilters(prev => prev.filter((_, idx) => idx !== i))} className="ml-0.5 hover:bg-destructive/20 rounded p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              <div className="relative flex-1 min-w-[180px]">
                <Input
                  className="h-8 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent px-1"
                  placeholder="พิมพ์เพื่อค้นหา…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowSearchDropdown(true); }}
                  onFocus={() => setShowSearchDropdown(true)}
                  onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
                />
                {showSearchDropdown && search.trim() && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border rounded-md shadow-lg w-80 max-h-80 overflow-y-auto">
                    {SEARCHABLE_COLS.map(col => (
                      <button
                        key={col}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-primary/10 text-left"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchFilters(prev => [...prev, { column: col, value: search.trim() }]);
                          setSearch("");
                          setShowSearchDropdown(false);
                        }}
                      >
                        <Search className="w-3 h-3 text-muted-foreground" />
                        <span>Search <span className="font-semibold text-primary">{SEARCH_COL_LABEL[col]}</span> for: <span className="font-mono">{search}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {(searchFilters.length > 0 || search) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSearchFilters([]); setSearch(""); }}>
                  <X className="w-3 h-3 mr-1" />Clear
                </Button>
              )}

              <div className="h-5 w-px bg-border" />

              {/* === Filters popover (รวม Columns/Fields/Hierarchy/Attributes/Stores) === */}
              {(() => {
                const activeFilterCount =
                  filters.division_group.length + filters.division.length + selectedDepartments.length +
                  filters.sub_department.length + filters.class.length + filters.item_type.length +
                  filters.buying_status.length + filters.product_owner.length +
                  selectedTypeStores.length + selectedStores.length +
                  (hiddenFields.length > 0 ? 1 : 0);
                return (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        <Filter className="h-3.5 w-3.5 mr-1" />Filters
                        {activeFilterCount > 0 && <Badge variant="default" className="ml-1.5 h-4 px-1 text-[10px]">{activeFilterCount}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[480px] p-3 space-y-2" align="end">
                      <div className="text-xs font-semibold text-muted-foreground">Columns & Fields</div>
                      <div className="flex flex-wrap gap-1.5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <Columns3 className="h-3 w-3 mr-1" />Columns ({selectedGroups.length})
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="start">
                            <div className="text-xs font-semibold mb-1.5 text-muted-foreground">กลุ่มคอลัมน์</div>
                            {(Object.keys(COL_GROUPS) as GroupKey[]).filter(g => g !== "unit_pick").map(g => (
                              <label key={g} className="flex items-center gap-2 cursor-pointer text-sm py-1 px-1 hover:bg-accent rounded">
                                <Checkbox checked={selectedGroups.includes(g)} onCheckedChange={(c) => setSelectedGroups(prev => c ? [...prev, g] : prev.filter(x => x !== g))} />
                                <span className="text-xs">{COL_GROUPS[g].label}</span>
                              </label>
                            ))}
                          </PopoverContent>
                        </Popover>
                        {allAvailableFields.length > 0 && (
                          <MultiSelectFilter
                            label="Fields"
                            icon={<Filter className="h-3 w-3 mr-1" />}
                            options={allAvailableFields}
                            selected={allAvailableFields.filter(f => !hiddenFields.includes(f))}
                            onChange={(visible) => setHiddenFields(allAvailableFields.filter(f => !visible.includes(f)))}
                            renderOption={(f) => COL_LABEL[f] || f}
                          />
                        )}
                      </div>

                      <div className="text-xs font-semibold text-muted-foreground pt-1">Hierarchy</div>
                      <div className="flex flex-wrap gap-1.5">
                        <MultiSelectFilter label="Div Grp" options={opts.division_group || []} selected={filters.division_group} onChange={(v) => setFilters({ ...filters, division_group: v })} />
                        <MultiSelectFilter label="Division" options={opts.division || []} selected={filters.division} onChange={(v) => setFilters({ ...filters, division: v })} />
                        <MultiSelectFilter label="Dept" options={deptOpts} selected={selectedDepartments} onChange={setSelectedDepartments} emptyHint="ขึ้นอยู่กับ Div Group / Division" />
                        <MultiSelectFilter label="Sub-Dept" options={subDeptOpts} selected={filters.sub_department} onChange={(v) => setFilters({ ...filters, sub_department: v })} />
                        <MultiSelectFilter label="Class" options={opts.class || []} selected={filters.class} onChange={(v) => setFilters({ ...filters, class: v })} />
                      </div>

                      <div className="text-xs font-semibold text-muted-foreground pt-1">Attributes</div>
                      <div className="flex flex-wrap gap-1.5">
                        <MultiSelectFilter label="Item Type" options={itemTypeOpts} selected={filters.item_type} onChange={(v) => setFilters({ ...filters, item_type: v })} />
                        <MultiSelectFilter label="Buying" options={buyingStatusOpts} selected={filters.buying_status} onChange={(v) => setFilters({ ...filters, buying_status: v })} />
                        <MultiSelectFilter label="Owner" options={productOwnerOpts} selected={filters.product_owner} onChange={(v) => setFilters({ ...filters, product_owner: v })} width="w-72" />
                      </div>

                      {showStores && (
                        <>
                          <div className="text-xs font-semibold text-muted-foreground pt-1">Stores</div>
                          <div className="flex flex-wrap gap-1.5">
                            <MultiSelectFilter label="Type" icon={<Building2 className="h-3 w-3 mr-1" />} options={typeStoreOpts} selected={selectedTypeStores} onChange={setSelectedTypeStores} width="w-48" />
                            <MultiSelectFilter label="Stores" icon={<Store className="h-3 w-3 mr-1" />} options={cache.stores.filter(s => selectedTypeStores.length === 0 || selectedTypeStores.includes(s.type_store)).map(s => s.name)} selected={selectedStores} onChange={setSelectedStores} />
                          </div>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                );
              })()}

              <Button size="sm" variant="default" className="h-8 text-xs" onClick={applyFilters} disabled={!cache.loaded.master}>
                <Play className="h-3.5 w-3.5 mr-1" />Show
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
                setFilters({ division_group: [], division: [], sub_department: [], class: [], item_type: [], buying_status: [], product_owner: [] });
                setSelectedDepartments([]); setSelectedTypeStores([]); setSelectedStores([]);
                setSearch(""); setSearchFilters([]); setHiddenFields([]);
                setApplied({
                  search: "", searchFilters: [],
                  filters: { division_group: [], division: [], sub_department: [], class: [], item_type: [], buying_status: [], product_owner: [] },
                  selectedDepartments: [], selectedStores: [], selectedTypeStores: [],
                });
              }}>Reset</Button>

              {/* === Select popover === */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    Select{effectiveSelectedSkus.size > 0 && <Badge variant="default" className="ml-1.5 h-4 px-1 text-[10px]">{effectiveSelectedSkus.size}</Badge>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  <Button size="sm" variant="ghost" className="w-full justify-start h-8 text-xs" onClick={selectAllFiltered} disabled={filtered.length === 0}>
                    All ({filtered.length.toLocaleString()})
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full justify-start h-8 text-xs" onClick={() => togglePageSelect(true)}>This Page</Button>
                  <Button size="sm" variant="ghost" className="w-full justify-start h-8 text-xs" onClick={clearSelection} disabled={effectiveSelectedSkus.size === 0}>
                    Clear ({effectiveSelectedSkus.size})
                  </Button>
                </PopoverContent>
              </Popover>

              {/* === Data popover (Import / Export / Clear Y/N) === */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />Data
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2 space-y-2" align="end">
                  {canImportRange && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1 flex items-center justify-between">
                      <span>IMPORT</span>
                      {importProgress && (
                        <span className="text-primary inline-flex items-center gap-1 normal-case">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          {importProgress.kind.toUpperCase()} · {importProgress.phase}
                          {importProgress.total > 0 && (
                            <> · {importProgress.current.toLocaleString()}/{importProgress.total.toLocaleString()} ({Math.round((importProgress.current / importProgress.total) * 100)}%)</>
                          )}
                        </span>
                      )}
                    </div>
                    {importProgress && importProgress.total > 0 && (
                      <div className="h-1 bg-muted rounded overflow-hidden mb-1">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.round((importProgress.current / importProgress.total) * 100))}%` }}
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-1">
                      {(["range"] as const).map(k => {
                        const isActive = importProgress?.kind === k;
                        return (
                        <div key={k} className="flex flex-col gap-0.5">
                          <label className={importBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}>
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleImport(e, k)} disabled={importBusy} />
                            <span className={`inline-flex items-center justify-center gap-1 px-2 py-1 border rounded text-[10px] w-full ${isActive ? "bg-primary/10 border-primary text-primary" : "hover:bg-accent"}`}>
                              {isActive ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Upload className="h-2.5 w-2.5" />}
                              {k.toUpperCase()}
                            </span>
                          </label>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => exportTemplate(k)}>
                            <FileText className="h-2.5 w-2.5 mr-0.5" />Tpl
                          </Button>
                        </div>
                        );
                      })}
                    </div>
                    {skippedRows && skippedRows.rows.length > 0 && (
                      <div className="mt-1.5 flex items-center justify-between gap-1 px-1.5 py-1 rounded border border-warning/40 bg-warning/10">
                        <div className="text-[10px] leading-tight min-w-0 flex-1">
                          <div className="font-semibold text-warning-foreground">
                            Skip {skippedRows.rows.length.toLocaleString()} rows · {skippedRows.kind.toUpperCase()}
                          </div>
                          <div className="text-muted-foreground truncate" title={skippedRows.fileName}>{skippedRows.fileName}</div>
                        </div>
                        <div className="flex gap-0.5 shrink-0">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={exportSkipList}>
                            <Download className="h-2.5 w-2.5 mr-0.5" />Skip
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setSkippedRows(null)} title="ปิด">
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1">EXPORT</div>
                    <div className="grid grid-cols-3 gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => doExport("all")} disabled={!!exporting || filtered.length === 0}>
                        <Download className="h-2.5 w-2.5 mr-1" />All
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => doExport("selected")} disabled={!!exporting || effectiveSelectedSkus.size === 0}>
                        <Download className="h-2.5 w-2.5 mr-1" />Sel
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => doExport("page")} disabled={!!exporting || pageRows.length === 0}>
                        <Download className="h-2.5 w-2.5 mr-1" />Page
                      </Button>
                    </div>
                    {exporting && <div className="text-[10px] text-primary inline-flex items-center gap-1 mt-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />exporting…</div>}
                  </div>

                  {canDeleteRange && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1">
                      <span>CLEAR Y/N</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mb-1.5">
                      {storesToShow.length > 0
                        ? `จะลบเฉพาะ ${storesToShow.length} ร้านค้า ตาม Filter`
                        : "ว่าง = ลบทุกร้านค้า (เลือก Stores ใน Filter ด้านบน)"}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] text-destructive"
                        onClick={() => clearRange("filtered", storesToShow, "y")}
                        disabled={!cache.loaded.perStore}
                      >
                        <Eraser className="h-2.5 w-2.5 mr-1" />ลบ Y
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        onClick={() => clearRange("filtered", storesToShow, "min")}
                        disabled={!cache.loaded.perStore}
                      >
                        <Eraser className="h-2.5 w-2.5 mr-1" />ลบ Min
                      </Button>
                    </div>
                  </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </Card>

          {/* PAGINATION BAR */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="text-muted-foreground">
              แสดง <b className="text-foreground">{showingFrom.toLocaleString()}–{showingTo.toLocaleString()}</b> จาก <b className="text-foreground">{filtered.length.toLocaleString()}</b> รายการ
              (ทั้งหมด {totalSku.toLocaleString()} SKU)
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Per page:</span>
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{[50, 100, 200, 500].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-3 w-3" /></Button>
              <span className="px-2 text-xs">หน้า {page} / {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight className="h-3 w-3" /></Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</Button>
            </div>
          </div>

          {/* TABLE */}
          <div className="border rounded overflow-auto" style={{ maxHeight: "70vh" }}>
            <table className="text-xs" style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: 36 }} />
                {visibleCols.map(c => <col key={c} style={{ width: colWidths[c] ?? DEFAULT_COL_W[c] ?? 100 }} />)}
                {showStores && storesToShow.map(s => (
                  <Fragment key={s}>
                    <col style={{ width: 50 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 60 }} />
                  </Fragment>
                ))}
              </colgroup>
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-1 py-1 text-center border-b">
                    <Checkbox
                      checked={pageAllSelected ? true : (pageSomeSelected ? "indeterminate" : false)}
                      onCheckedChange={(c) => togglePageSelect(!!c)}
                    />
                  </th>
                  {visibleCols.map(c => (
                    <th key={c} className="px-2 py-1 text-left whitespace-nowrap border-b relative select-none">
                      <span className="block truncate pr-3">{COL_LABEL[c] || c}</span>
                      <span
                        onMouseDown={(e) => onResizeStart(c, e)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/60 z-20"
                        style={{ userSelect: "none" }}
                      />
                    </th>
                  ))}
                  {showStores && storesToShow.map(s => {
                    const yCount = yCountByStore.get(s) || 0;
                    const yLoading = !cache.loaded.perStore;
                    return (
                      <th key={s} colSpan={3} className="px-2 py-1 text-center border-b border-l whitespace-nowrap" style={{ background: "hsl(48 96% 96%)" }}>
                        <div className="font-semibold">{s}</div>
                        <div className="text-[10px] font-normal text-muted-foreground inline-flex items-center gap-1 justify-center">
                          {yLoading ? (
                            <>
                              <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                              <span className="text-primary">กำลังโหลด...</span>
                            </>
                          ) : (
                            <>Y: <span className="text-primary font-semibold">{yCount.toLocaleString()}</span></>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
                {showStores && (
                  <tr className="bg-muted/50">
                    <th className="border-b" />
                    {visibleCols.map(c => <th key={c} className="border-b" />)}
                    {storesToShow.map(s => (
                      <Fragment key={s}>
                        <th className="px-1 py-0.5 text-[10px] border-b border-l" style={{ background: "hsl(48 96% 96%)" }}>Y/N</th>
                        <th className="px-1 py-0.5 text-[10px] border-b" style={{ background: "hsl(142 52% 96%)" }}>Min</th>
                        <th className="px-1 py-0.5 text-[10px] border-b" style={{ background: "hsl(210 52% 96%)" }}>Avg</th>
                      </Fragment>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {pageRows.map((r: any) => {
                  const isSelected = effectiveSelectedSkus.has(r.sku_code);
                  // Hover wins over pastel: use group-hover with !important via arbitrary variant
                  const hoverCls = "group-hover:!bg-[hsl(120_60%_88%)]";
                  const baseCls = isSelected ? "bg-primary/5" : "";
                  const cellCls = `border-b transition-colors ${baseCls} ${hoverCls}`;
                  return (
                    <tr key={r.sku_code} className={`group ${isSelected ? "bg-primary/5" : ""}`}>
                      <td className={`px-1 py-1 text-center ${cellCls}`}>
                        <Checkbox checked={isSelected} onCheckedChange={(c) => toggleSku(r.sku_code, !!c)} />
                      </td>
                      {visibleCols.map(c => {
                        if (c === "unit_picking_super" || c === "unit_picking_mart") {
                          const kind = c === "unit_picking_super" ? "super" : "mart";
                          const v = r[c];
                          const bg = c === "unit_picking_super" ? "hsl(280 52% 96%)" : "hsl(20 60% 94%)";
                          return (
                            <td key={c} className={`px-1 py-0.5 ${cellCls}`} style={{ background: bg }}>
                              <Input className="h-6 text-[11px] w-full" type="number" placeholder=""
                                defaultValue={v == null ? "" : String(v)}
                                onBlur={(e) => setUnitPickSku(r.sku_code, kind, e.target.value)} />
                            </td>
                          );
                        }
                        return (
                          <td key={c} className={`px-2 py-1 overflow-hidden ${cellCls}`}>
                            <div className="truncate" title={String(r[c] ?? "")}>
                              {typeof r[c] === "number" ? r[c].toLocaleString() : r[c] ?? ""}
                            </div>
                          </td>
                        );
                      })}
                      {showStores && storesToShow.map(s => {
                        const cell = (cache.ui.rangeMap.get(r.sku_code)?.get(s)) || { apply_yn: "N", min_display: 0 } as RangeCell;
                        const avgRaw = (r.avg_per_store || {})[s];
                        const avg = Number(avgRaw ?? 0);
                        const minV = cell.min_display;
                        const minStr = (minV === 0 || minV == null) ? "" : String(minV);
                        return (
                          <Fragment key={s}>
                            <td className={`px-1 py-0.5 border-l text-center ${cellCls}`} style={{ background: cell.apply_yn === "Y" ? undefined : "hsl(48 96% 96%)" }}>
                              <Button size="sm" variant={cell.apply_yn === "Y" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => toggleApply(r.sku_code, s)}>
                                {cell.apply_yn === "Y" ? "Y" : "N"}
                              </Button>
                            </td>
                            <td className={`px-1 py-0.5 ${cellCls}`} style={{ background: "hsl(142 52% 96%)" }}>
                              <Input key={`min-${r.sku_code}-${s}-${minStr}-${forceTick}`} className="h-6 w-14 text-[10px]" type="number" placeholder="" defaultValue={minStr}
                                onBlur={(e) => setMinDisplay(r.sku_code, s, e.target.value)} />
                            </td>
                            <td className={`px-1 py-0.5 text-right ${cellCls}`} style={{ background: "hsl(210 52% 96%)" }}>
                              {avg === 0 ? "" : avg.toFixed(2)}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {pageRows.length === 0 && (
                  <tr><td colSpan={Math.max(1, visibleCols.length + 1 + storesToShow.length * 3)} className="text-center p-8 text-muted-foreground">ไม่มีข้อมูล</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============ TAB 2 — Pivot + Dashboard (Report) ============ */}
        <TabsContent value="pivot" className="space-y-3 mt-2">
          {!pivotSnapshot ? (
            <Card className="p-6 text-center text-sm text-muted-foreground space-y-3">
              <div>ยังไม่มีรายงาน — กด <b>Get Report</b> เพื่อดึงข้อมูลปัจจุบันมาคำนวณ</div>
              <div className="text-xs">Live source: {liveSnapData.length.toLocaleString()} SKU · {liveSnapStores.length} stores</div>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={runPivotReport} disabled={liveSnapData.length === 0}>
                <Play className="h-3.5 w-3.5" /> Get Report
              </Button>
            </Card>
          ) : (
            <>
              {/* Toolbar: Doc info + filters + export */}
              <Card className="p-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs gap-1">
                  <FileText className="h-3 w-3" /> {latestSnap.name}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {latestSnap.item_count?.toLocaleString()} SKU · {latestSnapStores.length} stores
                </span>
                <div className="flex-1" />
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={runPivotReport} title="ดึงข้อมูลล่าสุด">
                  <RefreshCw className="h-3.5 w-3.5" /> Get Report
                </Button>
                <MultiSelectFilter
                  label={`SPC${skuSpcLoading ? " (กำลังโหลด…)" : ""}`}
                  options={pivotSpcOptions}
                  selected={pivotSpcFilter}
                  onChange={setPivotSpcFilter}
                />
                <MultiSelectFilter
                  label="Type Store"
                  options={pivotTypeStoreOptions}
                  selected={pivotTypeStoreFilter}
                  onChange={setPivotTypeStoreFilter}
                />
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={exportPivotXLSX} disabled={skuSpcLoading}>
                  <Download className="h-3.5 w-3.5" /> Export Excel
                </Button>
              </Card>

              {/* Loading progress banner */}
              {skuSpcLoading && (
                <Card className="p-3 border-primary/30 bg-primary/5">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          กำลังโหลดข้อมูล SPC / Vendor — {skuSpcProgress?.phase || "เตรียมข้อมูล"}
                        </span>
                        <span className="text-xs font-bold tabular-nums">{skuSpcProgress?.pct ?? 0}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${skuSpcProgress?.pct ?? 0}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        ตัวเลขที่แสดงเป็นค่าเบื้องต้น — จะอัปเดตเมื่อโหลดเสร็จ
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Grand total */}
              <Card className="p-3 bg-primary/5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">รวมจำนวน Y ทั้งหมด</div>
                    <div className="text-2xl font-bold tabular-nums">{pivotGrandTotal.toLocaleString()}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {storeBreakdowns.length} stores · เฉลี่ย {Math.round(pivotGrandTotal / Math.max(storeBreakdowns.length, 1)).toLocaleString()} SKU/store
                  </div>
                </div>
              </Card>

              {/* Y count per store */}
              <Card className="p-3">
                <h3 className="font-semibold mb-2 text-sm">จำนวน Y ต่อ Store</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {storeBreakdowns.map(b => (
                    <div key={b.store} className="border rounded p-2 text-center hover:bg-accent/30 transition-colors" title={b.store}>
                      <div className="text-[11px] text-muted-foreground truncate">{b.store}</div>
                      <div className="text-2xl font-bold tabular-nums">{b.total.toLocaleString()}</div>
                      <Badge variant="secondary" className="text-[9px] h-3.5 px-1 mt-0.5">{b.type_store}</Badge>
                    </div>
                  ))}
                  {storeBreakdowns.length === 0 && <div className="text-sm text-muted-foreground col-span-full text-center py-4">ไม่มีข้อมูล Y</div>}
                </div>
              </Card>

              {/* Breakdown per Store — match example template */}
              <Card className="p-3">
                <h3 className="font-semibold mb-3 text-sm">Breakdown ต่อ Store</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {storeBreakdowns.map(b => (
                    <div key={b.store} className="border border-foreground/40 rounded-sm overflow-hidden bg-background">
                      {/* Header — green pastel, store name + big total */}
                      <div
                        className="text-center border-b border-foreground/40 px-2 py-1.5"
                        style={{ background: "hsl(142,52%,88%)" }}
                      >
                        <div className="text-sm font-bold leading-tight">{b.store}</div>
                        <div className="text-xl font-bold tabular-nums leading-tight flex items-center justify-center gap-1">
                          {b.total.toLocaleString()}
                          {skuSpcLoading && <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
                        </div>
                      </div>
                      {/* 5×2 grid: Rank | Status/Type */}
                      <table className="w-full text-[11px] border-collapse">
                        <tbody>
                          <tr>
                            <td className="px-2 py-1 text-center border-b border-r border-foreground/40">A = <b>{b.rank.A.toLocaleString()}</b> SKU</td>
                            <td className="px-2 py-1 text-center border-b border-foreground/40">Active = <b>{b.status.Active.toLocaleString()}</b> SKU</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 text-center border-b border-r border-foreground/40">B = <b>{b.rank.B.toLocaleString()}</b> SKU</td>
                            <td className="px-2 py-1 text-center border-b border-foreground/40">Discontinue = <b>{b.status.Discontinue.toLocaleString()}</b> SKU</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 text-center border-b border-r border-foreground/40">C = <b>{b.rank.C.toLocaleString()}</b> SKU</td>
                            <td className="px-2 py-1 text-center border-b border-foreground/40">Basic Item = <b>{b.type.Basic.toLocaleString()}</b> SKU</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 text-center border-b border-r border-foreground/40">D = <b>{b.rank.D.toLocaleString()}</b> SKU</td>
                            <td className="px-2 py-1 text-center border-b border-foreground/40">Non Basic = <b>{b.type.NonBasic.toLocaleString()}</b> SKU</td>
                          </tr>
                          <tr>
                            <td className="px-2 py-1 text-center border-r border-foreground/40">Blank = <b>{b.rank.Blank.toLocaleString()}</b> SKU</td>
                            <td className="px-2 py-1 text-center text-muted-foreground">Other = <b>{b.status.Other.toLocaleString()}</b></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {storeBreakdowns.length === 0 && (
                    <div className="text-sm text-muted-foreground col-span-full text-center py-4">ไม่มีข้อมูล Y</div>
                  )}
                </div>
              </Card>

              {/* Department × Store */}
              <Card className="p-3">
                <h3 className="font-semibold mb-2 text-sm">Department × Store (Count Y)</h3>
                <div className="overflow-auto" style={{ maxHeight: "50vh" }}>
                  <table className="text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">Department</th>
                        {visibleStores.map(s => <th key={s} className="px-2 py-1 text-right whitespace-nowrap">{s}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(pivotByDeptStore).map(([dept, row]) => (
                        <tr key={dept} className="border-b">
                          <td className="px-2 py-1 font-medium">{dept}</td>
                          {visibleStores.map(s => <td key={s} className="px-2 py-1 text-right">{row[s] || ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ============ TAB 3 ============ */}
        <TabsContent value="docs" className="space-y-2 mt-2">
          <Card className="p-3">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">ชื่อ</th>
                  <th className="px-2 py-1 text-right">SKU</th>
                  <th className="px-2 py-1 text-right">Stores</th>
                  <th className="px-2 py-1 text-left">วันที่</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.id} className="border-b hover:bg-accent/50 cursor-pointer" onDoubleClick={() => openSnapshotPreview(s)}>
                    <td className="px-2 py-1">{s.name}</td>
                    <td className="px-2 py-1 text-right">{s.item_count}</td>
                    <td className="px-2 py-1 text-right">{(s.store_list || []).length}</td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString("th-TH")}</td>
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openSnapshotPreview(s)}><Eye className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteSnapshot(s.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </td>
                  </tr>
                ))}
                {snapshots.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">ยังไม่มี Document — กด Save All ด้านบน</td></tr>}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Post-Import Dialog: Save to Doc / Download Skip */}
      <Dialog open={!!importDoneDialog} onOpenChange={(o) => { if (!o) setImportDoneDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              ✅ Import {importDoneDialog?.kind.toUpperCase()} เสร็จสิ้น
            </DialogTitle>
          </DialogHeader>
          {importDoneDialog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">นำเข้า</div>
                  <div className="text-lg font-bold text-emerald-600 tabular-nums">
                    {importDoneDialog.saved.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {importDoneDialog.skus.toLocaleString()} SKU · {importDoneDialog.stores.toLocaleString()} store
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">ข้าม (Skip)</div>
                  <div className={`text-lg font-bold tabular-nums ${importDoneDialog.skipped > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {importDoneDialog.skipped.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {importDoneDialog.fileName}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                ✓ บันทึกลง <code className="text-foreground">range_store</code> และ sync <code className="text-foreground">range_store_view</code> แล้ว
              </div>
              {importDoneDialog.kind === "range" && importDoneDialog.yPerStore && importDoneDialog.yPerStore.length > 0 && (
                <div className="border rounded">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-muted/60 text-[10px] uppercase text-muted-foreground font-semibold">
                    <div>Store</div>
                    <div className="text-right">Y เดิม</div>
                    <div className="text-right">+ Added</div>
                    <div className="text-right">− Removed</div>
                    <div className="text-right">รวม</div>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto">
                    {importDoneDialog.yPerStore.map(r => (
                      <div key={r.store} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-1 text-xs border-t tabular-nums">
                        <div className="truncate" title={r.store}>{r.store}</div>
                        <div className="text-right text-muted-foreground">{r.oldY.toLocaleString()}</div>
                        <div className="text-right text-emerald-600 font-medium">{r.addedY > 0 ? `+${r.addedY.toLocaleString()}` : "0"}</div>
                        <div className="text-right text-rose-600 font-medium">{r.removedY > 0 ? `−${r.removedY.toLocaleString()}` : "0"}</div>
                        <div className="text-right font-semibold">{r.totalY.toLocaleString()} SKU</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 flex-wrap pt-2">
                {importDoneDialog.skipped > 0 && (
                  <Button variant="outline" size="sm" onClick={exportSkipList} className="text-xs">
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Download Skip ({importDoneDialog.skipped.toLocaleString()})
                  </Button>
                )}
                <Button size="sm" className="text-xs ml-auto" onClick={() => setImportDoneDialog(null)}>
                  ปิด
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewSnap} onOpenChange={() => setPreviewSnap(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle className="text-sm">
                {previewSnap?.name} <Badge variant="secondary">{previewSnap?.item_count} SKU</Badge>
                <Badge variant="outline" className="ml-1">{(previewSnap?.store_list || []).length} stores</Badge>
              </DialogTitle>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => exportSnapshotXLSX(previewSnap)}
                  disabled={previewLoading || !previewSnap?.data?.length}
                >
                  <FileSpreadsheet className="h-3 w-3 mr-1" />Export Excel
                </Button>
            </div>
          </DialogHeader>
          {previewSnap && (() => {
            const data: any[] = previewSnap.data || [];
            const stores: string[] = (previewSnap.store_list || []).slice().sort();
            if (previewLoading) {
              return <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />กำลังโหลดข้อมูล Document...</div>;
            }
            // คอลัมน์พื้นฐาน (ตัด range_data + avg_per_store ออกจาก plain columns เพราะเรา expand เป็น per-store cols)
            const baseKeys = data[0] ? Object.keys(data[0]).filter(k => k !== "range_data" && k !== "avg_per_store") : [];
            return (
              <div className="overflow-auto flex-1 border rounded">
                <table className="text-[11px] w-full">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      {baseKeys.map(k => (
                        <th key={k} className="px-2 py-1 text-left whitespace-nowrap border-r">{COL_LABEL[k] || k}</th>
                      ))}
                      {stores.map(s => (
                        <Fragment key={s}>
                          <th className="px-2 py-1 text-center whitespace-nowrap border-r" style={{ background: "hsl(48,96%,92%)" }} title={`${s} - Range Y/N`}>{s}<br/><span className="text-[9px] text-muted-foreground">Y/N</span></th>
                          <th className="px-2 py-1 text-center whitespace-nowrap border-r" style={{ background: "hsl(142,52%,92%)" }} title={`${s} - Min`}><span className="text-[9px] text-muted-foreground">Min</span></th>
                          <th className="px-2 py-1 text-center whitespace-nowrap border-r" style={{ background: "hsl(210,52%,92%)" }} title={`${s} - Avg/Day`}><span className="text-[9px] text-muted-foreground">Avg/D</span></th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 500).map((r: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        {baseKeys.map(k => (
                          <td key={k} className="px-2 py-1 whitespace-nowrap border-r">{typeof r[k] === "number" ? r[k].toLocaleString() : String(r[k] ?? "")}</td>
                        ))}
                        {stores.map(s => {
                          const cell = (r.range_data || {})[s] || {};
                          const minV = cell.min_display;
                          const avgV = (r.avg_per_store || {})[s];
                          return (
                            <Fragment key={s}>
                              <td className="px-2 py-1 text-center border-r" style={{ background: "hsl(48,96%,96%)" }}>{cell.apply_yn || ""}</td>
                              <td className="px-2 py-1 text-center border-r" style={{ background: "hsl(142,52%,96%)" }}>{minV === 0 || minV == null ? "" : minV}</td>
                              <td className="px-2 py-1 text-center border-r" style={{ background: "hsl(210,52%,96%)" }}>{avgV === 0 || avgV == null ? "" : Number(avgV).toFixed(2)}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length > 500 && (
                  <div className="text-[10px] text-muted-foreground text-center p-2 bg-muted/30">
                    แสดง 500 แถวแรก จาก {data.length.toLocaleString()} แถว — กด Export Excel เพื่อดูทั้งหมด
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
