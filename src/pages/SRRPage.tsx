import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2, Calculator, Download, ChevronLeft, ChevronRight, Database, Search, X,
  FileSpreadsheet, Pencil, Check, CheckSquare, Columns, XCircle, Save, Eye,
  ChevronDown, ChevronUp as ChevronUpIcon, RefreshCw, Filter, Play, Trash2,
  FolderOpen, CalendarDays, BarChart3, Info,
} from "lucide-react";
import { SRRReportTab } from "@/components/SRRReportTab";
import { SRRReport2Tab } from "@/components/SRRReport2Tab";
import { ImportSkipDialog, ImportSkipBar, type SkippedItem } from "@/components/ImportSkipDialog";
import { enrichSkippedSkusAfterRead, buildVendorEmptyResultSkips } from "@/lib/srrPostReadSkip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { remapRowsByTemplate, type TargetMenu } from "@/lib/exportTemplate";
import { buildSRRDCFormulaRow, buildSheetWithFormulaRow } from "@/lib/srrExportFormulas";
import {
  getTodayKey, loadRecentSnapshots, saveSnapshots, updateSnapshotData,
  deleteSnapshotDocuments, getSnapshotDates, loadSnapshots,
  cleanupOldSnapshots, savePODocument, loadSavedPODocs, deletePODocument,
  buildSnapshotBatchesFromDocs, getSnapshotBatches, loadSnapshotBatch,
  mergeSnapshotBatches, type SnapshotBatch,
} from "@/lib/snapshotService";
import { SnapshotBatchPicker } from "@/components/SnapshotBatchPicker";
import { SrrImportFilter, type SrrImportMode, type ImportedItem, type ImportedVendor } from "@/components/SrrImportFilter";
import { SrrFiltersPopover } from "@/components/SrrFiltersPopover";
import { TableChipSearch, applyChipFilter, type SearchChip } from "@/components/TableChipSearch";
import { getLatestRangeStorePackBox } from "@/lib/rangeStorePackBox";
import { DocsPopupDialog, formatDocNo, type DocRow } from "@/components/DocsPopupDialog";
import { buildCost0Doc, appendCost0Docs, COST0_KEY_DC, type Cost0Doc } from "@/lib/cost0Docs";
import { listPublicViews, savePublicView, deletePublicView, type SrrPublicView } from "@/lib/srrPublicViews";
import type { SRRRow, VendorInfo, VendorDocument, SavedPO, ColumnView } from "@/lib/srrTypes";
export type { HierarchyFilter } from "@/lib/srrTypes";
import {
  fetchAllRows, fetchSRRDataRPC, SRR_RPC_CACHE,
  HIGHLIGHT_COLS, TRUNCATE_COLS, SRR_COLUMNS, ALL_COL_KEYS, EDITABLE_COLS,
  formatCellValue, getDefaultWidth, getBatchKey, fmtTreeStamp,
  getDefaultSafety, recalcRow, buildSRRRows,
  VIEWS_KEY, loadSavedViews, saveSavedViews, PO_KEY,
  applyHighPrecisionFormat, loadSavedPOs, saveSavedPOs,
  VENDOR_DOCS_KEY, loadVendorDocs, saveVendorDocs,
  getDateKey, isWithin30Days, stripSeconds, getLocalPOBatches,
} from "@/lib/srrUtils";
export { applyHighPrecisionFormat, getLocalPOBatches } from "@/lib/srrUtils";
export { ListImportPO } from "@/components/ListImportPO";

// --- Multi-Select Dropdown ---
function MultiSelect({ label, options, selected, onChange, searchable = true, compact = false }: {
  label: string;
  options: { value: string; display: string }[];
  selected: string[];
  onChange: (val: string[]) => void;
  searchable?: boolean;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = searchable
    ? options.filter(o => o.display.toLowerCase().includes(search.toLowerCase()) || o.value.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("text-xs justify-between", compact ? "h-7 min-w-[100px] max-w-[180px] px-2" : "h-8 min-w-[120px] max-w-[200px]")}>
          <span className="truncate">
            {selected.length === 0 ? label : `${label} (${selected.length})`}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {searchable && (
          <div className="flex items-center gap-1 mb-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange(filtered.map(o => o.value))}>เลือกทั้งหมด</Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([])}>ล้าง</Button>
        </div>
        <ScrollArea className="h-48">
          {filtered.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer">
              <Checkbox checked={selected.includes(opt.value)} onCheckedChange={checked => {
                onChange(checked ? [...selected, opt.value] : selected.filter(v => v !== opt.value));
              }} />
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
// PERSISTENT STATE across menu switches
// ============================================================
const srrStateRef = { current: null as any };
const srrD2SStateRef = { current: null as any };

// Real-time elapsed seconds since `startedAt` (ms). Re-renders every 100ms while mounted.
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = ((Date.now() - startedAt) / 1000).toFixed(1);
  return <span className="text-[11px] font-mono tabular-nums text-primary font-semibold">⏱ {s}s</span>;
}

export default function SRRPage({ activeSub = "dc_item" }: { activeSub?: string }) {
  if (activeSub === "direct_item") {
    const SRRDirectPage = React.lazy(() => import("@/pages/SRRDirectPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRDirectPage /></React.Suspense>;
  }
  if (activeSub === "special_order") {
    const SRRSpecialOrderPage = React.lazy(() => import("@/pages/SRRSpecialOrderPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRSpecialOrderPage /></React.Suspense>;
  }
  if (activeSub === "order_b2b") {
    const SRROrderB2BPage = React.lazy(() => import("@/pages/SRROrderB2BPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRROrderB2BPage /></React.Suspense>;
  }
  if (activeSub === "srr_payment_overdue") {
    const SRRPaymentOverduePage = React.lazy(() => import("@/pages/SRRPaymentOverduePage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRPaymentOverduePage /></React.Suspense>;
  }
  if (activeSub === "srr_job_assign") {
    const SRRJobAssignPage = React.lazy(() => import("@/pages/SRRJobAssignPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRJobAssignPage /></React.Suspense>;
  }
  if (activeSub === "srr_send_docs") {
    const SRRSendDocsPage = React.lazy(() => import("@/pages/SRRSendDocsPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRSendDocsPage /></React.Suspense>;
  }
  if (activeSub === "sar") {
    const SARPage = React.lazy(() => import("@/pages/SARPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SARPage /></React.Suspense>;
  }
  if (activeSub === "help") {
    const SRRHelpPage = React.lazy(() => import("@/pages/SRRHelpPage"));
    return <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><SRRHelpPage /></React.Suspense>;
  }
  return <SRRDCItemPage />;
}

// ============================================================
// MAIN SRR DC ITEM — 2-TAB ARCHITECTURE
// Tab 1: Read & Cal per SPC → save as VendorDocuments (tree)
// Tab 2: Filter & Show & Edit (with Item Type filter)
// ============================================================
function SRRDCItemPage() {
  const { user, canDo } = useAuth();
  const canDeleteDoc = canDo("dc_item", "delete");
  // --- VendorDocuments (tree: SPC → Date → Vendor) ---
  const [vendorDocs, setVendorDocsRaw] = useState<VendorDocument[]>(srrStateRef.current?.vendorDocs || []);
  const [snapshotDates, setSnapshotDates] = useState<string[]>([]);
  const [snapshotBatches, setSnapshotBatches] = useState<SnapshotBatch[]>([]);
  const [poRefreshKey, setPoRefreshKey] = useState(0);
  const [cost0RefreshKey, setCost0RefreshKey] = useState(0);
  // Filter Date is per-mode (Filter / Vendor / Import) so each mode keeps its own date selection
  const [selectedBatchValuesByMode, setSelectedBatchValuesByMode] = useState<Record<"filter" | "vendor" | "import", string[]>>(
    srrStateRef.current?.selectedBatchValuesByMode || { filter: [], vendor: [], import: [] }
  );
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [latestImportedDocIds, setLatestImportedDocIds] = useState<string[]>([]);
  const listPoBatches = useMemo(() => getLocalPOBatches("srr_saved_pos"), [poRefreshKey]);
  const documentBatches = useMemo(
    () => mergeSnapshotBatches(buildSnapshotBatchesFromDocs(vendorDocs), snapshotBatches),
    [vendorDocs, snapshotBatches],
  );

  const setVendorDocs = useCallback((updater: VendorDocument[] | ((prev: VendorDocument[]) => VendorDocument[])) => {
    setVendorDocsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
  }, []);
  const [loading, setLoading] = useState(false);
  const [calcProgress, setCalcProgress] = useState(0);
  const [loadingPhase, setLoadingPhase] = useState("");
  const [loadingDetail, setLoadingDetail] = useState("");
  const [calcStartedAt, setCalcStartedAt] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>(srrStateRef.current?.activeTab || "read-cal");
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const cancelCalcRef = useRef(false);
  const [dataReady, setDataReady] = useState(false);
  const [dataLoadingMsg, setDataLoadingMsg] = useState("");
  const [statusBanner, setStatusBanner] = useState<{ title: string; detail?: string } | null>(null);
  useEffect(() => {
    if (!statusBanner) return;
    const t = setTimeout(() => setStatusBanner(null), 12000);
    return () => clearTimeout(t);
  }, [statusBanner]);
  const [spcListLoaded, setSpcListLoaded] = useState(false);

  // Tab 1: SPC selection for Read & Cal
  const [selectedSpcForCal, setSelectedSpcForCal] = useState<string[]>([]);
  const [calculatedSpcs, setCalculatedSpcs] = useState<Set<string>>(new Set());

  // Filter options
  const [vendorInfoList, setVendorInfoList] = useState<VendorInfo[]>([]);
  const [spcOptions, setSpcOptions] = useState<{ value: string; display: string }[]>([]);
  const [orderDayOptions, setOrderDayOptions] = useState<{ value: string; display: string }[]>([]);
  const [vendorOptions, setVendorOptions] = useState<{ value: string; display: string }[]>([]);
  const [itemTypeOptions, setItemTypeOptions] = useState<{ value: string; display: string }[]>([]);
  const [buyingStatusOptions, setBuyingStatusOptions] = useState<{ value: string; display: string }[]>([]);

  // Tab 1: Vendor filter for Read & Cal (subset of vendors in selected SPCs)
  const [vendorFilterCal, setVendorFilterCal] = useState<string[]>([]);
  // Tab 1: Type Store filter (Jmart / Kokkok / U-dee) — applied AFTER Read & Cal calc
  const [typeStoreCal, setTypeStoreCal] = useState<string[]>([]);
  // Tab 1: Store Name filter — applies to per-store columns after Read & Cal
  const [storeNameCal, setStoreNameCal] = useState<string[]>([]);

  // Tab 1 PRE-PREPARE filters (shown BEFORE "เตรียมข้อมูล")
  const [orderDayCal, setOrderDayCal] = useState<string[]>([]);
  const [itemTypeCal, setItemTypeCal] = useState<string[]>([]);
  const [buyingStatusCal, setBuyingStatusCal] = useState<string[]>([]);
  const [poGroupCal, setPoGroupCal] = useState<string[]>([]);
  // Product hierarchy filters (cascading) — applied at Read & Cal via RPC params
  const [divisionGroupCal, setDivisionGroupCal] = useState<string[]>([]);
  const [divisionCal, setDivisionCal] = useState<string[]>([]);
  const [departmentCal, setDepartmentCal] = useState<string[]>([]);
  const [subDepartmentCal, setSubDepartmentCal] = useState<string[]>([]);
  const [classCal, setClassCal] = useState<string[]>([]);
  const [subClassCal, setSubClassCal] = useState<string[]>([]);
  // Distinct hierarchy combinations from data_master (for cascading dropdowns)
  const [hierarchyRows, setHierarchyRows] = useState<{
    division_group: string; division: string; department: string;
    sub_department: string; class: string; sub_class: string;
  }[]>([]);

  // Master data for pre-filter dropdowns
  const [vendorMasterAll, setVendorMasterAll] = useState<{ vendor_code: string; vendor_name: string; spc_name: string; order_day: string; supplier_currency: string; purchase_agreement_vat: string }[]>([]);
  const [preFilterOptions, setPreFilterOptions] = useState<{
    itemTypes: { value: string; display: string }[];
    buyingStatuses: { value: string; display: string }[];
    poGroups: { value: string; display: string }[];
  }>({ itemTypes: [], buyingStatuses: [], poGroups: [] });

  // Tab 1: Import Mode (alternative to Filter Mode) — persisted across navigation
  // Restore order: stateRef (in-memory) → localStorage (survives full unmount) → "filter"
  const [importMode, setImportMode] = useState<SrrImportMode>(() => {
    const fromRef = srrStateRef.current?.importMode as SrrImportMode | undefined;
    if (fromRef) return fromRef;
    try {
      const ls = localStorage.getItem("srr_active_mode");
      if (ls === "filter" || ls === "vendor" || ls === "import") return ls as SrrImportMode;
    } catch {}
    return "filter";
  });
  // Persist active mode to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem("srr_active_mode", importMode); } catch {}
  }, [importMode]);
  const [importedItems, setImportedItems] = useState<ImportedItem[]>(srrStateRef.current?.importedItems || []);
  const [importedSkuSet, setImportedSkuSet] = useState<Set<string>>(
    new Set(srrStateRef.current?.importedSkuSetArr || [])
  );
  const [importedQtyBySku, setImportedQtyBySku] = useState<Map<string, number>>(
    new Map(srrStateRef.current?.importedQtyBySkuArr || [])
  );
  const [importedPoCostBySku, setImportedPoCostBySku] = useState<Map<string, number>>(
    new Map(srrStateRef.current?.importedPoCostBySkuArr || [])
  );
  const [importedQtyUnitBySku, setImportedQtyUnitBySku] = useState<Map<string, number>>(
    new Map(srrStateRef.current?.importedQtyUnitBySkuArr || [])
  );
  // Override Vendor: per-sku full vendor patch applied to raw rows before calc (leadtime/oc/spc/order_day)
  const [importedOverrideVendorBySku, setImportedOverrideVendorBySku] = useState<Map<string, any>>(
    new Map(srrStateRef.current?.importedOverrideVendorBySkuArr || [])
  );
  const [importedSkippedKeys, setImportedSkippedKeys] = useState<string[]>(srrStateRef.current?.importedSkippedKeys || []);
  const [importedSkippedItems, setImportedSkippedItems] = useState<SkippedItem[]>(srrStateRef.current?.importedSkippedItems || []);
  const [importSkipDialogOpen, setImportSkipDialogOpen] = useState(false);
  const [lastImportRanAt, setLastImportRanAt] = useState<number>(0);
  const [importedVendors, setImportedVendors] = useState<ImportedVendor[]>(srrStateRef.current?.importedVendors || []);
  // Popup สำหรับ Timeout / Network error ระหว่าง Read & Cal
  const [calcErrorDialog, setCalcErrorDialog] = useState<{ open: boolean; kind: "timeout" | "network" | "error"; title: string; message: string; raw?: string }>({
    open: false, kind: "error", title: "", message: "",
  });
  const TYPE_STORE_OPTIONS = useMemo(() => [
    { value: "Jmart", display: "Jmart" },
    { value: "Kokkok", display: "Kokkok" },
    { value: "U-dee", display: "U-dee" },
  ], []);
  const vendorOptionsForCal = useMemo(() => {
    return vendorInfoList
      .map(v => ({ value: v.vendor_code, display: `${v.vendor_code} - ${v.vendor_display_name}` }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [vendorInfoList]);

  // PRE-PREPARE: Cascading filters — each option list is filtered by the OTHER two selections
  // SPC options narrow by Vendor + OrderDay; Vendor options narrow by SPC + OrderDay; OrderDay narrows by SPC + Vendor
  const preSpcOptions = useMemo(() => {
    const pool = vendorMasterAll.filter(v =>
      (vendorFilterCal.length === 0 || vendorFilterCal.includes(v.vendor_code)) &&
      (orderDayCal.length === 0 || orderDayCal.includes(v.order_day))
    );
    const spcs = [...new Set(pool.map(v => v.spc_name).filter(Boolean))].sort();
    return spcs.map(s => ({ value: s, display: s }));
  }, [vendorMasterAll, vendorFilterCal, orderDayCal]);
  const preVendorOptions = useMemo(() => {
    const pool = vendorMasterAll.filter(v =>
      (selectedSpcForCal.length === 0 || selectedSpcForCal.includes(v.spc_name)) &&
      (orderDayCal.length === 0 || orderDayCal.includes(v.order_day))
    );
    const seen = new Map<string, { name: string; cur: string; pa: string }>();
    for (const v of pool) {
      if (v.vendor_code && !seen.has(v.vendor_code)) seen.set(v.vendor_code, { name: v.vendor_name, cur: v.supplier_currency, pa: v.purchase_agreement_vat });
    }
    return [...seen.entries()].map(([k, info]) => {
      const parts = [info.cur, info.pa, k, info.name].filter(Boolean);
      return { value: k, display: parts.join(" - ") };
    }).sort((a, b) => a.value.localeCompare(b.value));
  }, [vendorMasterAll, selectedSpcForCal, orderDayCal]);
  const preOrderDayOptions = useMemo(() => {
    const pool = vendorMasterAll.filter(v =>
      (selectedSpcForCal.length === 0 || selectedSpcForCal.includes(v.spc_name)) &&
      (vendorFilterCal.length === 0 || vendorFilterCal.includes(v.vendor_code))
    );
    const days = [...new Set(pool.map(v => v.order_day).filter(Boolean))].sort();
    return days.map(d => ({ value: d, display: d }));
  }, [vendorMasterAll, selectedSpcForCal, vendorFilterCal]);

  // Cascading hierarchy options — each list narrowed by the OTHER 5 selections,
  // so users can pick any filter in any order and still see overlapping data.
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
      const skipDefaults = await hasActiveFilterTemplates("srr_dc");
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

  // Derive effective SPC list for prepare/cal: explicit selection OR inferred from any active filter
  const effectiveSpcsForCal = useMemo(() => {
    if (selectedSpcForCal.length > 0) return selectedSpcForCal;
    const noBaseFilter = vendorFilterCal.length === 0 && orderDayCal.length === 0;
    const noExtraFilter = filterVendorPool === null;
    if (noBaseFilter && noExtraFilter) return [];
    // Start with vendor pool from non-base filters (or vendorMasterAll if none)
    let pool = filterVendorPool !== null
      ? filterVendorPool.map(v => ({ vendor_code: v.vendor_code, spc_name: v.spc_name, order_day: v.order_day }))
      : vendorMasterAll.map(v => ({ vendor_code: v.vendor_code, spc_name: v.spc_name, order_day: v.order_day }));
    if (vendorFilterCal.length > 0) pool = pool.filter(v => vendorFilterCal.includes(v.vendor_code));
    if (orderDayCal.length > 0)     pool = pool.filter(v => orderDayCal.includes(v.order_day));
    return [...new Set(pool.map(v => v.spc_name).filter(Boolean))].sort();
  }, [selectedSpcForCal, vendorFilterCal, orderDayCal, vendorMasterAll, filterVendorPool]);

  // Tab 1: search & expand
  const [docSearch, setDocSearch] = useState("");
  const [expandedSPCs, setExpandedSPCs] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<VendorDocument | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  // Tab 2: filters (Item Type moved here) — persisted via stateRef
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>(srrStateRef.current?.itemTypeFilter || []);
  const [selectedDocSpc, setSelectedDocSpc] = useState<string[]>(srrStateRef.current?.selectedDocSpc || []);
  const [orderDayFilter, setOrderDayFilter] = useState<string[]>(srrStateRef.current?.orderDayFilter || []);
  const [vendorFilter, setVendorFilter] = useState<string[]>(srrStateRef.current?.vendorFilter || []);
  const [buyingStatusFilter, setBuyingStatusFilter] = useState<string[]>(srrStateRef.current?.buyingStatusFilter || []);
  const [poGroupFilter, setPoGroupFilter] = useState<string[]>(srrStateRef.current?.poGroupFilter || []);
  const [showOnlyFinalGt0, setShowOnlyFinalGt0] = useState<boolean>(srrStateRef.current?.showOnlyFinalGt0 || false);
  // Tab 2: Mode toggle (independent from Tab 1's importMode) — controls which doc set Tab 2 sees
  const [tab2Mode, setTab2Mode] = useState<"filter" | "vendor" | "import">(() => {
    const fromRef = srrStateRef.current?.tab2Mode as "filter" | "vendor" | "import" | undefined;
    if (fromRef) return fromRef;
    try {
      const ls = localStorage.getItem("srr_tab2_mode");
      if (ls === "filter" || ls === "vendor" || ls === "import") return ls;
    } catch {}
    return "filter";
  });
  useEffect(() => {
    try { localStorage.setItem("srr_tab2_mode", tab2Mode); } catch {}
  }, [tab2Mode]);

  // Tab 1: Odoo-style search
  const [docSearchCol, setDocSearchCol] = useState<string>("all");
  const [showDocSearchDropdown, setShowDocSearchDropdown] = useState(false);
  const DOC_SEARCH_COLS = [
    { value: "all", label: "ทุกคอลัมน์" },
    { value: "spc_name", label: "SPC Name" },
    { value: "vendor_code", label: "Vendor Code" },
    { value: "vendor_display", label: "Vendor Name" },
    { value: "date_key", label: "Date" },
  ];

  // Tab 2 display state (showData persisted)
  const [showData, setShowData] = useState<SRRRow[]>(srrStateRef.current?.showData || []);
  const [page, setPage] = useState(srrStateRef.current?.page || 0);
  const [pageSize, setPageSize] = useState(srrStateRef.current?.pageSize || 30);

  // Tab 2: Odoo-style chip search
  const [tableSearchChips, setTableSearchChips] = useState<SearchChip[]>([]);
  const TABLE_SEARCH_COLS = useMemo(() => [
    { key: "vendor_display", label: "Vendor" },
    { key: "vendor_code", label: "Vendor Code" },
    { key: "sku_code", label: "SKU" },
    { key: "barcode_unit", label: "Barcode" },
    { key: "product_name_en", label: "Product (EN)" },
    { key: "product_name_la", label: "Product (LA)" },
    { key: "spc_name", label: "SPC" },
    { key: "po_group", label: "PO Group" },
    { key: "rank_sales", label: "Rank" },
    { key: "order_day", label: "Order Day" },
    { key: "item_type", label: "Item Type" },
  ], []);
  const TABLE_SEARCH_KEYS = useMemo(() => TABLE_SEARCH_COLS.map(c => c.key), [TABLE_SEARCH_COLS]);

  // Table interaction
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ col: string; startX: number; startW: number } | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(ALL_COL_KEYS));
  const [savedViews, setSavedViews] = useState<ColumnView[]>(loadSavedViews());
  const [publicViews, setPublicViews] = useState<SrrPublicView[]>([]);
  const [newViewName, setNewViewName] = useState("");
  const reloadPublicViews = useCallback(async () => {
    try { setPublicViews(await listPublicViews("dc")); } catch { /* ignore */ }
  }, []);
  useEffect(() => { reloadPublicViews(); }, [reloadPublicViews]);

  // Export PO
  const [exportOpen, setExportOpen] = useState(false);
  const [pickingType, setPickingType] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [exportVendors, setExportVendors] = useState<string[]>([]);
  const [exportMaxPerPO, setExportMaxPerPO] = useState<string>("");

  // Store Type data from DB
  const [storeTypes, setStoreTypes] = useState<{ ship_to: string; code: string; type_store: string; type_doc: string; store_name?: string }[]>([]);
  useEffect(() => {
    supabase.from("store_type").select("ship_to, code, type_store, type_doc, store_name").then(({ data }) => {
      if (data) {
        // SRR DC: lock to DC stores only
        const dcOnly = (data as any[]).filter(d => d.type_store === "DC");
        setStoreTypes(dcOnly as any);
        if (dcOnly.length > 0) setPickingType(dcOnly[0].ship_to);
      }
    });
  }, []);

  const { toast } = useToast();
  const displayColumns = useMemo(() => SRR_COLUMNS.filter(c => visibleColumns.has(c.key)), [visibleColumns]);

  // Persist state (filters + showData + per-mode date + import context for mode isolation)
  useEffect(() => {
    return () => {
      srrStateRef.current = {
        vendorDocs, activeTab, page, pageSize,
        itemTypeFilter, selectedDocSpc, orderDayFilter, vendorFilter, buyingStatusFilter,
        poGroupFilter, showOnlyFinalGt0, tab2Mode,
        showData,
        // --- mode isolation persistence ---
        importMode,
        selectedBatchValuesByMode,
        importedItems,
        importedSkuSetArr: Array.from(importedSkuSet),
        importedQtyBySkuArr: Array.from(importedQtyBySku.entries()),
        importedPoCostBySkuArr: Array.from(importedPoCostBySku.entries()),
        importedSkippedKeys,
        importedSkippedItems,
        importedVendors,
      };
    };
  });

  // Load snapshots from DB on mount + load available dates
  useEffect(() => {
    const loadFromDB = async () => {
      try {
        setLoadingSnapshots(true);
        // Load recent snapshots
        const snapshots = await loadRecentSnapshots();
        if (snapshots.length > 0 && vendorDocs.length === 0) {
          const docs: VendorDocument[] = snapshots.map(s => ({
            id: s.id,
            vendor_code: s.vendor_code,
            vendor_display: s.vendor_display || s.vendor_code,
            spc_name: s.spc_name,
            date_key: s.date_key.replace(/-/g, ""),
            created_at: s.created_at,
            item_count: s.item_count,
            suggest_count: s.suggest_count,
            data: s.data as SRRRow[],
            edit_count: s.edit_count,
            edited_columns: s.edited_columns,
            user_id: (s as any).user_id,
            // Use the saved source so each mode keeps its own docs after full reload
            source: (s as any).source || "filter",
          }));
          setVendorDocs(docs);
        }
        // Load available dates and batches
        const [dates, batches] = await Promise.all([getSnapshotDates(), getSnapshotBatches("srr_snapshots")]);
        setSnapshotDates(dates);
        setSnapshotBatches(batches);
        // Cleanup old snapshots
        cleanupOldSnapshots().catch(() => {});
      } catch (err: any) {
        console.error("Error loading snapshots:", err);
      } finally {
        setLoadingSnapshots(false);
      }
    };
    loadFromDB();
  }, []);

  // Active mode for the Filter Date picker — Tab 2 uses tab2Mode, otherwise importMode (Tab 1/3)
  const activeDateMode: "filter" | "vendor" | "import" =
    activeTab === "show-edit" ? tab2Mode : (importMode as "filter" | "vendor" | "import");

  // Replace docs of a specific mode without touching other modes' docs
  const replaceDocsForMode = (mode: "filter" | "vendor" | "import", incoming: VendorDocument[]) => {
    setVendorDocs(prev => {
      const others = prev.filter(d => (d.source || "filter") !== mode);
      const tagged = incoming.map(d => ({ ...d, source: mode }));
      return [...others, ...tagged];
    });
  };

  // Load snapshots for selected historical date or batch (ISO timestamp) — applies to current mode only
  const loadHistoricalDate = async (key: string, mode: "filter" | "vendor" | "import" = activeDateMode) => {
    if (key === "today") {
      try {
        setLoadingSnapshots(true);
        const snapshots = await loadRecentSnapshots();
        // Keep only snapshots saved under the active mode (default "filter" for legacy rows)
        const filtered = snapshots.filter((s: any) => ((s as any).source || "filter") === mode);
        const docs: VendorDocument[] = filtered.map(s => ({
          id: s.id,
          vendor_code: s.vendor_code,
          vendor_display: s.vendor_display || s.vendor_code,
          spc_name: s.spc_name,
          date_key: s.date_key.replace(/-/g, ""),
          created_at: s.created_at,
          item_count: s.item_count,
          suggest_count: s.suggest_count,
          data: s.data as SRRRow[],
          edit_count: s.edit_count,
          edited_columns: s.edited_columns,
            user_id: (s as any).user_id,
          source: mode,
        }));
        replaceDocsForMode(mode, docs);
        setShowData([]);
        toast({ title: `โหลดข้อมูลล่าสุด (${mode})`, description: `${docs.length} vendor docs` });
      } finally {
        setLoadingSnapshots(false);
      }
      return;
    }
    try {
      setLoadingSnapshots(true);
      const isBatch = key.includes("T");
      const snapshots = isBatch
        ? await loadSnapshotBatch(key, "srr_snapshots")
        : await loadSnapshots(key);
      // Keep only snapshots saved under the active mode (default "filter" for legacy rows)
      const filtered = snapshots.filter((s: any) => ((s as any).source || "filter") === mode);
      const docs: VendorDocument[] = filtered.map((s: any) => ({
        id: s.id,
        vendor_code: s.vendor_code,
        vendor_display: s.vendor_display || s.vendor_code,
        spc_name: s.spc_name,
        date_key: s.date_key.replace(/-/g, ""),
        created_at: s.created_at,
        item_count: s.item_count,
        suggest_count: s.suggest_count,
        data: s.data as SRRRow[],
        edit_count: s.edit_count,
        edited_columns: s.edited_columns,
            user_id: (s as any).user_id,
        source: mode,
      }));
      replaceDocsForMode(mode, docs);
      setShowData([]);
      const label = isBatch ? snapshotBatches.find(b => b.value === key)?.label || key : key;
      toast({ title: `โหลดข้อมูล ${label} (${mode})`, description: `${docs.length} vendor docs` });
    } catch (err: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setLoadingSnapshots(false);
    }
  };

  // Multi-batch loader: merges snapshots from several batch timestamps — applies to current mode only
  const loadHistoricalBatches = async (keys: string[], mode: "filter" | "vendor" | "import" = activeDateMode) => {
    if (keys.length === 0) { await loadHistoricalDate("today", mode); return; }
    if (keys.length === 1) { await loadHistoricalDate(keys[0], mode); return; }
    try {
      setLoadingSnapshots(true);
      const arrays = await Promise.all(keys.map(k => loadSnapshotBatch(k, "srr_snapshots")));
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const arr of arrays) for (const s of (arr || [])) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        merged.push(s);
      }
      // Keep only snapshots saved under the active mode (default "filter" for legacy rows)
      const filtered = merged.filter((s: any) => ((s as any).source || "filter") === mode);
      const docs: VendorDocument[] = filtered.map((s: any) => ({
        id: s.id,
        vendor_code: s.vendor_code,
        vendor_display: s.vendor_display || s.vendor_code,
        spc_name: s.spc_name,
        date_key: s.date_key.replace(/-/g, ""),
        created_at: s.created_at,
        item_count: s.item_count,
        suggest_count: s.suggest_count,
        data: s.data as SRRRow[],
        edit_count: s.edit_count,
        edited_columns: s.edited_columns,
            user_id: (s as any).user_id,
        source: mode,
      }));
      replaceDocsForMode(mode, docs);
      setShowData([]);
      toast({ title: `โหลด ${keys.length} batch (${mode})`, description: `${docs.length} vendor docs` });
    } catch (err: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setLoadingSnapshots(false);
    }
  };

  // Load SPC name list + Vendor Master + pre-filter options on mount
  useEffect(() => {
    (async () => {
      try {
        const vendorMasters = await fetchAllRows<any>("vendor_master", "vendor_code, vendor_name_en, vendor_name_la, spc_name, order_day, supplier_currency, purchase_agreement_vat");
        const spcs = [...new Set(vendorMasters.map((v: any) => v.spc_name).filter(Boolean))].sort() as string[];
        setSpcOptions(spcs.map(s => ({ value: s, display: s })));
        setVendorMasterAll(vendorMasters.filter((v: any) => v.vendor_code).map((v: any) => ({
          vendor_code: v.vendor_code,
          vendor_name: v.vendor_name_en || v.vendor_name_la || v.vendor_code,
          spc_name: v.spc_name || "",
          order_day: v.order_day || "",
          supplier_currency: v.supplier_currency || "",
          purchase_agreement_vat: v.purchase_agreement_vat || "",
        })));
        setSpcListLoaded(true);
      } catch (err: any) {
        toast({ title: "Error loading SPC list", description: err.message, variant: "destructive" });
      }
      try {
        const { data } = await supabase.rpc("get_srr_pre_filter_options" as any);
        const row = (data as any[])?.[0];
        if (row) {
          setPreFilterOptions({
            itemTypes: (row.item_types || []).map((v: string) => ({ value: v, display: v })),
            buyingStatuses: (row.buying_statuses || []).map((v: string) => ({ value: v, display: v })),
            poGroups: (row.po_groups || []).map((v: string) => ({ value: v, display: v })),
          });
        }
      } catch (err: any) {
        console.error("Pre-filter options load failed:", err);
      }
      try {
        const { hasActiveFilterTemplates } = await import("@/lib/filterTemplates");
        const skipDefaults = await hasActiveFilterTemplates("srr_dc");
        const { data } = await supabase.rpc("get_srr_hierarchy_options" as any, { p_skip_default_filters: skipDefaults });
        if (Array.isArray(data)) setHierarchyRows(data as any);
      } catch (err: any) {
        console.error("Hierarchy options load failed:", err);
      }
    })();
  }, []);

  // --- Tree grouping for Tab 1: Batch (yyyymmddHHMM) → SPC → Vendor ---
  // Each Read & Cal run produces docs with the same created_at minute → its own batch group.
  const docTree = useMemo(() => {
    const tree = new Map<string, Map<string, VendorDocument[]>>();
    const search = docSearch.toLowerCase();
    for (const doc of vendorDocs) {
      // hide docs from the other mode (default to "filter" for legacy/db-loaded snapshots)
      const docSource = doc.source || "filter";
      if (docSource !== importMode) continue;
      if (search) {
        const matchField = docSearchCol === "all"
          ? (doc.spc_name.toLowerCase().includes(search) ||
             doc.vendor_code.toLowerCase().includes(search) ||
             doc.vendor_display.toLowerCase().includes(search) ||
             doc.date_key.includes(search))
          : (doc as any)[docSearchCol]?.toString().toLowerCase().includes(search);
        if (!matchField) continue;
      }
      const batchKey = getBatchKey(doc);
      if (!tree.has(batchKey)) tree.set(batchKey, new Map());
      const spcMap = tree.get(batchKey)!;
      if (!spcMap.has(doc.spc_name)) spcMap.set(doc.spc_name, []);
      spcMap.get(doc.spc_name)!.push(doc);
    }
    return tree;
  }, [vendorDocs, docSearch, docSearchCol, importMode]);

  // Tab 2: only consider docs from the Tab 2 mode toggle (independent of Tab 1)
  const docsForTab2 = useMemo(
    () => vendorDocs.filter(d => (d.source || "filter") === tab2Mode),
    [vendorDocs, tab2Mode]
  );

  // Available SPC docs for Tab 2 (mode-scoped)
  const availableDocSpcs = useMemo(() => {
    const spcs = [...new Set(docsForTab2.map(d => d.spc_name))].sort();
    return spcs.map(s => {
      const count = docsForTab2.filter(d => d.spc_name === s).reduce((a, d) => a + d.item_count, 0);
      return { value: s, display: `${s} (${count} items)` };
    });
  }, [docsForTab2]);

  // Derive filter options from vendorDocs data (mode-scoped)
  const docDerivedOptions = useMemo(() => {
    const allRows = docsForTab2.flatMap(d => d.data);
    const vendors = new Map<string, string>();
    const orderDays = new Set<string>();
    const itemTypes = new Set<string>();
    const buyingStatuses = new Set<string>();
    const poGroups = new Set<string>();
    for (const row of allRows) {
      if (row.vendor_code) vendors.set(row.vendor_code, row.vendor_display || row.vendor_code);
      if (row.order_day) orderDays.add(row.order_day);
      if (row.item_type) itemTypes.add(row.item_type);
      if (row.buying_status) buyingStatuses.add(row.buying_status);
      if (row.po_group) poGroups.add(row.po_group);
    }
    return {
      vendors: [...vendors.entries()].map(([k, v]) => ({ value: k, display: `${k} - ${v}` })).sort((a, b) => a.value.localeCompare(b.value)),
      orderDays: [...orderDays].sort().map(d => ({ value: d, display: d })),
      itemTypes: [...itemTypes].sort().map(t => ({ value: t, display: t })),
      buyingStatuses: [...buyingStatuses].sort().map(b => ({ value: b, display: b })),
      poGroups: [...poGroups].sort().map(p => ({ value: p, display: p })),
    };
  }, [docsForTab2]);

  // Update vendor options when doc SPC selection changes (mode-scoped)
  useEffect(() => {
    const allRows = docsForTab2.flatMap(d => d.data);
    let filtered = allRows;
    if (selectedDocSpc.length > 0) filtered = filtered.filter(r => selectedDocSpc.includes(r.spc_name));
    if (orderDayFilter.length > 0) filtered = filtered.filter(r => orderDayFilter.includes(r.order_day));
    const seen = new Map<string, string>();
    for (const r of filtered) {
      if (r.vendor_code && !seen.has(r.vendor_code)) seen.set(r.vendor_code, r.vendor_display || r.vendor_code);
    }
    const vList = [...seen.entries()].map(([k, v]) => ({ value: k, display: `${k} - ${v}` })).sort((a, b) => a.value.localeCompare(b.value));
    setVendorOptions(vList);
  }, [selectedDocSpc, orderDayFilter, docsForTab2]);

  const loadFilterOptions = async (forSpcs?: string[]) => {
    // ===== VENDOR MODE: imported vendor_codes → derive SPC from vendor_master =====
    if (importMode === "vendor") {
      if (importedVendors.length === 0) {
        toast({ title: "ยังไม่ได้ Import Vendor", description: "กรุณา Import Vendor Code ก่อน", variant: "destructive" });
        return;
      }
      setDataReady(false);
      setDataLoadingMsg(`กำลัง resolve ${importedVendors.length} vendor...`);
      setLoadingDetail("");
      try {
        const vCodes = [...new Set(importedVendors.map(v => v.vendor_code).filter(Boolean))];
        setLoadingDetail(`Vendor codes: ${vCodes.slice(0, 3).join(", ")}${vCodes.length > 3 ? `, +${vCodes.length - 3}` : ""}`);
        const vendorMasters = await fetchAllRows<any>(
          "vendor_master",
          "vendor_code, spc_name, order_day, supplier_currency, vendor_name_la, vendor_name_en",
          q => q.in("vendor_code", vCodes)
        );
        if (vendorMasters.length === 0) {
          // ทุก vendor ถูก skip → enrich reason
          const allSkipped: SkippedItem[] = vCodes.map(v => ({
            kind: "vendor" as const,
            key: v,
            reason: "ไม่พบใน Vendor Master",
            detail: "vendor_code นี้ไม่มีใน vendor_master",
          }));
          setImportedSkippedItems(allSkipped);
          setImportSkipDialogOpen(true);
          toast({ title: "ไม่พบ vendor ใน Master", variant: "destructive" });
          setDataLoadingMsg(""); return;
        }
        const foundCodes = new Set<string>(vendorMasters.map((v: any) => v.vendor_code).filter(Boolean));
        const skippedVendors = vCodes.filter(v => !foundCodes.has(v));
        setDataLoadingMsg(`กำลังโหลด Display Name (${foundCodes.size} vendor)...`);
        setLoadingDetail(`Match ${foundCodes.size}/${vCodes.length} vendor`);
        // Pull display names from data_master (preferred) for each found vendor
        const dms = await fetchAllRows<any>(
          "data_master", "vendor_code, vendor_display_name",
          q => q.in("vendor_code", [...foundCodes])
        );
        const displayMap = new Map<string, string>();
        for (const d of dms) { if (d.vendor_code && !displayMap.has(d.vendor_code)) displayMap.set(d.vendor_code, d.vendor_display_name || ""); }
        const spcSet = new Set<string>();
        const infoList: VendorInfo[] = [];
        for (const v of vendorMasters) {
          if (!v.vendor_code) continue;
          if (v.spc_name) spcSet.add(v.spc_name);
          infoList.push({
            vendor_code: v.vendor_code,
            vendor_display_name: displayMap.get(v.vendor_code) || v.vendor_name_en || v.vendor_name_la || v.vendor_code,
            spc_name: v.spc_name || "",
            order_day: v.order_day || "",
            supplier_currency: v.supplier_currency || "",
          });
        }
        setVendorInfoList(infoList);
        const spcs = [...spcSet].sort();
        setSelectedSpcForCal(spcs);
        setVendorFilterCal([...foundCodes]);
        const days = [...new Set(infoList.map(v => v.order_day).filter(Boolean))].sort();
        setOrderDayOptions(days.map(d => ({ value: d, display: d })));

        // Build skipped items list
        const skippedItems: SkippedItem[] = skippedVendors.map(v => ({
          kind: "vendor" as const,
          key: v,
          reason: "ไม่พบใน Vendor Master",
          detail: "vendor_code นี้ไม่มีใน vendor_master",
        }));
        setImportedSkippedItems(skippedItems);
        setLastImportRanAt(Date.now());
        setDataReady(true); setDataLoadingMsg(""); setLoadingDetail("");
        toast({
          title: "เตรียมข้อมูลเสร็จ (Vendor Mode)",
          description: `Match ${foundCodes.size}/${vCodes.length} vendor · ${spcs.length} SPC${skippedVendors.length ? ` · Skip ${skippedVendors.length}` : " · ไม่มี skip"}`,
        });
        if (skippedItems.length > 0) setImportSkipDialogOpen(true);
      } catch (err: any) {
        toast({ title: "Error (Vendor Mode)", description: err.message, variant: "destructive" });
        setDataLoadingMsg(""); setLoadingDetail("");
      }
      return;
    }

    // ===== IMPORT MODE: resolve barcodes/SKUs → derive SPC + vendor =====
    if (importMode === "import") {
      if (importedItems.length === 0) {
        toast({ title: "ยังไม่ได้ Import", description: "กรุณา Import ไฟล์ Barcode/SKU ก่อน", variant: "destructive" });
        return;
      }
      setDataReady(false);
      setDataLoadingMsg(`กำลัง resolve ${importedItems.length} รายการ...`);
      setLoadingDetail("");
      try {
        const keys = importedItems.map(i => i.key);
        // Lookup in data_master by main_barcode, barcode, sku_code (chunked)
        const found = new Map<string, { sku_code: string; vendor_code: string; vendor_display_name: string; spc?: string }>();
        const matchedKeys = new Set<string>();
        const chunkSize = 80; // keep URL length safely under PostgREST/server limit
        for (let i = 0; i < keys.length; i += chunkSize) {
          const slice = keys.slice(i, i + chunkSize);
          const upTo = Math.min(i + chunkSize, keys.length);
          setDataLoadingMsg(`กำลัง resolve ${upTo}/${keys.length} (chunk ${Math.floor(i / chunkSize) + 1})...`);
          setLoadingDetail(`Match: ${matchedKeys.size} · SKU: ${found.size} · กำลังดึง ${slice[0]}${slice.length > 1 ? ` ... ${slice[slice.length - 1]}` : ""}`);
          const inExpr = slice.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(",");
          const { data, error } = await (supabase as any)
            .from("data_master")
            .select("sku_code, main_barcode, barcode, vendor_code, vendor_display_name")
            .or(`main_barcode.in.(${inExpr}),barcode.in.(${inExpr}),sku_code.in.(${inExpr})`);
          if (error) throw error;
          for (const row of (data || []) as any[]) {
            if (!row.sku_code) continue;
            // figure out which key matched
            const matchedKey = slice.find(k => k === row.main_barcode || k === row.barcode || k === row.sku_code);
            if (matchedKey) matchedKeys.add(matchedKey);
            if (!found.has(row.sku_code)) found.set(row.sku_code, {
              sku_code: row.sku_code,
              vendor_code: row.vendor_code || "",
              vendor_display_name: row.vendor_display_name || row.vendor_code || "",
            });
          }
        }
        // Build qty map keyed by sku_code (use first matching imported item's qty)
        const qtyMap = new Map<string, number>();
        for (const it of importedItems) {
          for (const [sku, info] of found) {
            // match by direct sku, or by barcode lookup — easiest: re-query from data_master result
            // we already have found by sku_code only, so map by re-iterating below
          }
        }
        // Build sku→qty by running through items again with master rows
        // Build a key→sku resolver
        const keyToSku = new Map<string, string>();
        // Re-fetch master rows for all matched keys with all 3 columns to map back
        const matchedKeysArr = [...matchedKeys];
        for (let i = 0; i < matchedKeysArr.length; i += chunkSize) {
          const slice = matchedKeysArr.slice(i, i + chunkSize);
          const inExpr2 = slice.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(",");
          const { data } = await (supabase as any)
            .from("data_master")
            .select("sku_code, main_barcode, barcode")
            .or(`main_barcode.in.(${inExpr2}),barcode.in.(${inExpr2}),sku_code.in.(${inExpr2})`);
          for (const row of (data || []) as any[]) {
            if (!row.sku_code) continue;
            if (row.main_barcode && slice.includes(row.main_barcode)) keyToSku.set(row.main_barcode, row.sku_code);
            if (row.barcode && slice.includes(row.barcode)) keyToSku.set(row.barcode, row.sku_code);
            if (slice.includes(row.sku_code)) keyToSku.set(row.sku_code, row.sku_code);
          }
        }
        const poCostMap = new Map<string, number>();
        const qtyUnitMap = new Map<string, number>();
        const skuToOverrideVendor = new Map<string, string>();
        for (const it of importedItems) {
          const sku = keyToSku.get(it.key);
          if (!sku) continue;
          if (it.qty > 0) qtyMap.set(sku, it.qty);
          if (it.qtyUnit && it.qtyUnit > 0) qtyUnitMap.set(sku, it.qtyUnit);
          if (it.poCost && it.poCost > 0) poCostMap.set(sku, it.poCost);
          if (it.overrideVendor && it.overrideVendor.trim()) skuToOverrideVendor.set(sku, it.overrideVendor.trim());
        }

        // NOTE: do NOT mutate found[].vendor_code here — we still need the ORIGINAL vendor's SPC
        // so the DB fetch (by SPC) returns the SKU's raw row. Override patching happens later
        // on raw rows inside readAndCalc.

        const skipped = importedItems.map(i => i.key).filter(k => !matchedKeys.has(k));
        setImportedSkippedKeys(skipped);
        setImportedSkuSet(new Set(found.keys()));
        setImportedQtyBySku(qtyMap);
        setImportedQtyUnitBySku(qtyUnitMap);
        setImportedPoCostBySku(poCostMap);

        // Build SkippedItem[] with reason — query data_master loosely (no Lanexang/Inactive filter) เพื่อหา reason
        const skippedItems: SkippedItem[] = [];
        if (skipped.length > 0) {
          const enrichMap = new Map<string, { sku?: string; status?: string; owner?: string; vendor?: string }>();
          for (let i = 0; i < skipped.length; i += chunkSize) {
            const slice = skipped.slice(i, i + chunkSize);
            const inExpr = slice.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(",");
            const { data: enrich } = await (supabase as any)
              .from("data_master")
              .select("sku_code, main_barcode, barcode, buying_status, product_owner, vendor_code")
              .or(`main_barcode.in.(${inExpr}),barcode.in.(${inExpr}),sku_code.in.(${inExpr})`);
            for (const row of (enrich || []) as any[]) {
              for (const k of slice) {
                if (k === row.main_barcode || k === row.barcode || k === row.sku_code) {
                  enrichMap.set(k, { sku: row.sku_code, status: row.buying_status, owner: row.product_owner, vendor: row.vendor_code });
                }
              }
            }
          }
          for (const k of skipped) {
            const e = enrichMap.get(k);
            if (!e) {
              skippedItems.push({ kind: "sku", key: k, reason: "ไม่พบใน Master", detail: "barcode/SKU นี้ไม่มีใน data_master" });
            } else if (e.status === "Inactive") {
              skippedItems.push({ kind: "sku", key: k, reason: "Inactive", detail: `SKU ${e.sku || "-"} · buying_status = Inactive` });
            } else if (!e.vendor) {
              skippedItems.push({ kind: "sku", key: k, reason: "ไม่มี Vendor Code", detail: `SKU ${e.sku || "-"} · vendor_code ว่าง` });
            } else {
              skippedItems.push({ kind: "sku", key: k, reason: "ไม่ผ่าน filter อื่น", detail: `SKU ${e.sku || "-"} · owner=${e.owner || "-"}` });
            }
          }
        }
        setImportedSkippedItems(skippedItems);
        setLastImportRanAt(Date.now());

        if (found.size === 0) {
          setDataLoadingMsg(""); setLoadingDetail("");
          toast({ title: "ไม่พบรายการใด ๆ ใน Master", description: `Skip ทั้งหมด ${skipped.length} รายการ`, variant: "destructive" });
          if (skippedItems.length > 0) setImportSkipDialogOpen(true);
          return;
        }

        // Now derive vendor_master rows for those vendors → get spc_name + order_day
        // Include ORIGINAL vendors (from data_master) + OVERRIDE vendors so SPC list covers both
        const baseVendorCodes = [...new Set([...found.values()].map(v => v.vendor_code).filter(Boolean))];
        const overrideVendorCodes = [...new Set([...skuToOverrideVendor.values()])];
        const vendorCodes = [...new Set([...baseVendorCodes, ...overrideVendorCodes])];
        setDataLoadingMsg(`กำลังโหลด Vendor Master (${vendorCodes.length})...`);
        setLoadingDetail(`Vendors: ${vendorCodes.slice(0, 4).join(", ")}${vendorCodes.length > 4 ? `, +${vendorCodes.length - 4}` : ""}`);
        const vendorMasters = await fetchAllRows<any>(
          "vendor_master", "vendor_code, vendor_name_en, vendor_name_la, spc_name, order_day, supplier_currency, leadtime, order_cycle",
          q => q.in("vendor_code", vendorCodes)
        );
        const spcSet = new Set<string>();
        const infoList: VendorInfo[] = [];
        const vmMap = new Map<string, any>();
        for (const v of vendorMasters) {
          if (!v.vendor_code) continue;
          vmMap.set(v.vendor_code, v);
          if (v.spc_name) spcSet.add(v.spc_name);
        }
        for (const vc of vendorCodes) {
          const vm = vmMap.get(vc);
          const f = [...found.values()].find(x => x.vendor_code === vc);
          infoList.push({
            vendor_code: vc,
            vendor_display_name: f?.vendor_display_name || vc,
            spc_name: vm?.spc_name || "",
            order_day: vm?.order_day || "",
            supplier_currency: vm?.supplier_currency || "",
          });
        }
        setVendorInfoList(infoList);

        // Build override map: sku → full vendor patch (only for SKUs with overrideVendor)
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
        const missingOv = [...skuToOverrideVendor.values()].filter(vc => !vmMap.has(vc));
        if (missingOv.length > 0) {
          toast({
            title: "Override Vendor: บาง vendor ไม่พบใน Vendor Master",
            description: `${missingOv.slice(0, 5).join(", ")}${missingOv.length > 5 ? ` ... +${missingOv.length - 5}` : ""} — แถวจะใช้ leadtime/oc = 0`,
            variant: "destructive",
          });
        }
        // Auto-select all derived SPCs so readAndCalc loops them
        const spcs = [...spcSet].sort();
        setSelectedSpcForCal(spcs);
        const days = [...new Set(infoList.map(v => v.order_day).filter(Boolean))].sort();
        setOrderDayOptions(days.map(d => ({ value: d, display: d })));
        setDataReady(true);
        setDataLoadingMsg(""); setLoadingDetail("");
        toast({
          title: "เตรียมข้อมูลเสร็จ (Import Mode)",
          description: `Match ${matchedKeys.size}/${importedItems.length} · ${found.size} SKU · ${spcs.length} SPC · ${vendorCodes.length} Vendor${skipped.length > 0 ? ` · Skip ${skipped.length}` : " · ไม่มี skip"}`,
        });
        if (skippedItems.length > 0) setImportSkipDialogOpen(true);
      } catch (err: any) {
        toast({ title: "Error (Import Mode)", description: err.message, variant: "destructive" });
        setDataLoadingMsg(""); setLoadingDetail("");
      }
      return;
    }

    // ===== FILTER MODE (existing flow) =====
    // Allow prepare with explicit SPC OR inferred SPC list from Vendor/OrderDay filters
    const spcsToLoad = forSpcs || (selectedSpcForCal.length > 0 ? selectedSpcForCal : effectiveSpcsForCal);
    if (spcsToLoad.length === 0) {
      toast({ title: "กรุณาเลือก Filter ก่อน", description: "เลือก SPC Name, Vendor หรือ Order Day อย่างน้อย 1 ตัว แล้วกดเตรียมข้อมูล", variant: "destructive" });
      return;
    }
    // Sync derived SPC selection back so subsequent calc uses the same set
    if (selectedSpcForCal.length === 0 && spcsToLoad.length > 0) {
      setSelectedSpcForCal(spcsToLoad);
    }
    setDataReady(false);
    setDataLoadingMsg("กำลังโหลด Vendor Master...");
    setLoadingDetail(`SPC: ${spcsToLoad.slice(0, 3).join(", ")}${spcsToLoad.length > 3 ? `, +${spcsToLoad.length - 3}` : ""}`);
    try {
      // Load only vendors matching selected SPCs
      const vendorMasters = await fetchAllRows<any>("vendor_master", "vendor_code, spc_name, order_day, supplier_currency",
        q => q.in("spc_name", spcsToLoad)
      );
      const vmMap = new Map<string, { spc_name: string; order_day: string; supplier_currency: string }>();
      for (const v of vendorMasters) {
        if (v.vendor_code) vmMap.set(v.vendor_code, { spc_name: v.spc_name || "", order_day: v.order_day || "", supplier_currency: v.supplier_currency || "" });
      }

      const vendorCodes = [...vmMap.keys()];
      if (vendorCodes.length === 0) {
        setDataReady(true);
        setDataLoadingMsg(""); setLoadingDetail("");
        toast({ title: "ไม่พบ Vendor", description: `ไม่พบ Vendor ใน SPC: ${spcsToLoad.join(", ")}` });
        return;
      }

      setDataLoadingMsg("กำลังโหลด Item Type...");
      setLoadingDetail(`Vendor: ${vendorCodes.length} codes · SPC: ${spcsToLoad.length}`);
      const itemTypes = await fetchAllRows<any>(
        "data_master", "item_type",
        q => q.eq("packing_size_qty", 1)
              .eq("product_owner", "Lanexang Green Property Sole Co.,Ltd").not("item_type", "is", null)
              .in("vendor_code", vendorCodes)
      );
      const itSet = [...new Set(itemTypes.map((r: any) => r.item_type as string).filter(Boolean))].sort();
      setItemTypeOptions(itSet.map(t => ({ value: t, display: t })));

      setDataLoadingMsg("กำลังโหลด Buying Status...");
      setLoadingDetail(`Item Type พบ ${itSet.length} ประเภท`);
      const buyingStatuses = await fetchAllRows<any>(
        "data_master", "buying_status",
        q => q.eq("packing_size_qty", 1)
              .eq("product_owner", "Lanexang Green Property Sole Co.,Ltd").not("buying_status", "is", null)
              .in("vendor_code", vendorCodes)
      );
      const bsSet = [...new Set(buyingStatuses.map((r: any) => r.buying_status as string).filter(Boolean))].sort();
      setBuyingStatusOptions(bsSet.map(b => ({ value: b, display: b })));

      setDataLoadingMsg("กำลังโหลด Vendor Display Names...");
      setLoadingDetail(`Buying Status พบ ${bsSet.length} ประเภท`);
      const masters = await fetchAllRows<any>(
        "data_master", "vendor_code, vendor_display_name",
        q => q.eq("packing_size_qty", 1)
              .eq("product_owner", "Lanexang Green Property Sole Co.,Ltd")
              .in("vendor_code", vendorCodes)
      );
      const vendorSeen = new Map<string, string>();
      const infoList: VendorInfo[] = [];
      for (const m of masters) {
        if (!m.vendor_code || vendorSeen.has(m.vendor_code)) continue;
        vendorSeen.set(m.vendor_code, m.vendor_display_name || m.vendor_code);
        const vm = vmMap.get(m.vendor_code);
        infoList.push({
          vendor_code: m.vendor_code,
          vendor_display_name: m.vendor_display_name || m.vendor_code,
          spc_name: vm?.spc_name || "",
          order_day: vm?.order_day || "",
          supplier_currency: vm?.supplier_currency || "",
        });
      }
      setVendorInfoList(infoList);
      const days = [...new Set(infoList.map(v => v.order_day).filter(Boolean))].sort();
      setOrderDayOptions(days.map(d => ({ value: d, display: d })));
      setDataReady(true);
      setDataLoadingMsg(""); setLoadingDetail("");
      setStatusBanner({
        title: "✅ เตรียมข้อมูลเสร็จ",
        detail: `${infoList.length.toLocaleString()} Vendor · ${spcsToLoad.length.toLocaleString()} SPC Name (รอ Cal)`,
      });
    } catch (err: any) {
      toast({ title: "Error loading filters", description: err.message, variant: "destructive" });
      setDataLoadingMsg("โหลดข้อมูลล้มเหลว"); setLoadingDetail("");
    }
  };

  // ============================================================
  // TAB 1: READ & CAL per SPC → save as VendorDocuments
  // ============================================================
  const readAndCalc = async () => {
    const spcsToProcess = selectedSpcForCal;
    if (spcsToProcess.length === 0) {
      toast({ title: "ไม่พบ SPC Name", description: "กรุณาเลือก SPC Name แล้วกดเตรียมข้อมูลก่อน", variant: "destructive" });
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
      // Import mode: filter directly by imported SKU set (Option A — fastest path).
      // Vendor codes can be null because the RPC will naturally restrict via the SKU filter
      // joined with vendor_master, avoiding a vendor-wide scan.
      const isImportMode = importMode === "import";
      const skuFilter = isImportMode && importedSkuSet.size > 0 ? Array.from(importedSkuSet) : null;
      const isVendorMode = importMode === "vendor";
      // Import/Vendor modes IGNORE all "filter mode" filters (only use imported SKU/Vendor list)
      const vcFilterAll = isImportMode
        ? null
        : isVendorMode
          ? [...new Set(vendorInfoList.filter(v => spcsToProcess.includes(v.spc_name)).map(v => v.vendor_code))]
          : (vendorFilterCal.length > 0 ? vendorFilterCal : null);
      const odParam = (isImportMode || isVendorMode) ? null : (orderDayCal.length > 0 ? orderDayCal : null);
      const itParam = (isImportMode || isVendorMode) ? null : (itemTypeCal.length > 0 ? itemTypeCal : null);
      const ignoreFilters = isImportMode || isVendorMode;

      setLoadingPhase(isImportMode
        ? `กำลังโหลด ${importedSkuSet.size} SKU (Import Mode — fast path)...`
        : `กำลังโหลดข้อมูล ${spcsToProcess.length} SPC...`);
      setLoadingDetail(isImportMode
        ? `SKU จาก Import: ${importedSkuSet.size} · Vendor codes auto-resolve`
        : `SPC: ${spcsToProcess.slice(0, 3).join(", ")}${spcsToProcess.length > 3 ? `, +${spcsToProcess.length - 3}` : ""}${vcFilterAll ? ` · Vendor: ${vcFilterAll.length}` : ""}`);
      setCalcProgress(5);

      // ONE batched RPC call. Import mode passes p_sku_codes for direct SKU filtering.
      let allRawRows = await fetchSRRDataRPC(vcFilterAll, spcsToProcess, odParam, itParam, {
        divisionGroups: ignoreFilters ? null : (divisionGroupCal.length > 0 ? divisionGroupCal : null),
        divisions: ignoreFilters ? null : (divisionCal.length > 0 ? divisionCal : null),
        departments: ignoreFilters ? null : (departmentCal.length > 0 ? departmentCal : null),
        subDepartments: ignoreFilters ? null : (subDepartmentCal.length > 0 ? subDepartmentCal : null),
        classes: ignoreFilters ? null : (classCal.length > 0 ? classCal : null),
        subClasses: ignoreFilters ? null : (subClassCal.length > 0 ? subClassCal : null),
      }, (loaded) => {
        setLoadingDetail(`โหลดแล้ว ${loaded.toLocaleString()} rows จาก data_master/stock/sales/on_order...`);
        setCalcProgress(prev => Math.min(45, 5 + Math.round((loaded / 5000) * 8)));
      }, skuFilter);

      // Client-side: Buying Status & PO Group (RPC ไม่รับ params) — skip in Import/Vendor mode
      if (!ignoreFilters) {
        setLoadingDetail(`รวม ${allRawRows.length.toLocaleString()} rows · กำลังกรอง Buying Status / PO Group...`);
        if (buyingStatusCal.length > 0) allRawRows = allRawRows.filter((r: any) => buyingStatusCal.includes(r.buying_status));
        if (poGroupCal.length > 0) allRawRows = allRawRows.filter((r: any) => poGroupCal.includes(r.po_group));
      }

      // Pre-aggregate Store Name filter — works in ALL modes (incl. Import/Vendor)
      // Drop raw rows whose store_name is not in selection (only when raw has store_name).
      if (storeNameCal.length > 0) {
        const keepStores = new Set(storeNameCal);
        allRawRows = allRawRows.filter((r: any) => !r.store_name || keepStores.has(r.store_name));
      }

      // OVERRIDE VENDOR: patch raw rows in-place — swap vendor_code/spc/order_day/leadtime/oc for matched SKUs.
      // Also re-lookup po_cost from (sku, override_vendor) because the RPC joins po_cost by
      // data_master.vendor_code (original vendor), so override vendors get no po_cost otherwise.
      if (isImportMode && importedOverrideVendorBySku.size > 0) {
        // Fetch po_cost for all (sku, override_vendor) pairs
        const ovPairs: { sku: string; vendor: string }[] = [];
        for (const [sku, ov] of importedOverrideVendorBySku) {
          if (sku && ov?.vendor_code) ovPairs.push({ sku, vendor: ov.vendor_code });
        }
        const pcMap = new Map<string, { moq: number | null; po_cost: number | null; po_cost_unit: number | null }>();
        if (ovPairs.length > 0) {
          setDataLoadingMsg(`กำลังโหลด PO Cost ของ Override Vendor (${ovPairs.length} รายการ)...`);
          const ovSkus = [...new Set(ovPairs.map(p => p.sku))];
          const ovVendors = [...new Set(ovPairs.map(p => p.vendor))];
          try {
            const pcRows = await fetchAllRows<any>(
              "po_cost",
              "item_id, vendor, moq, po_cost, po_cost_unit, updated_at",
              q => q.in("item_id", ovSkus).in("vendor", ovVendors).order("updated_at", { ascending: false })
            );
            // keep latest per (item_id, vendor)
            for (const r of pcRows) {
              const k = `${r.item_id}__${r.vendor}`;
              if (!pcMap.has(k)) pcMap.set(k, { moq: r.moq, po_cost: r.po_cost, po_cost_unit: r.po_cost_unit });
            }
          } catch (e) {
            console.warn("[SRR DC] Override Vendor po_cost lookup failed:", e);
          }
          setDataLoadingMsg(""); setLoadingDetail("");
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
            // No po_cost row for override vendor — clear stale values from original vendor
            r.po_cost = null;
            r.po_cost_unit = null;
          }
        }
      }

      // Group rows by SPC for per-SPC processing
      // In Import/Vendor mode, also restrict to SPCs the user explicitly picked (sub-filter of derived SPCs)
      const spcLimit = (isImportMode || isVendorMode) && selectedSpcForCal.length > 0
        ? new Set(selectedSpcForCal)
        : null;
      const rowsBySpc = new Map<string, any[]>();
      for (const r of allRawRows) {
        const spc = r.spc_name || "";
        if (!spcsToProcess.includes(spc)) continue;
        if (spcLimit && !spcLimit.has(spc)) continue;
        if (!rowsBySpc.has(spc)) rowsBySpc.set(spc, []);
        rowsBySpc.get(spc)!.push(r);
      }

      for (let i = 0; i < spcsToProcess.length; i++) {
        if (cancelCalcRef.current) {
          toast({ title: "ยกเลิกการคำนวณ", description: `คำนวณเสร็จ ${i}/${spcsToProcess.length} SPC` });
          break;
        }

        const spcName = spcsToProcess[i];
        const pct = 50 + Math.round((i / spcsToProcess.length) * 45);
        setCalcProgress(pct);
        setLoadingPhase(`[${i + 1}/${spcsToProcess.length}] กำลังคำนวณ: ${spcName}`);

        let rawRows = rowsBySpc.get(spcName) || [];
        if (rawRows.length === 0) {
          setLoadingDetail(`SPC ${spcName} · ไม่พบข้อมูล (ข้าม)`);
          continue;
        }
        setLoadingDetail(`SPC ${spcName} · ${rawRows.length.toLocaleString()} rows · กำลังกรอง SKU`);

        // Import Mode: keep only rows whose sku_code is in imported set
        const filteredRaw = importMode === "import" && importedSkuSet.size > 0
          ? rawRows.filter((r: any) => importedSkuSet.has(r.sku_code))
          : rawRows;
        if (filteredRaw.length === 0) continue;

        setLoadingDetail(`SPC ${spcName} · กำลังคำนวณ Min/Max/Stock/Sales (${filteredRaw.length.toLocaleString()} rows)`);
        let calculated = buildSRRRows(filteredRaw, vendorInfoList);

        // Override barcode_unit using data_master row where packing_size_qty=1 (Unit pack)
        try {
          const skusForUnit = [...new Set(calculated.map(r => r.sku_code).filter(Boolean))];
          setLoadingDetail(`SPC ${spcName} · กำลังโหลด Barcode Unit (${skusForUnit.length} SKU)`);
          const unitMap = await fetchUnitPackLookup(skusForUnit);
          if (unitMap.size > 0) {
            calculated = calculated.map(r => {
              const up = unitMap.get(r.sku_code);
              return up && up.barcode ? { ...r, barcode_unit: up.barcode } : r;
            });
          }
        } catch (e) {
          console.warn("[SRR DC] barcode_unit lookup failed:", e);
        }

        // Apply Pack/Box (qty) from latest Range Store snapshot
        try {
          const pbMap = await getLatestRangeStorePackBox();
          if (pbMap.size > 0) {
            calculated = calculated.map(r => {
              const pb = pbMap.get(r.sku_code);
              return pb ? { ...r, pack: pb.pack, box: pb.box } : r;
            });
          }
        } catch (e) {
          console.warn("[SRR DC] pack/box lookup failed:", e);
        }

        // Import Mode:
        //  Qty Uom  → order_uom_edit (recalc: final_suggest_qty = uomEdit * MOQ)
        //  Qty Unit → roundup to MOQ → write final_suggest_qty/uom directly (order_uom_edit blank)
        //  Po cost  → override per SKU
        if (importMode === "import" && (importedQtyBySku.size > 0 || importedQtyUnitBySku.size > 0 || importedPoCostBySku.size > 0)) {
          calculated = calculated.map(r => {
            const q = importedQtyBySku.get(r.sku_code);
            const qUnit = importedQtyUnitBySku.get(r.sku_code);
            const pc = importedPoCostBySku.get(r.sku_code);
            if (!q && !qUnit && !pc) return r;
            const moq = r.moq || 1;
            const next = { ...r };
            if (pc && pc > 0) {
              // Imported PO Cost = ราคาต่อหน่วย (Po Cost Unit) โดยตรง — ไม่หาร MOQ
              // po_cost (รวม) คำนวณกลับเป็น pc * moq เพื่อให้สอดคล้องกับสูตร po_cost_unit = po_cost / moq
              next.po_cost_unit = pc;
              next.po_cost = moq > 0 ? pc * moq : pc;
            }
            if (q && q > 0) {
              next.order_uom_edit = String(q);
              return recalcRow(next);
            }
            if (qUnit && qUnit > 0) {
              // Qty Unit ส่งตรงไป finalorder qty (roundup MOQ) — order_uom_edit เว้นว่าง
              const roundedUnit = moq > 0 ? Math.ceil(qUnit / moq) * moq : qUnit;
              const uomCount = moq > 0 ? roundedUnit / moq : roundedUnit;
              next.order_uom_edit = "";
              const recalced = recalcRow(next);
              recalced.final_suggest_qty = Math.round(roundedUnit * 100) / 100;
              recalced.final_suggest_uom = Math.round(uomCount * 100) / 100;
              return recalced;
            }
            return recalcRow(next);
          });
        }

        // Apply Type Store filter: zero-out values for unselected stores, then drop empty rows
        if (typeStoreCal.length > 0) {
          const keepJ = typeStoreCal.includes("Jmart");
          const keepK = typeStoreCal.includes("Kokkok");
          const keepU = typeStoreCal.includes("U-dee");
          calculated = calculated.map(r => {
            const next = { ...r };
            if (!keepJ) { next.min_jmart = 0; next.max_jmart = 0; next.stock_jmart = 0; next.avg_sales_jmart = 0; }
            if (!keepK) {
              next.min_kokkok = 0; next.max_kokkok = 0; next.stock_kokkok = 0; next.avg_sales_kokkok = 0;
              next.min_kokkok_fc = 0; next.max_kokkok_fc = 0; next.stock_kokkok_fc = 0; next.avg_sales_kokkok_fc = 0;
            }
            if (!keepU) { next.min_udee = 0; next.max_udee = 0; next.stock_udee = 0; next.avg_sales_udee = 0; }
            return recalcRow(next);
          }).filter(r =>
            (keepJ && (r.min_jmart || r.max_jmart || r.stock_jmart || r.avg_sales_jmart)) ||
            (keepK && (r.min_kokkok || r.max_kokkok || r.stock_kokkok || r.avg_sales_kokkok || r.min_kokkok_fc || r.max_kokkok_fc || r.stock_kokkok_fc || r.avg_sales_kokkok_fc)) ||
            (keepU && (r.min_udee || r.max_udee || r.stock_udee || r.avg_sales_udee))
          );
        }

        const vendorMap = new Map<string, SRRRow[]>();
        for (const row of calculated) {
          const vc = row.vendor_code || "UNKNOWN";
          if (!vendorMap.has(vc)) vendorMap.set(vc, []);
          vendorMap.get(vc)!.push(row);
        }

        setLoadingDetail(`SPC ${spcName} · กำลังจัดกลุ่มเป็น Document (${vendorMap.size} vendor)`);
        for (const [vc, rows] of vendorMap) {
          const vDisplay = rows[0]?.vendor_display || vc;
          newDocs.push({
            id: `vdoc-${importMode}-${dateKey}-${now.getTime()}-${spcName}-${vc}`,
            vendor_code: vc,
            vendor_display: vDisplay,
            spc_name: spcName,
            date_key: dateKey,
            created_at: now.toISOString(),
            item_count: rows.length,
            suggest_count: rows.filter(r => r.final_suggest_qty > 0).length,
            data: rows,
            edit_count: 0,
            edited_columns: [],
            source: importMode as "filter" | "vendor" | "import",
            user_id: user?.id,
          });
        }
      }

      setCalcProgress(96);
      setLoadingPhase("กำลังบันทึกลง Database...");
      const totalRowsCalc = newDocs.reduce((s, d) => s + d.item_count, 0);
      setLoadingDetail(`รวม ${newDocs.length} Vendor Docs · ${totalRowsCalc.toLocaleString()} rows`);

      // Track calculated SPCs
      setCalculatedSpcs(prev => {
        const next = new Set(prev);
        for (const spc of spcsToProcess) {
          if (cancelCalcRef.current) break;
          next.add(spc);
        }
        return next;
      });

      // Merge with existing: overwrite only the same batch + SPC + Vendor + mode.
      // Other vendors calculated in the same minute must remain separate docs.
      setVendorDocs(prev => {
        const newDocKeys = new Set(newDocs.map(d => `${d.source || importMode}|${getBatchKey(d)}|${d.spc_name}|${d.vendor_code}`));
        const kept = prev.filter(d => {
          if (!isWithin30Days(d.date_key)) return false;
          const docKey = `${d.source || "filter"}|${getBatchKey(d)}|${d.spc_name}|${d.vendor_code}`;
          return !newDocKeys.has(docKey);
        });
        return [...kept, ...newDocs];
      });

      // Optimistically show the new batch in the picker IMMEDIATELY (before DB save).
      // This makes the calculated docs visible without waiting for the save round-trip.
      const latestBatchValue = newDocs.length > 0 ? newDocs[0].created_at : "";
      const latestBatchLabel = latestBatchValue ? formatLocalBatchLabel(latestBatchValue) : "";
      if (newDocs.length > 0) {
        setSnapshotBatches(prev => [
          { value: latestBatchValue, label: latestBatchLabel, date_key: getTodayKey(), count: newDocs.length, source: importMode as any },
          // Drop any pre-existing entry that targets the same minute+mode to avoid duplicates
          ...prev.filter(b => !(b.label === latestBatchLabel && (b.source || "filter") === importMode)),
        ]);
        setSelectedBatchValuesByMode(prev => ({ ...prev, [importMode]: [latestBatchValue] }));
      }
      setLatestImportedDocIds(newDocs.map((d) => d.id));

      // AUTO-SAVE to Database (with granular progress)
      if (user && newDocs.length > 0) {
        try {
          const todayISO = getTodayKey();
          const batchCreatedAt = newDocs[0].created_at;
          const totalRowsForSave = newDocs.reduce((s, d) => s + d.item_count, 0);
          setLoadingPhase(`กำลังบันทึกลง Database... (${newDocs.length} docs · ${totalRowsForSave.toLocaleString()} rows)`);
          setLoadingDetail(`เตรียมบันทึก...`);
          await saveSnapshots(
            newDocs.map(d => ({
              spc_name: d.spc_name,
              vendor_code: d.vendor_code,
              vendor_display: d.vendor_display,
              item_count: d.item_count,
              suggest_count: d.suggest_count,
              data: d.data,
              edit_count: d.edit_count,
              edited_columns: d.edited_columns,
              source: d.source || importMode,
            })),
            user.id,
            todayISO,
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
            }
          );
          // Refresh available dates and batches, then dedupe (DB batch may share same minute label as optimistic)
          setLoadingDetail(`บันทึกสำเร็จ · refresh batch list...`);
          const [dates, batches] = await Promise.all([getSnapshotDates(), getSnapshotBatches("srr_snapshots")]);
          setSnapshotDates(dates);
          setSnapshotBatches(prev => {
            // Build deduped list by (mode + minute label): prefer the freshly-fetched DB row
            const byKey = new Map<string, typeof prev[number]>();
            for (const b of batches) byKey.set(`${b.source || "filter"}|${b.label}`, b);
            // Keep optimistic only if no DB equivalent exists yet
            for (const b of prev) {
              const k = `${b.source || "filter"}|${b.label}`;
              if (!byKey.has(k)) byKey.set(k, b);
            }
            return [...byKey.values()].sort((a, b) => b.label.localeCompare(a.label));
          });
          // Re-point selection to the DB batch value (ISO may differ from optimistic by ms)
          const dbMatch = batches.find(b => b.label === latestBatchLabel && (b.source || "filter") === importMode);
          if (dbMatch && dbMatch.value !== latestBatchValue) {
            setSelectedBatchValuesByMode(prev => ({ ...prev, [importMode]: [dbMatch.value] }));
          }

        } catch (saveErr: any) {
          console.error("Auto-save to DB failed:", saveErr);
          toast({ title: "⚠️ บันทึก DB ไม่สำเร็จ", description: saveErr.message, variant: "destructive" });
        }
      }

      // Enrich Skip List: SKUs/Vendors that were imported but did NOT survive RPC business filters
      try {
        const rpcSkus = new Set<string>(allRawRows.map((r: any) => r.sku_code).filter(Boolean));
        const rpcVendors = new Set<string>(allRawRows.map((r: any) => r.vendor_code).filter(Boolean));
        const extra: SkippedItem[] = [];
        if (isImportMode && importedSkuSet.size > 0) {
          const enriched = await enrichSkippedSkusAfterRead(Array.from(importedSkuSet), rpcSkus);
          extra.push(...enriched);
        }
        if (isVendorMode && importedVendors.length > 0) {
          const importedVcs = [...new Set(importedVendors.map(v => v.vendor_code).filter(Boolean))];
          extra.push(...buildVendorEmptyResultSkips(importedVcs, rpcVendors));
        }
        console.log("[SRR DC] Skip enrich:", {
          mode: importMode, importedSkuSize: importedSkuSet.size,
          importedVendorsLen: importedVendors.length,
          rpcSkus: rpcSkus.size, rpcVendors: rpcVendors.size,
          extra: extra.length, sample: extra.slice(0, 3),
        });
        // Always merge (even when extra=0) and flag that import ran so the bar reflects state
        setImportedSkippedItems(prev => {
          if (extra.length === 0) return prev;
          const seen = new Set(prev.map(p => `${p.kind}|${p.key}|${p.reason}`));
          const merged = [...prev];
          for (const e of extra) {
            const k = `${e.kind}|${e.key}|${e.reason}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          console.log("[SRR DC] Skip merged total:", merged.length);
          return merged;
        });
        setLastImportRanAt(Date.now());
      } catch (enrichErr) {
        console.warn("[SRR DC] Skip enrichment failed:", enrichErr);
      }

      setCalcProgress(100);
      const totalItems = newDocs.reduce((s, d) => s + d.item_count, 0);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const uniqVendors = new Set(newDocs.map(d => d.vendor_code)).size;
      const uniqSpcs = new Set(newDocs.map(d => d.spc_name)).size;
      const uniqSkus = new Set<string>();
      for (const d of newDocs) for (const r of d.data) if (r.sku_code) uniqSkus.add(r.sku_code);
      setLoadingDetail(`เสร็จสิ้น ${elapsed}s · ${totalItems.toLocaleString()} rows`);
      setStatusBanner({
        title: `✅ คำนวณเสร็จ (${elapsed}s)`,
        detail: `${uniqVendors.toLocaleString()} Vendor · ${uniqSkus.size.toLocaleString()} SKU · ${uniqSpcs.toLocaleString()} SPC · ${newDocs.length} Vendor Docs · บันทึกแล้ว`,
      });
      if (newDocs.length > 0) setDocsDialogOpen(true);

      setTimeout(() => { setCalcProgress(0); setLoadingPhase(""); setLoadingDetail(""); setCalcStartedAt(null); }, 2000);
    } catch (err: any) {
      console.error("[SRR DC] Read & Cal failed:", err);
      const msg = String(err?.message || err || "");
      const code = String(err?.code || "");
      const status = err?.status ?? err?.statusCode;
      const isAbort = err?.name === "AbortError" || /aborted|abortsignal/i.test(msg);
      const isTimeout =
        code === "57014" ||
        /timeout|statement[_ ]timeout|canceling statement|deadline|timed?\s*out/i.test(msg) ||
        status === 504 || status === 408 || isAbort;
      const isNetwork =
        /failed to fetch|network ?error|networkerror|load failed|fetch failed/i.test(msg) ||
        status === 0 || status === 502 || status === 503;
      if (isTimeout) {
        setCalcErrorDialog({
          open: true, kind: "timeout",
          title: "⏱️ Timeout — ดึงข้อมูลใช้เวลานานเกินไป",
          message:
            "ฐานข้อมูลใช้เวลาประมวลผลเกินขีดจำกัด (≈55 วินาที)\n" +
            "สาเหตุที่เป็นไปได้: เลือก SPC/Vendor เยอะเกินไป หรือข้อมูลในช่วง Filter มีจำนวนมาก\n\n" +
            "วิธีแก้:\n" +
            "• ลดจำนวน SPC ที่เลือกในรอบเดียว (แนะนำ ≤ 3 SPC)\n" +
            "• ใส่ Filter เพิ่ม เช่น Vendor / Order Day / Item Type\n" +
            "• กด Read & Cal ใหม่อีกครั้ง",
          raw: msg,
        });
      } else if (isNetwork) {
        setCalcErrorDialog({
          open: true, kind: "network",
          title: "🌐 Network Error — เชื่อมต่อ Server ไม่ได้",
          message: "การเชื่อมต่อขาดหายระหว่างดึงข้อมูล กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
          raw: msg,
        });
      } else {
        setCalcErrorDialog({
          open: true, kind: "error",
          title: "❌ Read & Cal ผิดพลาด",
          message: msg || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ",
          raw: msg,
        });
      }
    } finally {
      setLoading(false);
      setCalcStartedAt(null);
    }
  };

  const cancelCalc = () => { cancelCalcRef.current = true; };

  const deleteVendorDoc = async (docId: string) => {
    const doc = vendorDocs.find(d => d.id === docId);
    if (!doc) return;
    try {
      const result = await deleteSnapshotDocuments([doc], "srr_snapshots");
      setVendorDocs(prev => prev.filter(d => d.id !== docId));
      setShowData(prev => prev.filter(r => !doc.data.some(dr => dr.id === r.id)));
      setSelectedDocIds(prev => { const n = new Set(prev); n.delete(docId); return n; });
      toast({ title: "ลบ Document สำเร็จ", description: result.deleted === 0 ? "ลบออกจากหน้าจอแล้ว แต่ไม่พบแถวใน DB" : `ลบจาก DB ${result.deleted} รายการ` });
    } catch (e: any) {
      toast({ title: "ลบ Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // Mode-scoped: only act on docs of the currently active importMode
  const clearAllDocuments = async () => {
    const modeDocs = vendorDocs.filter(d => (d.source || "filter") === importMode);
    const ids = modeDocs.map(d => d.id);
    if (ids.length === 0) {
      toast({ title: "ไม่มี Document ใน Mode นี้" });
      return;
    }
    try {
      const result = await deleteSnapshotDocuments(modeDocs, "srr_snapshots");
      const idSet = new Set(ids);
      setVendorDocs(prev => prev.filter(d => !idSet.has(d.id)));
      setShowData([]);
      setCalculatedSpcs(new Set());
      setSelectedBatchValuesByMode(prev => ({ ...prev, [importMode]: [] }));
      setSelectedDocIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
      const modeLabel = importMode === "filter" ? "Filter" : importMode === "vendor" ? "Import Vendor" : "Import SKU";
      toast({ title: `ล้าง Document (${modeLabel}) แล้ว`, description: `ลบจาก DB ${result.deleted}/${result.requested} รายการ` });
    } catch (e: any) {
      toast({ title: "ล้าง Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const selectAllDocs = () => {
    const modeIds = vendorDocs.filter(d => (d.source || "filter") === importMode).map(d => d.id);
    setSelectedDocIds(prev => { const n = new Set(prev); modeIds.forEach(id => n.add(id)); return n; });
  };
  const unselectAllDocs = () => {
    const modeIds = new Set(vendorDocs.filter(d => (d.source || "filter") === importMode).map(d => d.id));
    setSelectedDocIds(prev => { const n = new Set(prev); modeIds.forEach(id => n.delete(id)); return n; });
  };
  const toggleDocSelect = (id: string) => {
    setSelectedDocIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const deleteSelectedDocs = async () => {
    const modeIdSet = new Set(vendorDocs.filter(d => (d.source || "filter") === importMode).map(d => d.id));
    const ids = [...selectedDocIds].filter(id => modeIdSet.has(id));
    if (ids.length === 0) return;
    const docs = vendorDocs.filter(d => ids.includes(d.id));
    try {
      const result = await deleteSnapshotDocuments(docs, "srr_snapshots");
      const idSet = new Set(ids);
      setVendorDocs(prev => prev.filter(d => !idSet.has(d.id)));
      setShowData(prev => prev.filter(r => !docs.some(doc => doc.data.some(dr => dr.id === r.id))));
      setSelectedDocIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
      toast({ title: "ลบ Document สำเร็จ", description: `ลบจาก DB ${result.deleted}/${result.requested} รายการ` });
    } catch (e: any) {
      toast({ title: "ลบ Document ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // Bulk delete by ids — used by Doc dialog (already-filtered ids)
  const deleteDocsByIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const docs = vendorDocs.filter(d => ids.includes(d.id));
    try {
      const result = await deleteSnapshotDocuments(docs, "srr_snapshots");
      // Verify against DB — only ids truly gone are removed from state.
      // (Guards against silent RLS denials where DELETE returns success but 0 rows.)
      const uuidIds = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id));
      let survivedIds = new Set<string>();
      if (uuidIds.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < uuidIds.length; i += chunkSize) {
          const chunk = uuidIds.slice(i, i + chunkSize);
          const { data } = await (supabase as any).from("srr_snapshots").select("id").in("id", chunk);
          (data || []).forEach((r: any) => survivedIds.add(r.id));
        }
      }
      const trulyDeleted = new Set(ids.filter(id => !survivedIds.has(id)));
      setVendorDocs(prev => prev.filter(d => !trulyDeleted.has(d.id)));
      setShowData(prev => prev.filter(r => !docs.some(doc => trulyDeleted.has(doc.id) && doc.data.some(dr => dr.id === r.id))));
      setSelectedDocIds(prev => { const n = new Set(prev); trulyDeleted.forEach(id => n.delete(id)); return n; });
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

  // ============================================================
  // TAB 2: SHOW — load from selected VendorDocuments
  // ============================================================
  const showFilteredData = async () => {
    // Tab 2 reads only docs from its own mode toggle (filter / vendor / import)
    if (docsForTab2.length === 0) {
      const modeLabel = tab2Mode === "filter" ? "Mode Filter" : tab2Mode === "vendor" ? "Import Vendor" : "Import Barcode";
      toast({ title: `ยังไม่มี Document ใน ${modeLabel}`, description: "ไปที่ Tab 1 แล้วกด Read & Cal ใน mode นี้ก่อน", variant: "destructive" });
      return;
    }

    let docs = docsForTab2;
    if (selectedDocSpc.length > 0) {
      docs = docs.filter(d => selectedDocSpc.includes(d.spc_name));
    }
    if (vendorFilter.length > 0) {
      docs = docs.filter(d => vendorFilter.includes(d.vendor_code));
    }

    // Merge data
    let merged: SRRRow[] = [];
    for (const doc of docs) merged.push(...doc.data);

    // Apply additional filters
    if (orderDayFilter.length > 0) {
      merged = merged.filter(r => orderDayFilter.includes(r.order_day));
    }
    // Item Type filter
    if (itemTypeFilter.length > 0) {
      merged = merged.filter(r => itemTypeFilter.includes(r.item_type));
    }
    // Buying Status filter
    if (buyingStatusFilter.length > 0) {
      merged = merged.filter(r => buyingStatusFilter.includes(r.buying_status));
    }
    // PO Group filter
    if (poGroupFilter.length > 0) {
      merged = merged.filter(r => poGroupFilter.includes(r.po_group));
    }

    // Sort: Product Name (EN) > Sub-Department > Department > PO Group (asc)
    merged.sort((a, b) => {
      const p = (a.product_name_en || "").localeCompare(b.product_name_en || "");
      if (p !== 0) return p;
      const sd = (a.sub_department || "").localeCompare(b.sub_department || "");
      if (sd !== 0) return sd;
      const d = (a.department || "").localeCompare(b.department || "");
      if (d !== 0) return d;
      return (a.po_group || "").localeCompare(b.po_group || "");
    });

    // Overlay Pack/Box (qty) from latest Range Store — fixes legacy docs saved without pack/box
    try {
      const pbMap = await getLatestRangeStorePackBox();
      if (pbMap.size > 0) {
        merged = merged.map(r => {
          if (r.pack != null && r.box != null) return r;
          const pb = pbMap.get(r.sku_code);
          if (!pb) return r;
          return {
            ...r,
            pack: r.pack != null ? r.pack : pb.pack,
            box: r.box != null ? r.box : pb.box,
          };
        });
      }
    } catch (e) {
      console.warn("[SRR DC Show] pack/box overlay failed:", e);
    }

    const _excluded = await (await import("@/lib/filterTemplates")).applyExcludeFilters(merged as any[], "srr_dc");
    setShowData(_excluded as any);
    setPage(0);
    setSelectedRows(new Set());
    setActiveCell(null);
    toast({
      title: `แสดง ${merged.length.toLocaleString()} รายการ`,
      description: selectedDocSpc.length > 0 ? `จาก ${selectedDocSpc.length} SPC` : "ทั้งหมด",
    });
  };

  // Edit Safety → recalc row + track edits
  const updateSafety = (rowId: string, value: string) => {
    const numVal = parseInt(value, 10);
    if (isNaN(numVal) && value !== "") return;
    const updater = (rows: SRRRow[]) => rows.map(r => {
      if (r.id !== rowId) return r;
      return recalcRow({ ...r, safety: numVal || 0 });
    });
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => {
      const hasRow = doc.data.some(r => r.id === rowId);
      if (!hasRow) return doc;
      const editedCols = new Set(doc.edited_columns);
      editedCols.add("safety");
      return {
        ...doc,
        data: doc.data.map(r => r.id === rowId ? recalcRow({ ...r, safety: numVal || 0 }) : r),
        edit_count: doc.edit_count + 1,
        edited_columns: [...editedCols],
      };
    }));
  };

  // Edit Avg Sales → recalc row + track edits
  const updateAvgSales = (rowId: string, field: "avg_sales_jmart" | "avg_sales_kokkok" | "avg_sales_kokkok_fc" | "avg_sales_udee", value: string) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal) && value !== "") return;
    const newVal = value === "" ? 0 : numVal;
    const updater = (rows: SRRRow[]) => rows.map(r => {
      if (r.id !== rowId) return r;
      return recalcRow({ ...r, [field]: newVal });
    });
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => {
      const hasRow = doc.data.some(r => r.id === rowId);
      if (!hasRow) return doc;
      const editedCols = new Set(doc.edited_columns);
      editedCols.add(field);
      return {
        ...doc,
        data: doc.data.map(r => r.id === rowId ? recalcRow({ ...r, [field]: newVal }) : r),
        edit_count: doc.edit_count + 1,
        edited_columns: [...editedCols],
      };
    }));
  };

  // Generic numeric field updater for Min/Stock (Clear/Restore)
  const updateNumericField = (
    rowId: string,
    field: "min_jmart" | "min_kokkok" | "min_kokkok_fc" | "min_udee" | "stock_jmart" | "stock_kokkok" | "stock_kokkok_fc" | "stock_udee",
    value: string,
  ) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal) && value !== "") return;
    const newVal = value === "" ? 0 : numVal;
    const updater = (rows: SRRRow[]) => rows.map(r => {
      if (r.id !== rowId) return r;
      return recalcRow({ ...r, [field]: newVal });
    });
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => {
      const hasRow = doc.data.some(r => r.id === rowId);
      if (!hasRow) return doc;
      const editedCols = new Set(doc.edited_columns);
      editedCols.add(field);
      return {
        ...doc,
        data: doc.data.map(r => r.id === rowId ? recalcRow({ ...r, [field]: newVal }) : r),
        edit_count: doc.edit_count + 1,
        edited_columns: [...editedCols],
      };
    }));
  };
  const updateOnOrder = (rowId: string, value: number) => {
    const updater = (rows: SRRRow[]) => rows.map(r =>
      r.id !== rowId ? r : recalcRow({ ...r, on_order: value })
    );
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => {
      const hasRow = doc.data.some(r => r.id === rowId);
      if (!hasRow) return doc;
      const editedCols = new Set(doc.edited_columns);
      editedCols.add("on_order");
      return {
        ...doc,
        data: doc.data.map(r => r.id === rowId ? recalcRow({ ...r, on_order: value }) : r),
        edit_count: doc.edit_count + 1,
        edited_columns: [...editedCols],
      };
    }));
  };

  const clearAllOnOrder = () => {
    setShowData(prev => prev.map(r => recalcRow({ ...r, on_order: 0 })));
    setVendorDocs(prev => prev.map(doc => ({
      ...doc,
      data: doc.data.map(r => recalcRow({ ...r, on_order: 0 })),
    })));
  };

  const restoreAllOnOrder = () => {
    setShowData(prev => prev.map(r => recalcRow({ ...r, on_order: r.orig_on_order })));
    setVendorDocs(prev => prev.map(doc => ({
      ...doc,
      data: doc.data.map(r => recalcRow({ ...r, on_order: r.orig_on_order })),
    })));
  };

  const updateOrderUomEdit = (rowId: string, value: string) => {
    const updater = (rows: SRRRow[]) => rows.map(r => {
      if (r.id !== rowId) return r;
      return recalcRow({ ...r, order_uom_edit: value });
    });
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => {
      const hasRow = doc.data.some(r => r.id === rowId);
      if (!hasRow) return doc;
      const editedCols = new Set(doc.edited_columns);
      editedCols.add("order_uom_edit");
      return {
        ...doc,
        data: doc.data.map(r => r.id === rowId ? recalcRow({ ...r, order_uom_edit: value }) : r),
        edit_count: doc.edit_count + 1,
        edited_columns: [...editedCols],
      };
    }));
  };

  const recalcSelected = () => {
    const targetIds = selectedRows.size > 0 ? selectedRows : new Set(showData.map(r => r.id));
    const updater = (rows: SRRRow[]) => rows.map(r => targetIds.has(r.id) ? recalcRow(r) : r);
    setShowData(updater);
    setVendorDocs(prev => prev.map(doc => ({
      ...doc,
      data: doc.data.map(r => targetIds.has(r.id) ? recalcRow(r) : r),
    })));
    toast({ title: "Recalculate สำเร็จ", description: `${targetIds.size} รายการ` });
  };

  // --- Paged data ---
  // Apply chip search to showData
  const filteredShowData = useMemo(() => {
    const base = showOnlyFinalGt0 ? showData.filter(r => r.final_suggest_qty > 0) : showData;
    return applyChipFilter(base, tableSearchChips, TABLE_SEARCH_KEYS);
  }, [showData, tableSearchChips, TABLE_SEARCH_KEYS, showOnlyFinalGt0]);
  const pagedData = filteredShowData.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filteredShowData.length / pageSize);

  // --- Row interactions ---
  const handleRowClick = (idx: number, id: string, e: { shiftKey: boolean }) => {
    if (e.shiftKey && lastClickedRow !== null) {
      const start = Math.min(lastClickedRow, idx);
      const end = Math.max(lastClickedRow, idx);
      setSelectedRows(prev => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) { if (pagedData[i]) next.add(pagedData[i].id); }
        return next;
      });
    } else {
      setSelectedRows(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }
    setLastClickedRow(idx);
    setActiveCell({ row: idx, col: activeCell?.col ?? 0 });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === pagedData.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(pagedData.map(r => r.id)));
  };

  const toggleColHighlight = (col: string) => {
    setSelectedCols(prev => { const next = new Set(prev); next.has(col) ? next.delete(col) : next.add(col); return next; });
  };

  // Column resize
  const onResizeStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    setResizing({ col, startX: e.clientX, startW: columnWidths[col] || getDefaultWidth(col) });
  };
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const diff = e.clientX - resizing.startX;
      setColumnWidths(prev => ({ ...prev, [resizing.col]: Math.max(60, resizing.startW + diff) }));
    };
    const onUp = () => setResizing(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizing]);

  const scrollActiveCellIntoView = useCallback((row: number, col: number) => {
    const container = tableContainerRef.current;
    if (!container) return;
    const cellEl = container.querySelector(`[data-row="${row}"][data-col="${col}"]`) as HTMLElement;
    if (cellEl) cellEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  const focusCellInput = useCallback((rowIdx: number, colKey: string) => {
    const el = document.querySelector(`input[data-row-idx="${rowIdx}"][data-col-key="${colKey}"]`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }, []);

  const editableColKeys = useMemo(() => [...EDITABLE_COLS], []);

  const handleTableKeyDown = useCallback((e: KeyboardEvent) => {
    if (!activeCell) return;
    const { row, col } = activeCell;
    const colCount = displayColumns.length;
    if (e.ctrlKey || e.metaKey) {
      let newRow = row, newCol = col;
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); newRow = pagedData.length - 1; break;
        case "ArrowUp": e.preventDefault(); newRow = 0; break;
        case "ArrowRight": e.preventDefault(); newCol = colCount - 1; break;
        case "ArrowLeft": e.preventDefault(); newCol = 0; break;
        case "a": e.preventDefault(); setSelectedRows(new Set(pagedData.map(r => r.id))); return;
        default: return;
      }
      setActiveCell({ row: newRow, col: newCol });
      requestAnimationFrame(() => scrollActiveCellIntoView(newRow, newCol));
      return;
    }
    let newRow = row, newCol = col;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); if (row < pagedData.length - 1) newRow = row + 1; break;
      case "ArrowUp": e.preventDefault(); if (row > 0) newRow = row - 1; break;
      case "ArrowRight": e.preventDefault(); if (col < colCount - 1) newCol = col + 1; break;
      case "ArrowLeft": e.preventDefault(); if (col > 0) newCol = col - 1; break;
      case "Escape": setActiveCell(null); setSelectedRows(new Set()); return;
      case " ": e.preventDefault(); if (pagedData[row]) { setSelectedRows(prev => { const next = new Set(prev); const id = pagedData[row].id; next.has(id) ? next.delete(id) : next.add(id); return next; }); } return;
      default: return;
    }
    if (newRow !== row || newCol !== col) {
      setActiveCell({ row: newRow, col: newCol });
      requestAnimationFrame(() => scrollActiveCellIntoView(newRow, newCol));
    }
  }, [activeCell, pagedData, displayColumns, scrollActiveCellIntoView]);

  useEffect(() => {
    document.addEventListener("keydown", handleTableKeyDown);
    return () => document.removeEventListener("keydown", handleTableKeyDown);
  }, [handleTableKeyDown]);

  // Column visibility
  const toggleColumnVisible = (key: string) => {
    setVisibleColumns(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const saveCurrentView = () => {
    if (!newViewName.trim()) return;
    const view: ColumnView = { name: newViewName.trim(), columns: Array.from(visibleColumns) };
    const updated = [...savedViews.filter(v => v.name !== view.name), view];
    setSavedViews(updated);
    saveSavedViews(updated);
    setNewViewName("");
    toast({ title: "บันทึก View ส่วนตัวสำเร็จ", description: view.name });
  };
  const saveCurrentViewPublic = async () => {
    const name = newViewName.trim();
    if (!name) return;
    try {
      await savePublicView("dc", name, Array.from(visibleColumns));
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
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    saveSavedViews(updated);
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

  const clearShowData = () => {
    setShowData([]);
    setSelectedRows(new Set());
    setActiveCell(null);
    setPage(0);
  };

  const exportTableData = (selectedOnly: boolean) => {
    const rows = selectedOnly ? showData.filter(r => selectedRows.has(r.id)) : showData;
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    const headers = displayColumns.map(c => c.label);
    const exportRows = rows.map(r => {
      const mapped: Record<string, any> = {};
      for (const col of displayColumns) {
        mapped[col.label] = col.key === "pack_size"
          ? (Number(r.moq) === 1 ? "Unit" : `1x${Number(r.moq) || 0}`)
          : (r as any)[col.key];
      }
      return mapped;
    });
    const formulaRow = buildSRRDCFormulaRow(headers);
    const ws = buildSheetWithFormulaRow(headers, exportRows, formulaRow);
    applyHighPrecisionFormat(ws, ["PO Cost Unit", "Products to Purchase/Unit Price"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SRR DC ITEM");
    XLSX.writeFile(wb, `SRR_DC_ITEM_export.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${rows.length} แถว` });
  };

  // Lookup main_barcode + unit_of_measure for the data_master row where packing_size_qty=1
  // (one row per sku_code can have multiple barcode/pack rows; we want the "Unit" pack row)
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
      const vendors = [...new Set(showData.filter(r => r.final_suggest_qty > 0).map(r => r.vendor_code))].sort();
      if (vendors.length === 0) { toast({ title: "ไม่มี Vendor ที่มี Suggest > 0", variant: "destructive" }); return; }
      const skusForLookup = showData.filter(r => r.final_suggest_qty > 0).map(r => r.sku_code);
      const unitPackMap = await fetchUnitPackLookup(skusForLookup);
      const now = new Date();
      const ts = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
      const selectedStore = storeTypes.find(st => st.ship_to === pickingType);
      const isStore = selectedStore ? selectedStore.type_store !== "DC" : true;
      const interTransfer = isStore ? "true" : "";
      const pickingDbId = selectedStore ? (selectedStore.type_store === "DC" ? "2540" : (selectedStore.ship_to || "")) : "";
      const existing = loadSavedPOs();
      const newPOs: SavedPO[] = [];
      const spcManager = "SPC manager01";

      for (const vc of vendors) {
        const vendorRows = showData.filter(r => r.vendor_code === vc && r.final_suggest_qty > 0);
        if (vendorRows.length === 0) continue;
        const vName = vendorRows[0].vendor_name;

        // Sub-group within vendor by po_group (fallback: vendor_code)
        const groupMap = new Map<string, SRRRow[]>();
        for (const r of vendorRows) {
          const gk = (r.po_group && r.po_group.trim()) ? r.po_group.trim() : vc;
          if (!groupMap.has(gk)) groupMap.set(gk, []);
          groupMap.get(gk)!.push(r);
        }

        for (const [groupKey, gRows] of groupMap) {
          const exportRows = gRows.map((r, idx) => {
            const up = unitPackMap.get(r.sku_code);
            const upBarcode = up?.barcode || r.barcode_unit;
            const upUom = up?.uom || r.unit_of_measure || "";
            return {
              "partner_id": idx === 0 ? vc : "",
              "Picking Type / Database ID": idx === 0 ? pickingDbId : "",
              "Inter Transfer": idx === 0 ? interTransfer : "",
              "PO Group": idx === 0 ? groupKey : "",
              "Products to Purchase/barcode": upBarcode,
              "Products to Purchase/Product": upBarcode,
              "Product name": r.product_name_la,
              "Products to Purchase/UoM": upUom,
              "Products to Purchase/Exclude In Package": "True",
              "Products to Purchase/Quantity": r.order_uom_edit && !isNaN(Number(r.order_uom_edit))
                ? Number(r.order_uom_edit) * (r.moq || 1)
                : r.final_suggest_qty,
              "Products to Purchase/Unit Price": r.po_cost_unit,
              "assigned_to": idx === 0 ? spcManager : "",
              "description": idx === 0 ? exportDescription : "",
            };
          });
          newPOs.push({
            id: `po-${ts}-${vc}-${groupKey}`,
            name: `${ts} - ${vc} - ${vName}${groupKey !== vc ? ` (${groupKey})` : ""}`,
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

      const allPOs = [...existing, ...newPOs];
      saveSavedPOs(allPOs);
      setPoRefreshKey(v => v + 1);
      setSelectedBatchValuesByMode(prev => ({ ...prev, [activeDateMode]: [now.toISOString()] }));

      // Also persist to DB (saved_po_documents) so Report 2 (Act = Saved POs) can read it
      if (user?.id) {
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const srcMap: Record<string, "filter" | "vendor" | "import"> = { filter: "filter", vendor: "vendor", import: "import" };
        const src = srcMap[activeDateMode] || "filter";
        // Group newPOs by vendor_code so we save one row per vendor (with merged po_data across po_groups)
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

      toast({ title: "บันทึก PO สำเร็จ", description: `${newPOs.length} เอกสาร (แยกตาม vendor + po_group)` });
      setExportOpen(false);
    } catch (err: any) {
      console.error("savePO error:", err);
      toast({ title: "บันทึก PO ไม่สำเร็จ", description: err?.message || "Unknown error", variant: "destructive" });
    }
  };

  const openExportDialog = () => {
    const vendors = [...new Set(showData.filter(r => r.final_suggest_qty > 0).map(r => r.vendor_code))].sort();
    setExportVendors(vendors);
    setExportOpen(true);
  };

  const doExport = async () => {
    if (exportVendors.length === 0) { toast({ title: "ไม่มี Vendor ที่มี Suggest > 0", variant: "destructive" }); return; }
    const now = new Date();
    const ts = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
    const selectedStore = storeTypes.find(st => st.ship_to === pickingType);
    const isStore = selectedStore ? selectedStore.type_store !== "DC" : true;
    const interTransfer = isStore ? "true" : "";
    const pickingDbId = selectedStore ? (selectedStore.type_store === "DC" ? "2540" : (selectedStore.ship_to || "")) : "";
    const skusForLookup = showData
      .filter(r => exportVendors.includes(r.vendor_code) && r.final_suggest_qty > 0)
      .map(r => r.sku_code);
    const unitPackMap = await fetchUnitPackLookup(skusForLookup);
    const wb = XLSX.utils.book_new();
    const allExportRows: any[] = [];
    const cost0DocsCreated: Cost0Doc[] = [];
    const spcManager = "SPC manager01";
    for (const vc of exportVendors) {
      const vendorRows = showData.filter(r => r.vendor_code === vc && r.final_suggest_qty > 0);
      if (vendorRows.length === 0) continue;

      // Sub-group by po_group (fallback: vendor_code)
      const groupMap = new Map<string, SRRRow[]>();
      for (const r of vendorRows) {
        const gk = (r.po_group && r.po_group.trim()) ? r.po_group.trim() : vc;
        if (!groupMap.has(gk)) groupMap.set(gk, []);
        groupMap.get(gk)!.push(r);
      }

      // Split rows by po_cost_unit: > 0 → Excel, = 0 → Doc Cost = 0 (localStorage)
      const cost0Rows: { row: SRRRow; qty: number }[] = [];
      for (const [groupKey, gRows] of groupMap) {
        const validRows = gRows.filter(r => Number(r.po_cost_unit) > 0);
        const zeroRows = gRows.filter(r => !(Number(r.po_cost_unit) > 0));
        // Compute qty (same as sent to list_import_po) for each zero row
        for (const r of zeroRows) {
          const qty = r.order_uom_edit && !isNaN(Number(r.order_uom_edit))
            ? Number(r.order_uom_edit) * (r.moq || 1)
            : r.final_suggest_qty;
          cost0Rows.push({ row: r, qty });
        }
        if (validRows.length === 0) continue;
        const maxPerPO = Math.max(0, Math.floor(Number(exportMaxPerPO) || 0));
        const chunks: SRRRow[][] = [];
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
            const upBarcode = up?.barcode || r.barcode_unit;
            const upUom = up?.uom || r.unit_of_measure || "";
            return {
              "partner_id": idx === 0 ? vc : "",
              "Picking Type / Database ID": idx === 0 ? pickingDbId : "",
              "Inter Transfer": idx === 0 ? interTransfer : "",
              "PO Group": idx === 0 ? chunkGroupKey : "",
              "Products to Purchase/barcode": upBarcode,
              "Products to Purchase/Product": upBarcode,
              "Product name": r.product_name_la,
              "Products to Purchase/UoM": upUom,
              "Products to Purchase/Exclude In Package": "True",
              "Products to Purchase/Quantity": r.order_uom_edit && !isNaN(Number(r.order_uom_edit))
                ? Number(r.order_uom_edit) * (r.moq || 1)
                : r.final_suggest_qty,
              "Products to Purchase/Unit Price": r.po_cost_unit,
              "assigned_to": idx === 0 ? spcManager : "",
              "description": idx === 0 ? exportDescription : "",
            };
          });
          const mappedExportRows = await remapRowsByTemplate("srr_dc_po", exportRows);
          allExportRows.push(...mappedExportRows);
        }
      }

      // Persist Cost=0 rows as a Doc per vendor under DC localStorage key
      if (cost0Rows.length > 0) {
        const cost0Doc = buildCost0Doc({
          variant: "dc",
          vendor_code: vc,
          vendor_name: vendorRows[0]?.vendor_name || "",
          vendor_display: vendorRows[0]?.vendor_display || vc,
          spc_name: vendorRows[0]?.spc_name || "",
          ts,
          isoDate: now.toISOString(),
          rows: cost0Rows.map(({ row, qty }) => ({
            Vendor: row.vendor_display || vc,
            "SKU Code": row.sku_code,
            "Main barcode": row.barcode_unit || "",
            "Product Name EN": row.product_name_en || "",
            "PO Cost": "" as const,
            MOQ: "" as const,
            "Qty Order": qty,
          })),
        });
        cost0DocsCreated.push(cost0Doc);
      }
    }
    const ws = XLSX.utils.json_to_sheet(allExportRows);
    applyHighPrecisionFormat(ws);
    XLSX.utils.book_append_sheet(wb, ws, "PO");
    const fileName = exportVendors.length === 1 ? `${ts} - ${exportVendors[0]}.xlsx` : `${ts} - MultiVendor.xlsx`;
    if (allExportRows.length > 0) XLSX.writeFile(wb, fileName);

    if (cost0DocsCreated.length > 0) {
      try { appendCost0Docs(COST0_KEY_DC, cost0DocsCreated); } catch (e: any) {
        toast({ title: "บันทึก Doc Cost=0 ไม่สำเร็จ", description: e?.message, variant: "destructive" });
      }
      setCost0RefreshKey(k => k + 1);
    }
    setExportOpen(false);
    const cost0Total = cost0DocsCreated.reduce((s, d) => s + d.rows.length, 0);
    toast({
      title: allExportRows.length > 0 ? "Export สำเร็จ" : "ไม่มีรายการ Cost > 0",
      description: `Excel ${allExportRows.length} แถว · Cost=0 ${cost0Total} แถว (${cost0DocsCreated.length} Doc) → ดูที่ Tab "Doc Cost = 0"`,
    });
  };

  const pickingOptions = storeTypes.map(st => st.ship_to);

  // --- Tree toggle helpers (Date → SPC → Vendor) ---
  // expandedSPCs is repurposed to hold expanded DATE keys; expandedDates holds `${dateKey}|${spcName}` keys
  const toggleDateNode = (dateKey: string) => {
    setExpandedSPCs(prev => { const n = new Set(prev); n.has(dateKey) ? n.delete(dateKey) : n.add(dateKey); return n; });
  };
  const toggleSpcNode = (dateKey: string, spcName: string) => {
    const key = `${dateKey}|${spcName}`;
    setExpandedDates(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const expandAllTree = () => {
    setExpandedSPCs(new Set(docTree.keys()));
    const allSpcs = new Set<string>();
    for (const [dateKey, spcMap] of docTree) {
      for (const spc of spcMap.keys()) allSpcs.add(`${dateKey}|${spc}`);
    }
    setExpandedDates(allSpcs);
  };
  const collapseAllTree = () => {
    setExpandedSPCs(new Set());
    setExpandedDates(new Set());
  };

  // --- Render Table ---
  const renderTable = (rows: SRRRow[], showEditColumns: boolean) => {
    if (rows.length === 0) return null;
    return (
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            {showEditColumns && (
              <>
                <th className="data-table-header bg-muted" style={{ width: 36, minWidth: 36 }}>
                  <Checkbox checked={selectedRows.size === pagedData.length && pagedData.length > 0} onCheckedChange={toggleSelectAll} className="mx-auto" />
                </th>
                <th className="data-table-header bg-muted" style={{ width: 44, minWidth: 44 }}>#</th>
              </>
            )}
            {!showEditColumns && (
              <th className="data-table-header bg-muted" style={{ width: 44, minWidth: 44 }}>#</th>
            )}
            {displayColumns.map(col => (
              <th
                key={col.key}
                className={cn(
                  "data-table-header relative group cursor-pointer select-none whitespace-nowrap",
                  selectedCols.has(col.key) && "bg-emerald-100 dark:bg-emerald-900/40",
                  HIGHLIGHT_COLS.has(col.key) && "bg-blue-50 dark:bg-blue-950/30"
                )}
                style={{ width: columnWidths[col.key] || getDefaultWidth(col.key), minWidth: 60 }}
                onClick={() => toggleColHighlight(col.key)}
              >
                {col.label}
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/30 group-hover:bg-primary/10"
                  onMouseDown={e => { e.stopPropagation(); onResizeStart(col.key, e); }}
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
                    ? "bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                    : isActiveRow
                      ? "bg-blue-50/50 dark:bg-blue-950/20"
                      : "hover:bg-muted/50"
                )}
                onClick={(e) => showEditColumns && handleRowClick(idx, row.id, e)}
              >
                {showEditColumns && (
                  <>
                    <td className="data-table-cell text-center bg-inherit" style={{ width: 36, minWidth: 36 }} onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          setSelectedRows(prev => { const n = new Set(prev); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; });
                        }}
                        className="h-3.5 w-3.5"
                      />
                    </td>
                    <td className="data-table-cell text-muted-foreground text-center bg-inherit" style={{ width: 44, minWidth: 44 }}>
                      {page * pageSize + idx + 1}
                    </td>
                  </>
                )}
                {!showEditColumns && (
                  <td className="data-table-cell text-muted-foreground text-center bg-inherit" style={{ width: 44, minWidth: 44 }}>
                    {idx + 1}
                  </td>
                )}
                {displayColumns.map((col, colIdx) => {
                  const isCellActive = activeCell?.row === idx && activeCell?.col === colIdx;
                  const val = col.key === "pack_size"
                    ? (Number(row.moq) === 1 ? "Unit" : `1x${Number(row.moq) || 0}`)
                    : row[col.key as keyof SRRRow];
                  const displayVal = formatCellValue(val, col.key);
                  const isEditable = showEditColumns && EDITABLE_COLS.has(col.key);
                  const isTruncate = TRUNCATE_COLS.has(col.key);
                  const isHighlight = HIGHLIGHT_COLS.has(col.key);

                  // Order UOM Edit overrides Final Suggest → orange highlight
                  const hasUomEditOverride = row.order_uom_edit !== "" && !isNaN(Number(row.order_uom_edit));
                  const isOverriddenFinal = col.key === "final_suggest_qty" && hasUomEditOverride;
                  // DOH ≥ 90 → light red highlight (DC)
                  const isDohRed = (col.key === "doh_asis" || col.key === "doh_tobe") && typeof val === "number" && (val as number) >= 90;
                  // Packsize highlight: green when Unit (moq==1), blue when 1x...
                  const isPackUnit = col.key === "pack_size" && Number(row.moq) === 1;
                  const isPackMoq = col.key === "pack_size" && Number(row.moq) !== 1;

                  return (
                    <td
                      key={col.key}
                      data-row={idx}
                      data-col={colIdx}
                      className={cn(
                        "data-table-cell",
                        selectedCols.has(col.key) && "bg-emerald-50/50 dark:bg-emerald-950/20",
                        isCellActive && "ring-2 ring-primary ring-inset",
                        isHighlight && !isSelected && !isActiveRow && !isOverriddenFinal && !isDohRed && "bg-blue-50/40 dark:bg-blue-950/20",
                        isOverriddenFinal && "bg-orange-100 dark:bg-orange-950/40",
                        isDohRed && "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold",
                        isPackUnit && "bg-green-100 dark:bg-green-950/40",
                        isPackMoq && "bg-sky-100 dark:bg-sky-950/40",
                        col.key === "final_suggest_qty" && typeof val === "number" && (val as number) > 0 && !isOverriddenFinal
                          ? "font-semibold text-green-600 dark:text-green-400" : ""
                      )}
                      style={{
                        width: columnWidths[col.key] || getDefaultWidth(col.key),
                        maxWidth: isTruncate ? (columnWidths[col.key] || 180) : undefined,
                      }}
                      onClick={(e) => { if (showEditColumns) { e.stopPropagation(); setActiveCell({ row: idx, col: colIdx }); handleRowClick(idx, row.id, e); } }}
                    >
                      {showEditColumns && (col.key === "avg_sales_jmart" || col.key === "avg_sales_kokkok" || col.key === "avg_sales_kokkok_fc" || col.key === "avg_sales_udee") ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{formatCellValue(val, col.key)}</span>
                          {(val as number) !== 0 ? (
                            <button
                              className="text-[9px] text-destructive hover:underline px-0.5"
                              onClick={e => { e.stopPropagation(); updateAvgSales(row.id, col.key as any, "0"); }}
                              title="Clear เป็น 0"
                            >Clear</button>
                          ) : (
                            <button
                              className="text-[9px] text-primary hover:underline px-0.5"
                              onClick={e => { e.stopPropagation(); updateAvgSales(row.id, col.key as any, String(row[`orig_${col.key}` as keyof SRRRow])); }}
                              title="คืนค่าเดิม"
                            >Restore</button>
                          )}
                        </div>
                      ) : showEditColumns && (col.key === "min_jmart" || col.key === "min_kokkok" || col.key === "min_kokkok_fc" || col.key === "min_udee" || col.key === "stock_jmart" || col.key === "stock_kokkok" || col.key === "stock_kokkok_fc" || col.key === "stock_udee") ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{formatCellValue(val, col.key)}</span>
                          {(val as number) !== 0 ? (
                            <button
                              className="text-[9px] text-destructive hover:underline px-0.5"
                              onClick={e => { e.stopPropagation(); updateNumericField(row.id, col.key as any, "0"); }}
                              title="Clear เป็น 0"
                            >Clear</button>
                          ) : (
                            <button
                              className="text-[9px] text-primary hover:underline px-0.5"
                              onClick={e => { e.stopPropagation(); updateNumericField(row.id, col.key as any, String(row[`orig_${col.key}` as keyof SRRRow])); }}
                              title="คืนค่าเดิม"
                            >Restore</button>
                          )}
                        </div>
                      ) : showEditColumns && col.key === "on_order" ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs flex-1">{formatCellValue(val, col.key)}</span>
                          <button
                            className="text-[9px] text-destructive hover:underline px-0.5"
                            onClick={e => { e.stopPropagation(); updateOnOrder(row.id, 0); }}
                            title="ล้างค่า ON ORDER"
                          >Clear</button>
                          <button
                            className="text-[9px] text-primary hover:underline px-0.5"
                            onClick={e => { e.stopPropagation(); updateOnOrder(row.id, row.orig_on_order); }}
                            title="คืนค่า ON ORDER เดิม"
                          >Restore</button>
                        </div>
                      ) : isEditable && col.key === "order_uom_edit" ? (
                        <Input
                          className="h-6 text-xs px-1 py-0 border-primary/50 w-full"
                          value={row.order_uom_edit}
                          onChange={e => updateOrderUomEdit(row.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          placeholder="—"
                          data-row-idx={idx}
                          data-col-key={col.key}
                          onKeyDown={e => {
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
                              const nextColIdx = displayColumns.findIndex(c => c.key === nextKey);
                              focusCellInput(nextRow, nextKey);
                              setActiveCell({ row: nextRow, col: nextColIdx });
                            }
                          }}
                        />
                      ) : isEditable && col.key === "safety" ? (
                        <Input
                          type="number"
                          className="h-6 text-xs px-1 py-0 border-amber-400/50 w-full bg-amber-50/30 dark:bg-amber-950/20"
                          value={row.safety}
                          onChange={e => updateSafety(row.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          min={0}
                          data-row-idx={idx}
                          data-col-key={col.key}
                          onKeyDown={e => {
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
                              const nextColIdx = displayColumns.findIndex(c => c.key === nextKey);
                              focusCellInput(nextRow, nextKey);
                              setActiveCell({ row: nextRow, col: nextColIdx });
                            }
                          }}
                        />
                      ) : col.key === "po_cost_unit" && Math.abs((row.po_cost_unit || 0) - (row.orig_po_cost_unit || 0)) > 0.001 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="block">{displayVal}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-amber-600 dark:text-amber-400 cursor-help" onClick={e => e.stopPropagation()} />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <div className="text-xs space-y-0.5">
                                <div className="font-semibold">PO Cost Override (Import)</div>
                                <div>Original: <span className="font-mono">{row.orig_po_cost_unit?.toLocaleString(undefined, { maximumFractionDigits: 10 })}</span></div>
                                <div>Imported: <span className="font-mono text-amber-600 dark:text-amber-400">{row.po_cost_unit?.toLocaleString(undefined, { maximumFractionDigits: 10 })}</span></div>
                                <div className="text-muted-foreground">Δ {((row.po_cost_unit || 0) - (row.orig_po_cost_unit || 0)).toLocaleString(undefined, { maximumFractionDigits: 10 })}</div>
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
                        <span className={cn(
                          "block",
                          isTruncate && "truncate",
                          col.key === "rank_sales" && row.rank_is_default && "text-red-600 dark:text-red-400 font-semibold"
                        )}>{displayVal}</span>
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

  const docsInMode = vendorDocs.filter(d => (d.source || "filter") === importMode);
  const totalItems = docsInMode.reduce((s, d) => s + d.item_count, 0);
  const totalDocsCount = docsInMode.length;

  return (
    <div className="flex flex-col h-full animate-fade-in" tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">SRR DC ITEM</h1>
          <p className="text-xs text-muted-foreground">
            {totalDocsCount > 0 ? `✅ ${totalDocsCount} Vendor Docs · ${totalItems.toLocaleString()} รายการ` : "กด Read & Cal เพื่อเริ่ม"}
            {showData.length > 0 && ` · แสดง ${showData.length.toLocaleString()}`}
            {selectedRows.size > 0 && ` · เลือก ${selectedRows.size}`}
          </p>
        </div>
      </div>

      {/* Progress bar — Read & Cal */}
      {loading && calcProgress > 0 && (
        <div className="px-4 py-2 bg-card border-b border-border space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-medium truncate">{loadingPhase}</span>
            <div className="flex items-center gap-2 shrink-0">
              {calcStartedAt != null && <ElapsedTimer startedAt={calcStartedAt} />}
              <span className="text-xs font-semibold tabular-nums">{calcProgress}%</span>
              <Button size="sm" variant="destructive" onClick={cancelCalc} className="h-6 text-xs px-2">
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

      {/* Progress bar — Prepare data (lighter) */}
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

      {/* Tabs */}
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
                    setDataReady(false);
                    if (m !== "import") {
                      setImportedItems([]); setImportedSkuSet(new Set()); setImportedQtyBySku(new Map()); setImportedPoCostBySku(new Map()); setImportedOverrideVendorBySku(new Map()); setImportedSkippedKeys([]); setImportedSkippedItems([]);
                    }
                    if (m !== "vendor") { setImportedVendors([]); setImportedSkippedItems([]); }
                    if (m === "filter") { setVendorFilterCal([]); }
                    setSelectedDocSpc([]); setVendorFilter([]); setOrderDayFilter([]);
                    setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
                    setShowData([]); setTableSearchChips([]); setPage(0);
                  }}
                  importedItems={importedItems}
                  onImportedChange={(items) => { setImportedItems(items); setDataReady(false); }}
                  matchedCount={importedSkuSet.size}
                  skippedCount={importedSkippedKeys.length}
                  disabled={loading}
                  enableVendorMode
                  importedVendors={importedVendors}
                  onImportedVendorsChange={(v) => { setImportedVendors(v); setDataReady(false); }}
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
                        itemTypeCal.length + typeStoreCal.length + buyingStatusCal.length + poGroupCal.length +
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
                      <MultiSelect compact label="Buying Status" options={preFilterOptions.buyingStatuses} selected={buyingStatusCal} onChange={setBuyingStatusCal} />
                      <MultiSelect compact label="PO Group" options={preFilterOptions.poGroups} selected={poGroupCal} onChange={setPoGroupCal} />
                    </SrrFiltersPopover>

                    {(selectedSpcForCal.length > 0 || orderDayCal.length > 0 || vendorFilterCal.length > 0 ||
                      itemTypeCal.length > 0 || typeStoreCal.length > 0 || buyingStatusCal.length > 0 || poGroupCal.length > 0 ||
                      divisionGroupCal.length > 0 || divisionCal.length > 0 || departmentCal.length > 0 ||
                      subDepartmentCal.length > 0 || classCal.length > 0 || subClassCal.length > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-1.5"
                        onClick={() => {
                          setSelectedSpcForCal([]); setOrderDayCal([]); setVendorFilterCal([]);
                          setItemTypeCal([]); setTypeStoreCal([]); setBuyingStatusCal([]); setPoGroupCal([]);
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

              </div>

              {/* GO zone — green: prepare + run */}
              <div className="flex items-center gap-1 shrink-0 px-1 py-0.5 rounded-md bg-emerald-100/70 border border-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-700">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadFilterOptions()}
                  disabled={loading || (importMode === "filter" ? effectiveSpcsForCal.length === 0 : importMode === "vendor" ? importedVendors.length === 0 : importedItems.length === 0)}
                  className="h-6 gap-1 text-[11px] px-1.5 border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 bg-card"
                >
                  <RefreshCw className="w-3 h-3" />
                  เตรียม{importMode === "filter"
                    ? (effectiveSpcsForCal.length > 0 ? ` (${effectiveSpcsForCal.length})` : "")
                    : importMode === "vendor"
                    ? (importedVendors.length > 0 ? ` (${importedVendors.length})` : "")
                    : (importedItems.length > 0 ? ` (${importedItems.length})` : "")}
                </Button>
                <Button onClick={readAndCalc} disabled={loading || !dataReady} size="sm" className="h-6 gap-1 text-[11px] px-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Cal
                </Button>
              </div>
            </>
          )}

          {/* DOC zone — pushed right */}
          <div className="ml-auto flex items-center shrink-0 pl-1">
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

        {/* ============ Sub-row: status / skip / action icons / search ============ */}
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
                title={importMode === "vendor" ? "srr_dc_vendor" : "srr_dc_sku"}
                forceShow={lastImportRanAt > 0}
                onClear={() => { setImportedSkippedItems([]); setLastImportRanAt(0); }}
              />
            )}

            {totalDocsCount > 0 && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={selectAllDocs} className="h-7 w-7">
                      <CheckSquare className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Select All</TooltipContent>
                </Tooltip>
                {selectedDocIds.size > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={unselectAllDocs} className="h-7 w-7">
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Unselect</TooltipContent>
                  </Tooltip>
                )}
                {selectedDocIds.size > 0 && canDeleteDoc && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="destructive" size="sm" onClick={deleteSelectedDocs} className="h-7 text-xs gap-1 px-2">
                        <Trash2 className="w-3.5 h-3.5" /> {selectedDocIds.size}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete Selected ({selectedDocIds.size})</TooltipContent>
                  </Tooltip>
                )}
                {canDeleteDoc && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="destructive" size="icon" onClick={clearAllDocuments} className="h-7 w-7">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete All</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={expandedSPCs.size > 0 ? collapseAllTree : expandAllTree} className="h-7 w-7">
                      {expandedSPCs.size > 0 ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{expandedSPCs.size > 0 ? "Collapse All" : "Expand All"}</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Search bar */}
            <div className="ml-auto flex items-center gap-1 relative">
              <Search className="w-3 h-3 text-muted-foreground" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-1.5 gap-1">
                    {DOC_SEARCH_COLS.find(c => c.value === docSearchCol)?.label || "ทุกคอลัมน์"}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {DOC_SEARCH_COLS.map(col => (
                    <DropdownMenuItem key={col.value} onClick={() => setDocSearchCol(col.value)}
                      className={cn("text-xs", docSearchCol === col.value && "font-bold")}>
                      {col.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Input
                placeholder={`ค้นหา ${DOC_SEARCH_COLS.find(c => c.value === docSearchCol)?.label || ""}...`}
                value={docSearch}
                onChange={e => setDocSearch(e.target.value)}
                className="h-7 text-xs w-44"
              />
              {docSearch && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDocSearch("")}>
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ======================== TAB 1: READ & CAL ======================== */}
        <TabsContent value="read-cal" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">

          {/* SPC Status Bar */}
          {dataReady && selectedSpcForCal.length > 0 && (
            <div className="px-4 py-2 bg-muted/30 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground mr-1">สถานะ SPC:</span>
                {selectedSpcForCal.map(spcVal => {
                  const isDone = calculatedSpcs.has(spcVal);
                  return (
                    <span
                      key={spcVal}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
                        isDone
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted border-border text-muted-foreground"
                      )}
                    >
                      {isDone ? <Check className="w-2.5 h-2.5" /> : <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30 inline-block" />}
                      {spcVal}
                    </span>
                  );
                })}
                <span className="text-[10px] text-muted-foreground ml-2">
                  ({calculatedSpcs.size}/{selectedSpcForCal.length} คำนวณแล้ว)
                </span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-4">
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Database className="w-16 h-16 mb-4 opacity-20" />
              {totalDocsCount === 0 && !loading ? (
                <>
                  <p className="text-base font-medium">1. กด "เตรียมข้อมูล" → 2. เลือก SPC Name → 3. กด "Read & Cal"</p>
                  <p className="text-xs mt-2 text-muted-foreground/70">เมื่อคำนวณเสร็จ กดปุ่ม <strong>Doc</strong> ที่มุมขวาบน เพื่อเปิดดู Documents</p>
                </>
              ) : (
                <>
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

        {/* ======================== TAB 2: FILTER & SHOW & EDIT ======================== */}
        <TabsContent value="show-edit" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setActiveTab("read-cal")} title="กลับไปหน้า Read & Cal">
              <ChevronLeft className="w-3.5 h-3.5" /> กลับ
            </Button>
            {/* Mode toggle for Tab 2 — independent from Tab 1 (Filter / Vendor / Barcode) */}
            <div className="flex items-center gap-0.5 border border-border rounded-md p-0.5 bg-muted/30">
              <Button
                size="sm"
                variant={tab2Mode === "filter" ? "default" : "ghost"}
                onClick={() => {
                  if (tab2Mode === "filter") return;
                  setTab2Mode("filter");
                  setSelectedDocSpc([]); setOrderDayFilter([]); setVendorFilter([]);
                  setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
                  setShowData([]); setTableSearchChips([]); setPage(0);
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
                  setSelectedDocSpc([]); setOrderDayFilter([]); setVendorFilter([]);
                  setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
                  setShowData([]); setTableSearchChips([]); setPage(0);
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
                  setSelectedDocSpc([]); setOrderDayFilter([]); setVendorFilter([]);
                  setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
                  setShowData([]); setTableSearchChips([]); setPage(0);
                }}
                className="h-6 text-[11px] px-2"
              >
                Import Barcode
              </Button>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {docsForTab2.length} docs
            </span>
            <MultiSelect compact label="SPC Name" options={availableDocSpcs.length > 0 ? availableDocSpcs : spcOptions} selected={selectedDocSpc} onChange={setSelectedDocSpc} />
            <MultiSelect compact label="Order Day" options={docDerivedOptions.orderDays} selected={orderDayFilter} onChange={setOrderDayFilter} searchable={false} />
            <MultiSelect compact label="Vendor" options={vendorOptions} selected={vendorFilter} onChange={setVendorFilter} />
            <MultiSelect compact label="Item Type" options={docDerivedOptions.itemTypes} selected={itemTypeFilter} onChange={setItemTypeFilter} searchable={false} />
            <MultiSelect compact label="Buying Status" options={docDerivedOptions.buyingStatuses} selected={buyingStatusFilter} onChange={setBuyingStatusFilter} searchable={false} />
            <MultiSelect compact label="PO Group" options={docDerivedOptions.poGroups} selected={poGroupFilter} onChange={setPoGroupFilter} searchable={false} />
            {(selectedDocSpc.length > 0 || orderDayFilter.length > 0 || vendorFilter.length > 0 || itemTypeFilter.length > 0 || buyingStatusFilter.length > 0 || poGroupFilter.length > 0) && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setSelectedDocSpc([]); setOrderDayFilter([]); setVendorFilter([]); setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]); }}>
                <X className="w-3 h-3 mr-1" /> Clear filter
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <Button size="sm" onClick={showFilteredData} disabled={vendorDocs.length === 0} className="text-xs gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Show
              </Button>
              {showData.length > 0 && (
                <>
                  <Button size="sm" onClick={recalcSelected} className="text-xs gap-1.5" variant="outline">
                    <RefreshCw className="w-3.5 h-3.5" /> Recal{selectedRows.size > 0 ? ` (${selectedRows.size})` : ""}
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearAllOnOrder} className="text-xs gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Clear All ON ORDER
                  </Button>
                  <Button size="sm" variant="outline" onClick={restoreAllOnOrder} className="text-xs gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Restore All ON ORDER
                  </Button>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="text-xs">
                        <Columns className="w-3.5 h-3.5 mr-1" /> Columns ({displayColumns.length}/{SRR_COLUMNS.length})
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-2" align="end">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-semibold">Show/Hide Columns</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setVisibleColumns(new Set(ALL_COL_KEYS))}>All</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setVisibleColumns(new Set())}>None</Button>
                        </div>
                      </div>
                      <div className="space-y-0.5 mb-3">
                        {SRR_COLUMNS.map(col => (
                          <label key={col.key} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                            <Checkbox checked={visibleColumns.has(col.key)} onCheckedChange={() => toggleColumnVisible(col.key)} className="h-3.5 w-3.5" />
                            {col.label}
                          </label>
                        ))}
                      </div>
                      <div className="border-t pt-2 space-y-2">
                        <span className="text-xs font-semibold px-1">Saved Views (ส่วนตัว)</span>
                        {savedViews.map(v => (
                          <div key={v.name} className="flex items-center gap-1 px-1">
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 justify-start" onClick={() => loadView(v)}>
                              <Eye className="w-3 h-3 mr-1" />{v.name}
                            </Button>
                            <button onClick={() => deleteView(v.name)} className="text-destructive hover:text-destructive/80"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                        <span className="text-xs font-semibold px-1 block pt-1">Public Views (ทุกคน)</span>
                        {publicViews.map(v => (
                          <div key={v.id} className="flex items-center gap-1 px-1">
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 justify-start" onClick={() => loadView(v)}>
                              <Eye className="w-3 h-3 mr-1" />{v.name}
                            </Button>
                            <button onClick={() => deletePublicViewById(v.id, v.name)} className="text-destructive hover:text-destructive/80"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                        <div className="flex items-center gap-1 px-1">
                          <Input placeholder="View name..." value={newViewName} onChange={e => setNewViewName(e.target.value)}
                            className="h-6 text-[10px] flex-1" onKeyDown={e => e.key === "Enter" && saveCurrentView()} />
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

                  <Button size="sm" variant="outline" onClick={openExportDialog} className="text-xs">
                    <Save className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearShowData} className="text-xs">
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
                onChipsChange={(chips) => { setTableSearchChips(chips); setPage(0); }}
                placeholder="ค้นหาในตาราง"
              />
              <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-2 select-none">
                <Checkbox
                  checked={showOnlyFinalGt0}
                  onCheckedChange={(c) => { setShowOnlyFinalGt0(!!c); setPage(0); }}
                  className="h-3.5 w-3.5"
                />
                <span>Show FinalOrder &gt; 0</span>
              </label>
            </div>
          )}

          {/* Table area - FULL WIDTH */}
          <div ref={tableContainerRef} className="flex-1 overflow-auto">
            {showData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
                <Filter className="w-10 h-10 mb-2 opacity-30" />
                {vendorDocs.length === 0 ? (
                  <>
                    <p className="text-sm">กรุณากด "Read & Cal" ใน Tab 1 ก่อน</p>
                    <p className="text-xs mt-1">จากนั้นกลับมาเลือก SPC แล้วกด "Show"</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">เลือก SPC Name แล้วกด <strong>"Show"</strong></p>
                    <p className="text-xs mt-1">มี {vendorDocs.length} vendor documents พร้อมใช้งาน</p>
                  </>
                )}
              </div>
            ) : (
              renderTable(pagedData, true)
            )}
          </div>

          {/* Footer */}
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
                      {[30, 50, 100, 200].map(size => (
                        <DropdownMenuItem key={size} onClick={() => { setPageSize(size); setPage(0); }}
                          className={cn("text-xs", pageSize === size && "font-bold")}>
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
                <span className="text-[10px] text-muted-foreground/60 hidden md:inline">
                  Shift+Click: เลือกช่วง · Ctrl+A: เลือกทั้งหมด
                </span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="h-7 w-7 p-0">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
                  <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* TAB 3 (List Import PO) — disabled, replaced by Doc dialog + Filter & Show export button */}

        <TabsContent value="report2" className="flex-1 flex flex-col mt-0 min-h-0 data-[state=inactive]:hidden">
          <SRRReport2Tab mode="dc" />
        </TabsContent>
      </Tabs>

      {/* Documents popup — opened via "Doc" button */}
      <DocsPopupDialog
        open={docsDialogOpen}
        onOpenChange={setDocsDialogOpen}
        variant="dc"
        initialMode={importMode as "filter" | "vendor" | "import"}
        latestBatchValue={selectedBatchValuesByMode[importMode]?.[0] || ""}
        latestDocIds={latestImportedDocIds}
        canDelete={canDeleteDoc}
        cost0StorageKey={COST0_KEY_DC}
        cost0RefreshKey={cost0RefreshKey}
        docs={vendorDocs.map<DocRow>((d) => {
          const vi = vendorInfoList.find((v) => v.vendor_code === d.vendor_code);
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
        onOpenDoc={(d) => {
          const doc = vendorDocs.find((x) => x.id === d.id);
          if (!doc) return;
          const src = (doc.source || "filter") as "filter" | "vendor" | "import";
          setTab2Mode(src);
          setSelectedDocSpc([doc.spc_name]);
          setVendorFilter([doc.vendor_code]);
          setOrderDayFilter([]); setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
          setShowData(doc.data);
          setPage(0);
          setSelectedRows(new Set());
          setActiveCell(null);
          setActiveTab("show-edit");
          setDocsDialogOpen(false);
        }}
        onOpenDocs={(ds) => {
          const docs = ds.map((d) => vendorDocs.find((x) => x.id === d.id)).filter(Boolean) as typeof vendorDocs;
          if (docs.length === 0) return;
          const src = (docs[0].source || "filter") as "filter" | "vendor" | "import";
          setTab2Mode(src);
          setSelectedDocSpc([...new Set(docs.map((x) => x.spc_name))]);
          setVendorFilter([...new Set(docs.map((x) => x.vendor_code))]);
          setOrderDayFilter([]); setItemTypeFilter([]); setBuyingStatusFilter([]); setPoGroupFilter([]);
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const doc of docs) for (const r of doc.data) { if (seen.has(r.id)) continue; seen.add(r.id); merged.push(r); }
          setShowData(merged);
          setPage(0);
          setSelectedRows(new Set());
          setActiveCell(null);
          setActiveTab("show-edit");
          setDocsDialogOpen(false);
        }}
      />

      {/* Preview Vendor Document Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">
              {previewDoc?.spc_name} · {previewDoc?.date_key} · {previewDoc?.vendor_display}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {previewDoc?.item_count} items · {previewDoc?.suggest_count} suggest &gt; 0
              {previewDoc && previewDoc.edit_count > 0 && ` · แก้ไข ${previewDoc.edit_count} ครั้ง [${previewDoc.edited_columns.join(", ")}]`}
            </p>
          </DialogHeader>
          {previewDoc && (
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0">
                  <tr>
                    <th className="data-table-header bg-muted">#</th>
                    {SRR_COLUMNS.map(col => (
                      <th key={col.key} className="data-table-header bg-muted whitespace-nowrap">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewDoc.data.map((row, i) => (
                    <tr key={row.id} className="border-b border-border hover:bg-muted/30">
                      <td className="data-table-cell text-muted-foreground text-center">{i + 1}</td>
                      {SRR_COLUMNS.map(col => {
                        const isPackUnit = col.key === "pack_size" && Number(row.moq) === 1;
                        const isPackMoq = col.key === "pack_size" && Number(row.moq) !== 1;
                        return (
                          <td key={col.key} className={cn(
                            "data-table-cell whitespace-nowrap",
                            isPackUnit && "bg-green-100 dark:bg-green-950/40",
                            isPackMoq && "bg-sky-100 dark:bg-sky-950/40",
                          )}>
                            <span className={cn(TRUNCATE_COLS.has(col.key) && "truncate block max-w-[150px]")}>
                              {formatCellValue(
                                col.key === "pack_size"
                                  ? (Number(row.moq) === 1 ? "Unit" : `1x${Number(row.moq) || 0}`)
                                  : row[col.key as keyof SRRRow],
                                col.key
                              )}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>ปิด</Button>
            {previewDoc && (
              <Button onClick={() => {
                const exportRows = previewDoc.data.map(r => {
                  const mapped: Record<string, any> = {};
                  for (const col of SRR_COLUMNS) { mapped[col.label] = r[col.key]; }
                  return mapped;
                });
                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Preview");
                XLSX.writeFile(wb, `${previewDoc.date_key}_${previewDoc.vendor_code}.xlsx`);
                toast({ title: "Export สำเร็จ", description: `${previewDoc.data.length} แถว` });
              }}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export PO / Save Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Save เอกสารสั่งซื้อ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Picking Type / Ship To</label>
              {(() => {
                const sel = storeTypes.find(st => st.ship_to === pickingType) || storeTypes[0];
                if (!sel) return <p className="text-xs text-muted-foreground">No DC store available</p>;
                return (
                  <>
                    <div className="w-full h-9 rounded-md border border-input bg-muted px-3 py-1 text-xs flex items-center">
                      {sel.ship_to} ({sel.type_store} · {sel.type_doc})
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Code: {sel.code} · Type: {sel.type_store} · Doc: {sel.type_doc} · Inter Transfer: ว่าง · ล็อกเป็น DC เท่านั้น
                    </p>
                  </>
                );
              })()}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <Input placeholder="พิมพ์คำอธิบาย..." value={exportDescription}
                onChange={e => setExportDescription(e.target.value)} className="text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                จำนวนรายการต่อ 1 PO (ตัดพีโอ)
              </label>
              <Input
                type="number"
                min={0}
                placeholder="ว่าง = ไม่ตัด (รวมทุกแถวเป็น PO เดียวต่อกลุ่ม)"
                value={exportMaxPerPO}
                onChange={e => setExportMaxPerPO(e.target.value)}
                className="text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                หากกำหนดตัวเลข N: ทุก N แถวจะถูกตัดเป็น PO ใหม่ (แถวแรกของแต่ละชุดจะเป็น header)
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Vendors ที่มี Suggest &gt; 0 ({exportVendors.length} vendor)
              </label>
              <ScrollArea className="h-32 border rounded p-2">
                {exportVendors.map(v => (
                  <div key={v} className="text-xs py-0.5">{v} - {showData.find(r => r.vendor_code === v)?.vendor_name}</div>
                ))}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setExportOpen(false)} className="text-xs">ยกเลิก</Button>
            <Button onClick={doExport} className="text-xs">
              <Download className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Skip Dialog (shared with Range Store style) */}
      <ImportSkipDialog
        open={importSkipDialogOpen}
        onOpenChange={setImportSkipDialogOpen}
        items={importedSkippedItems}
        title={importMode === "vendor" ? "SRR DC · Vendor Import" : "SRR DC · Barcode/SKU Import"}
        closeLabel="ปิด แล้วไป Read & Cal"
      />

      {/* Read & Cal Error / Timeout Dialog */}
      <Dialog open={calcErrorDialog.open} onOpenChange={(o) => setCalcErrorDialog(s => ({ ...s, open: o }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className={cn(
              calcErrorDialog.kind === "timeout" && "text-orange-600",
              calcErrorDialog.kind === "network" && "text-blue-600",
              calcErrorDialog.kind === "error" && "text-destructive",
            )}>
              {calcErrorDialog.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">{calcErrorDialog.message}</pre>
            {calcErrorDialog.raw && calcErrorDialog.raw !== calcErrorDialog.message && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">รายละเอียด Error (สำหรับ Dev)</summary>
                <pre className="mt-2 p-2 bg-muted rounded whitespace-pre-wrap break-all">{calcErrorDialog.raw}</pre>
              </details>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCalcErrorDialog(s => ({ ...s, open: false }))}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

