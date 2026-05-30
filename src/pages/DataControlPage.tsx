import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useDataTable, SheetInfo, FilterOperator, SearchFilter, OPERATOR_LABELS } from "@/hooks/useDataTable";
import { TableName, AllTableName, DATA_TABLES, COLUMN_LABELS, KEY_COLUMNS, getColumnLabel } from "@/lib/tableConfig";
import {
  parsePoCostFile, resolvePoCostImport, applyPoCostImport,
  downloadSkipList, downloadPoCostTemplate, loadVendorDisplayMap,
  splitExistingMissing, resolvedToSkipRows,
  type PoCostSkipRow, type PoCostResolved, type PoCostMarginWarning, type PoCostVendorMismatch, type PoCostMoqPackingWarning,
} from "@/lib/poCostImport";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Upload, Download, RefreshCw, Trash2, ChevronLeft, ChevronRight,
  Loader2, Package, Pencil, Check, X, FileSpreadsheet, XCircle, BarChart3,
  Search, Filter, ChevronDown, Columns, CheckSquare, Square, AlertTriangle,
  Save, Eye, Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { useAuth } from "@/hooks/useAuth";

interface DataControlPageProps {
  activeTable: AllTableName;
}

const ALL_OPERATORS: FilterOperator[] = ["contains", "=", "!=", "starts_with", "ends_with", "is_set", "is_not_set"];

export default function DataControlPage({ activeTable }: DataControlPageProps) {
  const { isAdmin, canDo, allowedDivisions, divisionAllowed, anyDivisionAllowed } = useAuth();
  const divisionEnforced = activeTable === "data_master" || activeTable === "po_cost";
  const allowedDivSet = divisionEnforced ? allowedDivisions() : null;
  const canExport = canDo(activeTable, "export") && (!divisionEnforced || anyDivisionAllowed("export"));
  const canDelete = canDo(activeTable, "delete") && (!divisionEnforced || anyDivisionAllowed("delete"));
  const canImport = canDo(activeTable, "import") && (!divisionEnforced || anyDivisionAllowed("import"));
  const canEdit   = canDo(activeTable, "edit")   && (!divisionEnforced || anyDivisionAllowed("edit"));
  const isPlaceholder = activeTable === "range_store";
  const safeTable = isPlaceholder ? "data_master" : activeTable as TableName;

  const {
    data, totalCount, loading, importProgress, page, setPage, pageSize, columns,
    searchColumns, setSearchColumns, searchValue, setSearchValue,
    filters, addFilter, removeFilter, updateFilter, clearFilters,
    fetchData, getSheets, importData, exportData, exportByFilters, exportTemplate, clearUI, deleteAll, deleteByFilters,
    editingRow, editedData, startEditing, cancelEditing, saveEditing, updateEditedField,
    pasteToRows, groupByColumn,
    setData, setTotalCount,
  } = useDataTable(safeTable);

  // Division-based row filtering for po_cost: map item_id -> division (loaded from data_master once)
  const [poCostDivMap, setPoCostDivMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (activeTable !== "po_cost" || !allowedDivSet) { return; }
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const m = new Map<string, string>();
        let from = 0; const step = 1000;
        while (true) {
          const { data: rows, error } = await (supabase as any)
            .from("data_master")
            .select("sku_code,division")
            .not("division", "is", null)
            .range(from, from + step - 1);
          if (error || !rows || rows.length === 0) break;
          for (const r of rows as any[]) {
            if (r.sku_code && r.division) m.set(String(r.sku_code), String(r.division));
          }
          if (rows.length < step) break;
          from += step;
        }
        if (!cancelled) setPoCostDivMap(m);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeTable, allowedDivSet]);

  // Return the division for a given row, depending on the active table
  const getRowDivision = useCallback((row: any): string | null => {
    if (activeTable === "data_master") return row?.division || null;
    if (activeTable === "po_cost") {
      const key = row?.item_id || row?.goodcode;
      if (!key) return null;
      return poCostDivMap.get(String(key)) || null;
    }
    return null;
  }, [activeTable, poCostDivMap]);

  // Filter the visible rows by allowed division (null = no restriction)
  const filterByDivision = useCallback(<T extends any>(rows: T[]): T[] => {
    if (!allowedDivSet) return rows;
    return rows.filter(r => {
      const d = getRowDivision(r);
      return d !== null && allowedDivSet.has(d);
    });
  }, [allowedDivSet, getRowDivision]);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [importMode, setImportMode] = useState<"insert" | "update">("insert");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ col: string; startX: number; startW: number } | null>(null);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(columns));

  // Saved column views per-table (localStorage)
  const VIEWS_KEY = `datactl_column_views_${activeTable}`;
  const [savedViews, setSavedViews] = useState<{ name: string; columns: string[] }[]>([]);
  const [newViewName, setNewViewName] = useState("");
  useEffect(() => {
    try { setSavedViews(JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]")); } catch { setSavedViews([]); }
  }, [VIEWS_KEY]);
  const persistViews = (views: { name: string; columns: string[] }[]) => {
    setSavedViews(views);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch {}
  };

  // Active cell for keyboard navigation
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);

  // Search dropdown
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState<FilterOperator>("contains");
  const [filterValue, setFilterValue] = useState("");

  // Sheet selector
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState(0);

  // Group by dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupCol, setGroupCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [aggType, setAggType] = useState<"count" | "sum" | "avg" | "distinct_count">("count");
  const [groupResult, setGroupResult] = useState<any[] | null>(null);
  const [pivotSearch, setPivotSearch] = useState("");
  const [pivotVisibleCols, setPivotVisibleCols] = useState<Set<string>>(new Set(["count", "sum", "avg"]));

  // PO Cost custom import state
  const { toast } = useToast();
  const [poCostImportLoading, setPoCostImportLoading] = useState(false);
  const [poCostImportProgress, setPoCostImportProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const [poCostSkipped, setPoCostSkipped] = useState<PoCostSkipRow[]>([]);
  const [showPoCostSkipDialog, setShowPoCostSkipDialog] = useState(false);
  const [postImportPrompt, setPostImportPrompt] = useState<{ itemIds: string[]; count: number } | null>(null);
  const [poCostImportSummary, setPoCostImportSummary] = useState<{ inserted: number; updated: number } | null>(null);
  const [vendorDisplayMap, setVendorDisplayMap] = useState<Map<string, string>>(new Map());
  const [vendorCurrencyMap, setVendorCurrencyMap] = useState<Map<string, string>>(new Map());
  const [vendorNameMap, setVendorNameMap] = useState<Map<string, string>>(new Map());
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());
  const [jmartPriceMap, setJmartPriceMap] = useState<Map<string, number>>(new Map());
  type ExtrasInfo = {
    mainBarcodeUnit?: string;
    mainBarcodePack?: string;
    product_name_la?: string;
    division_group?: string; division?: string;
    department?: string; sub_department?: string;
    class?: string; sub_class?: string;
    gm_buyer_code?: string; header_buyer_code?: string; buyer_code?: string;
  };
  const [extrasMap, setExtrasMap] = useState<Map<string, ExtrasInfo>>(new Map());
  const [rateTHB, setRateTHB] = useState<string>(() => localStorage.getItem("po_cost_rate_thb") || "");
  const [rateUSD, setRateUSD] = useState<string>(() => localStorage.getItem("po_cost_rate_usd") || "");
  const [rateTHBDraft, setRateTHBDraft] = useState<string>(rateTHB);
  const [rateUSDDraft, setRateUSDDraft] = useState<string>(rateUSD);
  const [rateEditing, setRateEditing] = useState(false);

  // PO Cost view mode: data / report; and column filter
  type MarginOp = "" | ">" | "<" | "=" | "!=" | ">=" | "<=" | "between" | "contains" | "starts_with" | "ends_with" | "is_set" | "is_not_set";
  type PoLoadFilter = { column: string; operator: MarginOp; value: string; value2?: string };
  const [poCostView, setPoCostView] = useState<"data" | "report">("data");
  const [filterColPo, setFilterColPo] = useState<string>("__margin_pct"); // default Margin%
  const [marginOp, setMarginOp] = useState<MarginOp>("");
  const [marginV1, setMarginV1] = useState<string>("");
  const [marginV2, setMarginV2] = useState<string>("");
  const [filterColPo2, setFilterColPo2] = useState<string>("__jmart_margin_pct");
  const [marginOp2, setMarginOp2] = useState<MarginOp>("");
  const [marginV12, setMarginV12] = useState<string>("");
  const [marginV22, setMarginV22] = useState<string>("");
  const [filterLogic, setFilterLogic] = useState<"AND" | "OR">("AND");
  const [marginRows, setMarginRows] = useState<any[] | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  // Report tab — 3 user-defined conditions
  const [reportConds, setReportConds] = useState<{ op: MarginOp; v1: string; v2: string }[]>([
    { op: "=", v1: "0", v2: "" },
    { op: "<", v1: "0", v2: "" },
    { op: ">", v1: "50", v2: "" },
  ]);
  const [reportRows, setReportRows] = useState<any[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [poLoadProgress, setPoLoadProgress] = useState<{ phase: string; current: number; total: number } | null>(null);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  // PO Cost dropdown filters (server-side WHERE conditions)
  const [poVendorFilter, setPoVendorFilter] = useState<string[]>([]);
  const [poBarcodeFilter, setPoBarcodeFilter] = useState<string[]>([]);
  const [poBarcodeUnitFilter, setPoBarcodeUnitFilter] = useState<string[]>([]);
  const [poGmBuyerFilter, setPoGmBuyerFilter] = useState<string[]>([]);
  const [poHeaderBuyerFilter, setPoHeaderBuyerFilter] = useState<string[]>([]);
  const [poBuyerFilter, setPoBuyerFilter] = useState<string[]>([]);
  const [poSkuFilter, setPoSkuFilter] = useState<string>("");
  // Dropdown option lists (pre-loaded once when entering PO Cost)
  const [poVendorOptions, setPoVendorOptions] = useState<string[]>([]);
  const [poVendorLabelMap, setPoVendorLabelMap] = useState<Map<string, string>>(new Map());
  const [poBarcodeOptions, setPoBarcodeOptions] = useState<string[]>([]);
  const [poBarcodeUnitOptions, setPoBarcodeUnitOptions] = useState<string[]>([]);
  const [poGmBuyerOptions, setPoGmBuyerOptions] = useState<string[]>([]);
  const [poHeaderBuyerOptions, setPoHeaderBuyerOptions] = useState<string[]>([]);
  const [poBuyerOptions, setPoBuyerOptions] = useState<string[]>([]);
  const [poBarcodeLabelMap, setPoBarcodeLabelMap] = useState<Map<string, string>>(new Map());
  const [poBarcodeUnitLabelMap, setPoBarcodeUnitLabelMap] = useState<Map<string, string>>(new Map());
  const [poGmBuyerLabelMap, setPoGmBuyerLabelMap] = useState<Map<string, string>>(new Map());
  const [poHeaderBuyerLabelMap, setPoHeaderBuyerLabelMap] = useState<Map<string, string>>(new Map());
  const [poBuyerLabelMap, setPoBuyerLabelMap] = useState<Map<string, string>>(new Map());
  const [poFilterOptionsLoaded, setPoFilterOptionsLoaded] = useState(false);

  // Pre-load dropdown options once when entering po_cost page (single RPC call — instant)
  useEffect(() => {
    if (activeTable !== "po_cost" || poFilterOptionsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_po_cost_filter_options" as any);
        if (error) throw error;
        if (cancelled || !data) return;
        const d: any = data;
        const vMap = new Map<string, string>();
        const vCodes: string[] = [];
        for (const v of (d.vendors || [])) {
          const code = String(v.code || "").trim();
          if (!code || vMap.has(code)) continue;
          const n = Number(v.count || 0);
          const baseLabel = v.label || code;
          vMap.set(code, n > 0 ? `${baseLabel} (${n.toLocaleString()})` : baseLabel);
          vCodes.push(code);
        }
        setPoVendorOptions(vCodes);
        setPoVendorLabelMap(vMap);
        const unpack = (arr: any[]) => (arr || []).map((x: any) =>
          typeof x === "object" && x !== null ? { v: String(x.v), n: Number(x.count || 0) } : { v: String(x), n: 0 }
        );
        const bp = unpack(d.main_barcode_pack);
        const bu = unpack(d.main_barcode_unit);
        const gm = unpack(d.gm_buyer_code);
        const hb = unpack(d.header_buyer_code);
        const by = unpack(d.buyer_code);
        const mkMap = (arr: { v: string; n: number }[]) => new Map(arr.map(x => [x.v, x.n > 0 ? `${x.v} (${x.n.toLocaleString()})` : x.v]));
        setPoBarcodeOptions(bp.map(x => x.v));
        setPoBarcodeUnitOptions(bu.map(x => x.v));
        setPoGmBuyerOptions(gm.map(x => x.v));
        setPoHeaderBuyerOptions(hb.map(x => x.v));
        setPoBuyerOptions(by.map(x => x.v));
        setPoBarcodeLabelMap(mkMap(bp));
        setPoBarcodeUnitLabelMap(mkMap(bu));
        setPoGmBuyerLabelMap(mkMap(gm));
        setPoHeaderBuyerLabelMap(mkMap(hb));
        setPoBuyerLabelMap(mkMap(by));
        setPoFilterOptionsLoaded(true);
      } catch (e: any) {
        if (!cancelled) toast({ title: "โหลด Filter Options ผิดพลาด", description: e.message, variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
  }, [activeTable, poFilterOptionsLoaded, toast]);

  // Compute Cost(Lak) and Margin% for a row given current rates + maps
  const computeRowMetrics = useCallback((row: any) => {
    const cur = vendorCurrencyMap.get(String(row.vendor || "")) || "";
    const unit = Number(row.po_cost_unit);
    const rThb = parseFloat(rateTHB);
    const rUsd = parseFloat(rateUSD);
    let costLak: number | null = null;
    if (Number.isFinite(unit)) {
      if (cur === "LAK") costLak = unit;
      else if (cur === "THB" && Number.isFinite(rThb) && rThb > 0) costLak = unit * rThb;
      else if (cur === "USD" && Number.isFinite(rUsd) && rUsd > 0) costLak = unit * rUsd;
    }
    const price = priceMap.get(String(row.item_id || ""));
    const marginAmt = (price !== undefined && costLak !== null) ? (price - costLak) : null;
    const marginPct = (marginAmt !== null && price && price !== 0) ? (marginAmt / price) * 100 : null;
    const jmartPrice = jmartPriceMap.get(String(row.item_id || ""));
    const jmartMarginAmt = (jmartPrice !== undefined && costLak !== null) ? (jmartPrice - costLak) : null;
    const jmartMarginPct = (jmartMarginAmt !== null && jmartPrice && jmartPrice !== 0) ? (jmartMarginAmt / jmartPrice) * 100 : null;
    const diffPrice = (price !== undefined && jmartPrice !== undefined) ? (price - jmartPrice) : null;
    const diffPct = (diffPrice !== null && jmartPrice && jmartPrice !== 0) ? (diffPrice / jmartPrice) * 100 : null;
    return { costLak, price: price ?? null, marginAmt, marginPct, currency: cur,
      jmartPrice: jmartPrice ?? null, jmartMarginAmt, jmartMarginPct, diffPrice, diffPct };
  }, [vendorCurrencyMap, priceMap, jmartPriceMap, rateTHB, rateUSD]);

  const matchMargin = (pct: number | null, op: MarginOp, v1: string, v2: string): boolean => {
    if (pct === null || op === "") return false;
    const a = parseFloat(v1); const b = parseFloat(v2);
    switch (op) {
      case ">": return Number.isFinite(a) && pct > a;
      case "<": return Number.isFinite(a) && pct < a;
      case "=": return Number.isFinite(a) && Math.abs(pct - a) < 0.0001;
      case ">=": return Number.isFinite(a) && pct >= a;
      case "<=": return Number.isFinite(a) && pct <= a;
      case "between": return Number.isFinite(a) && Number.isFinite(b) && pct >= Math.min(a, b) && pct <= Math.max(a, b);
      default: return false;
    }
  };

  // Generic value resolver — returns raw value (number for numeric synthetic; string otherwise)
  const resolveColValue = (row: any, col: string, m: any): { num: number | null; text: string | null } => {
    let v: any = null;
    if (col.startsWith("__")) {
      switch (col) {
        case "__price": v = m?.price; break;
        case "__cost_lak": v = m?.costLak; break;
        case "__margin_amt": v = m?.marginAmt; break;
        case "__margin_pct": v = m?.marginPct; break;
        case "__jmart_price": v = m?.jmartPrice; break;
        case "__jmart_margin_amt": v = m?.jmartMarginAmt; break;
        case "__jmart_margin_pct": v = m?.jmartMarginPct; break;
        case "__diff_price": v = m?.diffPrice; break;
        case "__diff_pct": v = m?.diffPct; break;
        default: {
          const e = extrasMap.get(String(row.item_id || ""));
          const map: Record<string, any> = {
            __main_barcode_unit: e?.mainBarcodeUnit,
            __division_group: e?.division_group,
            __division: e?.division,
            __department: e?.department,
            __sub_department: e?.sub_department,
            __class: e?.class,
            __sub_class: e?.sub_class,
            __gm_buyer_code: e?.gm_buyer_code,
            __header_buyer_code: e?.header_buyer_code,
            __buyer_code: e?.buyer_code,
          };
          v = map[col];
        }
      }
    } else {
      v = row[col];
    }
    if (v === null || v === undefined || v === "") return { num: null, text: null };
    const n = typeof v === "number" ? v : Number(v);
    return { num: Number.isFinite(n) ? n : null, text: String(v) };
  };

  const NUMERIC_OPS = new Set([">","<","=",">=","<=","between"]);
  const matchGeneric = (val: { num: number | null; text: string | null }, op: MarginOp, v1: string, v2: string): boolean => {
    if (op === "") return true;
    if (op === "is_set") return val.text !== null;
    if (op === "is_not_set") return val.text === null;
    if (NUMERIC_OPS.has(op)) {
      return matchMargin(val.num, op, v1, v2);
    }
    if (val.text === null) return false;
    const t = val.text.toLowerCase(); const q = (v1 || "").toLowerCase();
    if (op === "contains") return t.includes(q);
    if (op === "starts_with") return t.startsWith(q);
    if (op === "ends_with") return t.endsWith(q);
    return false;
  };

  // Load po_cost rows from the enriched VIEW with DB-side filters where possible.
  const loadAllPoCost = useCallback(async (extraFilter?: PoLoadFilter, dropdownFilters?: { vendor?: string[]; barcode?: string[]; barcodeUnit?: string[]; gmBuyer?: string[]; headerBuyer?: string[]; buyer?: string[]; sku?: string[] }): Promise<{ rows: any[]; cm: Map<string,string>; nm: Map<string,string>; pm: Map<string,number>; jpm: Map<string,number>; ex: Map<string, ExtrasInfo> }> => {
    const fetchSize = 1000;
    const concurrency = 3;
    const mapCol = (c: string) => {
      const map: Record<string, string> = {
        vendor: "vendor_code",
        product_name: "po_product_name",
        __price: "list_price",
        __jmart_price: "jmart_price",
        __main_barcode_unit: "main_barcode_unit",
        __division_group: "division_group",
        __division: "division",
        __department: "department",
        __sub_department: "sub_department",
        __class: "class",
        __sub_class: "sub_class",
        __gm_buyer_code: "gm_buyer_code",
        __header_buyer_code: "header_buyer_code",
        __buyer_code: "buyer_code",
      };
      return map[c] || c;
    };
    const canPushPoFilter = (f?: PoLoadFilter) => {
      if (!f || new Set(["__cost_lak", "__margin_amt", "__margin_pct", "__jmart_margin_amt", "__jmart_margin_pct", "__diff_price", "__diff_pct"]).has(f.column)) return false;
      if (f.operator === "is_set" || f.operator === "is_not_set") return true;
      if (!f.value || (f.operator === "between" && !f.value2)) return false;
      return true;
    };
    // Only select columns we actually use (much faster than SELECT *)
    const SELECT_COLS = "id,item_id,vendor_code,vendor_name,supplier_currency,goodcode,po_product_name,product_name_la,moq,po_cost,po_cost_unit,list_price,jmart_price,main_barcode_unit,main_barcode_pack,division_group,division,department,sub_department,class,sub_class,gm_buyer_code,header_buyer_code,buyer_code,created_at,updated_at";
    const applyOneFilter = (q: any, f: { column: string; operator: MarginOp; value: string; value2?: string }) => {
      const col = mapCol(f.column);
      switch (f.operator) {
        case "contains": return q.ilike(col, `%${f.value}%`);
        case "=": return q.eq(col, f.value);
        case "!=": return q.neq(col, f.value);
        case "starts_with": return q.ilike(col, `${f.value}%`);
        case "ends_with": return q.ilike(col, `%${f.value}`);
        case "is_set": return q.not(col, "is", null);
        case "is_not_set": return q.is(col, null);
        case ">": return q.gt(col, f.value);
        case "<": return q.lt(col, f.value);
        case ">=": return q.gte(col, f.value);
        case "<=": return q.lte(col, f.value);
        case "between": {
          const a = Number(f.value);
          const b = Number(f.value2);
          return Number.isFinite(a) && Number.isFinite(b) ? q.gte(col, Math.min(a, b)).lte(col, Math.max(a, b)) : q;
        }
        default: return q;
      }
    };
    const applyFilters = (q: any) => {
      for (const f of filters) {
        q = applyOneFilter(q, { column: f.column, operator: f.operator, value: f.value });
      }
      if (canPushPoFilter(extraFilter)) q = applyOneFilter(q, extraFilter!);
      if (dropdownFilters) {
        if (dropdownFilters.vendor && dropdownFilters.vendor.length) q = q.in("vendor_code", dropdownFilters.vendor);
        if (dropdownFilters.barcode && dropdownFilters.barcode.length) q = q.in("main_barcode_pack", dropdownFilters.barcode);
        if (dropdownFilters.barcodeUnit && dropdownFilters.barcodeUnit.length) q = q.in("main_barcode_unit", dropdownFilters.barcodeUnit);
        if (dropdownFilters.gmBuyer && dropdownFilters.gmBuyer.length) q = q.in("gm_buyer_code", dropdownFilters.gmBuyer);
        if (dropdownFilters.headerBuyer && dropdownFilters.headerBuyer.length) q = q.in("header_buyer_code", dropdownFilters.headerBuyer);
        if (dropdownFilters.buyer && dropdownFilters.buyer.length) q = q.in("buyer_code", dropdownFilters.buyer);
        if (dropdownFilters.sku && dropdownFilters.sku.length) q = q.in("item_id", dropdownFilters.sku);
      }
      return q;
    };
    // 1) Get total count via HEAD (no rows transferred)
    setPoLoadProgress({ phase: "กำลังนับจำนวนข้อมูล...", current: 0, total: 0 });
    const headQ = applyFilters(supabase.from("po_cost_enriched" as any).select("id", { count: "exact", head: true }));
    const { count, error: cntErr } = await headQ;
    if (cntErr) throw cntErr;
    const total = count || 0;
    const all: any[] = [];
    if (total > 0) {
      setPoLoadProgress({ phase: "กำลังโหลดข้อมูล PO Cost...", current: 0, total });
      const ranges: { from: number; to: number }[] = [];
      for (let off = 0; off < total; off += fetchSize) ranges.push({ from: off, to: Math.min(off + fetchSize - 1, total - 1) });
      let nextRange = 0;
      const workers = Array.from({ length: Math.min(concurrency, ranges.length) }, async () => {
        while (nextRange < ranges.length) {
          const r = ranges[nextRange++];
          const q = applyFilters(supabase.from("po_cost_enriched" as any).select(SELECT_COLS)).order("id", { ascending: true }).range(r.from, r.to);
          const res: any = await q;
          if (res.error) throw res.error;
          all.push(...(res.data || []));
          setPoLoadProgress({ phase: "กำลังโหลดข้อมูล PO Cost...", current: Math.min(all.length, total), total });
        }
      });
      await Promise.all(workers);
      all.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
      }
    setPoLoadProgress({ phase: "กำลังประมวลผล...", current: total, total });

    // Map view rows → po_cost-shaped rows + build maps in ONE pass (no second fetch)
    const cm = new Map<string, string>();
    const nm = new Map<string, string>();
    const pm = new Map<string, number>();
    const jpm = new Map<string, number>();
    const ex = new Map<string, ExtrasInfo>();
    const mapped: any[] = all.map((r: any) => {
      const code = String(r.vendor_code || "");
      const sku = String(r.item_id || "");
      if (code) {
        if (r.supplier_currency) cm.set(code, String(r.supplier_currency).toUpperCase());
        if (r.vendor_name) nm.set(code, String(r.vendor_name));
      }
      if (sku) {
        if (r.list_price !== null && r.list_price !== undefined) pm.set(sku, Number(r.list_price));
        if (r.jmart_price !== null && r.jmart_price !== undefined) jpm.set(sku, Number(r.jmart_price));
        ex.set(sku, {
          mainBarcodeUnit: r.main_barcode_unit || undefined,
          mainBarcodePack: r.main_barcode_pack || undefined,
          product_name_la: r.product_name_la || undefined,
          division_group: r.division_group || undefined,
          division: r.division || undefined,
          department: r.department || undefined,
          sub_department: r.sub_department || undefined,
          class: r.class || undefined,
          sub_class: r.sub_class || undefined,
          gm_buyer_code: r.gm_buyer_code || undefined,
          header_buyer_code: r.header_buyer_code || undefined,
          buyer_code: r.buyer_code || undefined,
        });
      }
      // Reshape to look like po_cost row (downstream code uses r.vendor / r.product_name)
      return {
        id: r.id,
        item_id: r.item_id,
        vendor: r.vendor_code,
        goodcode: r.goodcode,
        product_name: r.po_product_name,
        moq: r.moq,
        po_cost: r.po_cost,
        po_cost_unit: r.po_cost_unit,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
    setVendorCurrencyMap(cm);
    setVendorNameMap(nm);
    setPriceMap(pm);
    setJmartPriceMap(jpm);
    setExtrasMap(ex);
    setVendorDisplayMap(prev => {
      const merged = new Map(prev);
      for (const [code, cur] of cm) {
        const name = nm.get(code) || "";
        merged.set(code, [cur, code, name].filter(Boolean).join(" - "));
      }
      return merged;
    });
    return { rows: mapped, cm, nm, pm, jpm, ex };
  }, [filters]);
  const parseSkuList = (s: string): string[] => s.split(/[\s,;\n\r\t]+/).map(x => x.trim()).filter(Boolean);
  const buildPoDropdownFilters = useCallback(() => ({
    vendor: poVendorFilter,
    barcode: poBarcodeFilter,
    barcodeUnit: poBarcodeUnitFilter,
    gmBuyer: poGmBuyerFilter,
    headerBuyer: poHeaderBuyerFilter,
    buyer: poBuyerFilter,
    sku: parseSkuList(poSkuFilter),
  }), [poVendorFilter, poBarcodeFilter, poBarcodeUnitFilter, poGmBuyerFilter, poHeaderBuyerFilter, poBuyerFilter, poSkuFilter]);

  const hasAnyPoFilter = (
    poVendorFilter.length + poBarcodeFilter.length + poBarcodeUnitFilter.length +
    poGmBuyerFilter.length + poHeaderBuyerFilter.length + poBuyerFilter.length +
    parseSkuList(poSkuFilter).length
  ) > 0 || marginOp !== "" || marginOp2 !== "";

  const reloadPoFilterOptions = useCallback(() => {
    setPoFilterOptionsLoaded(false);
  }, []);

  // Read 1 for po_cost — honors PO dropdown filters (vendor / barcode / buyer / sku).
  // Without this, fetchData() reads base po_cost table and ignores the dropdowns → returns too many rows.
  const handlePoCostRead1 = useCallback(async () => {
    const dd = buildPoDropdownFilters();
    const hasDropdown =
      (dd.vendor?.length || 0) + (dd.barcode?.length || 0) + (dd.barcodeUnit?.length || 0) +
      (dd.gmBuyer?.length || 0) + (dd.headerBuyer?.length || 0) + (dd.buyer?.length || 0) +
      (dd.sku?.length || 0) > 0;
    if (!hasDropdown) {
      await fetchData();
      return;
    }
    try {
      const { rows } = await loadAllPoCost(undefined, dd);
      setTotalCount(rows.length);
      const start = page * pageSize;
      setData(rows.slice(start, start + pageSize));
    } catch (e: any) {
      toast({ title: "Read Error", description: e.message, variant: "destructive" });
    } finally {
      setPoLoadProgress(null);
    }
  }, [buildPoDropdownFilters, fetchData, loadAllPoCost, page, pageSize, setData, setTotalCount, toast]);



  const computeWithMaps = (row: any, cm: Map<string,string>, pm: Map<string,number>, jpm?: Map<string,number>) => {
    const cur = cm.get(String(row.vendor || "")) || "";
    const unit = Number(row.po_cost_unit);
    const rThb = parseFloat(rateTHB); const rUsd = parseFloat(rateUSD);
    let costLak: number | null = null;
    if (Number.isFinite(unit)) {
      if (cur === "LAK") costLak = unit;
      else if (cur === "THB" && Number.isFinite(rThb) && rThb > 0) costLak = unit * rThb;
      else if (cur === "USD" && Number.isFinite(rUsd) && rUsd > 0) costLak = unit * rUsd;
    }
    const price = pm.get(String(row.item_id || ""));
    const marginAmt = (price !== undefined && costLak !== null) ? (price - costLak) : null;
    const marginPct = (marginAmt !== null && price && price !== 0) ? (marginAmt / price) * 100 : null;
    const jmartPrice = jpm?.get(String(row.item_id || ""));
    const jmartMarginAmt = (jmartPrice !== undefined && costLak !== null) ? (jmartPrice - costLak) : null;
    const jmartMarginPct = (jmartMarginAmt !== null && jmartPrice && jmartPrice !== 0) ? (jmartMarginAmt / jmartPrice) * 100 : null;
    const diffPrice = (price !== undefined && jmartPrice !== undefined) ? (price - jmartPrice) : null;
    const diffPct = (diffPrice !== null && jmartPrice && jmartPrice !== 0) ? (diffPrice / jmartPrice) * 100 : null;
    return { costLak, price: price ?? null, marginAmt, marginPct, currency: cur,
      jmartPrice: jmartPrice ?? null, jmartMarginAmt, jmartMarginPct, diffPrice, diffPct };
  };

  const handleShowMarginFilter = async () => {
    setMarginLoading(true);
    try {
      const hasF1 = marginOp !== "";
      const hasF2 = marginOp2 !== "";
      // Only push to DB if exactly one filter active (otherwise AND/OR combos need full data)
      const pushFilter = hasF1 && !hasF2
        ? { column: filterColPo, operator: marginOp, value: marginV1, value2: marginV2 }
        : (!hasF1 && hasF2
          ? { column: filterColPo2, operator: marginOp2, value: marginV12, value2: marginV22 }
          : undefined);
      const { rows, cm, pm, jpm } = await loadAllPoCost(pushFilter, buildPoDropdownFilters());
      let out = rows;
      if (hasF1 || hasF2) {
        out = rows.filter(row => {
          const m = computeWithMaps(row, cm, pm, jpm);
          const ok1 = hasF1 ? matchGeneric(resolveColValue(row, filterColPo, m), marginOp, marginV1, marginV2) : null;
          const ok2 = hasF2 ? matchGeneric(resolveColValue(row, filterColPo2, m), marginOp2, marginV12, marginV22) : null;
          if (hasF1 && hasF2) return filterLogic === "AND" ? (ok1 && ok2) : (ok1 || ok2);
          return hasF1 ? !!ok1 : !!ok2;
        });
      }
      setMarginRows(out);
      toast({ title: `กรองได้ ${out.length} แถว` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setMarginLoading(false); setPoLoadProgress(null); }
  };

  const clearMarginFilter = () => {
    setMarginRows(null);
    setMarginOp(""); setMarginV1(""); setMarginV2("");
    setMarginOp2(""); setMarginV12(""); setMarginV22("");
  };

  const handleShowReport = async () => {
    setReportLoading(true);
    try {
      const { rows, cm, nm, pm, jpm } = await loadAllPoCost();
      const groups = new Map<string, any[]>();
      for (const r of rows) {
        const v = String(r.vendor || "");
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(r);
      }
      const out: any[] = [];
      for (const [vendor, list] of groups) {
        let c0 = 0, c1 = 0, c2 = 0;
        let c0j = 0, c1j = 0, c2j = 0;
        for (const r of list) {
          const m = computeWithMaps(r, cm, pm, jpm);
          if (matchMargin(m.marginPct, reportConds[0].op, reportConds[0].v1, reportConds[0].v2)) c0++;
          if (matchMargin(m.marginPct, reportConds[1].op, reportConds[1].v1, reportConds[1].v2)) c1++;
          if (matchMargin(m.marginPct, reportConds[2].op, reportConds[2].v1, reportConds[2].v2)) c2++;
          if (matchMargin(m.jmartMarginPct, reportConds[0].op, reportConds[0].v1, reportConds[0].v2)) c0j++;
          if (matchMargin(m.jmartMarginPct, reportConds[1].op, reportConds[1].v1, reportConds[1].v2)) c1j++;
          if (matchMargin(m.jmartMarginPct, reportConds[2].op, reportConds[2].v1, reportConds[2].v2)) c2j++;
        }
        const items = list.map(r => {
          const m = computeWithMaps(r, cm, pm, jpm);
          return {
            item_id: r.item_id,
            product_name: r.product_name || "",
            goodcode: r.goodcode || "",
            po_cost_unit: r.po_cost_unit,
            price: m.price,
            costLak: m.costLak,
            marginAmt: m.marginAmt,
            marginPct: m.marginPct,
            jmartPrice: m.jmartPrice,
            jmartMarginAmt: m.jmartMarginAmt,
            jmartMarginPct: m.jmartMarginPct,
            diffPrice: m.diffPrice,
            diffPct: m.diffPct,
            currency: cm.get(vendor) || "",
          };
        });
        out.push({
          vendor_code: vendor,
          vendor_name: nm.get(vendor) || "",
          total: list.length,
          c0, c1, c2, c0j, c1j, c2j,
          items,
        });
      }
      out.sort((a, b) => b.total - a.total);
      setReportRows(out);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setReportLoading(false); setPoLoadProgress(null); }
  };
  // Update-mode missing-rows prompt
  const [missingPrompt, setMissingPrompt] = useState<{
    existing: PoCostResolved[];
    missing: PoCostResolved[];
  } | null>(null);
  const [marginPrompt, setMarginPrompt] = useState<{
    mode: "insert" | "update";
    toUpsert: PoCostResolved[];
    skipped: PoCostSkipRow[];
    warnings: PoCostMarginWarning[];
  } | null>(null);
  const [marginSelected, setMarginSelected] = useState<Set<number>>(new Set());

  // Vendor mismatch (imported vendor ≠ data_master vendor) confirmation
  const [vendorMismatchPrompt, setVendorMismatchPrompt] = useState<{
    mode: "insert" | "update";
    toUpsert: PoCostResolved[];
    skipped: PoCostSkipRow[];
    warnings: PoCostMarginWarning[];
    mismatches: PoCostVendorMismatch[];
    moqPackingWarnings?: PoCostMoqPackingWarning[];
  } | null>(null);
  const [vendorMismatchSelected, setVendorMismatchSelected] = useState<Set<number>>(new Set());

  // MOQ=1 vs Packing>1 confirmation
  const [moqPackingPrompt, setMoqPackingPrompt] = useState<{
    mode: "insert" | "update";
    toUpsert: PoCostResolved[];
    skipped: PoCostSkipRow[];
    warnings: PoCostMarginWarning[];
    moqPackingWarnings: PoCostMoqPackingWarning[];
  } | null>(null);
  const [moqPackingSelected, setMoqPackingSelected] = useState<Set<number>>(new Set());

  // When margin warning popup opens, ensure we have currency for every warning vendor.
  // Fallback fetch from vendor_master for vendors not already in vendorCurrencyMap.
  useEffect(() => {
    if (!marginPrompt) return;
    const missing = Array.from(new Set(
      marginPrompt.warnings
        .map(w => w.resolved.vendor)
        .filter(v => v && !vendorCurrencyMap.has(v))
    ));
    if (missing.length === 0) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("vendor_master")
          .select("vendor_code, supplier_currency")
          .in("vendor_code", missing);
        if (!data || data.length === 0) return;
        setVendorCurrencyMap(prev => {
          const next = new Map(prev);
          for (const r of data) {
            if (r.vendor_code && r.supplier_currency) {
              next.set(String(r.vendor_code), String(r.supplier_currency).toUpperCase());
            }
          }
          return next;
        });
      } catch { /* ignore */ }
    })();
  }, [marginPrompt]);

  const tableConfig = DATA_TABLES.find(t => t.name === activeTable)!;
  const keyColumns = KEY_COLUMNS[safeTable] || columns.slice(0, 5);

  // Compute displayed columns based on visibility
  const baseDisplayColumns = columns.filter(c => visibleColumns.has(c));
  const displayColumns = activeTable === "po_cost"
    ? (() => {
        // Custom order per spec: Vendor → Barcodes → Hierarchy → Buyer → SKU → Product → MOQ/Cost → Calc
        const v = (k: string) => visibleColumns.has(k);
        const ordered: string[] = [];
        if (v("vendor")) ordered.push("vendor");
        ordered.push("__main_barcode_pack", "__main_barcode_unit");
        ordered.push(
          "__division_group", "__division",
          "__department", "__sub_department",
          "__class", "__sub_class",
          "__gm_buyer_code", "__header_buyer_code", "__buyer_code",
        );
        if (v("item_id")) ordered.push("item_id");
        if (v("product_name")) ordered.push("product_name");
        if (v("moq")) ordered.push("moq");
        if (v("po_cost")) ordered.push("po_cost");
        if (v("po_cost_unit")) ordered.push("po_cost_unit");
        ordered.push(
          "__cost_lak",
          "__price", "__margin_amt", "__margin_pct",
          "__jmart_price", "__jmart_margin_amt", "__jmart_margin_pct",
          "__diff_price", "__diff_pct",
        );
        // Append any other visible base columns not already placed (skip goodcode — replaced by __main_barcode_pack)
        for (const c of baseDisplayColumns) {
          if (c === "goodcode") continue;
          if (!ordered.includes(c)) ordered.push(c);
        }
        return ordered;
      })()
    : baseDisplayColumns;
  const SYNTHETIC_LABELS: Record<string, string> = {
    __price: "2KM Price",
    __cost_lak: "Cost (Lak)",
    __margin_amt: "2KM Margin Amount",
    __margin_pct: "2KM Margin %",
    __jmart_price: "Jmart Price",
    __jmart_margin_amt: "Jmart Margin Amount",
    __jmart_margin_pct: "Jmart Margin %",
    __diff_price: "Diff Price",
    __diff_pct: "% Diff",
    __main_barcode_pack: "Main Barcode",
    __main_barcode_unit: "Main Barcode (Unit)",
    __division_group: "Division Group",
    __division: "Division",
    __department: "Department",
    __sub_department: "Sub-Department",
    __class: "Class",
    __sub_class: "Sub-Class",
    __gm_buyer_code: "GM Buyer Code",
    __header_buyer_code: "Header Buyer Code",
    __buyer_code: "Buyer Code",
  };
  // Helper: get synthetic value for a row+col
  const getSyntheticValue = (row: any, col: string, m: any): string => {
    const fmt = (v: number | null | undefined, frac = 2) =>
      (v === null || v === undefined) ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: frac });
    if (col === "__price") return fmt(m?.price);
    if (col === "__cost_lak") return fmt(m?.costLak);
    if (col === "__margin_amt") return fmt(m?.marginAmt);
    if (col === "__margin_pct") return m?.marginPct != null ? m.marginPct.toFixed(2) + "%" : "";
    if (col === "__jmart_price") return fmt(m?.jmartPrice);
    if (col === "__jmart_margin_amt") return fmt(m?.jmartMarginAmt);
    if (col === "__jmart_margin_pct") return m?.jmartMarginPct != null ? m.jmartMarginPct.toFixed(2) + "%" : "";
    if (col === "__diff_price") return fmt(m?.diffPrice);
    if (col === "__diff_pct") return m?.diffPct != null ? m.diffPct.toFixed(2) + "%" : "";
    const e = extrasMap.get(String(row.item_id || ""));
    if (col === "__main_barcode_pack") return e?.mainBarcodePack || "";
    if (col === "__main_barcode_unit") return e?.mainBarcodeUnit || "";
    if (col === "__division_group") return e?.division_group || "";
    if (col === "__division") return e?.division || "";
    if (col === "__department") return e?.department || "";
    if (col === "__sub_department") return e?.sub_department || "";
    if (col === "__class") return e?.class || "";
    if (col === "__sub_class") return e?.sub_class || "";
    if (col === "__gm_buyer_code") return e?.gm_buyer_code || "";
    if (col === "__header_buyer_code") return e?.header_buyer_code || "";
    if (col === "__buyer_code") return e?.buyer_code || "";
    return "";
  };


  // ===== PO Cost: Export respecting Margin filter / selection =====
  const exportPoCostRows = (
    rows: any[],
    filename: string,
    extrasOverride?: Map<string, ExtrasInfo>,
    cmOverride?: Map<string, string>,
    pmOverride?: Map<string, number>,
    jpmOverride?: Map<string, number>,
    nmOverride?: Map<string, string>,
  ) => {
    if (!rows || rows.length === 0) {
      toast({ title: "ไม่มีข้อมูลให้ Export", variant: "destructive" });
      return;
    }
    const ex = extrasOverride ?? extrasMap;
    const cm = cmOverride ?? vendorCurrencyMap;
    const pm = pmOverride ?? priceMap;
    const jpm = jpmOverride ?? jmartPriceMap;
    const nm = nmOverride ?? vendorNameMap;
    const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
    const exportRows = rows.map(r => {
      const m = computeWithMaps(r, cm, pm, jpm);
      const e = ex.get(String(r.item_id || ""));
      // Vendor display: "CUR - CODE - NAME"
      const code = String(r.vendor || "");
      const cur = cm.get(code) || "";
      const vname = nm.get(code) || "";
      const vendorDisplay = [cur, code, vname].filter(Boolean).join(" - ");
      return {
        "Vendor": vendorDisplay,
        "Main Barcode": e?.mainBarcodePack ?? r.goodcode ?? "",
        "Main Barcode (Unit)": e?.mainBarcodeUnit ?? "",
        "Division Group": e?.division_group ?? "",
        "Division": e?.division ?? "",
        "Department": e?.department ?? "",
        "Sub-Department": e?.sub_department ?? "",
        "Class": e?.class ?? "",
        "Sub-Class": e?.sub_class ?? "",
        "GM Buyer Code": e?.gm_buyer_code ?? "",
        "Header Buyer Code": e?.header_buyer_code ?? "",
        "Buyer Code": e?.buyer_code ?? "",
        "ID (SKUCode)": r.item_id ?? "",
        "Product Name": e?.product_name_la ?? r.product_name ?? "",
        "MOQ (1x)": num(r.moq),
        "PO Cost": num(r.po_cost),
        "PO Cost Unit": num(r.po_cost_unit),
        "Cost (Lak)": m.costLak,
        "2KM Price": m.price,
        "2KM Margin Amount": m.marginAmt,
        "2KM Margin %": m.marginPct,
        "Jmart Price": m.jmartPrice,
        "Jmart Margin Amount": m.jmartMarginAmt,
        "Jmart Margin %": m.jmartMarginPct,
        "Diff Price": m.diffPrice,
        "% Diff": m.diffPct,
      };
    });
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "po_cost");
      XLSX.writeFile(wb, filename);
      toast({ title: "Export สำเร็จ", description: `${exportRows.length} แถว` });
    });
  };

  const handleExportPoCostFiltered = () => {
    if (!marginRows || marginRows.length === 0) {
      toast({ title: "ยังไม่ได้กด Show หรือไม่พบข้อมูล", variant: "destructive" });
      return;
    }
    exportPoCostRows(marginRows, "po_cost_margin_filtered.xlsx");
  };

  const handleExportPoCostSelected = () => {
    if (selectedRows.size === 0) {
      toast({ title: "ยังไม่ได้เลือกแถว", variant: "destructive" });
      return;
    }
    const source = (marginRows ?? data);
    const sel = source.filter(r => selectedRows.has(r.id));
    exportPoCostRows(sel, "po_cost_selected.xlsx");
  };

  const handleExportPoCostAll = async () => {
    try {
      const { rows, ex, cm, pm, jpm, nm } = await loadAllPoCost();
      exportPoCostRows(rows, "po_cost_export.xlsx", ex, cm, pm, jpm, nm);
    } catch (e: any) {
      toast({ title: "Export Error", description: e.message, variant: "destructive" });
    }
  };

  const handleExportPoCostByChips = async () => {
    if (filters.length === 0) {
      toast({ title: "ไม่มี Filter ที่ใช้งานอยู่", variant: "destructive" });
      return;
    }
    try {
      const { rows, ex, cm, pm, jpm, nm } = await loadAllPoCost();
      exportPoCostRows(rows, "po_cost_filtered.xlsx", ex, cm, pm, jpm, nm);
    } catch (e: any) {
      toast({ title: "Export Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDeletePoCostByChips = async () => {
    if (filters.length === 0) {
      toast({ title: "ไม่มี Filter ที่ใช้งานอยู่", variant: "destructive" });
      return;
    }
    if (!confirm(`ลบ ${totalCount.toLocaleString()} แถวตาม Filter ที่ใช้งานอยู่?`)) return;
    try {
      const { rows } = await loadAllPoCost();
      const ids = rows.map((r: any) => r.id).filter(Boolean);
      await deletePoCostByIds(ids);
      toast({ title: "ลบสำเร็จ", description: `${ids.length} แถว` });
      setSelectedRows(new Set());
      if (marginRows) setMarginRows(null);
      await fetchData();
    } catch (e: any) {
      toast({ title: "Delete Error", description: e.message, variant: "destructive" });
    }
  };

  // ===== PO Cost: Delete modes =====
  const deletePoCostByIds = async (ids: string[]) => {
    const chunk = 500;
    for (let i = 0; i < ids.length; i += chunk) {
      const { error } = await supabase.from("po_cost").delete().in("id", ids.slice(i, i + chunk));
      if (error) throw error;
    }
  };

  const handleDeleteByMarginFilter = async () => {
    if (!marginRows || marginRows.length === 0) {
      toast({ title: "ยังไม่ได้กด Show หรือไม่พบข้อมูล", variant: "destructive" });
      return;
    }
    if (!confirm(`ลบ ${marginRows.length} แถวที่แสดงตาม Filter ?`)) return;
    try {
      const ids = marginRows.map(r => r.id).filter(Boolean);
      await deletePoCostByIds(ids);
      toast({ title: "ลบสำเร็จ", description: `${ids.length} แถว` });
      setMarginRows(null); setSelectedRows(new Set());
      await fetchData();
    } catch (e: any) {
      toast({ title: "Delete Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteSelectedPoCost = async () => {
    if (selectedRows.size === 0) {
      toast({ title: "ยังไม่ได้เลือกแถว", variant: "destructive" });
      return;
    }
    if (!confirm(`ลบ ${selectedRows.size} แถวที่เลือก ?`)) return;
    try {
      await deletePoCostByIds(Array.from(selectedRows));
      toast({ title: "ลบสำเร็จ", description: `${selectedRows.size} แถว` });
      setSelectedRows(new Set());
      if (marginRows) setMarginRows(prev => prev?.filter(r => !selectedRows.has(r.id)) ?? null);
      await fetchData();
    } catch (e: any) {
      toast({ title: "Delete Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDeletePagePoCost = async () => {
    const source = marginRows ?? data;
    if (!source || source.length === 0) {
      toast({ title: "ไม่มีข้อมูลในหน้านี้", variant: "destructive" });
      return;
    }
    if (!confirm(`ลบ ${source.length} แถวในหน้านี้ ?`)) return;
    try {
      const ids = source.map(r => r.id).filter(Boolean);
      await deletePoCostByIds(ids);
      toast({ title: "ลบสำเร็จ", description: `${ids.length} แถว` });
      setSelectedRows(new Set());
      if (marginRows) setMarginRows(null);
      await fetchData();
    } catch (e: any) {
      toast({ title: "Delete Error", description: e.message, variant: "destructive" });
    }
  };

  // Edit filter state
  const [editingFilterIdx, setEditingFilterIdx] = useState<number | null>(null);

  // Reset visible columns when table changes
  useEffect(() => {
    setVisibleColumns(new Set(columns));
  }, [activeTable, columns.join(",")]);

  useEffect(() => {
    if (!isPlaceholder) fetchData();
    setSelectedRows(new Set());
    setSelectedCols(new Set());
    setActiveCell(null);
    setLastClickedRow(null);
  }, [activeTable, page]);

  // Phase 2 loader: now uses po_cost_enriched view (1 query, no flicker, no race)
  const [phase2Loading, setPhase2Loading] = useState(false);
  const loadPoCostPhase2 = useCallback(async () => {
    if (activeTable !== "po_cost" || data.length === 0) return;
    setPhase2Loading(true);
    try {
      const itemIds = Array.from(new Set(data.map((r: any) => String(r.item_id || "")).filter(Boolean)));
      const cm = new Map<string, string>();
      const nm = new Map<string, string>();
      const pm = new Map<string, number>();
      const jpm = new Map<string, number>();
      const ex = new Map<string, ExtrasInfo>();
      const chunk = 500;
      for (let i = 0; i < itemIds.length; i += chunk) {
        const { data: vrows, error } = await supabase
          .from("po_cost_enriched" as any)
          .select("*")
          .in("item_id", itemIds.slice(i, i + chunk));
        if (error) throw error;
        for (const r of (vrows || []) as any[]) {
          const code = String(r.vendor_code || "");
          const sku = String(r.item_id || "");
          if (code) {
            if (r.supplier_currency) cm.set(code, String(r.supplier_currency).toUpperCase());
            if (r.vendor_name) nm.set(code, String(r.vendor_name));
          }
          if (sku) {
            if (r.list_price !== null && r.list_price !== undefined) pm.set(sku, Number(r.list_price));
            if (r.jmart_price !== null && r.jmart_price !== undefined) jpm.set(sku, Number(r.jmart_price));
            ex.set(sku, {
              mainBarcodeUnit: r.main_barcode_unit || undefined,
              mainBarcodePack: r.main_barcode_pack || undefined,
              product_name_la: r.product_name_la || undefined,
              division_group: r.division_group || undefined,
              division: r.division || undefined,
              department: r.department || undefined,
              sub_department: r.sub_department || undefined,
              class: r.class || undefined,
              sub_class: r.sub_class || undefined,
              gm_buyer_code: r.gm_buyer_code || undefined,
              header_buyer_code: r.header_buyer_code || undefined,
              buyer_code: r.buyer_code || undefined,
            });
          }
        }
      }
      // Single batched state update — minimizes re-renders, eliminates flicker
      setVendorCurrencyMap(cm);
      setVendorNameMap(nm);
      setPriceMap(pm);
      setJmartPriceMap(jpm);
      setExtrasMap(ex);
      setVendorDisplayMap(prev => {
        const merged = new Map(prev);
        for (const [code, cur] of cm) {
          const name = nm.get(code) || "";
          merged.set(code, [cur, code, name].filter(Boolean).join(" - "));
        }
        return merged;
      });
      toast({ title: "Read สำเร็จ", description: `โหลดข้อมูลเสริม ${itemIds.length} รายการ` });
    } catch (e: any) {
      toast({ title: "Read Error", description: e.message, variant: "destructive" });
    } finally {
      setPhase2Loading(false);
    }

  }, [activeTable, data, toast]);

  // Auto-enrich removed — Phase2 now only runs when user clicks "Read 2" button (avoids slow auto-fetch).


  // Last updated timestamp (MAX(updated_at)) — refreshed on table switch & after fetchData
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refreshLastUpdated = useCallback(async () => {
    if (isPlaceholder) { setLastUpdated(null); return; }
    try {
      const { data: rows, error } = await supabase
        .from(safeTable as any)
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) { setLastUpdated(null); return; }
      const ts = (rows?.[0] as any)?.updated_at as string | undefined;
      setLastUpdated(ts || null);
    } catch {
      setLastUpdated(null);
    }
  }, [safeTable, isPlaceholder]);
  useEffect(() => { refreshLastUpdated(); }, [refreshLastUpdated, totalCount, importProgress]);

  const formatLastUpdated = (iso: string | null): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };


  // Search: when clicking a column suggestion, open filter dialog with that column
  const addSearchFilter = (col: string) => {
    setFilterCol(col);
    setFilterOp("contains");
    setFilterValue(searchValue.trim());
    setShowFilterDialog(true);
    setShowSearchDropdown(false);
  };

  // Confirm advanced filter (add or update)
  const confirmFilter = () => {
    if (!filterCol) return;
    const newFilter: SearchFilter = {
      column: filterCol,
      operator: filterOp,
      value: ["is_set", "is_not_set"].includes(filterOp) ? "" : filterValue.trim(),
    };
    if (editingFilterIdx !== null) {
      updateFilter(editingFilterIdx, newFilter);
      setEditingFilterIdx(null);
    } else {
      if (["is_set", "is_not_set"].includes(filterOp) || filterValue.trim()) {
        addFilter(newFilter);
      }
    }
    setShowFilterDialog(false);
    setFilterCol("");
    setFilterValue("");
  };

  // Open filter dialog to edit an existing chip
  const editFilter = (idx: number) => {
    const f = filters[idx];
    setFilterCol(f.column);
    setFilterOp(f.operator);
    setFilterValue(f.value);
    setEditingFilterIdx(idx);
    setShowFilterDialog(true);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (searchValue.trim()) {
        const col = keyColumns[0] || columns[0];
        setFilterCol(col);
        setFilterOp("contains");
        setFilterValue(searchValue.trim());
        setShowFilterDialog(true);
        setShowSearchDropdown(false);
      } else {
        setPage(0);
        fetchData();
      }
    } else if (e.key === "Escape") {
      setShowSearchDropdown(false);
    }
  };

  // Auto-search when filters change — debounced + race-guarded
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    if (isPlaceholder) return;
    const seq = ++fetchSeqRef.current;
    const t = setTimeout(() => {
      // Drop stale invocations
      if (seq !== fetchSeqRef.current) return;
      setPage(0);
      Promise.resolve(fetchData()).catch(err => {
        console.error("[DataControl] fetchData failed:", err);
        toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: err?.message || "ลองใหม่อีกครั้ง", variant: "destructive" });
      });
    }, 300);
    return () => clearTimeout(t);
  }, [filters]);

  // Continue import after margin confirmation (or directly if no warnings)
  const continuePoCostImport = async (
    mode: "insert" | "update",
    toUpsert: PoCostResolved[],
    skipped: PoCostSkipRow[],
  ) => {
    // In Update mode: detect rows that don't exist (item_id+vendor not in DB) and prompt user
    if (mode === "update" && toUpsert.length > 0) {
      setPoCostImportProgress({ current: 0, total: toUpsert.length, phase: "ตรวจสอบข้อมูลเดิม..." });
      const { existing, missing } = await splitExistingMissing(toUpsert);
      if (missing.length > 0) {
        setPoCostSkipped(skipped);
        setMissingPrompt({ existing, missing });
        return;
      }
    }
    await runApplyAndFinish(toUpsert, mode, skipped);
  };

  // PO Cost custom import (replaces default import for po_cost table)
  const handlePoCostImport = async (file: File, mode: "insert" | "update") => {
    setPoCostImportLoading(true);
    setPoCostImportProgress({ current: 0, total: 0, phase: "กำลังอ่านไฟล์..." });
    try {
      const rows = await parsePoCostFile(file);
      if (rows.length === 0) {
        toast({ title: "ไฟล์ว่างเปล่า", variant: "destructive" });
        return;
      }
      const rThbNum = parseFloat(rateTHB);
      const rUsdNum = parseFloat(rateUSD);
      const { toUpsert, skipped, marginWarnings, vendorMismatches, moqPackingWarnings } = await resolvePoCostImport(rows, (cur, total, phase) => {
        setPoCostImportProgress({ current: cur, total, phase });
      }, {
        rateTHB: Number.isFinite(rThbNum) && rThbNum > 0 ? rThbNum : null,
        rateUSD: Number.isFinite(rUsdNum) && rUsdNum > 0 ? rUsdNum : null,
      });

      // 1) Vendor Code mismatch (imported ≠ data_master) → ask user first
      if (vendorMismatches.length > 0) {
        setVendorMismatchPrompt({ mode, toUpsert, skipped, warnings: marginWarnings, mismatches: vendorMismatches, moqPackingWarnings });
        return;
      }

      // 2) MOQ=1 but Packing Size Qty > 1 → confirm
      if (moqPackingWarnings.length > 0) {
        setMoqPackingPrompt({ mode, toUpsert, skipped, warnings: marginWarnings, moqPackingWarnings });
        return;
      }

      // 3) Abnormal Margin% → ask user to confirm
      if (marginWarnings.length > 0) {
        setMarginPrompt({ mode, toUpsert, skipped, warnings: marginWarnings });
        return;
      }

      await continuePoCostImport(mode, toUpsert, skipped);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };

  // Margin warning actions.
  // Selection rule: if user picked rows → action targets only selected ones.
  // If selection is empty → action targets ALL warnings (legacy behavior).
  const getSelectedWarnings = () => {
    if (!marginPrompt) return [] as PoCostMarginWarning[];
    if (marginSelected.size === 0) return marginPrompt.warnings;
    return marginPrompt.warnings.filter((_, i) => marginSelected.has(i));
  };
  const confirmMarginUpsertAll = async () => {
    if (!marginPrompt) return;
    const { mode, toUpsert, skipped, warnings } = marginPrompt;
    // If user has a selection: only upsert selected warnings + non-warning rows.
    // Unselected warnings go to skip list.
    let finalUpsert = toUpsert;
    let finalSkip = skipped;
    if (marginSelected.size > 0) {
      const selectedKeys = new Set(
        warnings
          .filter((_, i) => marginSelected.has(i))
          .map(w => `${w.resolved.item_id}||${w.resolved.vendor}`)
      );
      const warnKeys = new Set(warnings.map(w => `${w.resolved.item_id}||${w.resolved.vendor}`));
      finalUpsert = toUpsert.filter(r => {
        const k = `${r.item_id}||${r.vendor}`;
        // keep if it's not a warning row, OR if it's selected
        return !warnKeys.has(k) || selectedKeys.has(k);
      });
      const unselectedWarn = warnings.filter((_, i) => !marginSelected.has(i));
      finalSkip = [...skipped, ...unselectedWarn.map(w => w.skip)];
    }
    setMarginPrompt(null);
    setMarginSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continuePoCostImport(mode, finalUpsert, finalSkip);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };
  const confirmMarginSkipWarnings = async () => {
    if (!marginPrompt) return;
    const { mode, toUpsert, skipped, warnings } = marginPrompt;
    const warnKeys = new Set(warnings.map(w => `${w.resolved.item_id}||${w.resolved.vendor}`));
    const filtered = toUpsert.filter(r => !warnKeys.has(`${r.item_id}||${r.vendor}`));
    const mergedSkip = [...skipped, ...warnings.map(w => w.skip)];
    setMarginPrompt(null);
    setMarginSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continuePoCostImport(mode, filtered, mergedSkip);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };

  // Vendor mismatch actions — same selection rule as margin warnings.
  // Selected = upsert with imported vendor; Unselected = move to skip list.
  const continueAfterMoqPacking = async (
    finalUpsert: PoCostResolved[],
    finalSkip: PoCostSkipRow[],
    warnings: PoCostMarginWarning[],
    mode: "insert" | "update",
  ) => {
    const upsertKeys = new Set(finalUpsert.map(r => `${r.item_id}||${r.vendor}`));
    const remainingWarn = warnings.filter(w => upsertKeys.has(`${w.resolved.item_id}||${w.resolved.vendor}`));
    if (remainingWarn.length > 0) {
      setMarginPrompt({ mode, toUpsert: finalUpsert, skipped: finalSkip, warnings: remainingWarn });
      return;
    }
    await continuePoCostImport(mode, finalUpsert, finalSkip);
  };
  const continueAfterVendorMismatch = async (
    finalUpsert: PoCostResolved[],
    finalSkip: PoCostSkipRow[],
    warnings: PoCostMarginWarning[],
    mode: "insert" | "update",
    moqPackingWarnings?: PoCostMoqPackingWarning[],
  ) => {
    const upsertKeys = new Set(finalUpsert.map(r => `${r.item_id}||${r.vendor}`));
    // MOQ=1 vs Packing>1 prompt next
    const remainingMoq = (moqPackingWarnings || []).filter(w => upsertKeys.has(`${w.resolved.item_id}||${w.resolved.vendor}`));
    if (remainingMoq.length > 0) {
      const remainingMargin = warnings.filter(w => upsertKeys.has(`${w.resolved.item_id}||${w.resolved.vendor}`));
      setMoqPackingPrompt({ mode, toUpsert: finalUpsert, skipped: finalSkip, warnings: remainingMargin, moqPackingWarnings: remainingMoq });
      return;
    }
    await continueAfterMoqPacking(finalUpsert, finalSkip, warnings, mode);
  };
  const confirmMoqPackingUpsert = async () => {
    if (!moqPackingPrompt) return;
    const { mode, toUpsert, skipped, warnings, moqPackingWarnings } = moqPackingPrompt;
    let finalUpsert = toUpsert;
    let finalSkip = skipped;
    if (moqPackingSelected.size > 0) {
      const selectedKeys = new Set(
        moqPackingWarnings.filter((_, i) => moqPackingSelected.has(i))
          .map(m => `${m.resolved.item_id}||${m.resolved.vendor}`)
      );
      const allKeys = new Set(moqPackingWarnings.map(m => `${m.resolved.item_id}||${m.resolved.vendor}`));
      finalUpsert = toUpsert.filter(r => {
        const k = `${r.item_id}||${r.vendor}`;
        return !allKeys.has(k) || selectedKeys.has(k);
      });
      const unsel = moqPackingWarnings.filter((_, i) => !moqPackingSelected.has(i));
      finalSkip = [...skipped, ...unsel.map(u => u.skip)];
    }
    setMoqPackingPrompt(null);
    setMoqPackingSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continueAfterMoqPacking(finalUpsert, finalSkip, warnings, mode);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };
  const confirmMoqPackingSkipAll = async () => {
    if (!moqPackingPrompt) return;
    const { mode, toUpsert, skipped, warnings, moqPackingWarnings } = moqPackingPrompt;
    const allKeys = new Set(moqPackingWarnings.map(m => `${m.resolved.item_id}||${m.resolved.vendor}`));
    const finalUpsert = toUpsert.filter(r => !allKeys.has(`${r.item_id}||${r.vendor}`));
    const finalSkip = [...skipped, ...moqPackingWarnings.map(m => m.skip)];
    setMoqPackingPrompt(null);
    setMoqPackingSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continueAfterMoqPacking(finalUpsert, finalSkip, warnings, mode);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };
  const confirmVendorMismatchUpsert = async () => {
    if (!vendorMismatchPrompt) return;
    const { mode, toUpsert, skipped, warnings, mismatches, moqPackingWarnings } = vendorMismatchPrompt;
    let finalUpsert = toUpsert;
    let finalSkip = skipped;
    if (vendorMismatchSelected.size > 0) {
      const selectedKeys = new Set(
        mismatches.filter((_, i) => vendorMismatchSelected.has(i))
          .map(m => `${m.resolved.item_id}||${m.resolved.vendor}`)
      );
      const allKeys = new Set(mismatches.map(m => `${m.resolved.item_id}||${m.resolved.vendor}`));
      finalUpsert = toUpsert.filter(r => {
        const k = `${r.item_id}||${r.vendor}`;
        return !allKeys.has(k) || selectedKeys.has(k);
      });
      const unsel = mismatches.filter((_, i) => !vendorMismatchSelected.has(i));
      finalSkip = [...skipped, ...unsel.map(u => u.skip)];
    }
    setVendorMismatchPrompt(null);
    setVendorMismatchSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continueAfterVendorMismatch(finalUpsert, finalSkip, warnings, mode, moqPackingWarnings);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };
  const confirmVendorMismatchSkipAll = async () => {
    if (!vendorMismatchPrompt) return;
    const { mode, toUpsert, skipped, warnings, mismatches, moqPackingWarnings } = vendorMismatchPrompt;
    const allKeys = new Set(mismatches.map(m => `${m.resolved.item_id}||${m.resolved.vendor}`));
    const finalUpsert = toUpsert.filter(r => !allKeys.has(`${r.item_id}||${r.vendor}`));
    const finalSkip = [...skipped, ...mismatches.map(m => m.skip)];
    setVendorMismatchPrompt(null);
    setVendorMismatchSelected(new Set());
    setPoCostImportLoading(true);
    try {
      await continueAfterVendorMismatch(finalUpsert, finalSkip, warnings, mode, moqPackingWarnings);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };

  // Apply upsert + show summary/skip dialog
  const runApplyAndFinish = async (
    toUpsert: PoCostResolved[],
    mode: "insert" | "update",
    skipped: PoCostSkipRow[],
  ) => {
    let summary = { inserted: 0, updated: 0 };
    if (toUpsert.length > 0) {
      summary = await applyPoCostImport(toUpsert, mode, (cur, total, phase) => {
        setPoCostImportProgress({ current: cur, total, phase });
      });
    }

    setPoCostImportSummary(summary);
    setPoCostSkipped(skipped);

    if (skipped.length > 0) {
      setShowPoCostSkipDialog(true);
    }

    toast({
      title: mode === "update" ? "อัปเดตสำเร็จ" : "นำเข้าสำเร็จ",
      description: `Insert: ${summary.inserted} · Update: ${summary.updated}${skipped.length > 0 ? ` · ข้าม: ${skipped.length}` : ""}`,
    });

    await fetchData();
    setPoFilterOptionsLoaded(false);

    // Ask user if they want to view the imported rows
    if (toUpsert.length > 0) {
      const ids = Array.from(new Set(toUpsert.map(r => String(r.item_id || "")).filter(Boolean)));
      if (ids.length > 0) setPostImportPrompt({ itemIds: ids, count: ids.length });
    }
  };

  const handleShowImportedData = async () => {
    if (!postImportPrompt) return;
    const ids = postImportPrompt.itemIds;
    setPostImportPrompt(null);
    setPoVendorFilter([]); setPoBarcodeFilter([]); setPoBarcodeUnitFilter([]);
    setPoGmBuyerFilter([]); setPoHeaderBuyerFilter([]); setPoBuyerFilter([]);
    setPoSkuFilter(ids.join("\n"));
    setMarginLoading(true);
    try {
      const { rows } = await loadAllPoCost(undefined, { sku: ids });
      setMarginRows(rows);
      toast({ title: `แสดง ${rows.length} แถว` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setMarginLoading(false);
    }
  };

  // User chose: Insert missing rows (existing → update, missing → insert)
  const confirmMissingInsert = async () => {
    if (!missingPrompt) return;
    setPoCostImportLoading(true);
    try {
      const all = [...missingPrompt.existing, ...missingPrompt.missing];
      // upsert with onConflict will update existing and insert missing
      await runApplyAndFinish(all, "update", poCostSkipped);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setMissingPrompt(null);
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };

  // User chose: Skip missing rows (only update existing, missing → skip list)
  const confirmMissingSkip = async () => {
    if (!missingPrompt) return;
    setPoCostImportLoading(true);
    try {
      const skipFromMissing = resolvedToSkipRows(
        missingPrompt.missing,
        "ไม่พบ SKU+Vendor ในข้อมูลเดิม (Update mode)",
      );
      const mergedSkip = [...poCostSkipped, ...skipFromMissing];
      await runApplyAndFinish(missingPrompt.existing, "update", mergedSkip);
    } catch (err: any) {
      toast({ title: "Import ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setMissingPrompt(null);
      setPoCostImportLoading(false);
      setPoCostImportProgress(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    // Custom flow for po_cost
    if (activeTable === "po_cost") {
      await handlePoCostImport(file, importMode);
      return;
    }

    try {
      const sheetList = await getSheets(file);
      if (sheetList.length > 1) {
        setPendingFile(file);
        setSheets(sheetList);
        setSelectedSheet(0);
        setSheetDialogOpen(true);
      } else {
        importData(file, importMode, 0);
      }
    } catch {
      importData(file, importMode, 0);
    }
  };

  const confirmSheetImport = () => {
    if (pendingFile) importData(pendingFile, importMode, selectedSheet);
    setSheetDialogOpen(false);
    setPendingFile(null);
  };

  const toggleColHighlight = (col: string) => {
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  // Row selection with Shift support
  const handleRowClick = (idx: number, id: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedRow !== null) {
      const start = Math.min(lastClickedRow, idx);
      const end = Math.max(lastClickedRow, idx);
      setSelectedRows(prev => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (data[i]) next.add(data[i].id);
        }
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedRows(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
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
    if (selectedRows.size === data.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(data.map(r => r.id)));
    }
  };

  // Paste from clipboard
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (selectedRows.size === 0) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const selectedIds = Array.from(selectedRows);
    await pasteToRows(selectedIds, text);
  }, [selectedRows, pasteToRows]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // Scroll active cell into view
  const scrollActiveCellIntoView = useCallback((row: number, col: number) => {
    if (!tableContainerRef.current) return;
    const container = tableContainerRef.current;
    // Find the target cell
    const rowEls = container.querySelectorAll("tbody tr");
    const targetRow = rowEls[row] as HTMLElement;
    if (!targetRow) return;
    const cells = targetRow.querySelectorAll("td");
    const targetCell = cells[col + 3] as HTMLElement; // +3 for checkbox, #, edit columns
    if (!targetCell) return;

    // Scroll horizontally
    const cellLeft = targetCell.offsetLeft;
    const cellRight = cellLeft + targetCell.offsetWidth;
    const containerLeft = container.scrollLeft;
    const containerRight = containerLeft + container.clientWidth;
    if (cellRight > containerRight) {
      container.scrollLeft = cellRight - container.clientWidth + 20;
    } else if (cellLeft < containerLeft) {
      container.scrollLeft = cellLeft - 20;
    }

    // Scroll vertically
    const rowTop = targetRow.offsetTop;
    const rowBottom = rowTop + targetRow.offsetHeight;
    const headerHeight = 36; // sticky header
    const visibleTop = container.scrollTop + headerHeight;
    const visibleBottom = container.scrollTop + container.clientHeight;
    if (rowBottom > visibleBottom) {
      container.scrollTop = rowBottom - container.clientHeight + 10;
    } else if (rowTop < visibleTop) {
      container.scrollTop = rowTop - headerHeight - 10;
    }
  }, []);

  // Keyboard navigation (Ctrl+Arrow, Enter, Tab, Escape)
  const handleTableKeyDown = useCallback((e: KeyboardEvent) => {
    if (!activeCell || data.length === 0) return;
    // Don't intercept when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const { row, col } = activeCell;

    if (e.ctrlKey || e.metaKey) {
      let newRow = row, newCol = col;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          newRow = data.length - 1;
          break;
        case "ArrowUp":
          e.preventDefault();
          newRow = 0;
          break;
        case "ArrowRight":
          e.preventDefault();
          newCol = displayColumns.length - 1;
          break;
        case "ArrowLeft":
          e.preventDefault();
          newCol = 0;
          break;
        case "a":
          e.preventDefault();
          setSelectedRows(new Set(data.map(r => r.id)));
          return;
        default:
          return;
      }
      setActiveCell({ row: newRow, col: newCol });
      requestAnimationFrame(() => scrollActiveCellIntoView(newRow, newCol));
      return;
    }

    let newRow = row, newCol = col;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (row < data.length - 1) {
          newRow = row + 1;
          if (e.shiftKey && data[newRow]) {
            setSelectedRows(prev => new Set([...prev, data[newRow].id]));
          }
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (row > 0) {
          newRow = row - 1;
          if (e.shiftKey && data[newRow]) {
            setSelectedRows(prev => new Set([...prev, data[newRow].id]));
          }
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (col < displayColumns.length - 1) newCol = col + 1;
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (col > 0) newCol = col - 1;
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          if (col > 0) newCol = col - 1;
          else if (row > 0) { newRow = row - 1; newCol = displayColumns.length - 1; }
        } else {
          if (col < displayColumns.length - 1) newCol = col + 1;
          else if (row < data.length - 1) { newRow = row + 1; newCol = 0; }
        }
        break;
      case "Escape":
        setActiveCell(null);
        setSelectedRows(new Set());
        return;
      case " ":
        e.preventDefault();
        if (data[row]) {
          setSelectedRows(prev => {
            const next = new Set(prev);
            const id = data[row].id;
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          });
        }
        return;
      default:
        return;
    }
    if (newRow !== row || newCol !== col) {
      setActiveCell({ row: newRow, col: newCol });
      requestAnimationFrame(() => scrollActiveCellIntoView(newRow, newCol));
    }
  }, [activeCell, data, displayColumns, scrollActiveCellIntoView]);

  useEffect(() => {
    document.addEventListener("keydown", handleTableKeyDown);
    return () => document.removeEventListener("keydown", handleTableKeyDown);
  }, [handleTableKeyDown]);

  // Column resize
  const onResizeStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    setResizing({ col, startX: e.clientX, startW: columnWidths[col] || 120 });
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

  const handleGroupBy = async () => {
    if (!groupCol) return;
    const result = await groupByColumn(groupCol, valueCol || columns[0], aggType === "distinct_count" ? "count" : aggType);
    setGroupResult(result);
  };

  const deleteSelected = async () => {
    if (selectedRows.size === 0) return;
    try {
      const ids = Array.from(selectedRows);
      const { error } = await (await import("@/integrations/supabase/client")).supabase
        .from(safeTable).delete().in("id", ids);
      if (error) throw error;
      setSelectedRows(new Set());
      fetchData();
    } catch (err: any) {
      console.error(err);
    }
  };

  // Column visibility helpers
  const toggleColumnVisible = (col: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };
  const selectAllColumns = () => setVisibleColumns(new Set(columns));
  const clearAllColumns = () => setVisibleColumns(new Set());

  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    const next = [...savedViews.filter(v => v.name !== name), { name, columns: Array.from(visibleColumns) }];
    persistViews(next);
    setNewViewName("");
    toast({ title: "บันทึก View สำเร็จ", description: name });
  };
  const loadView = (view: { name: string; columns: string[] }) => {
    // Only load columns that still exist in current table
    const valid = view.columns.filter(c => columns.includes(c));
    setVisibleColumns(new Set(valid));
    toast({ title: `โหลด View: ${view.name}` });
  };
  const deleteView = (name: string) => {
    persistViews(savedViews.filter(v => v.name !== name));
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  if (isPlaceholder) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Package className="w-16 h-16 mb-4 opacity-30" />
        <h2 className="text-lg font-semibold text-foreground">{tableConfig?.label || activeTable}</h2>
        <p className="text-sm mt-2">รอการออกแบบเพิ่มเติม</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in" tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">{tableConfig.label}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>{tableConfig.labelTh} · {totalCount.toLocaleString()} แถว</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80">
              <Clock className="w-3 h-3" />
              อัปเดตล่าสุด: {formatLastUpdated(lastUpdated)}
            </span>
            {selectedRows.size > 0 && <span>· เลือก {selectedRows.size} รายการ</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
          {activeTable === "po_cost" && (
            <>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">Rate THB:</span>
                <Input
                  type="number"
                  step="any"
                  value={rateEditing ? rateTHBDraft : rateTHB}
                  onChange={e => setRateTHBDraft(e.target.value)}
                  disabled={!rateEditing}
                  placeholder="0"
                  className="h-7 w-20 text-xs"
                />
                <span className="text-muted-foreground ml-1">USD:</span>
                <Input
                  type="number"
                  step="any"
                  value={rateEditing ? rateUSDDraft : rateUSD}
                  onChange={e => setRateUSDDraft(e.target.value)}
                  disabled={!rateEditing}
                  placeholder="0"
                  className="h-7 w-20 text-xs"
                />
                {rateEditing ? (
                  <>
                    <Button size="sm" className="h-7 text-xs" onClick={() => {
                      setRateTHB(rateTHBDraft);
                      setRateUSD(rateUSDDraft);
                      localStorage.setItem("po_cost_rate_thb", rateTHBDraft);
                      localStorage.setItem("po_cost_rate_usd", rateUSDDraft);
                      setRateEditing(false);
                      toast({ title: "บันทึก Rate สำเร็จ" });
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                      setRateTHBDraft(rateTHB); setRateUSDDraft(rateUSD); setRateEditing(false);
                    }}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                    setRateTHBDraft(rateTHB); setRateUSDDraft(rateUSD); setRateEditing(true);
                  }}>Edit</Button>
                )}
              </div>
              {canImport && (
                <Button size="sm" variant="outline" className="text-xs" onClick={downloadPoCostTemplate}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Template
                </Button>
              )}
            </>
          )}
          {(canImport || canEdit) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs" disabled={!!importProgress || poCostImportLoading}>
                  {(importProgress || poCostImportProgress) ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 mr-1" />
                  )}
                  {(() => {
                    const p = poCostImportProgress || importProgress;
                    if (!p) return "Import";
                    return `${p.phase}${p.total ? ` · ${p.current.toLocaleString()}/${p.total.toLocaleString()} (${Math.floor((p.current / Math.max(p.total, 1)) * 100)}%)` : ""}`;
                  })()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {canImport && activeTable !== "po_cost" && (
                  <DropdownMenuItem onClick={() => { setImportMode("insert"); fileInputRef.current?.click(); }}>
                    <Upload className="w-3.5 h-3.5 mr-2" /> Insert (เพิ่มข้อมูลใหม่)
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onClick={() => { setImportMode("update"); fileInputRef.current?.click(); }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-2" /> Update (อัปเดตข้อมูล)
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Column Visibility */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs">
                <Columns className="w-3.5 h-3.5 mr-1" /> Columns ({displayColumns.length}/{columns.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 max-h-[70vh] overflow-y-auto p-2" align="end">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold">Show/Hide Columns</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={selectAllColumns}>All</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={clearAllColumns}>None</Button>
                </div>
              </div>
              <div className="space-y-0.5 mb-3">
                {columns.map(col => (
                  <label key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                    <Checkbox
                      checked={visibleColumns.has(col)}
                      onCheckedChange={() => toggleColumnVisible(col)}
                      className="h-3.5 w-3.5"
                    />
                    {getColumnLabel(col, activeTable)}
                  </label>
                ))}
              </div>
              <div className="border-t pt-2 space-y-2">
                <span className="text-xs font-semibold px-1">Saved Views</span>
                {savedViews.map(v => (
                  <div key={v.name} className="flex items-center gap-1 px-1">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 justify-start" onClick={() => loadView(v)}>
                      <Eye className="w-3 h-3 mr-1" />{v.name}
                    </Button>
                    <button onClick={() => deleteView(v.name)} className="text-destructive hover:text-destructive/80"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <div className="flex items-center gap-1 px-1">
                  <Input
                    placeholder="View name..."
                    value={newViewName}
                    onChange={e => setNewViewName(e.target.value)}
                    className="h-6 text-[10px] flex-1"
                    onKeyDown={e => e.key === "Enter" && saveCurrentView()}
                  />
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={saveCurrentView} disabled={!newViewName.trim()}>
                    <Save className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {canExport && activeTable === "po_cost" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs">
                  <Download className="w-3.5 h-3.5 mr-1" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={handleExportPoCostAll}>
                  <Download className="w-3.5 h-3.5 mr-2" /> Export ทั้งหมด
                </DropdownMenuItem>
                {filters.length > 0 && (
                  <DropdownMenuItem onClick={handleExportPoCostByChips}>
                    <Filter className="w-3.5 h-3.5 mr-2" /> Export ตาม Filter ค้นหา ({totalCount.toLocaleString()})
                  </DropdownMenuItem>
                )}
                {marginRows !== null && (
                  <DropdownMenuItem onClick={handleExportPoCostFiltered}>
                    <Filter className="w-3.5 h-3.5 mr-2" /> Export ตาม Margin Filter ({marginRows.length})
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleExportPoCostSelected} disabled={selectedRows.size === 0}>
                  <CheckSquare className="w-3.5 h-3.5 mr-2" /> Export ที่เลือก ({selectedRows.size})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportTemplate}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2" /> Export Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs">
                  <Download className="w-3.5 h-3.5 mr-1" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => exportData()}>
                  <Download className="w-3.5 h-3.5 mr-2" /> Export ทั้งหมด
                </DropdownMenuItem>
                {(filters.length > 0 || searchValue) && (
                  <DropdownMenuItem onClick={exportByFilters}>
                    <Filter className="w-3.5 h-3.5 mr-2" /> Export ตาม Filter ({totalCount.toLocaleString()})
                  </DropdownMenuItem>
                )}
                {selectedRows.size > 0 && (
                  <DropdownMenuItem onClick={() => exportData(Array.from(selectedRows))}>
                    <CheckSquare className="w-3.5 h-3.5 mr-2" /> Export ที่เลือก ({selectedRows.size})
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={exportTemplate}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2" /> Export Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="outline" onClick={() => { setGroupCol(""); setValueCol(""); setAggType("count"); setGroupResult(null); setGroupDialogOpen(true); }} className="text-xs">
            <BarChart3 className="w-3.5 h-3.5 mr-1" /> Pivot
          </Button>
          {activeTable === "po_cost" ? (
            <>
              <Button size="sm" variant="outline" onClick={handlePoCostRead1} className="text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Read 1
              </Button>
              <Button size="sm" variant="outline" onClick={loadPoCostPhase2} disabled={phase2Loading || data.length === 0} className="text-xs">
                {phase2Loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />} Read 2
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={fetchData} className="text-xs">
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Read
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={clearUI} className="text-xs">
            <XCircle className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
          {canDelete && activeTable === "po_cost" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="destructive" className="text-xs">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {filters.length > 0 && (
                  <DropdownMenuItem onClick={handleDeletePoCostByChips} className="text-destructive">
                    <Filter className="w-3.5 h-3.5 mr-2" /> Delete ตาม Filter ค้นหา ({totalCount.toLocaleString()})
                  </DropdownMenuItem>
                )}
                {marginRows !== null && (
                  <DropdownMenuItem onClick={handleDeleteByMarginFilter}>
                    <Filter className="w-3.5 h-3.5 mr-2" /> Delete ตาม Margin Filter ({marginRows.length})
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleDeleteSelectedPoCost} disabled={selectedRows.size === 0}>
                  <CheckSquare className="w-3.5 h-3.5 mr-2" /> Delete ที่เลือก ({selectedRows.size})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDeletePagePoCost}>
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete หน้านี้ ({(marginRows ?? data).length})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={deleteAll} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete All
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {canDelete && selectedRows.size > 0 && (
                <Button size="sm" variant="destructive" onClick={deleteSelected} className="text-xs">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Selected ({selectedRows.size})
                </Button>
              )}
              {canDelete && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="destructive" className="text-xs">
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(filters.length > 0 || searchValue) && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm(`ลบ ${totalCount.toLocaleString()} แถวตาม Filter ที่ใช้งานอยู่?`)) deleteByFilters();
                        }}
                        className="text-destructive"
                      >
                        <Filter className="w-3.5 h-3.5 mr-2" /> Delete ตาม Filter ({totalCount.toLocaleString()})
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        if (confirm(`ลบข้อมูลทั้งหมดในตารางนี้?`)) deleteAll();
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete All
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </div>

      {/* PO Cost: Tabs (Data / Report) + Margin% filter */}
      {activeTable === "po_cost" && (
        <div className="flex flex-col gap-2 px-6 pt-2 pb-2 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={poCostView === "data" ? "default" : "outline"}
              className="text-xs h-7"
              onClick={() => setPoCostView("data")}
            >Data</Button>
            <Button
              size="sm"
              variant={poCostView === "report" ? "default" : "outline"}
              className="text-xs h-7"
              onClick={() => setPoCostView("report")}
            >Report</Button>
          </div>
          {poCostView === "data" && (() => {
            const NUMERIC_COLS = new Set([
              "moq","po_cost_unit","po_cost",
              "__cost_lak","__price","__margin_amt","__margin_pct",
              "__jmart_price","__jmart_margin_amt","__jmart_margin_pct",
              "__diff_price","__diff_pct",
            ]);
            const isNum = NUMERIC_COLS.has(filterColPo);
            const colOptions = displayColumns; // all columns currently visible (DB + synthetic)
            return (
              <div className="flex flex-col gap-1.5">
                {/* Dropdown filter row (server-side WHERE) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground w-12">เลือก:</span>
                  <MultiSelectFilter
                    label="Vendor"
                    options={poVendorOptions}
                    selected={poVendorFilter}
                    onChange={setPoVendorFilter}
                    renderOption={(code) => poVendorLabelMap.get(code) || code}
                    width="w-96"
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <MultiSelectFilter
                    label="Main Barcode"
                    options={poBarcodeOptions}
                    selected={poBarcodeFilter}
                    onChange={setPoBarcodeFilter}
                    renderOption={(v) => poBarcodeLabelMap.get(v) || v}
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <MultiSelectFilter
                    label="Main Barcode (Unit)"
                    options={poBarcodeUnitOptions}
                    selected={poBarcodeUnitFilter}
                    onChange={setPoBarcodeUnitFilter}
                    renderOption={(v) => poBarcodeUnitLabelMap.get(v) || v}
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <MultiSelectFilter
                    label="GM Buyer"
                    options={poGmBuyerOptions}
                    selected={poGmBuyerFilter}
                    onChange={setPoGmBuyerFilter}
                    renderOption={(v) => poGmBuyerLabelMap.get(v) || v}
                    width="w-56"
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <MultiSelectFilter
                    label="Header Buyer"
                    options={poHeaderBuyerOptions}
                    selected={poHeaderBuyerFilter}
                    onChange={setPoHeaderBuyerFilter}
                    renderOption={(v) => poHeaderBuyerLabelMap.get(v) || v}
                    width="w-56"
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <MultiSelectFilter
                    label="Buyer"
                    options={poBuyerOptions}
                    selected={poBuyerFilter}
                    onChange={setPoBuyerFilter}
                    renderOption={(v) => poBuyerLabelMap.get(v) || v}
                    width="w-56"
                    emptyHint={poFilterOptionsLoaded ? "ไม่มีข้อมูล" : "กำลังโหลด..."}
                  />
                  <Input
                    placeholder="SKU Code (comma/newline)"
                    value={poSkuFilter}
                    onChange={e => setPoSkuFilter(e.target.value)}
                    className="h-7 text-xs w-56"
                  />
                  <Button size="sm" className="text-xs h-7" onClick={handleShowMarginFilter} disabled={marginLoading || !hasAnyPoFilter} title={!hasAnyPoFilter ? "กรุณาเลือก Filter ก่อน" : ""}>
                    {marginLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Filter className="w-3 h-3 mr-1" />}
                    ดึงข้อมูล
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={reloadPoFilterOptions} title="รีเฟรชรายการใน Dropdown">
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                  {(poVendorFilter.length + poBarcodeFilter.length + poBarcodeUnitFilter.length + poGmBuyerFilter.length + poHeaderBuyerFilter.length + poBuyerFilter.length + parseSkuList(poSkuFilter).length) > 0 && (
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => {
                      setPoVendorFilter([]); setPoBarcodeFilter([]); setPoBarcodeUnitFilter([]);
                      setPoGmBuyerFilter([]); setPoHeaderBuyerFilter([]); setPoBuyerFilter([]);
                      setPoSkuFilter("");
                    }}>
                      <X className="w-3 h-3 mr-1" /> Clear ตัวกรอง
                    </Button>
                  )}
                </div>
                {/* Filter row 1 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground w-12">Filter:</span>
                  <select className="h-7 text-xs border rounded px-2 bg-background max-w-[220px]"
                    value={filterColPo} onChange={e => { setFilterColPo(e.target.value); setMarginOp(""); setMarginV1(""); setMarginV2(""); }}>
                    {colOptions.map(c => (
                      <option key={c} value={c}>
                        {c.startsWith("__") ? SYNTHETIC_LABELS[c] : getColumnLabel(c, "po_cost")}
                      </option>
                    ))}
                  </select>
                  <select className="h-7 text-xs border rounded px-2 bg-background"
                    value={marginOp} onChange={e => setMarginOp(e.target.value as MarginOp)}>
                    <option value="">— เลือกเงื่อนไข —</option>
                    {isNum ? (
                      <>
                        <option value=">">{'มากกว่า (>)'}</option>
                        <option value="<">{'น้อยกว่า (<)'}</option>
                        <option value="=">เท่ากับ (=)</option>
                        <option value=">=">{'>='}</option>
                        <option value="<=">{'<='}</option>
                        <option value="between">ระหว่าง</option>
                      </>
                    ) : (
                      <>
                        <option value="contains">contains</option>
                        <option value="=">=</option>
                        <option value="starts_with">starts with</option>
                        <option value="ends_with">ends with</option>
                      </>
                    )}
                    <option value="is_set">is set</option>
                    <option value="is_not_set">is not set</option>
                  </select>
                  {!["is_set","is_not_set",""].includes(marginOp) && (
                    <Input type={isNum ? "number" : "text"} step="any" placeholder={isNum ? "ค่า" : "ค้นหา..."} className="h-7 w-32 text-xs"
                      value={marginV1} onChange={e => setMarginV1(e.target.value)} />
                  )}
                  {marginOp === "between" && (
                    <>
                      <span className="text-xs text-muted-foreground">ถึง</span>
                      <Input type="number" step="any" placeholder="ค่า" className="h-7 w-24 text-xs"
                        value={marginV2} onChange={e => setMarginV2(e.target.value)} />
                    </>
                  )}
                </div>
                {/* Logic + Filter row 2 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <select className="h-7 text-xs border rounded px-2 bg-background w-12 font-semibold"
                    value={filterLogic} onChange={e => setFilterLogic(e.target.value as "AND" | "OR")}>
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                  {(() => {
                    const isNum2 = NUMERIC_COLS.has(filterColPo2);
                    return (
                      <>
                        <select className="h-7 text-xs border rounded px-2 bg-background max-w-[220px]"
                          value={filterColPo2} onChange={e => { setFilterColPo2(e.target.value); setMarginOp2(""); setMarginV12(""); setMarginV22(""); }}>
                          {colOptions.map(c => (
                            <option key={c} value={c}>
                              {c.startsWith("__") ? SYNTHETIC_LABELS[c] : getColumnLabel(c, "po_cost")}
                            </option>
                          ))}
                        </select>
                        <select className="h-7 text-xs border rounded px-2 bg-background"
                          value={marginOp2} onChange={e => setMarginOp2(e.target.value as MarginOp)}>
                          <option value="">— เลือกเงื่อนไข —</option>
                          {isNum2 ? (
                            <>
                              <option value=">">{'มากกว่า (>)'}</option>
                              <option value="<">{'น้อยกว่า (<)'}</option>
                              <option value="=">เท่ากับ (=)</option>
                              <option value=">=">{'>='}</option>
                              <option value="<=">{'<='}</option>
                              <option value="between">ระหว่าง</option>
                            </>
                          ) : (
                            <>
                              <option value="contains">contains</option>
                              <option value="=">=</option>
                              <option value="starts_with">starts with</option>
                              <option value="ends_with">ends with</option>
                            </>
                          )}
                          <option value="is_set">is set</option>
                          <option value="is_not_set">is not set</option>
                        </select>
                        {!["is_set","is_not_set",""].includes(marginOp2) && (
                          <Input type={isNum2 ? "number" : "text"} step="any" placeholder={isNum2 ? "ค่า" : "ค้นหา..."} className="h-7 w-32 text-xs"
                            value={marginV12} onChange={e => setMarginV12(e.target.value)} />
                        )}
                        {marginOp2 === "between" && (
                          <>
                            <span className="text-xs text-muted-foreground">ถึง</span>
                            <Input type="number" step="any" placeholder="ค่า" className="h-7 w-24 text-xs"
                              value={marginV22} onChange={e => setMarginV22(e.target.value)} />
                          </>
                        )}
                      </>
                    );
                  })()}
                  <Button size="sm" className="text-xs h-7" onClick={handleShowMarginFilter} disabled={marginLoading || !hasAnyPoFilter} title={!hasAnyPoFilter ? "กรุณาเลือก Filter ก่อน" : ""}>
                    {marginLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    {marginLoading && poLoadProgress
                      ? `${poLoadProgress.phase}${poLoadProgress.total ? ` ${poLoadProgress.current.toLocaleString()}/${poLoadProgress.total.toLocaleString()}` : ""}`
                      : "Show"}
                  </Button>
                  {marginRows !== null && (
                    <>
                      <Badge variant="secondary" className="text-xs">กรองแล้ว {marginRows.length} แถว</Badge>
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={clearMarginFilter}>
                        <X className="w-3 h-3 mr-1" /> Clear filter
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Odoo-style Search Bar */}
      <div className="flex items-center gap-2 px-6 py-2.5 bg-card border-b border-border flex-wrap">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {/* Active filter chips */}
        {filters.map((f, i) => (
          <Badge key={i} variant="secondary" className="text-xs gap-1 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-secondary/80" onClick={() => editFilter(i)}>
            <span className="font-medium">{getColumnLabel(f.column, activeTable)}</span>
            <span className="text-muted-foreground">{OPERATOR_LABELS[f.operator]}</span>
            {f.value && <span className="font-semibold">{f.value}</span>}
            <Pencil className="w-2.5 h-2.5 text-muted-foreground ml-0.5" />
            <button onClick={(e) => { e.stopPropagation(); removeFilter(i); }} className="ml-0.5 hover:bg-destructive/20 rounded p-0.5">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {/* Search input with dropdown */}
        <div className="relative flex-1 min-w-[200px]">
          <Input
            ref={searchInputRef}
            className="h-8 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
            placeholder="พิมพ์เพื่อค้นหา..."
            value={searchValue}
            onChange={e => { setSearchValue(e.target.value); setShowSearchDropdown(true); }}
            onFocus={() => setShowSearchDropdown(true)}
            onKeyDown={handleSearchKeyDown}
          />
          {/* Dropdown suggestions */}
          {showSearchDropdown && searchValue.trim() && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg w-80 max-h-80 overflow-y-auto">
              {keyColumns.map(col => (
                <button
                  key={col}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-primary/10 text-left transition-colors"
                  onClick={() => addSearchFilter(col)}
                >
                  <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span>Search <span className="font-semibold text-primary">{getColumnLabel(col, activeTable)}</span> for: <span className="font-mono text-xs">{searchValue}</span></span>
                </button>
              ))}
              <div className="border-t border-border" />
              {columns.filter(c => !keyColumns.includes(c)).slice(0, 10).map(col => (
                <button
                  key={col}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted text-left transition-colors"
                  onClick={() => addSearchFilter(col)}
                >
                  <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span>Search <span className="font-medium">{getColumnLabel(col, activeTable)}</span> for: <span className="font-mono text-xs">{searchValue}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
        {filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => { clearFilters(); fetchData(); }} className="text-xs h-7">
            <X className="w-3 h-3 mr-1" /> Clear All
          </Button>
        )}
      </div>

      {/* PO Cost Report view */}
      {activeTable === "po_cost" && poCostView === "report" ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border rounded p-2 bg-card">
                <div className="text-xs font-semibold mb-1 text-muted-foreground">เงื่อนไขคอลัมน์ {i + 1}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  <select className="h-7 text-xs border rounded px-1 bg-background"
                    value={reportConds[i].op}
                    onChange={e => setReportConds(prev => prev.map((c, j) => j === i ? { ...c, op: e.target.value as MarginOp } : c))}>
                    <option value="">—</option>
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="=">=</option>
                    <option value=">=">{'>='}</option>
                    <option value="<=">{'<='}</option>
                    <option value="between">between</option>
                  </select>
                  <Input type="number" step="any" placeholder="%" className="h-7 w-20 text-xs"
                    value={reportConds[i].v1}
                    onChange={e => setReportConds(prev => prev.map((c, j) => j === i ? { ...c, v1: e.target.value } : c))} />
                  {reportConds[i].op === "between" && (
                    <Input type="number" step="any" placeholder="ถึง" className="h-7 w-20 text-xs"
                      value={reportConds[i].v2}
                      onChange={e => setReportConds(prev => prev.map((c, j) => j === i ? { ...c, v2: e.target.value } : c))} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" onClick={handleShowReport} disabled={reportLoading} className="text-xs h-7">
              {reportLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              {reportLoading && poLoadProgress
                ? `${poLoadProgress.phase}${poLoadProgress.total ? ` ${poLoadProgress.current.toLocaleString()}/${poLoadProgress.total.toLocaleString()}` : ""}`
                : "Show"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setReportRows(null)}>Clear</Button>
            {reportRows && (
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                const rows = reportRows.map(r => ({
                  "Vendor Code": r.vendor_code,
                  "Vendor Name": r.vendor_name,
                  "จำนวนรายการ": r.total,
                  [`2KM Col 1 (${reportConds[0].op}${reportConds[0].v1}${reportConds[0].op==="between"?"-"+reportConds[0].v2:""})`]: r.c0,
                  [`2KM Col 2 (${reportConds[1].op}${reportConds[1].v1}${reportConds[1].op==="between"?"-"+reportConds[1].v2:""})`]: r.c1,
                  [`2KM Col 3 (${reportConds[2].op}${reportConds[2].v1}${reportConds[2].op==="between"?"-"+reportConds[2].v2:""})`]: r.c2,
                  [`Jmart Col 1 (${reportConds[0].op}${reportConds[0].v1}${reportConds[0].op==="between"?"-"+reportConds[0].v2:""})`]: r.c0j,
                  [`Jmart Col 2 (${reportConds[1].op}${reportConds[1].v1}${reportConds[1].op==="between"?"-"+reportConds[1].v2:""})`]: r.c1j,
                  [`Jmart Col 3 (${reportConds[2].op}${reportConds[2].v1}${reportConds[2].op==="between"?"-"+reportConds[2].v2:""})`]: r.c2j,
                }));
                import("xlsx").then(XLSX => {
                  const ws = XLSX.utils.json_to_sheet(rows);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Report");
                  XLSX.writeFile(wb, "po_cost_report.xlsx");
                });
              }}>
                <Download className="w-3 h-3 mr-1" /> Export
              </Button>
            )}
            {reportRows && <Badge variant="secondary" className="text-xs">{reportRows.length} vendors</Badge>}
          </div>
          {reportRows && (
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="w-8 px-2 py-2 border-b"></th>
                    <th className="text-left px-3 py-2 border-b">Vendor Code</th>
                    <th className="text-left px-3 py-2 border-b">Vendor Name</th>
                    <th className="text-right px-3 py-2 border-b">จำนวนรายการ</th>
                    <th className="text-right px-3 py-2 border-b bg-amber-50 dark:bg-amber-950/30">
                      2KM Col 1 ({reportConds[0].op}{reportConds[0].v1}{reportConds[0].op === "between" ? "-" + reportConds[0].v2 : ""}%)
                    </th>
                    <th className="text-right px-3 py-2 border-b bg-amber-50 dark:bg-amber-950/30">
                      2KM Col 2 ({reportConds[1].op}{reportConds[1].v1}{reportConds[1].op === "between" ? "-" + reportConds[1].v2 : ""}%)
                    </th>
                    <th className="text-right px-3 py-2 border-b bg-amber-50 dark:bg-amber-950/30">
                      2KM Col 3 ({reportConds[2].op}{reportConds[2].v1}{reportConds[2].op === "between" ? "-" + reportConds[2].v2 : ""}%)
                    </th>
                    <th className="text-right px-3 py-2 border-b bg-sky-50 dark:bg-sky-950/30">
                      Jmart Col 1 ({reportConds[0].op}{reportConds[0].v1}{reportConds[0].op === "between" ? "-" + reportConds[0].v2 : ""}%)
                    </th>
                    <th className="text-right px-3 py-2 border-b bg-sky-50 dark:bg-sky-950/30">
                      Jmart Col 2 ({reportConds[1].op}{reportConds[1].v1}{reportConds[1].op === "between" ? "-" + reportConds[1].v2 : ""}%)
                    </th>
                    <th className="text-right px-3 py-2 border-b bg-sky-50 dark:bg-sky-950/30">
                      Jmart Col 3 ({reportConds[2].op}{reportConds[2].v1}{reportConds[2].op === "between" ? "-" + reportConds[2].v2 : ""}%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((r, i) => {
                    const open = expandedVendors.has(r.vendor_code);
                    return (
                    <React.Fragment key={r.vendor_code}>
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="px-2 py-1.5 text-center">
                          <button
                            className="hover:bg-muted rounded p-0.5"
                            onClick={() => setExpandedVendors(prev => {
                              const next = new Set(prev);
                              if (next.has(r.vendor_code)) next.delete(r.vendor_code); else next.add(r.vendor_code);
                              return next;
                            })}
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform ${open ? "" : "-rotate-90"}`} />
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-mono">{r.vendor_code}</td>
                        <td className="px-3 py-1.5">{r.vendor_name}</td>
                        <td className="px-3 py-1.5 text-right">{r.total.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-amber-50/50 dark:bg-amber-950/20">{r.c0.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-amber-50/50 dark:bg-amber-950/20">{r.c1.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-amber-50/50 dark:bg-amber-950/20">{r.c2.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-sky-50/50 dark:bg-sky-950/20">{r.c0j.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-sky-50/50 dark:bg-sky-950/20">{r.c1j.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-right bg-sky-50/50 dark:bg-sky-950/20">{r.c2j.toLocaleString()}</td>
                      </tr>
                      {open && (
                        <tr key={`${i}-d`} className="bg-muted/20">
                          <td></td>
                          <td colSpan={9} className="p-2">
                            <div className="border rounded bg-background overflow-auto max-h-96">
                              <table className="w-full text-[11px] border-collapse">
                                <thead className="bg-muted/60 sticky top-0">
                                  <tr>
                                    <th className="text-left px-2 py-1 border-b">Item ID</th>
                                    <th className="text-left px-2 py-1 border-b">Goodcode</th>
                                    <th className="text-left px-2 py-1 border-b">Product Name</th>
                                    <th className="text-right px-2 py-1 border-b">PO Cost Unit</th>
                                    <th className="text-left px-2 py-1 border-b">Currency</th>
                                    <th className="text-right px-2 py-1 border-b">Cost (Lak)</th>
                                    <th className="text-right px-2 py-1 border-b bg-amber-50 dark:bg-amber-950/30">2KM Price</th>
                                    <th className="text-right px-2 py-1 border-b bg-amber-50 dark:bg-amber-950/30">2KM Margin Amt</th>
                                    <th className="text-right px-2 py-1 border-b bg-amber-50 dark:bg-amber-950/30">2KM Margin %</th>
                                    <th className="text-right px-2 py-1 border-b bg-sky-50 dark:bg-sky-950/30">Jmart Price</th>
                                    <th className="text-right px-2 py-1 border-b bg-sky-50 dark:bg-sky-950/30">Jmart Margin Amt</th>
                                    <th className="text-right px-2 py-1 border-b bg-sky-50 dark:bg-sky-950/30">Jmart Margin %</th>
                                    <th className="text-right px-2 py-1 border-b">Diff Price</th>
                                    <th className="text-right px-2 py-1 border-b">% Diff</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.items.map((it: any, k: number) => (
                                    <tr key={k} className="border-b hover:bg-muted/30">
                                      <td className="px-2 py-1 font-mono">{it.item_id}</td>
                                      <td className="px-2 py-1 font-mono">{it.goodcode}</td>
                                      <td className="px-2 py-1">{it.product_name}</td>
                                      <td className="px-2 py-1 text-right">{it.po_cost_unit != null ? Number(it.po_cost_unit).toLocaleString() : ""}</td>
                                      <td className="px-2 py-1">{it.currency}</td>
                                      <td className="px-2 py-1 text-right">{it.costLak != null ? Number(it.costLak).toLocaleString(undefined,{maximumFractionDigits:2}) : ""}</td>
                                      <td className="px-2 py-1 text-right bg-amber-50/40 dark:bg-amber-950/20">{it.price != null ? Number(it.price).toLocaleString() : ""}</td>
                                      <td className="px-2 py-1 text-right bg-amber-50/40 dark:bg-amber-950/20">{it.marginAmt != null ? Number(it.marginAmt).toLocaleString(undefined,{maximumFractionDigits:2}) : ""}</td>
                                      <td className="px-2 py-1 text-right bg-amber-50/40 dark:bg-amber-950/20">{it.marginPct != null ? Number(it.marginPct).toFixed(2) + "%" : ""}</td>
                                      <td className="px-2 py-1 text-right bg-sky-50/40 dark:bg-sky-950/20">{it.jmartPrice != null ? Number(it.jmartPrice).toLocaleString() : ""}</td>
                                      <td className="px-2 py-1 text-right bg-sky-50/40 dark:bg-sky-950/20">{it.jmartMarginAmt != null ? Number(it.jmartMarginAmt).toLocaleString(undefined,{maximumFractionDigits:2}) : ""}</td>
                                      <td className="px-2 py-1 text-right bg-sky-50/40 dark:bg-sky-950/20">{it.jmartMarginPct != null ? Number(it.jmartMarginPct).toFixed(2) + "%" : ""}</td>
                                      <td className="px-2 py-1 text-right">{it.diffPrice != null ? Number(it.diffPrice).toLocaleString(undefined,{maximumFractionDigits:2}) : ""}</td>
                                      <td className="px-2 py-1 text-right">{it.diffPct != null ? Number(it.diffPct).toFixed(2) + "%" : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
      /* Table */
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto"
        onClick={() => showSearchDropdown && setShowSearchDropdown(false)}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">กำลังโหลด...</span>
          </div>
        ) : (() => {
          const base = activeTable === "po_cost" ? (marginRows ?? []) : data;
          const filtered = filterByDivision(base);
          return filtered.length === 0;
        })() ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            {activeTable === "po_cost" && marginRows === null ? (
              <>
                <p className="text-sm">กรุณาเลือก Filter แล้วกด ดึงข้อมูล</p>
                <p className="text-xs mt-1">เลือก Vendor / Barcode / Buyer ฯลฯ ด้านบน แล้วกดปุ่ม "ดึงข้อมูล"</p>
              </>
            ) : (
              <>
                <p className="text-sm">ยังไม่มีข้อมูล</p>
                <p className="text-xs mt-1">กด Import เพื่อนำเข้าข้อมูลจากไฟล์ Excel</p>
              </>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-table-header bg-muted" style={{ width: 40, minWidth: 40 }}>
                  <Checkbox checked={selectedRows.size === data.length && data.length > 0} onCheckedChange={toggleSelectAll} className="mx-auto" />
                </th>
                <th className="data-table-header bg-muted" style={{ width: 48, minWidth: 48 }}>#</th>
                {activeTable !== "po_cost" && (
                  <th className="data-table-header bg-muted" style={{ width: 56, minWidth: 56 }}>Edit</th>
                )}
                {displayColumns.map((col, colIdx) => {
                  const isSynthetic = col.startsWith("__");
                  const label = isSynthetic ? SYNTHETIC_LABELS[col] : getColumnLabel(col, activeTable);
                  return (
                    <th
                      key={col}
                      className={cn(
                        "data-table-header relative group select-none",
                        !isSynthetic && "cursor-pointer",
                        selectedCols.has(col) && "bg-emerald-100 dark:bg-emerald-900/40",
                        isSynthetic && "bg-amber-50 dark:bg-amber-950/30"
                      )}
                      style={{ width: columnWidths[col] || 120, minWidth: 60 }}
                      onClick={() => !isSynthetic && toggleColHighlight(col)}
                    >
                      {label}
                      {!isSynthetic && (
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/30 group-hover:bg-primary/10"
                          onMouseDown={e => { e.stopPropagation(); onResizeStart(col, e); }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filterByDivision(activeTable === "po_cost" && marginRows ? marginRows : data).map((row, idx) => {
                const isSelected = selectedRows.has(row.id);
                const isActiveRow = activeCell?.row === idx;
                return (
                  <tr
                    key={row.id || idx}
                    className={cn(
                      "border-b border-border transition-colors",
                      isSelected
                        ? "bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                        : isActiveRow
                          ? "bg-blue-50/50 dark:bg-blue-950/20"
                          : "hover:bg-muted/50"
                    )}
                    onClick={(e) => handleRowClick(idx, row.id, e)}
                  >
                    <td className="data-table-cell text-center bg-inherit" style={{ width: 40, minWidth: 40 }} onClick={e => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => handleRowClick(idx, row.id, { shiftKey: false, ctrlKey: false, metaKey: false } as any)} />
                    </td>
                    <td className="data-table-cell text-muted-foreground text-center bg-inherit" style={{ width: 48, minWidth: 48 }}>{page * pageSize + idx + 1}</td>
                    {activeTable !== "po_cost" && (
                      <td className="data-table-cell text-center bg-inherit" style={{ width: 56, minWidth: 56 }} onClick={e => e.stopPropagation()}>
                        {editingRow === row.id ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={saveEditing} className="text-green-600 hover:text-green-800"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={cancelEditing} className="text-red-500 hover:text-red-700"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (canEdit && (!divisionEnforced || divisionAllowed(getRowDivision(row), "edit"))) ? (
                          <button onClick={() => startEditing(row.id)} className="text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                        ) : null}
                      </td>
                    )}
                    {displayColumns.map((col, colIdx) => {
                      const isCellActive = activeCell?.row === idx && activeCell?.col === colIdx;
                      const isSynthetic = col.startsWith("__");
                      let displayValue = "";
                      const isSyntheticMetric = isSynthetic;
                      const metrics = isSyntheticMetric
                        ? computeWithMaps(row, vendorCurrencyMap, priceMap, jmartPriceMap)
                        : null;
                      if (isSynthetic) {
                        displayValue = getSyntheticValue(row, col, metrics);
                      } else {
                        displayValue = String(row[col] ?? "");
                        if (activeTable === "po_cost" && col === "vendor" && row[col]) {
                          displayValue = vendorDisplayMap.get(String(row[col])) || String(row[col]);
                        }
                        if (activeTable === "po_cost" && col === "product_name") {
                          const e = extrasMap.get(String(row.item_id || ""));
                          if (e?.product_name_la) displayValue = e.product_name_la;
                        }
                      }
                      const refPct = (col === "__margin_amt" || col === "__margin_pct") ? metrics?.marginPct
                        : (col === "__jmart_margin_amt" || col === "__jmart_margin_pct") ? metrics?.jmartMarginPct
                        : null;
                      const refAmt = (col === "__margin_amt") ? metrics?.marginAmt
                        : (col === "__jmart_margin_amt") ? metrics?.jmartMarginAmt
                        : null;
                      const isNegative = (refPct != null && refPct <= 0) || (refAmt != null && refAmt < 0);
                      const marginColorClass = isNegative
                        ? "text-red-600 dark:text-red-400"
                        : (refPct != null && refPct < 1 ? "text-orange-500 dark:text-orange-400" : "");
                      return (
                        <td
                          key={col}
                          className={cn(
                            "data-table-cell",
                            selectedCols.has(col) && "bg-emerald-50/50 dark:bg-emerald-950/20",
                            isCellActive && "ring-2 ring-primary ring-inset",
                            isSynthetic && "bg-amber-50/40 dark:bg-amber-950/20 font-medium",
                            isSynthetic && ["__cost_lak","__price","__margin_amt","__margin_pct","__jmart_price","__jmart_margin_amt","__jmart_margin_pct","__diff_price","__diff_pct"].includes(col) && "text-right",
                            marginColorClass
                          )}
                          style={{ width: columnWidths[col] || 120, maxWidth: columnWidths[col] || 250 }}
                          title={displayValue}
                          onClick={(e) => { e.stopPropagation(); setActiveCell({ row: idx, col: colIdx }); handleRowClick(idx, row.id, e); }}
                        >
                          {editingRow === row.id && !isSynthetic ? (
                            <Input className="h-6 text-xs px-1 py-0 border-primary/50" value={editedData[col] ?? ""} onChange={e => updateEditedField(col, e.target.value)} />
                          ) : (
                            <span className="truncate block">{displayValue}</span>
                          )}
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
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-2.5 border-t border-border bg-card">
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {totalPages > 0 ? `หน้า ${page + 1} / ${totalPages}` : ""} ({totalCount.toLocaleString()} แถว)
          </span>
          <span className="text-[10px] text-muted-foreground/60 hidden md:inline">
            Shift+Click: เลือกช่วง · Ctrl+A: เลือกทั้งหมด · Arrow: เลื่อน · Ctrl+Arrow: ข้ามไปสุด · Space: เลือก/ยกเลิก
          </span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="h-7 w-7 p-0">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Custom Filter Dialog */}
      <Dialog open={showFilterDialog} onOpenChange={(open) => { setShowFilterDialog(open); if (!open) setEditingFilterIdx(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingFilterIdx !== null ? "Edit Condition" : "Modify Condition"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Column</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-background" value={filterCol} onChange={e => setFilterCol(e.target.value)}>
                <option value="">เลือกคอลัมน์...</option>
                {columns.map(c => <option key={c} value={c}>{getColumnLabel(c, activeTable)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Condition</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_OPERATORS.map(op => (
                  <Button
                    key={op}
                    size="sm"
                    variant={filterOp === op ? "default" : "outline"}
                    className="text-xs h-7 px-3"
                    onClick={() => setFilterOp(op)}
                  >
                    {OPERATOR_LABELS[op]}
                  </Button>
                ))}
              </div>
            </div>
            {!["is_set", "is_not_set"].includes(filterOp) && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Value</label>
                <Input value={filterValue} onChange={e => setFilterValue(e.target.value)} placeholder="ค่าที่ต้องการ..." onKeyDown={e => e.key === "Enter" && confirmFilter()} autoFocus />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFilterDialog(false)}>Discard</Button>
            <Button onClick={confirmFilter} disabled={!filterCol}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet Selector Dialog */}
      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เลือก Sheet ที่ต้องการ Import</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {sheets.map(s => (
              <label key={s.index} className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors",
                selectedSheet === s.index ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
              )}>
                <input type="radio" checked={selectedSheet === s.index} onChange={() => setSelectedSheet(s.index)} className="accent-primary" />
                <span className="text-sm font-medium">{s.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSheetDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={confirmSheetImport}>Import Sheet นี้</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pivot Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pivot Table</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">📊 Row (Group By)</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-background" value={groupCol} onChange={e => setGroupCol(e.target.value)}>
                <option value="">เลือกคอลัมน์...</option>
                {displayColumns.map(c => <option key={c} value={c}>{getColumnLabel(c, activeTable)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">📈 Value</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-background" value={valueCol} onChange={e => setValueCol(e.target.value)}>
                <option value="">เลือกคอลัมน์...</option>
                {displayColumns.map(c => <option key={c} value={c}>{getColumnLabel(c, activeTable)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">🔢 Aggregation</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-background" value={aggType} onChange={e => setAggType(e.target.value as any)}>
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="distinct_count">Distinct Count</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={handleGroupBy} disabled={!groupCol}>สร้าง Pivot</Button>
            <Button size="sm" variant="outline" onClick={() => setGroupResult(null)}>Clear</Button>
            {groupResult && groupResult.length > 0 && (
              <>
                <div className="border-l border-border h-6 mx-1" />
                <Button size="sm" variant="outline" className="text-xs" onClick={() => {
                  const exportRows = (pivotSearch
                    ? groupResult.filter(r => String(r[groupCol] ?? "").toLowerCase().includes(pivotSearch.toLowerCase()))
                    : groupResult
                  ).map(r => {
                    const row: Record<string, any> = { [getColumnLabel(groupCol, activeTable)]: r[groupCol] };
                    if (aggType === "count" || aggType === "distinct_count") row["Count"] = r.count;
                    if (aggType === "sum") row["Sum"] = r.sum;
                    if (aggType === "avg") row["Average"] = r.avg;
                    return row;
                  });
                  import("xlsx").then(XLSX => {
                    const ws = XLSX.utils.json_to_sheet(exportRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Pivot");
                    XLSX.writeFile(wb, `${safeTable}_pivot.xlsx`);
                  });
                }}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Export Pivot
                </Button>
                <div className="flex-1 min-w-[150px]">
                  <Input
                    className="h-7 text-xs"
                    placeholder="ค้นหาใน Pivot..."
                    value={pivotSearch}
                    onChange={e => setPivotSearch(e.target.value)}
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="text-xs">
                      <Columns className="w-3.5 h-3.5 mr-1" /> Columns
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="end">
                    <div className="space-y-1">
                      {["count", "sum", "avg"].map(col => (
                        <label key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                          <Checkbox
                            checked={pivotVisibleCols.has(col)}
                            onCheckedChange={() => setPivotVisibleCols(prev => {
                              const next = new Set(prev);
                              next.has(col) ? next.delete(col) : next.add(col);
                              return next;
                            })}
                            className="h-3.5 w-3.5"
                          />
                          {col === "count" ? "Count" : col === "sum" ? "Sum" : "Average"}
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
          {groupResult && (() => {
            const filtered = pivotSearch
              ? groupResult.filter(r => String(r[groupCol] ?? "").toLowerCase().includes(pivotSearch.toLowerCase()))
              : groupResult;
            return (
              <>
                <p className="text-xs text-muted-foreground mt-2">{filtered.length.toLocaleString()} กลุ่ม</p>
                <div className="border rounded overflow-auto max-h-96 mt-1">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2 border-b font-semibold">{getColumnLabel(groupCol, activeTable)}</th>
                        {pivotVisibleCols.has("count") && <th className="text-right px-3 py-2 border-b font-semibold">Count</th>}
                        {pivotVisibleCols.has("sum") && <th className="text-right px-3 py-2 border-b font-semibold">Sum</th>}
                        {pivotVisibleCols.has("avg") && <th className="text-right px-3 py-2 border-b font-semibold">Average</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 500).map((r, i) => (
                        <tr key={i} className="border-b hover:bg-muted/50">
                          <td className="px-3 py-1.5">{r[groupCol]}</td>
                          {pivotVisibleCols.has("count") && <td className="px-3 py-1.5 text-right">{r.count.toLocaleString()}</td>}
                          {pivotVisibleCols.has("sum") && <td className="px-3 py-1.5 text-right">{r.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>}
                          {pivotVisibleCols.has("avg") && <td className="px-3 py-1.5 text-right">{r.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length > 500 && <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {filtered.length} กลุ่ม</p>}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* PO Cost Skip List Dialog */}
      <Dialog open={!!postImportPrompt} onOpenChange={(o) => !o && setPostImportPrompt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>นำเข้าสำเร็จ</DialogTitle>
            <DialogDescription>
              อัปเดต/เพิ่มข้อมูล {postImportPrompt?.count || 0} รายการแล้ว — ต้องการแสดงข้อมูลที่เพิ่งนำเข้าหรือไม่?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostImportPrompt(null)}>ปิด</Button>
            <Button onClick={handleShowImportedData}>แสดงข้อมูล</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPoCostSkipDialog} onOpenChange={setShowPoCostSkipDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Skip List ({poCostSkipped.length} รายการที่ข้าม)
            </DialogTitle>
            <DialogDescription>
              {poCostImportSummary && (
                <span>นำเข้าสำเร็จ: Insert {poCostImportSummary.inserted} · Update {poCostImportSummary.updated} · ข้าม {poCostSkipped.length}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="text-left px-2 py-1.5 border-b">ID/SKU/Barcode</th>
                  <th className="text-left px-2 py-1.5 border-b">Product Name</th>
                  <th className="text-right px-2 py-1.5 border-b">Po Cost</th>
                  <th className="text-right px-2 py-1.5 border-b">Moq</th>
                  <th className="text-left px-2 py-1.5 border-b">Vendor</th>
                  <th className="text-left px-2 py-1.5 border-b">Reason</th>
                  <th className="text-right px-2 py-1.5 border-b">Suggest Unit</th>
                </tr>
              </thead>
              <tbody>
                {poCostSkipped.slice(0, 500).map((s, i) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1 font-mono">{s.key}</td>
                    <td className="px-2 py-1">{s.productName}</td>
                    <td className="px-2 py-1 text-right">{s.poCost ?? "-"}</td>
                    <td className="px-2 py-1 text-right">{s.moq ?? "-"}</td>
                    <td className="px-2 py-1">{s.vendor}</td>
                    <td className="px-2 py-1 text-amber-700 dark:text-amber-400">{s.reason}</td>
                    <td className="px-2 py-1 text-right font-semibold">{s.suggestUnit ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {poCostSkipped.length > 500 && (
              <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {poCostSkipped.length} (กด Download เพื่อดูทั้งหมด)</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPoCostSkipDialog(false)}>ปิด</Button>
            <Button onClick={() => downloadSkipList(poCostSkipped)}>
              <Download className="w-3.5 h-3.5 mr-1" /> Download Skip List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Cost: Margin% warning confirmation */}
      <Dialog open={!!marginPrompt} onOpenChange={(o) => { if (!o) { setMarginPrompt(null); setMarginSelected(new Set()); } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              พบรายการที่ Margin% ผิดปกติ
            </DialogTitle>
            <DialogDescription>
              {marginPrompt && (
                <span>
                  เกณฑ์: Margin% &gt; 50% หรือ &lt; 0.5% (เทียบกับ 2KM Price และ Jmart Price) ·
                  พบ <strong className="text-amber-600">{marginPrompt.warnings.length}</strong> รายการ
                  จากทั้งหมด {marginPrompt.toUpsert.length} ·
                  เลือกแล้ว <strong>{marginSelected.size}</strong> · (ไม่เลือก = ทำทุกรายการ)
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1.5 border-b w-8 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกทั้งหมด"
                      checked={!!marginPrompt && marginPrompt.warnings.length > 0 && marginSelected.size === marginPrompt.warnings.length}
                      ref={(el) => {
                        if (el && marginPrompt) {
                          el.indeterminate = marginSelected.size > 0 && marginSelected.size < marginPrompt.warnings.length;
                        }
                      }}
                      onChange={(e) => {
                        if (!marginPrompt) return;
                        if (e.target.checked) {
                          setMarginSelected(new Set(marginPrompt.warnings.map((_, i) => i)));
                        } else {
                          setMarginSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-2 py-1.5 border-b">ID (SKU)</th>
                  <th className="text-left px-2 py-1.5 border-b">Currency</th>
                  <th className="text-left px-2 py-1.5 border-b">Vendor</th>
                  <th className="text-left px-2 py-1.5 border-b">Product Name</th>
                  <th className="text-right px-2 py-1.5 border-b">MOQ</th>
                  <th className="text-right px-2 py-1.5 border-b">PO Cost<div className="text-[10px] font-normal text-muted-foreground">(vendor ccy)</div></th>
                  <th className="text-right px-2 py-1.5 border-b">PO Cost Unit<div className="text-[10px] font-normal text-muted-foreground">(vendor ccy)</div></th>
                  <th className="text-right px-2 py-1.5 border-b bg-emerald-50 dark:bg-emerald-950/30">FX Rate<div className="text-[10px] font-normal text-muted-foreground">→ LAK</div></th>
                  <th className="text-right px-2 py-1.5 border-b bg-emerald-50 dark:bg-emerald-950/30">PO Cost (LAK)<div className="text-[10px] font-normal text-muted-foreground">ใช้คำนวณ Margin</div></th>
                  <th className="text-right px-2 py-1.5 border-b">2KM Price<div className="text-[10px] font-normal text-muted-foreground">(LAK)</div></th>
                  <th className="text-right px-2 py-1.5 border-b">2KM Margin%</th>
                  <th className="text-right px-2 py-1.5 border-b">Jmart Price<div className="text-[10px] font-normal text-muted-foreground">(000,000,000)</div></th>
                  <th className="text-right px-2 py-1.5 border-b">Jmart Margin%</th>
                </tr>
              </thead>
              <tbody>
                {marginPrompt?.warnings.slice(0, 500).map((w, i) => {
                  const flag = (v: number | null) => v !== null && (v > 50 || v < 0.5);
                  const checked = marginSelected.has(i);
                  const fmt = (v: number | null | undefined, dec = 0) =>
                    v === null || v === undefined || !Number.isFinite(Number(v))
                      ? "-"
                      : Number(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
                  return (
                    <tr key={i} className={cn("border-b hover:bg-muted/30", checked && "bg-primary/5")}>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setMarginSelected(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(i); else next.delete(i);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">{w.resolved.item_id}</td>
                      <td className="px-2 py-1">{vendorCurrencyMap.get(w.resolved.vendor) || "-"}</td>
                      <td className="px-2 py-1">{w.resolved.vendor}</td>
                      <td className="px-2 py-1">{w.resolved.product_name}</td>
                      <td className="px-2 py-1 text-right">{fmt(w.resolved.moq)}</td>
                      <td className="px-2 py-1 text-right">{fmt(w.resolved.po_cost)}</td>
                      <td className="px-2 py-1 text-right">{fmt(w.resolved.po_cost_unit, 4)}</td>
                      <td className="px-2 py-1 text-right bg-emerald-50/40 dark:bg-emerald-950/20">{w.fxRate ? fmt(w.fxRate, 2) : "-"}</td>
                      <td className="px-2 py-1 text-right bg-emerald-50/40 dark:bg-emerald-950/20 font-medium">{fmt(w.poCostUnitLak ?? null)}</td>
                      <td className="px-2 py-1 text-right">{fmt(w.list_price)}</td>
                      <td className={cn("px-2 py-1 text-right font-semibold", flag(w.marginPct2km) && "text-amber-600")}>
                        {w.marginPct2km !== null ? `${w.marginPct2km.toFixed(2)}%` : "-"}
                      </td>
                      <td className="px-2 py-1 text-right">{fmt(w.jmart_price)}</td>
                      <td className={cn("px-2 py-1 text-right font-semibold", flag(w.marginPctJmart) && "text-amber-600")}>
                        {w.marginPctJmart !== null ? `${w.marginPctJmart.toFixed(2)}%` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(marginPrompt?.warnings.length ?? 0) > 500 && (
              <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {marginPrompt!.warnings.length} (กด Download เพื่อดูทั้งหมด)</p>
            )}
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setMarginPrompt(null); setMarginSelected(new Set()); }}>ยกเลิก</Button>
            <Button variant="outline" onClick={() => {
              const target = getSelectedWarnings();
              if (target.length === 0) return;
              downloadSkipList(target.map(w => w.skip));
            }}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Download Skip List {marginSelected.size > 0 ? `(${marginSelected.size})` : `(ทั้งหมด ${marginPrompt?.warnings.length ?? 0})`}
            </Button>
            <Button variant="secondary" onClick={confirmMarginSkipWarnings}>
              ข้ามรายการเตือนทั้งหมด + Upsert ที่เหลือ
            </Button>
            <Button onClick={confirmMarginUpsertAll}>
              {marginSelected.size > 0
                ? `ยืนยัน Upsert เฉพาะที่เลือก (${marginSelected.size})`
                : `ยืนยัน Upsert ทั้งหมด`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Cost: MOQ=1 vs Packing Size Qty > 1 confirmation */}
      <Dialog open={!!moqPackingPrompt} onOpenChange={(o) => { if (!o) { setMoqPackingPrompt(null); setMoqPackingSelected(new Set()); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              พบ MOQ = 1 แต่ Data Master มี Packing Size Qty &gt; 1
            </DialogTitle>
            <DialogDescription>
              {moqPackingPrompt && (
                <span>
                  พบ <strong className="text-amber-600">{moqPackingPrompt.moqPackingWarnings.length}</strong> รายการ
                  จากทั้งหมด {moqPackingPrompt.toUpsert.length} ·
                  เลือกแล้ว <strong>{moqPackingSelected.size}</strong> · (เลือก = ยืนยัน Upsert ตามไฟล์, ไม่เลือก = ข้าม)
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1.5 border-b w-8 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกทั้งหมด"
                      checked={!!moqPackingPrompt && moqPackingPrompt.moqPackingWarnings.length > 0 && moqPackingSelected.size === moqPackingPrompt.moqPackingWarnings.length}
                      ref={(el) => {
                        if (el && moqPackingPrompt) {
                          el.indeterminate = moqPackingSelected.size > 0 && moqPackingSelected.size < moqPackingPrompt.moqPackingWarnings.length;
                        }
                      }}
                      onChange={(e) => {
                        if (!moqPackingPrompt) return;
                        if (e.target.checked) {
                          setMoqPackingSelected(new Set(moqPackingPrompt.moqPackingWarnings.map((_, i) => i)));
                        } else {
                          setMoqPackingSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-2 py-1.5 border-b">ID (SKU)</th>
                  <th className="text-left px-2 py-1.5 border-b">Product Name</th>
                  <th className="text-left px-2 py-1.5 border-b">Vendor</th>
                  <th className="text-right px-2 py-1.5 border-b bg-amber-50 dark:bg-amber-950/30">MOQ (ไฟล์)</th>
                  <th className="text-left px-2 py-1.5 border-b bg-emerald-50 dark:bg-emerald-950/30">Packing Size Qty (Master &gt;1)</th>
                  <th className="text-right px-2 py-1.5 border-b">PO Cost</th>
                </tr>
              </thead>
              <tbody>
                {moqPackingPrompt?.moqPackingWarnings.slice(0, 500).map((mw, i) => {
                  const checked = moqPackingSelected.has(i);
                  const fmt = (v: number | null | undefined) =>
                    v === null || v === undefined || !Number.isFinite(Number(v)) ? "-" : Number(v).toLocaleString();
                  return (
                    <tr key={i} className={cn("border-b hover:bg-muted/30", checked && "bg-primary/5")}>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setMoqPackingSelected(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(i); else next.delete(i);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">{mw.resolved.item_id}</td>
                      <td className="px-2 py-1">{mw.productName}</td>
                      <td className="px-2 py-1 font-mono">{mw.resolved.vendor}</td>
                      <td className="px-2 py-1 text-right font-medium bg-amber-50/40 dark:bg-amber-950/20">{fmt(mw.importedMoq)}</td>
                      <td className="px-2 py-1 font-mono bg-emerald-50/40 dark:bg-emerald-950/20">{mw.packingSizes.join(", ")}</td>
                      <td className="px-2 py-1 text-right">{fmt(mw.resolved.po_cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(moqPackingPrompt?.moqPackingWarnings.length ?? 0) > 500 && (
              <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {moqPackingPrompt!.moqPackingWarnings.length} (กด Download เพื่อดูทั้งหมด)</p>
            )}
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setMoqPackingPrompt(null); setMoqPackingSelected(new Set()); }}>ยกเลิก</Button>
            <Button variant="outline" onClick={() => {
              if (!moqPackingPrompt) return;
              const target = moqPackingSelected.size > 0
                ? moqPackingPrompt.moqPackingWarnings.filter((_, i) => moqPackingSelected.has(i))
                : moqPackingPrompt.moqPackingWarnings;
              if (target.length === 0) return;
              downloadSkipList(target.map(m => m.skip));
            }}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Download Skip List {moqPackingSelected.size > 0 ? `(${moqPackingSelected.size})` : `(ทั้งหมด ${moqPackingPrompt?.moqPackingWarnings.length ?? 0})`}
            </Button>
            <Button variant="secondary" onClick={confirmMoqPackingSkipAll}>
              ข้ามทั้งหมด + Upsert ที่เหลือ
            </Button>
            <Button onClick={confirmMoqPackingUpsert}>
              {moqPackingSelected.size > 0
                ? `ยืนยัน Upsert เฉพาะที่เลือก (${moqPackingSelected.size})`
                : `ยืนยัน Upsert ทั้งหมดตามไฟล์`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Cost: Vendor Code mismatch confirmation */}
      <Dialog open={!!vendorMismatchPrompt} onOpenChange={(o) => { if (!o) { setVendorMismatchPrompt(null); setVendorMismatchSelected(new Set()); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              พบ Vendor Code ที่ไม่ตรงกับ Data Master
            </DialogTitle>
            <DialogDescription>
              {vendorMismatchPrompt && (
                <span>
                  Vendor Code ในไฟล์ ไม่ตรงกับ Vendor Code ของสินค้านี้ใน Data Master ·
                  พบ <strong className="text-amber-600">{vendorMismatchPrompt.mismatches.length}</strong> รายการ
                  จากทั้งหมด {vendorMismatchPrompt.toUpsert.length} ·
                  เลือกแล้ว <strong>{vendorMismatchSelected.size}</strong> · (ไม่เลือก = Insert ทุกรายการตามไฟล์)
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1.5 border-b w-8 text-center">
                    <input
                      type="checkbox"
                      aria-label="เลือกทั้งหมด"
                      checked={!!vendorMismatchPrompt && vendorMismatchPrompt.mismatches.length > 0 && vendorMismatchSelected.size === vendorMismatchPrompt.mismatches.length}
                      ref={(el) => {
                        if (el && vendorMismatchPrompt) {
                          el.indeterminate = vendorMismatchSelected.size > 0 && vendorMismatchSelected.size < vendorMismatchPrompt.mismatches.length;
                        }
                      }}
                      onChange={(e) => {
                        if (!vendorMismatchPrompt) return;
                        if (e.target.checked) {
                          setVendorMismatchSelected(new Set(vendorMismatchPrompt.mismatches.map((_, i) => i)));
                        } else {
                          setVendorMismatchSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-2 py-1.5 border-b">ID (SKU)</th>
                  <th className="text-left px-2 py-1.5 border-b">Product Name</th>
                  <th className="text-left px-2 py-1.5 border-b bg-amber-50 dark:bg-amber-950/30">Vendor (ไฟล์)</th>
                  <th className="text-left px-2 py-1.5 border-b bg-emerald-50 dark:bg-emerald-950/30">Vendor (Data Master)</th>
                  <th className="text-right px-2 py-1.5 border-b">MOQ</th>
                  <th className="text-right px-2 py-1.5 border-b">PO Cost</th>
                </tr>
              </thead>
              <tbody>
                {vendorMismatchPrompt?.mismatches.slice(0, 500).map((vm, i) => {
                  const checked = vendorMismatchSelected.has(i);
                  const fmt = (v: number | null | undefined) =>
                    v === null || v === undefined || !Number.isFinite(Number(v))
                      ? "-"
                      : Number(v).toLocaleString();
                  return (
                    <tr key={i} className={cn("border-b hover:bg-muted/30", checked && "bg-primary/5")}>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setVendorMismatchSelected(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(i); else next.delete(i);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">{vm.resolved.item_id}</td>
                      <td className="px-2 py-1">{vm.productName}</td>
                      <td className="px-2 py-1 font-mono bg-amber-50/40 dark:bg-amber-950/20 font-medium">{vm.importedVendor}</td>
                      <td className="px-2 py-1 font-mono bg-emerald-50/40 dark:bg-emerald-950/20">{vm.masterVendors.join(", ")}</td>
                      <td className="px-2 py-1 text-right">{fmt(vm.resolved.moq)}</td>
                      <td className="px-2 py-1 text-right">{fmt(vm.resolved.po_cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(vendorMismatchPrompt?.mismatches.length ?? 0) > 500 && (
              <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {vendorMismatchPrompt!.mismatches.length} (กด Download เพื่อดูทั้งหมด)</p>
            )}
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setVendorMismatchPrompt(null); setVendorMismatchSelected(new Set()); }}>ยกเลิก</Button>
            <Button variant="outline" onClick={() => {
              if (!vendorMismatchPrompt) return;
              const target = vendorMismatchSelected.size > 0
                ? vendorMismatchPrompt.mismatches.filter((_, i) => vendorMismatchSelected.has(i))
                : vendorMismatchPrompt.mismatches;
              if (target.length === 0) return;
              downloadSkipList(target.map(m => m.skip));
            }}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Download Skip List {vendorMismatchSelected.size > 0 ? `(${vendorMismatchSelected.size})` : `(ทั้งหมด ${vendorMismatchPrompt?.mismatches.length ?? 0})`}
            </Button>
            <Button variant="secondary" onClick={confirmVendorMismatchSkipAll}>
              ข้ามทั้งหมด + Upsert ที่เหลือ
            </Button>
            <Button onClick={confirmVendorMismatchUpsert}>
              {vendorMismatchSelected.size > 0
                ? `ยืนยัน Upsert เฉพาะที่เลือก (${vendorMismatchSelected.size})`
                : `ยืนยัน Upsert ทั้งหมดตามไฟล์`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Cost: Update mode — missing rows confirmation */}
      <Dialog open={!!missingPrompt} onOpenChange={(o) => !o && setMissingPrompt(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              พบข้อมูลใหม่ที่ไม่มีอยู่เดิม
            </DialogTitle>
            <DialogDescription>
              {missingPrompt && (
                <span>
                  จะอัปเดต {missingPrompt.existing.length} รายการที่มีอยู่เดิม ·
                  พบ <strong className="text-amber-600">{missingPrompt.missing.length}</strong> รายการใหม่ที่ไม่มี SKU+Vendor ในระบบ
                  <br />
                  ต้องการ <strong>Insert</strong> รายการใหม่เหล่านี้ หรือ <strong>Skip</strong> (ใส่ลง Skip List ให้ Download)?
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="text-left px-2 py-1.5 border-b">ID (SKUCode)</th>
                  <th className="text-left px-2 py-1.5 border-b">Vendor</th>
                  <th className="text-left px-2 py-1.5 border-b">Product Name</th>
                  <th className="text-right px-2 py-1.5 border-b">MOQ</th>
                  <th className="text-right px-2 py-1.5 border-b">PO Cost</th>
                </tr>
              </thead>
              <tbody>
                {missingPrompt?.missing.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1 font-mono">{r.item_id}</td>
                    <td className="px-2 py-1">{r.vendor}</td>
                    <td className="px-2 py-1">{r.product_name}</td>
                    <td className="px-2 py-1 text-right">{r.moq}</td>
                    <td className="px-2 py-1 text-right">{r.po_cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(missingPrompt?.missing.length ?? 0) > 500 && (
              <p className="text-xs text-muted-foreground p-2">แสดง 500 จาก {missingPrompt!.missing.length}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMissingPrompt(null)}>ยกเลิก</Button>
            <Button variant="secondary" onClick={confirmMissingSkip}>
              Skip + ใส่ Skip List
            </Button>
            <Button onClick={confirmMissingInsert}>
              Insert รายการใหม่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
