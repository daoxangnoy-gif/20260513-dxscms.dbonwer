import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Calculator, Download, Upload, Save, Filter, RefreshCw, Search, FileSpreadsheet, Trash2, FileDown } from "lucide-react";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import * as XLSX from "xlsx";
import { buildSheetWithFormulaRow } from "@/lib/srrExportFormulas";
import { buildSARFormulaRow } from "@/lib/sarExportFormulas";
import { cn } from "@/lib/utils";
import SAROnOrderDCTab from "@/components/SAROnOrderDCTab";
import SARSkuNoOrderTab from "@/components/SARSkuNoOrderTab";
import SAROrderFromStoreTab from "@/components/SAROrderFromStoreTab";
import StorePriorityDialog from "@/components/StorePriorityDialog";
import { SARRow, computeRow } from "@/lib/sarCalc";
import { Percent, ListOrdered } from "lucide-react";
import { sarState, type ImportedQty } from "@/lib/sarState";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ImportSkipBar, ImportSkipDialog, type SkippedItem } from "@/components/ImportSkipDialog";

type Mode = "filter" | "import";
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 5000, 10000];

interface DocRowRaw {
  sku_code: string;
  product_name_la: string | null;
  product_name_en: string | null;
  main_barcode: string | null;
  unit_of_measure: string | null;
  store_name: string;
  type_store: string;
  size_store?: string;
  unit_pick?: number;
  unit_pick_edit?: number | null;
  pack_qty?: number | null;
  box_qty?: number | null;
  avg_sale?: number;
  rank_sale?: string;
  rank_factor?: number;
  item_type?: string;
  buying_status?: string;
  division?: string;
  department?: string;
  sub_department?: string;
  class?: string;
  min_cal?: number;
  max_cal?: number;
  min_final?: number;
  max_final?: number;
}

const COLS: { key: keyof SARRow; label: string; w?: number; right?: boolean; editable?: boolean }[] = [
  { key: "store_name", label: "Store Name", w: 130 },
  { key: "type_store", label: "Type Store", w: 90 },
  { key: "division", label: "Division", w: 100 },
  { key: "department", label: "Department", w: 110 },
  { key: "sub_department", label: "Sub-Department", w: 130 },
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
  { key: "stock_store", label: "Store Stock", w: 90, right: true },
  { key: "sar_suggest1", label: "SAR Suggest1", w: 100, right: true },
  { key: "sar_suggest2", label: "SAR Suggest2", w: 100, right: true },
  { key: "on_order", label: "On Order", w: 80, right: true },
  { key: "tt_order", label: "TT Order", w: 80, right: true },
  { key: "pack_size", label: "Packsize", w: 80 },
  { key: "suggest_order_edit", label: "Suggest Order Edit", w: 130, right: true, editable: true },
  { key: "final_order_unit", label: "Final Order/Unit", w: 120, right: true },
  { key: "final_order_uom", label: "Final Order/UOM", w: 120, right: true },
  { key: "doh_min", label: "DOH MIN", w: 80, right: true },
  { key: "doh_max", label: "DOH MAX", w: 80, right: true },
  { key: "doh_stock", label: "DOH Stock", w: 80, right: true },
  { key: "doh_tobe", label: "DOH Tobe", w: 80, right: true },
];

const HIGHLIGHT_COLS = new Set(["sar_suggest1", "sar_suggest2", "tt_order", "final_order_unit", "final_order_uom"]);

const CALC_NUM_KEYS = new Set(["stock_dc", "stock_store", "on_order", "sar_suggest1", "sar_suggest2", "tt_order", "final_order_unit", "final_order_uom", "doh_min", "doh_max", "doh_stock", "doh_tobe"]);

function fmtNumber(v: any, key: string, calculated: boolean): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v !== "number") return String(v);
  // For calculated formula columns on a calculated row, always show the value (including 0)
  if (v === 0) {
    if (key === "suggest_order_edit") return "-";
    if (calculated && CALC_NUM_KEYS.has(key)) return "0";
    return "-";
  }
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtFile(ts: Date) {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${ts.getFullYear()}${p(ts.getMonth() + 1)}${p(ts.getDate())}${p(ts.getHours())}${p(ts.getMinutes())}${p(ts.getSeconds())}`;
}

// Real-time elapsed seconds since `startedAt` (ms). Re-renders every 100ms.
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = ((Date.now() - startedAt) / 1000).toFixed(1);
  return <span className="text-[11px] font-mono tabular-nums text-primary font-semibold">⏱ {s}s</span>;
}

export default function SARPage() {
  const { user, isAdmin, canDo } = useAuth();

  const canCal      = isAdmin || canDo("read-cal",     "view");
  const canOnOrder  = isAdmin || canDo("on-order-dc",  "view");
  const canSkuNoOrd = isAdmin || canDo("sku-no-order", "view");
  const canOFS      = isAdmin || canDo("ofs_import",   "view") || canDo("ofs_hq", "view") || canDo("ofs_result", "view");
  const canDocs     = isAdmin || canDo("docs",         "view");
  const { toast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState<"cal" | "on_order_dc" | "sku_no_order" | "docs" | "order_from_store">("cal");
  const [priorityOpen, setPriorityOpen] = useState(false);

  // Mode + filter state (restore from module cache for persistence across navigation)
  const [mode, setMode] = useState<Mode>(sarState.mode);
  const [storeFilter, setStoreFilter] = useState<string[]>(sarState.storeFilter);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>(sarState.typeStoreFilter);
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>(sarState.itemTypeFilter);
  const [buyingFilter, setBuyingFilter] = useState<string[]>(sarState.buyingFilter);
  const [divisionFilter, setDivisionFilter] = useState<string[]>(sarState.divisionFilter);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>(sarState.departmentFilter);
  const [subDeptFilter, setSubDeptFilter] = useState<string[]>(sarState.subDeptFilter);
  const [classFilter, setClassFilter] = useState<string[]>(sarState.classFilter);
  const [skuFilter, setSkuFilter] = useState<string[]>(sarState.skuFilter);
  const [barcodeFilter, setBarcodeFilter] = useState<string[]>(sarState.barcodeFilter);

  // filterOpts is derived from rawDoc cross-filter counts below

  // Import barcode/sku set
  const [importedSet, setImportedSet] = useState<Set<string>>(new Set(sarState.importedKeys));
  const [importedFileLabel, setImportedFileLabel] = useState<string>(sarState.importedFileLabel);
  const [importedRows, setImportedRows] = useState<ImportedQty[]>(sarState.importedRows);
  const [importSkipped, setImportSkipped] = useState<SkippedItem[]>(sarState.importSkipped);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);

  // Data state (restored from cache)
  const [rows, setRows] = useState<SARRow[]>(sarState.rows);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calculated, setCalculated] = useState(sarState.calculated);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(500);
  const [search, setSearch] = useState("");

  // Progress
  const [progressLabel, setProgressLabel] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  // Save & Export
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [perPO, setPerPO] = useState<number>(50);

  // Snapshots tab data
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set());

  // Rows whose Suggest2 was overridden by %Par allocation — for cell highlight
  const [parAdjusted, setParAdjusted] = useState<Set<number>>(new Set());
  const [calcParRunning, setCalcParRunning] = useState(false);

  // ----- Persist key state to module cache -----
  useEffect(() => { sarState.rows = rows; sarState.calculated = calculated; }, [rows, calculated]);
  useEffect(() => {
    sarState.mode = mode;
    sarState.storeFilter = storeFilter;
    sarState.typeStoreFilter = typeStoreFilter;
    sarState.itemTypeFilter = itemTypeFilter;
    sarState.buyingFilter = buyingFilter;
    sarState.divisionFilter = divisionFilter;
    sarState.departmentFilter = departmentFilter;
    sarState.subDeptFilter = subDeptFilter;
    sarState.classFilter = classFilter;
    sarState.skuFilter = skuFilter;
    sarState.barcodeFilter = barcodeFilter;
    sarState.importedKeys = Array.from(importedSet);
    sarState.importedFileLabel = importedFileLabel;
    sarState.importedRows = importedRows;
    sarState.importSkipped = importSkipped;
  }, [mode, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, divisionFilter, departmentFilter, subDeptFilter, classFilter, skuFilter, barcodeFilter, importedSet, importedFileLabel, importedRows, importSkipped]);

  // Raw doc cache for cross-filter counts
  const [rawDoc, setRawDoc] = useState<DocRowRaw[]>([]);
  const [rawDocLoading, setRawDocLoading] = useState(false);

  // Elapsed-time tracking for ดึงข้อมูล / คำนวณ
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const [calcStartedAt, setCalcStartedAt] = useState<number | null>(null);

  const loadRawDoc = useCallback(async () => {
    setRawDocLoading(true);
    try {
      const { data } = await supabase
        .from("minmax_cal_documents")
        .select("data")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (!data?.data || !Array.isArray(data.data)) return;
      const raw = data.data as unknown as DocRowRaw[];

      // Enrich with data_master so filter dropdowns show full Division/Dept/SubDept/Class/ItemType/BuyingStatus
      const needsEnrich = raw.some(r => !r.division || !r.department || !r.sub_department || !r.class || !r.item_type || !r.buying_status);
      if (needsEnrich) {
        const skus = Array.from(new Set(raw.map(r => r.sku_code).filter(Boolean)));
        const dmMap = new Map<string, { division: string; department: string; sub_department: string; class: string; item_type: string; buying_status: string }>();
        const CHUNK = 500;
        for (let i = 0; i < skus.length; i += CHUNK) {
          const slice = skus.slice(i, i + CHUNK);
          let off = 0;
          const PAGE = 1000;
          while (true) {
            const { data: dm, error } = await supabase.from("data_master")
              .select("sku_code, division, department, sub_department, class, item_type, buying_status")
              .in("sku_code", slice)
              .range(off, off + PAGE - 1);
            if (error) break;
            const batch = dm || [];
            for (const m of batch as any[]) {
              if (!m.sku_code) continue;
              const ex = dmMap.get(m.sku_code);
              if (!ex || (!ex.division && m.division)) {
                dmMap.set(m.sku_code, {
                  division: m.division || ex?.division || "",
                  department: m.department || ex?.department || "",
                  sub_department: m.sub_department || ex?.sub_department || "",
                  class: m.class || ex?.class || "",
                  item_type: m.item_type || ex?.item_type || "",
                  buying_status: m.buying_status || ex?.buying_status || "",
                });
              }
            }
            if (batch.length < PAGE) break;
            off += PAGE;
          }
        }
        const enriched = raw.map(r => {
          const m = dmMap.get(r.sku_code);
          if (!m) return r;
          return {
            ...r,
            division: r.division || m.division,
            department: r.department || m.department,
            sub_department: r.sub_department || m.sub_department,
            class: r.class || m.class,
            item_type: r.item_type || m.item_type,
            buying_status: r.buying_status || m.buying_status,
          };
        });
        setRawDoc(enriched);
      } else {
        setRawDoc(raw);
      }
    } catch (e: any) {
      console.warn("load raw doc", e);
    } finally {
      setRawDocLoading(false);
    }
  }, []);
  useEffect(() => { loadRawDoc(); }, [loadRawDoc]);

  // Cross-filter aware option counts (each field's count ignores its own selection)
  // Optimized: O(N × activeFilters) using Set.has + pre-extracted row values
  const filterCounts = useMemo(() => {
    const keys = ["stores", "types", "itemTypes", "buyings", "divisions", "departments", "subDepartments", "classes"] as const;
    const cols: (keyof DocRowRaw)[] = ["store_name", "type_store", "item_type", "buying_status", "division", "department", "sub_department", "class"];
    const sels = [storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, divisionFilter, departmentFilter, subDeptFilter, classFilter];
    const selSets: (Set<string> | null)[] = sels.map(s => s.length ? new Set(s) : null);
    const activeIdx: number[] = [];
    for (let i = 0; i < 8; i++) if (selSets[i]) activeIdx.push(i);
    const out: Record<string, Record<string, number>> = {};
    for (const k of keys) out[k] = {};
    const vals = new Array<string>(8);
    for (let i = 0; i < rawDoc.length; i++) {
      const r = rawDoc[i] as any;
      for (let j = 0; j < 8; j++) {
        const v = r[cols[j]];
        vals[j] = v == null ? "" : String(v);
      }
      // Count active filters that this row fails
      let firstMiss = -1, missCount = 0;
      for (const ai of activeIdx) {
        if (!selSets[ai]!.has(vals[ai])) {
          if (++missCount === 1) firstMiss = ai;
          else break;
        }
      }
      if (missCount === 0) {
        // Row matches all → contribute to every field's count
        for (let j = 0; j < 8; j++) {
          const v = vals[j];
          if (v) out[keys[j]][v] = (out[keys[j]][v] || 0) + 1;
        }
      } else if (missCount === 1) {
        // Row matches all except one → contribute only to that one field
        const v = vals[firstMiss];
        if (v) out[keys[firstMiss]][v] = (out[keys[firstMiss]][v] || 0) + 1;
      }
      // missCount >= 2 → row contributes to nothing
    }
    return out;
  }, [rawDoc, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, divisionFilter, departmentFilter, subDeptFilter, classFilter]);

  // Filter options derived from counts (only show keys with count > 0 given other selections)
  const filterOpts = useMemo(() => ({
    stores: Object.keys(filterCounts.stores || {}),
    types: Object.keys(filterCounts.types || {}),
    itemTypes: Object.keys(filterCounts.itemTypes || {}),
    buyings: Object.keys(filterCounts.buyings || {}),
    divisions: Object.keys(filterCounts.divisions || {}),
    departments: Object.keys(filterCounts.departments || {}),
    subDepartments: Object.keys(filterCounts.subDepartments || {}),
    classes: Object.keys(filterCounts.classes || {}),
  }), [filterCounts]);

  // Unique stores for Priority dialog (from current Min/Max doc)
  const priorityStores = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rawDoc) {
      if (r.store_name && !map.has(r.store_name)) map.set(r.store_name, r.type_store || "");
    }
    return Array.from(map.entries()).map(([store_name, type_store]) => ({ store_name, type_store }));
  }, [rawDoc]);

  // ----- Step 1: ดึงข้อมูล (load latest Min/Max doc) -----
  const fetchData = async () => {
    setLoading(true);
    setLoadStartedAt(Date.now());
    try {
      setProgressLabel("กำลังโหลด Min/Max Doc...");
      setProgressPct(5);
      const { data: doc, error } = await supabase
        .from("minmax_cal_documents")
        .select("data, doc_name, created_at")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw error;
      if (!doc?.data || !Array.isArray(doc.data)) {
        toast({ title: "ไม่พบ Min/Max Doc", description: "กรุณาคำนวณ Min/Max ก่อน", variant: "destructive" });
        setRows([]); setCalculated(false);
        return;
      }
      const raw = doc.data as unknown as DocRowRaw[];
      setProgressLabel(`Doc โหลดแล้ว ${raw.length.toLocaleString()} แถว — กำลังกรอง...`);
      setProgressPct(20);

      // Enrich raw rows with data_master category fields BEFORE filtering
      // (raw doc lacks division/department/sub_department/class/item_type/buying_status)
      const needCat =
        divisionFilter.length || departmentFilter.length || subDeptFilter.length ||
        classFilter.length || itemTypeFilter.length || buyingFilter.length;
      let working: DocRowRaw[] = raw;
      if (needCat) {
        const needsEnrich = raw.some(r =>
          !r.division || !r.department || !r.sub_department || !r.class || !r.item_type || !r.buying_status);
        if (needsEnrich) {
          setProgressLabel("กำลังเสริมหมวดหมู่จาก Master...");
          const skus = Array.from(new Set(raw.map(r => r.sku_code).filter(Boolean)));
          const dmCat = new Map<string, { division: string; department: string; sub_department: string; class: string; item_type: string; buying_status: string }>();
          const CHUNK = 500;
          for (let i = 0; i < skus.length; i += CHUNK) {
            const slice = skus.slice(i, i + CHUNK);
            let off = 0;
            const PAGE = 1000;
            while (true) {
              const { data: dm, error: dmErr } = await supabase.from("data_master")
                .select("sku_code, division, department, sub_department, class, item_type, buying_status")
                .in("sku_code", slice)
                .range(off, off + PAGE - 1);
              if (dmErr) throw dmErr;
              const batch = (dm || []) as any[];
              for (const m of batch) {
                if (!m.sku_code) continue;
                const ex = dmCat.get(m.sku_code);
                dmCat.set(m.sku_code, {
                  division: m.division || ex?.division || "",
                  department: m.department || ex?.department || "",
                  sub_department: m.sub_department || ex?.sub_department || "",
                  class: m.class || ex?.class || "",
                  item_type: m.item_type || ex?.item_type || "",
                  buying_status: m.buying_status || ex?.buying_status || "",
                });
              }
              if (batch.length < PAGE) break;
              off += PAGE;
            }
          }
          working = raw.map(r => {
            const c = dmCat.get(r.sku_code);
            if (!c) return r;
            return {
              ...r,
              division: r.division || c.division,
              department: r.department || c.department,
              sub_department: r.sub_department || c.sub_department,
              class: r.class || c.class,
              item_type: r.item_type || c.item_type,
              buying_status: r.buying_status || c.buying_status,
            };
          });
        }
      }

      // Apply mode filter
      let filtered = working;
      if (mode === "filter") {
        filtered = working.filter(r =>
          (storeFilter.length === 0 || storeFilter.includes(r.store_name)) &&
          (typeStoreFilter.length === 0 || typeStoreFilter.includes(r.type_store)) &&
          (itemTypeFilter.length === 0 || itemTypeFilter.includes(r.item_type || "")) &&
          (buyingFilter.length === 0 || buyingFilter.includes(r.buying_status || "")) &&
          (divisionFilter.length === 0 || divisionFilter.includes(r.division || "")) &&
          (departmentFilter.length === 0 || departmentFilter.includes(r.department || "")) &&
          (subDeptFilter.length === 0 || subDeptFilter.includes(r.sub_department || "")) &&
          (classFilter.length === 0 || classFilter.includes(r.class || "")) &&
          (skuFilter.length === 0 || skuFilter.includes(r.sku_code)) &&
          (barcodeFilter.length === 0 || (r.main_barcode != null && barcodeFilter.includes(r.main_barcode)))
        );
      } else {
        if (importedSet.size === 0) {
          toast({ title: "ยังไม่ Import", description: "กรุณา Import barcode/SKU ก่อน", variant: "destructive" });
          return;
        }
        // Imported keys อาจเป็น sku_code หรือ barcode (main_barcode/barcode)
        // Doc rows มีแต่ sku_code → ต้อง resolve barcode → sku_code จาก data_master ก่อน
        setProgressLabel(`กำลัง resolve barcode → SKU (${importedSet.size.toLocaleString()} keys)...`);
        const keys = Array.from(importedSet);
        const resolvedSkus = new Set<string>();
        // ใส่ key ที่อาจเป็น sku_code ตรง ๆ
        for (const k of keys) resolvedSkus.add(k);
        // Query data_master ด้วย main_barcode / barcode in (keys) แบบ batch
        const CHUNK_BC = 500;
        for (let i = 0; i < keys.length; i += CHUNK_BC) {
          const slice = keys.slice(i, i + CHUNK_BC);
          const { data: bcRows, error: bcErr } = await supabase
            .from("data_master")
            .select("sku_code, main_barcode, barcode")
            .or(`main_barcode.in.(${slice.map(s => `"${s}"`).join(",")}),barcode.in.(${slice.map(s => `"${s}"`).join(",")})`);
          if (bcErr) {
            console.warn("[SAR import] barcode resolve error", bcErr);
            continue;
          }
          for (const m of (bcRows || []) as any[]) {
            if (m.sku_code) resolvedSkus.add(String(m.sku_code));
          }
        }
        filtered = working.filter(r => resolvedSkus.has(r.sku_code));
        if (filtered.length === 0) {
          toast({ title: "ไม่พบข้อมูล", description: `Import ${importedSet.size} keys แต่ไม่ match กับ Min/Max Doc`, variant: "destructive" });
        }
      }

      setProgressLabel(`กรองได้ ${filtered.length.toLocaleString()} แถว — กำลังเสริม Division/Pack/Box จาก Master...`);
      setProgressPct(40);

      // ----- Enrich missing fields from data_master + range_store_view -----
      const skus = Array.from(new Set(filtered.map(r => r.sku_code).filter(Boolean)));
      const dmMap = new Map<string, { division: string; department: string; sub_department: string; class: string; item_type: string; buying_status: string }>();
      const mainBarcodeMap = new Map<string, string>(); // sku → main_barcode where packing_size_qty=1
      const priceMap = new Map<string, { cost: number | null; price2km: number | null; price_jm: number | null }>(); // sku → prices where packing_size_qty=1
      const rsvMap = new Map<string, { pack_qty: number | null; box_qty: number | null }>();
      const CHUNK = 200;
      let done = 0;

      // Paginated fetch helper (bypasses PostgREST 1000-row default)
      const fetchAllDM = async (slice: string[]) => {
        const all: any[] = [];
        let off = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await supabase.from("data_master")
            .select("sku_code, division, department, sub_department, class, item_type, buying_status, main_barcode, packing_size_qty, standard_price, list_price, jmart_price")
            .in("sku_code", slice)
            .range(off, off + PAGE - 1);
          if (error) throw error;
          const batch = data || [];
          all.push(...batch);
          if (batch.length < PAGE) break;
          off += PAGE;
        }
        return all;
      };

      for (let i = 0; i < skus.length; i += CHUNK) {
        const slice = skus.slice(i, i + CHUNK);
        const [dmRows, rsvRes] = await Promise.all([
          fetchAllDM(slice),
          supabase.from("range_store_view")
            .select("sku_code, pack_qty, box_qty")
            .in("sku_code", slice),
        ]);
        for (const m of dmRows as any[]) {
          if (!m.sku_code) continue;
          // Capture category fields (first non-empty wins)
          const existing = dmMap.get(m.sku_code);
          if (!existing || (!existing.division && m.division)) {
            dmMap.set(m.sku_code, {
              division: m.division || existing?.division || "",
              department: m.department || existing?.department || "",
              sub_department: m.sub_department || existing?.sub_department || "",
              class: m.class || existing?.class || "",
              item_type: m.item_type || existing?.item_type || "",
              buying_status: m.buying_status || existing?.buying_status || "",
            });
          }
          // Capture main_barcode + prices WHERE packing_size_qty = 1
          const pkg = m.packing_size_qty == null ? null : Number(m.packing_size_qty);
          if (pkg === 1) {
            if (m.main_barcode && !mainBarcodeMap.has(m.sku_code)) {
              mainBarcodeMap.set(m.sku_code, m.main_barcode);
            }
            if (!priceMap.has(m.sku_code)) {
              priceMap.set(m.sku_code, {
                cost: m.standard_price == null ? null : Number(m.standard_price),
                price2km: m.list_price == null ? null : Number(m.list_price),
                price_jm: m.jmart_price == null ? null : Number(m.jmart_price),
              });
            }
          }
        }
        for (const m of (rsvRes.data || []) as any[]) {
          if (m.sku_code) rsvMap.set(m.sku_code, {
            pack_qty: m.pack_qty == null ? null : Number(m.pack_qty),
            box_qty: m.box_qty == null ? null : Number(m.box_qty),
          });
        }
        done += slice.length;
        setProgressPct(40 + Math.round((done / Math.max(1, skus.length)) * 50));
        setProgressLabel(`เสริมข้อมูล Master ${done.toLocaleString()}/${skus.length.toLocaleString()}`);
      }

      // Map to SARRow (prefer doc values, fallback to master/rsv)
      const mapped: SARRow[] = filtered.map(r => {
        const dm = dmMap.get(r.sku_code);
        const rsv = rsvMap.get(r.sku_code);
        const mb1 = mainBarcodeMap.get(r.sku_code) || null;
        const pr = priceMap.get(r.sku_code);
        const up = Number(r.unit_pick_edit ?? r.unit_pick ?? 1) || 1;
        return {
          sku_code: r.sku_code,
          main_barcode: mb1 ?? r.main_barcode,
          product_name_la: r.product_name_la,
          product_name_en: r.product_name_en,
          unit_of_measure: r.unit_of_measure,
          store_name: r.store_name,
          type_store: r.type_store || "",
          division: r.division || dm?.division || "",
          department: r.department || dm?.department || "",
          sub_department: r.sub_department || dm?.sub_department || "",
          item_type: r.item_type || dm?.item_type || "",
          buying_status: r.buying_status || dm?.buying_status || "",
          unit_pick: up,
          pack_qty: r.pack_qty ?? rsv?.pack_qty ?? null,
          box_qty: r.box_qty ?? rsv?.box_qty ?? null,
          cost: pr?.cost ?? null,
          price2km: pr?.price2km ?? null,
          price_jm: pr?.price_jm ?? null,
          pack_size: up === 1 ? "Unit" : `1x${up}`,
          avg_sale: Number(r.avg_sale) || 0,
          rank_sale: r.rank_sale || "D",
          rank_factor: Number(r.rank_factor) || 7,
          min_val: Number(r.min_final ?? r.min_cal ?? 0) || 0,
          max_val: Number(r.max_final ?? r.max_cal ?? 0) || 0,
          stock_dc: 0,
          stock_store: 0,
          on_order: 0,
          sar_suggest1: 0,
          sar_suggest2: 0,
          tt_order: 0,
          suggest_order_edit: null,
          final_order_unit: 0,
          final_order_uom: 0,
          doh_min: 0,
          doh_max: 0,
          doh_stock: 0,
          doh_tobe: 0,
          calculated: false,
        };
      });

      setProgressPct(100);
      const _excluded = await (await import("@/lib/filterTemplates")).applyExcludeFilters(mapped as any[], "sar");
      setRows(_excluded as any);
      setCalculated(false);
      setPage(0);
      toast({ title: `ดึงข้อมูลสำเร็จ`, description: `${mapped.length.toLocaleString()} แถว จาก ${doc.doc_name}` });
    } catch (e: any) {
      toast({ title: "Load error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadStartedAt(null);
      setTimeout(() => { setProgressPct(0); setProgressLabel(""); }, 800);
    }
  };

  // ----- Step 2: คำนวณ -----
  const doCalculate = async () => {
    if (rows.length === 0) {
      toast({ title: "ยังไม่มีข้อมูล", description: "กด 'ดึงข้อมูล' ก่อน", variant: "destructive" });
      return;
    }
    setCalculating(true);
    setCalcStartedAt(Date.now());
    try {
      const skus = Array.from(new Set(rows.map(r => r.sku_code)));

      setProgressLabel("กำลังโหลด Stock...");
      setProgressPct(5);

      // 1) Fetch stock — DC sum by type_store=DC; store keyed by company (= store_name)
      const stockMap = new Map<string, { dc: number; store: Map<string, number> }>();
      const PAGE = 1000;
      let stockDone = 0;
      for (let i = 0; i < skus.length; i += 500) {
        const slice = skus.slice(i, i + 500);
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("stock")
            .select("item_id, type_store, company, quantity")
            .in("item_id", slice)
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data || []) as any[];
          for (const s of batch) {
            const sku = s.item_id;
            if (!sku) continue;
            if (!stockMap.has(sku)) stockMap.set(sku, { dc: 0, store: new Map() });
            const entry = stockMap.get(sku)!;
            const qty = Number(s.quantity) || 0;
            const ts = String(s.type_store || "");
            const company = String(s.company || "").trim();
            if (ts === "DC") {
              entry.dc += qty;
            }
            // Store stock — SUMIF qty WHERE company = store_name
            if (company) {
              entry.store.set(company, (entry.store.get(company) || 0) + qty);
            }
          }
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        stockDone += slice.length;
        setProgressPct(5 + Math.round((stockDone / Math.max(1, skus.length)) * 55));
        setProgressLabel(`โหลด Stock ${stockDone.toLocaleString()}/${skus.length.toLocaleString()} SKU`);
      }

      setProgressLabel("กำลังโหลด On Order DC...");
      setProgressPct(60);

      // 2) Fetch on_order_dc
      const onOrderMap = new Map<string, number>();
      let ooDone = 0;
      for (let i = 0; i < skus.length; i += 500) {
        const slice = skus.slice(i, i + 500);
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("on_order_dc")
            .select("sku_code, store_name, qty")
            .in("sku_code", slice)
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data || []) as any[];
          for (const o of batch) {
            const k = `${o.sku_code}|${o.store_name}`;
            onOrderMap.set(k, (onOrderMap.get(k) || 0) + (Number(o.qty) || 0));
          }
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        ooDone += slice.length;
        setProgressPct(60 + Math.round((ooDone / Math.max(1, skus.length)) * 30));
        setProgressLabel(`โหลด On Order ${ooDone.toLocaleString()}/${skus.length.toLocaleString()} SKU`);
      }

      setProgressLabel("กำลังโหลด SKU No Order...");
      setProgressPct(92);

      // 2.5) Load SKU No Order set (sku_code|store_name)
      const noOrderSet = new Set<string>();
      {
        let off = 0;
        while (true) {
          const { data, error } = await (supabase as any)
            .from("sku_no_order")
            .select("sku_code, store_name")
            .range(off, off + PAGE - 1);
          if (error) throw error;
          const batch = (data || []) as any[];
          for (const r of batch) noOrderSet.add(`${r.sku_code}|${r.store_name}`);
          if (batch.length < PAGE) break;
          off += PAGE;
        }
      }

      setProgressLabel("กำลังคำนวณ...");
      setProgressPct(95);

      // 3) Compute per row
      // Build imported qty index by (key|store)
      const impByKey = new Map<string, { qty_uom: number | null; qty_unit: number | null }>();
      if (mode === "import") {
        for (const r of importedRows) {
          const store = String(r.store_name || "").trim();
          if (!store) continue;
          impByKey.set(`${r.key}|${store}`, { qty_uom: r.qty_uom, qty_unit: r.qty_unit });
        }
      }

      const next = rows.map(r => {
        const st = stockMap.get(r.sku_code);
        const dc = st?.dc || 0;
        const ss = st?.store.get(r.store_name) || 0;
        const oo = onOrderMap.get(`${r.sku_code}|${r.store_name}`) || 0;
        // Look up imported qty by sku or barcode + store
        let edit: number | null = r.suggest_order_edit;
        let overrideUnit: number | null = null;
        if (mode === "import") {
          const hit =
            impByKey.get(`${r.sku_code}|${r.store_name}`) ||
            (r.main_barcode ? impByKey.get(`${r.main_barcode}|${r.store_name}`) : undefined);
          if (hit) {
            if (hit.qty_uom != null) edit = hit.qty_uom;
            if (hit.qty_unit != null) overrideUnit = hit.qty_unit;
          }
        }
        const computed = computeRow({ ...r, stock_dc: dc, stock_store: ss, on_order: oo, suggest_order_edit: edit });
        // If sku+store is in SKU No Order list, suppress suggest1 (and downstream)
        if (noOrderSet.has(`${r.sku_code}|${r.store_name}`)) {
          computed.sar_suggest1 = 0;
          computed.sar_suggest2 = 0;
          computed.tt_order = 0;
          // Final order respects user edit only
          if (edit != null && edit > 0) {
            const up = computed.unit_pick > 0 ? computed.unit_pick : 1;
            const fu = Math.ceil(edit / up) * up;
            computed.final_order_unit = fu;
            computed.final_order_uom = fu / up;
          } else {
            computed.final_order_unit = 0;
            computed.final_order_uom = 0;
          }
        }
        if (overrideUnit != null) {
          const up = computed.unit_pick > 0 ? computed.unit_pick : 1;
          const fu = Math.ceil(overrideUnit / up) * up;
          computed.final_order_unit = fu;
          computed.final_order_uom = fu / up;
        }
        return computed;
      });
      setRows(next);
      setCalculated(true);
      setParAdjusted(new Set());
      setProgressPct(100);
      toast({ title: "คำนวณเสร็จ", description: `${next.length.toLocaleString()} แถว` });
    } catch (e: any) {
      toast({ title: "Calc error", description: e.message, variant: "destructive" });
    } finally {
      setCalculating(false);
      setCalcStartedAt(null);
      setTimeout(() => { setProgressPct(0); setProgressLabel(""); }, 800);
    }
  };

  // ----- คำนวนตาม %Par : allocate Stock DC per SKU across stores by priority -----
  const doCalcByPar = async () => {
    if (!calculated || rows.length === 0) {
      toast({ title: "ต้องคำนวณก่อน", variant: "destructive" });
      return;
    }
    setCalcParRunning(true);
    try {
      // 1) Load store_priority for current user
      const priorityMap = new Map<string, number>();
      if (user) {
        const { data: prData } = await (supabase as any)
          .from("store_priority")
          .select("store_name, priority")
          .eq("user_id", user.id);
        for (const p of (prData || []) as any[]) {
          if (p.store_name && p.priority != null) priorityMap.set(p.store_name, Number(p.priority));
        }
      }
      // Sort key: priority asc (no priority = 9999), then store_name asc (รหัสสาขา)
      const sortKey = (storeName: string) => {
        const p = priorityMap.get(storeName);
        return [p == null ? 9999 : p, storeName] as [number, string];
      };

      // 2) Group row-indexes by sku_code
      const bySku = new Map<string, number[]>();
      rows.forEach((r, i) => {
        if (!r.sku_code) return;
        if (!bySku.has(r.sku_code)) bySku.set(r.sku_code, []);
        bySku.get(r.sku_code)!.push(i);
      });

      const next = rows.slice();
      const adjusted = new Set<number>();

      for (const [, idxList] of bySku.entries()) {
        // Single Stock DC value for this SKU (ทุกแถวควรเท่ากัน, ใช้ max กันพลาด)
        const stockDC = idxList.reduce((m, i) => Math.max(m, Number(next[i].stock_dc) || 0), 0);
        const totalSug1 = idxList.reduce((s, i) => s + (Number(next[i].sar_suggest1) || 0), 0);

        if (totalSug1 <= stockDC || totalSug1 <= 0) {
          // พอแบ่ง → คง Suggest2 เดิม (สูตรเดิม), ไม่ต้องเฉลี่ย, ไม่ไฮไลต์
          continue;
        }

        // ไม่พอ → จัดสรรตาม priority แล้ว store_name
        const ordered = idxList.slice().sort((a, b) => {
          const [pa, sa] = sortKey(next[a].store_name || "");
          const [pb, sb] = sortKey(next[b].store_name || "");
          if (pa !== pb) return pa - pb;
          return sa < sb ? -1 : sa > sb ? 1 : 0;
        });

        let remaining = stockDC;
        for (const i of ordered) {
          const r = next[i];
          const sug1 = Number(r.sar_suggest1) || 0;
          const up = Number(r.unit_pick) > 0 ? Number(r.unit_pick) : 1;
          let alloc = 0;
          if (remaining > 0 && sug1 > 0) {
            const ratio = sug1 / totalSug1;
            alloc = Math.ceil((ratio * stockDC) / up) * up;
            if (alloc > remaining) {
              // ปัดลงให้พอดี unit_pick แต่ไม่เกิน remaining
              alloc = Math.floor(remaining / up) * up;
            }
            if (alloc < 0) alloc = 0;
          }
          next[i] = { ...r, sar_suggest2: alloc };
          adjusted.add(i);
          remaining -= alloc;
          if (remaining < 0) remaining = 0;
        }
      }

      setRows(next);
      setParAdjusted(adjusted);
      toast({
        title: "คำนวนตาม %Par สำเร็จ",
        description: `ปรับ Suggest2 ทั้งหมด ${adjusted.size.toLocaleString()} แถว`,
      });
    } catch (e: any) {
      toast({ title: "Calc %Par error", description: e.message, variant: "destructive" });
    } finally {
      setCalcParRunning(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_\-\/\\.]+/g, "");
      const set = new Set<string>();
      const irows: ImportedQty[] = [];
      const skipped: SkippedItem[] = [];
      // Resolve column keys per first row
      const sampleKeys = json.length > 0 ? Object.keys(json[0]) : [];
      const findKey = (...candidates: string[]) => {
        const cset = new Set(candidates.map(norm));
        return sampleKeys.find(k => cset.has(norm(k)));
      };
      const keyCol = findKey("skucode", "sku", "barcode", "mainbarcode", "skucodebarcode", "barcodeskucode");
      const storeCol = findKey("storename", "store");
      const qtyUomCol = findKey("qtyuom");
      const qtyUnitCol = findKey("qtyunit");

      for (let i = 0; i < json.length; i++) {
        const r = json[i];
        const rawKey = keyCol ? String(r[keyCol] ?? "").trim() : "";
        const store = storeCol ? String(r[storeCol] ?? "").trim() : "";
        const qUom = qtyUomCol ? Number(r[qtyUomCol]) : NaN;
        const qUnit = qtyUnitCol ? Number(r[qtyUnitCol]) : NaN;
        if (!rawKey) {
          skipped.push({ kind: "sku", key: `(row ${i + 2})`, reason: "ไม่มี skucode/barcode", original: r });
          continue;
        }
        if (!store) {
          skipped.push({ kind: "store", key: rawKey, reason: "ไม่มี Store Name", original: r });
          continue;
        }
        if (!Number.isFinite(qUom) && !Number.isFinite(qUnit)) {
          skipped.push({ kind: "qty", key: `${rawKey} @ ${store}`, reason: "ไม่มี Qty (Uom/Unit)", original: r });
          // Still allow filtering by key+store
        }
        set.add(rawKey);
        irows.push({
          key: rawKey,
          store_name: store,
          qty_uom: Number.isFinite(qUom) ? qUom : null,
          qty_unit: Number.isFinite(qUnit) ? qUnit : null,
        });
      }

      setImportedSet(set);
      setImportedRows(irows);
      setImportSkipped(skipped);
      setImportedFileLabel(`${file.name} (${set.size} keys, ${irows.length} rows)`);
      toast({
        title: "Import สำเร็จ",
        description: `${set.size} keys, ${irows.length} rows${skipped.length ? `, skipped ${skipped.length}` : ""}`,
      });
      if (skipped.length > 0) setSkipDialogOpen(true);
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    }
  };

  // ----- Edit suggest_order_edit (Enter / Arrow nav) -----
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const updateEdit = (idx: number, val: string) => {
    const n = val === "" ? null : Number(val);
    const next = [...rows];
    next[idx] = computeRow({ ...next[idx], suggest_order_edit: n });
    setRows(next);
  };
  const focusInput = (idx: number) => {
    const el = inputRefs.current[`e_${idx}`];
    if (el) { el.focus(); el.select(); }
  };
  // arrow nav across currently visible (filtered+paged) rows
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, posInPage: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nxt = pageRows[posInPage + 1];
      if (nxt) focusInput(nxt.origIdx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prv = pageRows[posInPage - 1];
      if (prv) focusInput(prv.origIdx);
    }
  };

  // ----- Filtered / paginated rows (carry origIdx so editing maps back to rows correctly) -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.map((r, origIdx) => ({ r, origIdx }));
    if (!q) return base;
    return base.filter(({ r }) =>
      r.sku_code.toLowerCase().includes(q) ||
      (r.main_barcode || "").toLowerCase().includes(q) ||
      (r.product_name_la || "").toLowerCase().includes(q) ||
      (r.product_name_en || "").toLowerCase().includes(q) ||
      (r.store_name || "").toLowerCase().includes(q)
    );
  }, [rows, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // ----- Save snapshot -----
  const saveSnapshot = async () => {
    if (!user) { toast({ title: "ต้องเข้าสู่ระบบ", variant: "destructive" }); return; }
    if (!calculated || rows.length === 0) {
      toast({ title: "ต้องคำนวณก่อน", variant: "destructive" });
      return;
    }
    try {
      const name = saveName.trim() || `${fmtFile(new Date())}-sar`;
      // Ensure every saved row carries calculated:true so reopen displays formula values (incl. 0)
      const payload = rows.map(r => ({ ...r, calculated: true }));
      const { error } = await (supabase as any).from("sar_snapshots").insert({
        user_id: user.id,
        doc_name: name,
        source: mode,
        item_count: payload.length,
        data: payload as any,
      });
      if (error) throw error;
      toast({ title: "บันทึก Snapshot สำเร็จ", description: `${name} (${rows.length} แถว)` });
      setSaveOpen(false);
      setSaveName("");
    } catch (e: any) {
      toast({ title: "Save error", description: e.message, variant: "destructive" });
    }
  };

  // ----- Clear data (reset to before-fetch state) -----
  const clearData = () => {
    if (rows.length > 0 && !confirm("ล้างข้อมูลในตาราง?")) return;
    setRows([]);
    setCalculated(false);
    setPage(0);
    setSearch("");
    setParAdjusted(new Set());
  };

  // ----- Download import-mode template -----
  const downloadImportTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "SkuCode/Barcode": "0001234", "Store Name": "Jmart Sikai", "Qty Uom": 1, "Qty Unit": 12 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "SAR_Import_Template.xlsx");
  };

  // ----- Export current UI data (no RO grouping) -----
  const exportCurrentUI = () => {
    if (filtered.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    try {
      const wb = XLSX.utils.book_new();
      const headers = COLS.map(c => c.label);
      const allRows = filtered.map(({ r }) => Object.fromEntries(COLS.map(c => [c.label, (r as any)[c.key]])));
      const formulaRow = buildSARFormulaRow(headers);
      const wsAll = buildSheetWithFormulaRow(headers, allRows, formulaRow);
      XLSX.utils.book_append_sheet(wb, wsAll, "SAR");
      XLSX.writeFile(wb, `SAR_${fmtFile(new Date())}.xlsx`);
      toast({ title: "Export สำเร็จ", description: `${filtered.length.toLocaleString()} แถว` });
    } catch (e: any) {
      toast({ title: "Export error", description: e.message, variant: "destructive" });
    }
  };

  // ----- Export List Import RO (spec format: Header per group + line rows) -----
  const exportListRO = () => {
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    try {
      const eligible = rows.filter(r => (r.final_order_unit || 0) > 0);
      if (eligible.length === 0) { toast({ title: "ไม่มีรายการ Final Order > 0", variant: "destructive" }); return; }

      // Group by Store Name → Sub-Department (each group = one RO)
      const byStore = new Map<string, Map<string, SARRow[]>>();
      for (const r of eligible) {
        const s = r.store_name || "(no store)";
        const sd = r.sub_department || "(no sub-dept)";
        if (!byStore.has(s)) byStore.set(s, new Map());
        const m = byStore.get(s)!;
        if (!m.has(sd)) m.set(sd, []);
        m.get(sd)!.push(r);
      }

      // Single sheet with all RO rows
      const COLS_RO = [
        "Company", "Partner", "RPM Type", "Currency", "Order Group",
        "Order Lines/Barcode", "Order Lines/Product", "Order Lines/Unit of Measure",
        "Order Lines/Quantity", "Order Lines/Exclude In Package", "Order Lines/Unit Price",
      ];
      const perRO = Math.max(1, Number(perPO) || 50);
      const out: any[] = [];
      for (const [store, sdMap] of byStore.entries()) {
        for (const [sd, items] of sdMap.entries()) {
          // Split this (Store → Sub-Dept) group into chunks of perRO items = one RO per chunk
          for (let start = 0; start < items.length; start += perRO) {
            const chunk = items.slice(start, start + perRO);
            chunk.forEach((r, idx) => {
              const up = r.unit_pick > 0 ? r.unit_pick : 1;
              const qty = r.final_order_unit;
              const qUom = qty / up;
              const isHeader = idx === 0; // header on first row of each chunk
              out.push({
                "Company": isHeader ? store : "",
                "Partner": isHeader ? "Lanexang Green Property Sole Co.,Ltd" : "",
                "RPM Type": isHeader ? "DC Item" : "",
                "Currency": isHeader ? "LAK" : "",
                "Order Group": isHeader ? sd : "",
                "Order Lines/Barcode": r.main_barcode || "",
                "Order Lines/Product": r.main_barcode || "",
                "Order Lines/Unit of Measure": "Unit",
                "Order Lines/Quantity": qty,
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
      XLSX.writeFile(wb, `SAR_Import_RO_${fmtFile(new Date())}.xlsx`);
      toast({ title: "Export RO สำเร็จ", description: `${out.length.toLocaleString()} rows` });
    } catch (e: any) {
      toast({ title: "Export error", description: e.message, variant: "destructive" });
    }
  };

  // ----- Load snapshot docs -----
  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("sar_snapshots")
        .select("id, doc_name, source, item_count, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setSnapshots(data || []);
    } catch (e: any) {
      toast({ title: "Load snapshots error", description: e.message, variant: "destructive" });
    } finally {
      setSnapshotsLoading(false);
    }
  }, [toast]);
  useEffect(() => { if (activeTab === "docs") loadSnapshots(); }, [activeTab, loadSnapshots]);

  const openSnapshot = async (id: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from("sar_snapshots").select("data, doc_name").eq("id", id).single();
      if (error) throw error;
      const arr = ((data?.data || []) as SARRow[]).map(r => ({ ...r, doh_tobe: (r as any).doh_tobe ?? 0, calculated: true }));
      setRows(arr);
      setCalculated(true);
      setPage(0);
      setActiveTab("cal");
      toast({ title: "โหลด Snapshot", description: `${data?.doc_name} (${arr.length.toLocaleString()} แถว)` });
    } catch (e: any) {
      toast({ title: "Open error", description: e.message, variant: "destructive" });
    }
  };

  // Show multiple selected snapshots merged
  const showSelectedSnapshots = async () => {
    const ids = Array.from(selectedSnapshots);
    if (ids.length === 0) { toast({ title: "ยังไม่ได้เลือก Snapshot", variant: "destructive" }); return; }
    try {
      const { data, error } = await (supabase as any)
        .from("sar_snapshots").select("data, doc_name").in("id", ids);
      if (error) throw error;
      const merged: SARRow[] = [];
      for (const d of (data || [])) {
        const arr = (d?.data || []) as SARRow[];
        // Use loop instead of push(...arr) to avoid "Maximum call stack size exceeded" on huge arrays
        for (let i = 0; i < arr.length; i++) merged.push({ ...arr[i], doh_tobe: (arr[i] as any).doh_tobe ?? 0, calculated: true });
      }
      setRows(merged);
      setCalculated(true);
      setPage(0);
      setActiveTab("cal");
      toast({ title: "โหลด Snapshot", description: `${ids.length} doc, ${merged.length.toLocaleString()} แถว` });
    } catch (e: any) {
      toast({ title: "Open error", description: e.message, variant: "destructive" });
    }
  };

  const deleteSnapshot = async (id: string, name: string) => {
    if (!confirm(`ลบ Snapshot "${name}"?`)) return;
    const { error } = await (supabase as any).from("sar_snapshots").delete().eq("id", id);
    if (error) { toast({ title: "Delete error", description: error.message, variant: "destructive" }); return; }
    setSnapshots(s => s.filter(x => x.id !== id));
    setSelectedSnapshots(s => { const n = new Set(s); n.delete(id); return n; });
    toast({ title: "ลบสำเร็จ" });
  };

  const toggleSnapshot = (id: string) => {
    setSelectedSnapshots(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAllSnapshots = () => {
    setSelectedSnapshots(s => {
      if (s.size === snapshots.length) return new Set();
      return new Set(snapshots.map(x => x.id));
    });
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full flex flex-col">
        <div className="border-b px-4 pt-2 bg-background">
          <TabsList>
            {canCal      && <TabsTrigger value="cal">คำนวน SAR</TabsTrigger>}
            {canOnOrder  && <TabsTrigger value="on_order_dc">On Order DC</TabsTrigger>}
            {canSkuNoOrd && <TabsTrigger value="sku_no_order">SKU No Order</TabsTrigger>}
            {canOFS      && <TabsTrigger value="order_from_store">Order From Store</TabsTrigger>}
            {canDocs && <TabsTrigger value="docs">Doc Snapshot</TabsTrigger>}
          </TabsList>
        </div>

        {canCal && <TabsContent value="cal" className="flex-1 overflow-hidden data-[state=active]:flex flex-col mt-0">
          {/* Toolbar */}
          <div className="border-b p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Mode toggle */}
              <div className="inline-flex border rounded overflow-hidden text-xs">
                <button
                  onClick={() => setMode("filter")}
                  className={cn("px-3 py-1.5", mode === "filter" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
                >
                  <Filter className="w-3.5 h-3.5 inline mr-1" /> Filter
                </button>
                <button
                  onClick={() => setMode("import")}
                  className={cn("px-3 py-1.5", mode === "import" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
                >
                  <Upload className="w-3.5 h-3.5 inline mr-1" /> Import Barcode
                </button>
              </div>

              {mode === "filter" ? (
                <>
                  <MultiSelectFilter label="Store" options={filterOpts.stores} selected={storeFilter} onChange={setStoreFilter} width="w-80" counts={filterCounts.stores} loading={rawDocLoading} />
                  <MultiSelectFilter label="Type Store" options={filterOpts.types} selected={typeStoreFilter} onChange={setTypeStoreFilter} counts={filterCounts.types} loading={rawDocLoading} />
                  <MultiSelectFilter label="Item Type" options={filterOpts.itemTypes} selected={itemTypeFilter} onChange={setItemTypeFilter} counts={filterCounts.itemTypes} loading={rawDocLoading} />
                  <MultiSelectFilter label="Buying Status" options={filterOpts.buyings} selected={buyingFilter} onChange={setBuyingFilter} counts={filterCounts.buyings} loading={rawDocLoading} />
                  <MultiSelectFilter label="Division" options={filterOpts.divisions} selected={divisionFilter} onChange={setDivisionFilter} counts={filterCounts.divisions} loading={rawDocLoading} />
                  <MultiSelectFilter label="Department" options={filterOpts.departments} selected={departmentFilter} onChange={setDepartmentFilter} counts={filterCounts.departments} loading={rawDocLoading} />
                  <MultiSelectFilter label="Sub-Department" options={filterOpts.subDepartments} selected={subDeptFilter} onChange={setSubDeptFilter} counts={filterCounts.subDepartments} loading={rawDocLoading} />
                  <MultiSelectFilter label="Class" options={filterOpts.classes} selected={classFilter} onChange={setClassFilter} counts={filterCounts.classes} loading={rawDocLoading} />
                  <Input
                    placeholder="SKU (คั่นด้วย ,)"
                    className="h-8 text-xs w-40"
                    defaultValue={skuFilter.join(",")}
                    onBlur={(e) => setSkuFilter(e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean))}
                  />
                  <Input
                    placeholder="Barcode (คั่นด้วย ,)"
                    className="h-8 text-xs w-40"
                    defaultValue={barcodeFilter.join(",")}
                    onBlur={(e) => setBarcodeFilter(e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean))}
                  />
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={downloadImportTemplate}>
                    <FileDown className="w-3.5 h-3.5 mr-1" /> Template
                  </Button>
                  <label className="cursor-pointer">
                    <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImportFile} />
                    <span className="inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs hover:bg-muted">
                      <Upload className="w-3.5 h-3.5 mr-1" /> เลือกไฟล์
                    </span>
                  </label>
                  {importedFileLabel && <Badge variant="secondary" className="text-xs">{importedFileLabel}</Badge>}
                  {(importSkipped.length > 0 || importedFileLabel) && (
                    <ImportSkipBar
                      count={importSkipped.length}
                      context="Import"
                      items={importSkipped}
                      title="sar_import"
                      forceShow={!!importedFileLabel}
                      onClear={() => setImportSkipped([])}
                      className="ml-1"
                    />
                  )}
                </>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPriorityOpen(true)}>
                  <ListOrdered className="w-4 h-4 mr-1" /> Priority
                </Button>
                <Button size="sm" onClick={fetchData} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  ดึงข้อมูล
                </Button>
                <Button size="sm" onClick={doCalculate} disabled={calculating || rows.length === 0} variant="default">
                  {calculating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}
                  คำนวณ
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={doCalcByPar}
                  disabled={!calculated || calcParRunning || rows.length === 0}
                  title="แบ่ง Stock DC ตามอัตราส่วน Suggest1 + Priority สาขา → เขียนทับ Suggest2"
                >
                  {calcParRunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Percent className="w-4 h-4 mr-1" />}
                  คำนวนตาม %par
                </Button>
                {rows.length > 0 && (
                  <Button size="sm" variant="outline" onClick={clearData}>
                    <Trash2 className="w-4 h-4 mr-1" /> Clear Data
                  </Button>
                )}
                {calculated && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
                      <Save className="w-4 h-4 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={exportCurrentUI}>
                      <FileSpreadsheet className="w-4 h-4 mr-1" /> Export
                    </Button>
                  </>
                )}
              </div>
            </div>

            {(loading || calculating || progressPct > 0) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{progressLabel}</span>
                  <div className="flex items-center gap-2">
                    {(loadStartedAt || calcStartedAt) && (
                      <ElapsedTimer startedAt={(loadStartedAt || calcStartedAt)!} />
                    )}
                    <span className="font-mono">{progressPct}%</span>
                  </div>
                </div>
                <Progress value={progressPct} className="h-1.5" />
              </div>
            )}

            {rows.length > 0 && (
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="ค้นหา SKU / Barcode / Product / Store..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="h-7 text-xs max-w-md"
                />
                <span className="text-xs text-muted-foreground ml-auto">
                  {filtered.length.toLocaleString()} แถว · หน้า {page + 1}/{totalPages}
                </span>
                <select
                  className="h-7 text-xs border rounded px-1 bg-background"
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                  title="จำนวนแถวต่อหน้า"
                >
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n.toLocaleString()}/หน้า</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</Button>
                <Button size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>›</Button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <Calculator className="w-12 h-12 opacity-40" />
                <div className="text-sm">กด <strong>ดึงข้อมูล</strong> เพื่อโหลด Min/Max</div>
              </div>
            ) : (
              <table className="text-xs border-collapse w-max">
                <thead className="sticky top-0 z-10 bg-muted shadow-sm">
                  <tr>
                    {COLS.map(c => (
                      <th
                        key={c.key}
                        className={cn(
                          "px-2 py-1.5 text-left font-semibold border-b",
                          c.right && "text-right",
                          HIGHLIGHT_COLS.has(c.key as string) && "bg-amber-100"
                        )}
                        style={{ width: c.w, minWidth: c.w }}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((item, i) => {
                    const r = item.r;
                    const realIdx = item.origIdx;
                    return (
                      <tr key={`${r.sku_code}-${r.store_name}-${i}`} className="group border-b hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30 focus-within:bg-emerald-100/70">
                        {COLS.map(c => {
                          const v = (r as any)[c.key];
                          if (c.editable && c.key === "suggest_order_edit") {
                            return (
                              <td key={c.key} className="px-1 py-0.5 text-right group-hover:bg-emerald-100/70" style={{ width: c.w, minWidth: c.w }}>
                                <input
                                  ref={el => (inputRefs.current[`e_${realIdx}`] = el)}
                                  type="number"
                                  step="any"
                                  value={v ?? ""}
                                  onChange={(e) => updateEdit(realIdx, e.target.value)}
                                  onKeyDown={(e) => handleKey(e, i)}
                                  onClick={(e) => e.stopPropagation()}
                                  onFocus={(e) => e.currentTarget.select()}
                                  className="w-full h-6 px-1 text-right border rounded text-xs bg-background"
                                  placeholder="-"
                                />
                              </td>
                            );
                          }
                          return (
                            <td
                              key={c.key}
                              className={cn(
                                "px-2 py-1 border-r border-r-border/40",
                                c.right && "text-right tabular-nums",
                                HIGHLIGHT_COLS.has(c.key as string) && "bg-amber-50 font-semibold group-hover:bg-emerald-100/70 dark:group-hover:bg-emerald-900/30",
                                c.key === "sar_suggest2" && parAdjusted.has(realIdx) && "!bg-sky-200 text-sky-900",
                                (c.key === "doh_stock" || c.key === "doh_tobe") && typeof v === "number" && v > 90 && "!bg-red-100"
                              )}
                              style={{ width: c.w, minWidth: c.w, maxWidth: c.w }}
                              title={typeof v === "string" ? v : undefined}
                            >
                              <div className="truncate">
                                {typeof v === "number" ? fmtNumber(v, c.key as string, r.calculated) : (v ?? "")}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>}

        {canOnOrder && (
          <TabsContent value="on_order_dc" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            <SAROnOrderDCTab />
          </TabsContent>
        )}

        {canSkuNoOrd && (
          <TabsContent value="sku_no_order" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            <SARSkuNoOrderTab />
          </TabsContent>
        )}

        {canOFS && (
          <TabsContent value="order_from_store" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            <SAROrderFromStoreTab />
          </TabsContent>
        )}

        {canDocs && <TabsContent value="docs" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
          <div className="px-4 py-2 flex items-center gap-2 border-b">
            <div className="text-sm font-semibold">SAR Snapshot Documents</div>
            {selectedSnapshots.size > 0 && (
              <Badge variant="secondary" className="text-xs">เลือก {selectedSnapshots.size}</Badge>
            )}
            <Button
              size="sm"
              onClick={showSelectedSnapshots}
              disabled={selectedSnapshots.size === 0}
              className="ml-2"
            >
              Show ({selectedSnapshots.size})
            </Button>
            <Button size="sm" variant="outline" className="ml-auto" onClick={loadSnapshots} disabled={snapshotsLoading}>
              <RefreshCw className={cn("w-4 h-4 mr-1", snapshotsLoading && "animate-spin")} /> Refresh
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-1.5 w-8">
                    <Checkbox
                      checked={snapshots.length > 0 && selectedSnapshots.size === snapshots.length}
                      onCheckedChange={toggleAllSnapshots}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">Doc Name</th>
                  <th className="px-2 py-1.5 text-left">Source</th>
                  <th className="px-2 py-1.5 text-right">Item Count</th>
                  <th className="px-2 py-1.5 text-left">Created At</th>
                  <th className="px-2 py-1.5 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.id} className="border-t hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30">
                    <td className="px-2 py-1">
                      <Checkbox
                        checked={selectedSnapshots.has(s.id)}
                        onCheckedChange={() => toggleSnapshot(s.id)}
                      />
                    </td>
                    <td className="px-2 py-1 font-mono">{s.doc_name}</td>
                    <td className="px-2 py-1">{s.source}</td>
                    <td className="px-2 py-1 text-right">{Number(s.item_count || 0).toLocaleString()}</td>
                    <td className="px-2 py-1">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-2 py-1 flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => openSnapshot(s.id)}>
                        Open
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => deleteSnapshot(s.id, s.doc_name)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {snapshots.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                    {snapshotsLoading ? "กำลังโหลด..." : "ยังไม่มี Snapshot — กด Save จาก Tab SAR เพื่อบันทึก"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>}
      </Tabs>

      {/* Save Dialog (with List Import RO export inside) */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึก SAR Snapshot</DialogTitle>
            <DialogDescription>{rows.length.toLocaleString()} แถว · mode = {mode}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium">ชื่อ Snapshot (ไม่ใส่ = auto)</label>
              <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={`${fmtFile(new Date())}-sar`} />
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="text-xs font-medium">Export List Import RO</div>
              <div className="text-[11px] text-muted-foreground">
                ตัดตาม Store Name → Sub-Department → จำนวนรายการที่ระบุ (เฉพาะ Final Order/Unit &gt; 0:
                {" "}{rows.filter(r => (r.final_order_unit || 0) > 0).length.toLocaleString()} แถว)
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs">รายการต่อ 1 RO</label>
                <Input
                  type="number"
                  value={perPO}
                  onChange={e => setPerPO(Number(e.target.value) || 50)}
                  className="w-24 h-8"
                  min={1}
                />
                <Button size="sm" variant="outline" onClick={exportListRO}>
                  <Download className="w-4 h-4 mr-1" /> Export RO .xlsx
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>ปิด</Button>
            <Button onClick={saveSnapshot}><Save className="w-4 h-4 mr-1" /> บันทึก Snapshot</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportSkipDialog
        open={skipDialogOpen}
        onOpenChange={setSkipDialogOpen}
        items={importSkipped}
        title="sar_import"
      />

      <StorePriorityDialog
        open={priorityOpen}
        onOpenChange={setPriorityOpen}
        stores={priorityStores}
      />
    </div>
  );
}
