import React, { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, Upload, Play, Search, X, FileSpreadsheet, Trash2, Download,
  Database, Columns, CheckSquare, StopCircle, Eye, Save, FolderOpen, FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { ImportSkipBar, type SkippedItem } from "@/components/ImportSkipDialog";
import { ListImportPO } from "@/pages/SRRPage";

// =================================================================
// Column Groups - drives Prepare/Read (only fetch what's selected)
// Per-store and All-store are SEPARATE groups so user can toggle them independently
// =================================================================
type GroupKey =
  | "classification"
  | "vendor"
  | "identity"
  | "pack"
  | "price"
  | "po_cost"
  | "minmax_per"   // Min/Max per store (cross-tab)
  | "minmax_all"   // Min/Max All Store aggregate
  | "stock_dc"     // Stock DC only (separate group)
  | "stock_per"    // Stock per store (cross-tab) — excludes DC
  | "stock_all"    // Stock All Store aggregates
  | "avg_per"      // Avg Sale per store (cross-tab)
  | "avg_all"      // Avg Sale TT aggregate
  | "qty";

const GROUP_DEFS: { key: GroupKey; label: string; defaultOn: boolean }[] = [
  { key: "classification", label: "Classification (Division/Dept/Class/PO Group)", defaultOn: true },
  { key: "vendor", label: "Vendor / Currency / SPC", defaultOn: true },
  { key: "identity", label: "Identity (SKU/Barcode/Name/Status)", defaultOn: true },
  { key: "pack", label: "Pack / Box", defaultOn: true },
  { key: "price", label: "Price / Cost Std", defaultOn: true },
  { key: "po_cost", label: "PO Cost / MOQ / PO Cost Unit", defaultOn: true },
  { key: "minmax_per", label: "Min/Max — Per Store (cross-tab)", defaultOn: true },
  { key: "minmax_all", label: "Min/Max — All Store (sum)", defaultOn: true },
  { key: "stock_dc", label: "Stock DC", defaultOn: true },
  { key: "stock_per", label: "Stock — Per Store (cross-tab)", defaultOn: true },
  { key: "stock_all", label: "Stock — All Store + All+DC (sum)", defaultOn: true },
  { key: "avg_per", label: "Avg Sale — Per Store (cross-tab)", defaultOn: true },
  { key: "avg_all", label: "Avg Sale — TT (sum)", defaultOn: true },
  { key: "qty", label: "Quantity (input)", defaultOn: true },
];

// Groups that need minmax / stock / sales tables when reading
const NEEDS_MINMAX = (g: Set<GroupKey>) => g.has("minmax_per") || g.has("minmax_all");
const NEEDS_STOCK  = (g: Set<GroupKey>) => g.has("stock_per") || g.has("stock_all") || g.has("stock_dc");
const NEEDS_AVG    = (g: Set<GroupKey>) => g.has("avg_per") || g.has("avg_all");

type ColDef = {
  key: string;
  label: string;
  group: GroupKey;
  width: number;
  numeric?: boolean;
  perStore?: "min" | "max" | "stock" | "avg";
  storeName?: string;
};

const STATIC_COLS: ColDef[] = [
  { key: "division_group", label: "Division Group", group: "classification", width: 130 },
  { key: "division", label: "Division", group: "classification", width: 110 },
  { key: "department", label: "Department", group: "classification", width: 130 },
  { key: "sub_department", label: "Sub-Department", group: "classification", width: 140 },
  { key: "class", label: "Class", group: "classification", width: 110 },
  { key: "sub_class", label: "Sub-Class", group: "classification", width: 120 },
  { key: "po_group", label: "PO Group", group: "classification", width: 100 },
  { key: "replenishment_type", label: "Replenishment Type", group: "classification", width: 130 },

  { key: "vendor_display", label: "Vendor", group: "vendor", width: 200 },
  { key: "currency", label: "Currency", group: "vendor", width: 80 },
  { key: "spc_name", label: "SPC Name", group: "vendor", width: 120 },

  { key: "imp_barcode", label: "Barcode (Imp)", group: "identity", width: 130 },
  { key: "sku_code", label: "SKU Code", group: "identity", width: 110 },
  { key: "main_barcode", label: "Main Barcode (Unit)", group: "identity", width: 140 },
  { key: "product_name_la", label: "Product Name (LA)", group: "identity", width: 200 },
  { key: "product_name_en", label: "Product Name (EN)", group: "identity", width: 200 },
  { key: "buying_status", label: "Buying Status", group: "identity", width: 110 },
  { key: "item_type", label: "Item Type", group: "identity", width: 100 },

  { key: "pack_qty", label: "Pack", group: "pack", width: 70, numeric: true },
  { key: "box_qty", label: "Box", group: "pack", width: 70, numeric: true },

  { key: "price", label: "Price", group: "price", width: 90, numeric: true },
  { key: "cost_std", label: "Cost Std", group: "price", width: 90, numeric: true },

  { key: "po_cost", label: "PO Cost", group: "po_cost", width: 90, numeric: true },
  { key: "moq", label: "1x (MOQ)", group: "po_cost", width: 80, numeric: true },
  { key: "po_cost_unit", label: "PO Cost Unit", group: "po_cost", width: 100, numeric: true },

  // Aggregate cols (per-store cross-tabs are injected dynamically just before these)
  { key: "min_all", label: "Min All Store", group: "minmax_all", width: 110, numeric: true },
  { key: "max_all", label: "Max All Store", group: "minmax_all", width: 110, numeric: true },
  { key: "stock_dc", label: "Stock DC", group: "stock_dc", width: 90, numeric: true },
  { key: "stock_all", label: "Stock All Store", group: "stock_all", width: 110, numeric: true },
  { key: "stock_all_dc", label: "Stock All Store + DC", group: "stock_all", width: 130, numeric: true },
  { key: "avg_all", label: "Avg Sale TT", group: "avg_all", width: 110, numeric: true },

  { key: "quantity", label: "Quantity", group: "qty", width: 110, numeric: true },
];

// Per-store cross-tab anchor markers — tell us where to inject per-store cols
// (independent of the All-store group toggle)
const PER_STORE_ANCHORS: { group: GroupKey; perStore: "min" | "max" | "stock" | "avg"; label: (sn: string) => string }[] = [
  { group: "minmax_per", perStore: "min", label: (sn) => `Min ${sn}` },
  { group: "minmax_per", perStore: "max", label: (sn) => `Max ${sn}` },
  { group: "stock_per", perStore: "stock", label: (sn) => `Stock ${sn}` },
  { group: "avg_per", perStore: "avg", label: (sn) => `Avg ${sn}` },
];

interface SpecialRow {
  id: string;
  division_group: string; division: string; department: string; sub_department: string;
  class: string; sub_class: string; po_group: string; replenishment_type: string;
  vendor_code: string; vendor_display: string; currency: string; spc_name: string;
  imp_barcode: string; sku_code: string; main_barcode: string;
  product_name_la: string; product_name_en: string;
  buying_status: string; item_type: string;
  pack_qty: number; box_qty: number;
  price: number; cost_std: number;
  po_cost: number; moq: number; po_cost_unit: number;
  min_by_store: Record<string, number>;
  max_by_store: Record<string, number>;
  stock_by_store: Record<string, number>;
  avg_by_store: Record<string, number>;
  min_all: number; max_all: number;
  stock_dc: number; stock_all: number; stock_all_dc: number;
  avg_all: number;
  quantity: number;
}

function MultiSelect({ label, options, selected, onChange, width = 140 }: {
  label: string;
  options: { value: string; display: string }[];
  selected: string[];
  onChange: (val: string[]) => void;
  width?: number;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => o.display.toLowerCase().includes(search.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs justify-between" style={{ minWidth: width }}>
          <span className="truncate">{selected.length === 0 ? label : `${label} (${selected.length})`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 bg-popover z-50" align="start">
        <div className="flex items-center gap-1 mb-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange(filtered.map(o => o.value))}>เลือกทั้งหมด</Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([])}>ล้าง</Button>
        </div>
        <ScrollArea className="h-48">
          {filtered.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer">
              <Checkbox checked={selected.includes(opt.value)} onCheckedChange={c => onChange(c ? [...selected, opt.value] : selected.filter(v => v !== opt.value))} />
              <span className="text-xs truncate">{opt.display}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4">ไม่พบข้อมูล</p>}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// Fast batched fetch by chunking the .in() filter and running all chunks in parallel.
// This is far faster than serial pagination because Postgres can use the indexed IN-list directly.
async function fetchByIdsParallel<T>(
  table: string,
  selectCols: string,
  inColumn: string,
  ids: string[],
  abortRef: { aborted: boolean },
  chunkSize = 500,
  concurrency = 6,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const out: T[] = [];
  // Process chunks with limited concurrency to avoid Supabase rate limits
  for (let i = 0; i < chunks.length; i += concurrency) {
    if (abortRef.aborted) throw new Error("__ABORTED__");
    const wave = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      wave.map(async (slice) => {
        const { data, error } = await (supabase as any)
          .from(table).select(selectCols).in(inColumn, slice);
        if (error) throw error;
        return (data || []) as T[];
      })
    );
    for (const r of results) out.push(...r);
  }
  return out;
}

function fmt(n: number): string {
  if (n === 0 || !n) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface PreparedCache {
  familyByMain: Map<string, any[]>;
  familyBySku: Map<string, any[]>;
  byBarcode: Map<string, any>;
  rowCount: number;
  preparedAt: Date;
  groups: Set<GroupKey>;
}

// =================================================================
// Saved Documents (Tab 2) — persist to localStorage
// =================================================================
interface SavedSpecialDoc {
  id: string;
  name: string;          // user-given name
  filename: string;      // "yyyymmddhhmmss - name"
  created_at: string;    // ISO
  rows: SpecialRow[];
  columns: string[];     // displayed column keys at save time
  storeNames: string[];
  storeTypeMap: Array<[string, string]>;
  selectedGroups: GroupKey[];
}
const SPECIAL_DOCS_KEY = "special_order_saved_docs";
function loadSpecialDocs(): SavedSpecialDoc[] {
  try { return JSON.parse(localStorage.getItem(SPECIAL_DOCS_KEY) || "[]"); } catch { return []; }
}
function saveSpecialDocs(docs: SavedSpecialDoc[]) {
  try { localStorage.setItem(SPECIAL_DOCS_KEY, JSON.stringify(docs)); } catch { /* quota */ }
}
function tsFilename(name: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${ts} - ${name.trim() || "untitled"}`;
}

// =================================================================
// In-session state persistence (survives navigation between menus)
// =================================================================
const stateRef: {
  barcodes: string[];
  importedQty: Map<string, number>;
  vendorOverrides: Map<string, { vendor_code: string; vendor_display_name?: string }>;
  selectedGroups: Set<GroupKey>;
  prepared: PreparedCache | null;
  rows: SpecialRow[];
  perStoreData: { minmax: any[]; stock: any[]; sales: any[] };
  storeTypeMap: Map<string, string>;
  allStoreNames: string[];
  typeStoresMinMax: string[];
  typeStoresStock: string[];
  typeStoresAvg: string[];
  pendingStoreMinMax: string[];
  pendingStoreStock: string[];
  pendingStoreAvg: string[];
  pendingTypeMinMax: string[];
  pendingTypeStock: string[];
  pendingTypeAvg: string[];
  appliedStoreMinMax: string[];
  appliedStoreStock: string[];
  appliedStoreAvg: string[];
  appliedTypeMinMax: string[];
  appliedTypeStock: string[];
  appliedTypeAvg: string[];
  hiddenCols: Set<string>;
  columnWidths: Record<string, number>;
  search: string;
  activeTab: string;
} = {
  barcodes: [], importedQty: new Map(), vendorOverrides: new Map(),
  rows: [], prepared: null, selectedGroups: new Set(GROUP_DEFS.filter(g => g.defaultOn).map(g => g.key)),
  perStoreData: { minmax: [], stock: [], sales: [] },
  storeTypeMap: new Map(), allStoreNames: [],
  typeStoresMinMax: [], typeStoresStock: [], typeStoresAvg: [],
  pendingStoreMinMax: [], pendingStoreStock: [], pendingStoreAvg: [],
  pendingTypeMinMax: [], pendingTypeStock: [], pendingTypeAvg: [],
  appliedStoreMinMax: [], appliedStoreStock: [], appliedStoreAvg: [],
  appliedTypeMinMax: [], appliedTypeStock: [], appliedTypeAvg: [],
  hiddenCols: new Set(), columnWidths: {}, search: "", activeTab: "order",
};

export default function SRRSpecialOrderPage() {
  const { toast } = useToast();

  const [barcodes, setBarcodes] = useState<string[]>(stateRef.barcodes);
  const [importedQty, setImportedQty] = useState<Map<string, number>>(stateRef.importedQty);
  const [vendorOverrides, setVendorOverrides] = useState<Map<string, { vendor_code: string; vendor_display_name?: string }>>(stateRef.vendorOverrides);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importTab, setImportTab] = useState("upload");
  const [vendorOverrideOpen, setVendorOverrideOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vendorOverrideFileRef = useRef<HTMLInputElement>(null);
  const [skippedItems, setSkippedItems] = useState<SkippedItem[]>([]);

  const [selectedGroups, setSelectedGroups] = useState<Set<GroupKey>>(stateRef.selectedGroups);

  const [preparing, setPreparing] = useState(false);
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepStage, setPrepStage] = useState("");
  const prepAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const [prepared, setPrepared] = useState<PreparedCache | null>(stateRef.prepared);

  const [reading, setReading] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [readStage, setReadStage] = useState("");
  const readAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const [rows, setRows] = useState<SpecialRow[]>(stateRef.rows);
  const [perStoreData, setPerStoreData] = useState<{ minmax: any[]; stock: any[]; sales: any[] }>(stateRef.perStoreData);
  const [storeTypeMap, setStoreTypeMap] = useState<Map<string, string>>(stateRef.storeTypeMap);
  const [allStoreNames, setAllStoreNames] = useState<string[]>(stateRef.allStoreNames);

  const [pendingStoreMinMax, setPendingStoreMinMax] = useState<string[]>(stateRef.pendingStoreMinMax);
  const [pendingStoreStock, setPendingStoreStock] = useState<string[]>(stateRef.pendingStoreStock);
  const [pendingStoreAvg, setPendingStoreAvg] = useState<string[]>(stateRef.pendingStoreAvg);
  const [pendingTypeMinMax, setPendingTypeMinMax] = useState<string[]>(stateRef.pendingTypeMinMax);
  const [pendingTypeStock, setPendingTypeStock] = useState<string[]>(stateRef.pendingTypeStock);
  const [pendingTypeAvg, setPendingTypeAvg] = useState<string[]>(stateRef.pendingTypeAvg);

  const [appliedStoreMinMax, setAppliedStoreMinMax] = useState<string[]>(stateRef.appliedStoreMinMax);
  const [appliedStoreStock, setAppliedStoreStock] = useState<string[]>(stateRef.appliedStoreStock);
  const [appliedStoreAvg, setAppliedStoreAvg] = useState<string[]>(stateRef.appliedStoreAvg);
  const [appliedTypeMinMax, setAppliedTypeMinMax] = useState<string[]>(stateRef.appliedTypeMinMax);
  const [appliedTypeStock, setAppliedTypeStock] = useState<string[]>(stateRef.appliedTypeStock);
  const [appliedTypeAvg, setAppliedTypeAvg] = useState<string[]>(stateRef.appliedTypeAvg);

  const [search, setSearch] = useState(stateRef.search);

  const [typeStoresMinMax, setTypeStoresMinMax] = useState<string[]>(stateRef.typeStoresMinMax);
  const [typeStoresStock, setTypeStoresStock] = useState<string[]>(stateRef.typeStoresStock);
  const [typeStoresAvg, setTypeStoresAvg] = useState<string[]>(stateRef.typeStoresAvg);

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(stateRef.hiddenCols);
  const [colSelectorOpen, setColSelectorOpen] = useState(false);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(stateRef.columnWidths);
  const [resizing, setResizing] = useState<{ col: string; startX: number; startW: number } | null>(null);

  // Tab + saved documents (Tab 2)
  const [activeTab, setActiveTab] = useState<string>(stateRef.activeTab);
  const [savedDocs, setSavedDocs] = useState<SavedSpecialDoc[]>(() => loadSpecialDocs());
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [previewDoc, setPreviewDoc] = useState<SavedSpecialDoc | null>(null);

  // Save PO (Special) dialog
  const [savePOOpen, setSavePOOpen] = useState(false);
  const [poDescription, setPoDescription] = useState("");

  // Persist all relevant state to module-level ref so it survives navigation/unmount
  useEffect(() => { stateRef.barcodes = barcodes; }, [barcodes]);
  useEffect(() => { stateRef.importedQty = importedQty; }, [importedQty]);
  useEffect(() => { stateRef.vendorOverrides = vendorOverrides; }, [vendorOverrides]);
  useEffect(() => { stateRef.selectedGroups = selectedGroups; }, [selectedGroups]);
  useEffect(() => { stateRef.prepared = prepared; }, [prepared]);
  useEffect(() => { stateRef.rows = rows; }, [rows]);
  useEffect(() => { stateRef.perStoreData = perStoreData; }, [perStoreData]);
  useEffect(() => { stateRef.storeTypeMap = storeTypeMap; }, [storeTypeMap]);
  useEffect(() => { stateRef.allStoreNames = allStoreNames; }, [allStoreNames]);
  useEffect(() => { stateRef.typeStoresMinMax = typeStoresMinMax; }, [typeStoresMinMax]);
  useEffect(() => { stateRef.typeStoresStock = typeStoresStock; }, [typeStoresStock]);
  useEffect(() => { stateRef.typeStoresAvg = typeStoresAvg; }, [typeStoresAvg]);
  useEffect(() => { stateRef.pendingStoreMinMax = pendingStoreMinMax; }, [pendingStoreMinMax]);
  useEffect(() => { stateRef.pendingStoreStock = pendingStoreStock; }, [pendingStoreStock]);
  useEffect(() => { stateRef.pendingStoreAvg = pendingStoreAvg; }, [pendingStoreAvg]);
  useEffect(() => { stateRef.pendingTypeMinMax = pendingTypeMinMax; }, [pendingTypeMinMax]);
  useEffect(() => { stateRef.pendingTypeStock = pendingTypeStock; }, [pendingTypeStock]);
  useEffect(() => { stateRef.pendingTypeAvg = pendingTypeAvg; }, [pendingTypeAvg]);
  useEffect(() => { stateRef.appliedStoreMinMax = appliedStoreMinMax; }, [appliedStoreMinMax]);
  useEffect(() => { stateRef.appliedStoreStock = appliedStoreStock; }, [appliedStoreStock]);
  useEffect(() => { stateRef.appliedStoreAvg = appliedStoreAvg; }, [appliedStoreAvg]);
  useEffect(() => { stateRef.appliedTypeMinMax = appliedTypeMinMax; }, [appliedTypeMinMax]);
  useEffect(() => { stateRef.appliedTypeStock = appliedTypeStock; }, [appliedTypeStock]);
  useEffect(() => { stateRef.appliedTypeAvg = appliedTypeAvg; }, [appliedTypeAvg]);
  useEffect(() => { stateRef.hiddenCols = hiddenCols; }, [hiddenCols]);
  useEffect(() => { stateRef.columnWidths = columnWidths; }, [columnWidths]);
  useEffect(() => { stateRef.search = search; }, [search]);
  useEffect(() => { stateRef.activeTab = activeTab; }, [activeTab]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizing.startX;
      const w = Math.max(60, resizing.startW + dx);
      setColumnWidths(prev => ({ ...prev, [resizing.col]: w }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing]);

  const startResize = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    const def = STATIC_COLS.find(c => c.key === col);
    const w = columnWidths[col] || def?.width || 100;
    setResizing({ col, startX: e.clientX, startW: w });
  };

  // ============ IMPORT ============
  // Detects Barcode column and (optional) Quantity/Qty column. Quantities feed the Quantity input on Read.
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const sample = json[0] || {};
        const keys = Object.keys(sample);
        const barcodeCol = keys.find(k => k.toLowerCase().includes("barcode")) || keys[0];
        const qtyCol = keys.find(k => /^(qty|quantity|จำนวน)$/i.test(k.trim()));
        if (!barcodeCol) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }

        const list: string[] = [];
        const qtyMap = new Map<string, number>();
        for (const r of json) {
          const bc = String(r[barcodeCol] ?? "").trim();
          if (!bc) continue;
          if (!list.includes(bc)) list.push(bc);
          if (qtyCol) {
            const q = Number(String(r[qtyCol] ?? "").replace(/,/g, ""));
            if (q > 0) qtyMap.set(bc, (qtyMap.get(bc) || 0) + q);
          }
        }
        setBarcodes(list);
        setImportedQty(qtyMap);
        setPrepared(null);
        setRows([]);
        setSkippedItems([]);
        toast({
          title: `Import สำเร็จ`,
          description: `${list.length} barcode${qtyMap.size > 0 ? ` · มี Qty ${qtyMap.size} รายการ` : ""}`,
        });
        setImportOpen(false);
      } catch (err: any) {
        toast({ title: "Import ไม่สำเร็จ", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Paste mode: supports "barcode" or "barcode<TAB|comma|space>qty" per line
  const handlePasteImport = () => {
    const lines = pasteText.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast({ title: "กรุณากรอก barcode", variant: "destructive" }); return; }
    const list: string[] = [];
    const qtyMap = new Map<string, number>();
    for (const ln of lines) {
      const parts = ln.split(/[\t,;\s]+/).filter(Boolean);
      const bc = parts[0];
      if (!bc) continue;
      if (!list.includes(bc)) list.push(bc);
      if (parts[1]) {
        const q = Number(parts[1].replace(/,/g, ""));
        if (q > 0) qtyMap.set(bc, (qtyMap.get(bc) || 0) + q);
      }
    }
    setBarcodes(list);
    setImportedQty(qtyMap);
    setPrepared(null);
    setRows([]);
    toast({
      title: `Import สำเร็จ`,
      description: `${list.length} barcode${qtyMap.size > 0 ? ` · มี Qty ${qtyMap.size} รายการ` : ""}`,
    });
    setImportOpen(false);
    setPasteText("");
  };

  // ============ VENDOR OVERRIDE IMPORT (SKU + Vendor) ============
  // Excel: 2 cols [SKU_Code, Vendor]. Replaces vendor_code + vendor_display in matched rows.
  const handleVendorOverrideFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (json.length === 0) {
          toast({ title: "ไฟล์ว่าง", variant: "destructive" });
          return;
        }
        const sample = json[0] || {};
        const keys = Object.keys(sample);
        const skuCol = keys.find(k => /sku|item|รหัส/i.test(k)) || keys[0];
        const vendorCol = keys.find(k => /vendor|partner|supplier|ผู้ขาย/i.test(k)) || keys[1];
        if (!skuCol || !vendorCol) {
          toast({ title: "ต้องมีคอลัมน์ SKU และ Vendor", variant: "destructive" });
          return;
        }
        const map = new Map<string, { vendor_code: string; vendor_display_name?: string }>();
        for (const r of json) {
          const sku = String(r[skuCol] ?? "").trim();
          const vendor = String(r[vendorCol] ?? "").trim();
          if (!sku || !vendor) continue;
          // Vendor field may be "VC001 - Display Name" or just code
          const dashIdx = vendor.indexOf(" - ");
          const code = dashIdx > 0 ? vendor.slice(0, dashIdx).trim() : vendor;
          const display = dashIdx > 0 ? vendor.slice(dashIdx + 3).trim() : undefined;
          map.set(sku, { vendor_code: code, vendor_display_name: display });
        }
        if (map.size === 0) {
          toast({ title: "ไม่พบข้อมูลให้ override", variant: "destructive" });
          return;
        }
        setVendorOverrides(map);
        // Apply immediately to current rows (if Read already done)
        if (rows.length > 0) {
          setRows(prev => prev.map(r => {
            const ov = map.get(r.sku_code);
            if (!ov) return r;
            const display = ov.vendor_display_name
              ? `${ov.vendor_code} - ${ov.vendor_display_name}`
              : ov.vendor_code;
            return { ...r, vendor_code: ov.vendor_code, vendor_display: display };
          }));
        }
        toast({ title: "Override Vendor สำเร็จ", description: `${map.size} SKU` });
        setVendorOverrideOpen(false);
      } catch (err: any) {
        toast({ title: "Import ไม่สำเร็จ", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ============ PREPARE ============
  const prepareData = async () => {
    if (preparing) {
      prepAbortRef.current.aborted = true;
      return;
    }
    if (barcodes.length === 0) { toast({ title: "กรุณา Import Barcodes ก่อน", variant: "destructive" }); return; }
    if (selectedGroups.size === 0) { toast({ title: "เลือกอย่างน้อย 1 กลุ่มคอลัมน์", variant: "destructive" }); return; }

    prepAbortRef.current = { aborted: false };
    setPreparing(true);
    setPrepProgress(0);
    setPrepStage("ค้นหา barcode ใน Data Master...");

    try {
      // Always-loaded core fields (needed regardless of group toggles for vendor lookup, replenishment, names)
      const selectParts: string[] = [
        "sku_code", "main_barcode", "barcode", "vendor_code", "vendor_display_name",
        "stock_unit_flag", "replenishment_type",
        "product_name_la", "product_name_en", "buying_status", "item_type",
      ];
      if (selectedGroups.has("classification")) selectParts.push("division_group", "division", "department", "sub_department", "class", "sub_class", "po_group");
      if (selectedGroups.has("pack")) selectParts.push("unit_of_measure", "packing_size_qty");
      if (selectedGroups.has("price")) selectParts.push("list_price", "standard_price");
      const selectStr = [...new Set(selectParts)].join(", ");

      const CHUNK = 200;
      const matchRows: any[] = [];
      for (let i = 0; i < barcodes.length; i += CHUNK) {
        if (prepAbortRef.current.aborted) throw new Error("__ABORTED__");
        const slice = barcodes.slice(i, i + CHUNK);
        const { data: byMain, error: e1 } = await (supabase as any)
          .from("data_master").select("sku_code").in("main_barcode", slice);
        if (e1) throw e1;
        const { data: byBc, error: e2 } = await (supabase as any)
          .from("data_master").select("sku_code").in("barcode", slice);
        if (e2) throw e2;
        const { data: bySku, error: e3 } = await (supabase as any)
          .from("data_master").select("sku_code").in("sku_code", slice);
        if (e3) throw e3;
        matchRows.push(...(byMain || []), ...(byBc || []), ...(bySku || []));
        setPrepProgress(15 + Math.round((i / barcodes.length) * 30));
      }
      // Use SKU_Code as the grouping key — load ALL data_master rows sharing these SKUs
      // (covers Pack/Box that may live under different main_barcode values within the same SKU)
      const skuCodes = [...new Set(matchRows.map(r => r.sku_code).filter(Boolean))];

      // Track barcodes that did NOT match any data_master row
      const matchedKeySet = new Set<string>();
      // Re-fetch to know which input barcodes matched (build from matchRows path: but matchRows has sku_code only)
      // Simpler: query a second time mapping input → matched
      const inputMatchSet = new Set<string>();
      for (let i = 0; i < barcodes.length; i += CHUNK) {
        const slice = barcodes.slice(i, i + CHUNK);
        const { data: a } = await (supabase as any).from("data_master").select("main_barcode,barcode,sku_code").in("main_barcode", slice);
        const { data: b } = await (supabase as any).from("data_master").select("main_barcode,barcode,sku_code").in("barcode", slice);
        const { data: c } = await (supabase as any).from("data_master").select("main_barcode,barcode,sku_code").in("sku_code", slice);
        for (const r of [...(a || []), ...(b || []), ...(c || [])]) {
          if (r.main_barcode && slice.includes(r.main_barcode)) inputMatchSet.add(r.main_barcode);
          if (r.barcode && slice.includes(r.barcode)) inputMatchSet.add(r.barcode);
          if (r.sku_code && slice.includes(r.sku_code)) inputMatchSet.add(r.sku_code);
        }
      }
      const skippedBarcodes = barcodes.filter(b => !inputMatchSet.has(b));
      const newSkips: SkippedItem[] = skippedBarcodes.map(k => ({
        kind: "sku" as const,
        key: k,
        reason: "ไม่พบใน Data Master",
        detail: `barcode/SKU "${k}" ไม่มีใน main_barcode, barcode หรือ sku_code`,
        original: importedQty.has(k) ? { Barcode: k, Qty: importedQty.get(k) } : { Barcode: k },
      }));

      if (skuCodes.length === 0) {
        setSkippedItems(newSkips);
        toast({ title: "ไม่พบ barcode ใน Data Master", variant: "destructive" });
        setPreparing(false);
        return;
      }

      setPrepStage(`โหลดสินค้า ${skuCodes.length} SKU...`);
      setPrepProgress(50);
      const dmAll: any[] = [];
      for (let i = 0; i < skuCodes.length; i += CHUNK) {
        if (prepAbortRef.current.aborted) throw new Error("__ABORTED__");
        const slice = skuCodes.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("data_master").select(selectStr).in("sku_code", slice);
        if (error) throw error;
        dmAll.push(...(data || []));
        setPrepProgress(50 + Math.round((i / skuCodes.length) * 45));
      }

      const familyByMain = new Map<string, any[]>();
      const familyBySku = new Map<string, any[]>();
      const byBarcode = new Map<string, any>();
      for (const dm of dmAll) {
        const mb = dm.main_barcode || "";
        if (!familyByMain.has(mb)) familyByMain.set(mb, []);
        familyByMain.get(mb)!.push(dm);
        const sk = dm.sku_code || "";
        if (sk) {
          if (!familyBySku.has(sk)) familyBySku.set(sk, []);
          familyBySku.get(sk)!.push(dm);
        }
        if (dm.main_barcode) byBarcode.set(dm.main_barcode, dm);
        if (dm.barcode) byBarcode.set(dm.barcode, dm);
        // Also key by sku_code so users can mix Barcode + SKU Code in the same import column
        if (dm.sku_code && !byBarcode.has(dm.sku_code)) byBarcode.set(dm.sku_code, dm);
      }

      // Add Inactive items as additional skips
      for (const dm of dmAll) {
        if (dm.buying_status && /inactive/i.test(dm.buying_status)) {
          const k = dm.main_barcode || dm.barcode || dm.sku_code;
          if (k && barcodes.includes(k)) {
            newSkips.push({ kind: "sku", key: k, reason: "Inactive", detail: `buying_status: ${dm.buying_status}`, original: { Barcode: k, SKU: dm.sku_code } });
          }
        }
      }

      setPrepared({ familyByMain, familyBySku, byBarcode, rowCount: dmAll.length, preparedAt: new Date(), groups: new Set(selectedGroups) });
      setSkippedItems(newSkips);
      setPrepProgress(100);
      toast({ title: "เตรียมข้อมูลเสร็จ", description: `${dmAll.length} รายการ · พร้อม Read${newSkips.length ? ` · Skip ${newSkips.length}` : ""}` });
    } catch (err: any) {
      if (err.message === "__ABORTED__") {
        toast({ title: "ยกเลิก Prepare แล้ว" });
      } else {
        toast({ title: "Prepare ไม่สำเร็จ", description: err.message, variant: "destructive" });
      }
    } finally {
      setPreparing(false);
    }
  };

  // ============ READ ============
  const readData = async () => {
    if (reading) {
      readAbortRef.current.aborted = true;
      return;
    }
    if (!prepared) { toast({ title: "กด Prepare ก่อน", variant: "destructive" }); return; }
    readAbortRef.current = { aborted: false };
    setReading(true);
    setReadProgress(0);
    setReadStage("จับคู่ barcode กับสินค้า...");

    try {
      const { familyByMain, familyBySku, byBarcode, groups } = prepared;

      const skuRows: { imp: string; unit: any; family: any[] }[] = [];
      const seenSku = new Set<string>();
      for (const imp of barcodes) {
        const matched = byBarcode.get(imp);
        if (!matched) continue;
        // Prefer SKU family (covers Pack/Box under different main_barcode)
        const family =
          (matched.sku_code && familyBySku.get(matched.sku_code)) ||
          familyByMain.get(matched.main_barcode || "") ||
          [matched];
        // Pick best "unit" row: prefer stock_unit_flag=Y AND vendor_code present,
        // then any row with vendor_code, then stock_unit_flag=Y, else fallback
        const unit =
          family.find((d: any) => d.stock_unit_flag === "Y" && d.vendor_code) ||
          family.find((d: any) => d.vendor_code) ||
          family.find((d: any) => d.stock_unit_flag === "Y") ||
          matched;
        if (!unit.sku_code || seenSku.has(unit.sku_code)) continue;
        seenSku.add(unit.sku_code);
        skuRows.push({ imp, unit, family });
      }

      if (skuRows.length === 0) {
        toast({ title: "ไม่พบสินค้าใด ๆ ตาม barcode", variant: "destructive" });
        setReading(false);
        return;
      }

      const skuCodes = skuRows.map(s => s.unit.sku_code).filter(Boolean);
      const vendorCodes = [...new Set(skuRows.map(s => s.unit.vendor_code).filter(Boolean))];

      // ============ PARALLEL FETCH — major speed win ============
      // Run all needed table fetches concurrently. Each one is itself chunked + parallel.
      setReadStage(`โหลดข้อมูลทั้งหมดพร้อมกัน...`);
      setReadProgress(20);

      const [vms, pcs, mms, sts, sls] = await Promise.all([
        // Vendor data (currency, spc_name) — always fetch when vendors exist
        vendorCodes.length > 0
          ? fetchByIdsParallel<any>("vendor_master", "vendor_code, supplier_currency, spc_name", "vendor_code", vendorCodes as string[], readAbortRef.current)
          : Promise.resolve([] as any[]),
        groups.has("po_cost")
          ? fetchByIdsParallel<any>("po_cost", "item_id, moq, po_cost, po_cost_unit", "item_id", skuCodes, readAbortRef.current)
          : Promise.resolve([] as any[]),
        NEEDS_MINMAX(groups)
          ? (async () => {
              // อ่าน Min/Max จาก Doc ล่าสุดของ Min/Max Cal (กรองที่ DB ตาม SKU เพื่อกัน 1000-row limit)
              const { data, error } = await (supabase as any).rpc("get_latest_minmax_for_skus", { p_skus: skuCodes });
              if (error) throw error;
              return ((data || []) as any[]).map((r) => ({
                item_id: r.sku_code,
                store_name: r.store_name,
                type_store: r.type_store,
                min_val: r.min_val,
                max_val: r.max_val,
              }));
            })()
          : Promise.resolve([] as any[]),
        NEEDS_STOCK(groups)
          ? fetchByIdsParallel<any>("stock", "item_id, company, type_store, quantity", "item_id", skuCodes, readAbortRef.current)
          : Promise.resolve([] as any[]),
        NEEDS_AVG(groups)
          ? fetchByIdsParallel<any>("sales_by_week", "id18, store_name, type_store, avg_day", "id18", skuCodes, readAbortRef.current)
          : Promise.resolve([] as any[]),
      ]);

      setReadProgress(85);
      setReadStage(`ประมวลผล...`);

      const vmMap = new Map<string, any>();
      for (const v of vms) if (v.vendor_code && !vmMap.has(v.vendor_code)) vmMap.set(v.vendor_code, v);
      const pcMap = new Map<string, any>();
      for (const p of pcs) if (p.item_id && !pcMap.has(p.item_id)) pcMap.set(p.item_id, p);

      setPerStoreData({ minmax: mms, stock: sts, sales: sls });

      // Collect store_name -> type_store map (priority: minmax > stock > sales)
      const stMap = new Map<string, string>();
      const tMin = new Set<string>(), tStk = new Set<string>(), tAvg = new Set<string>();
      for (const m of mms) {
        if (m.store_name && m.type_store && !stMap.has(m.store_name)) stMap.set(m.store_name, m.type_store);
        if (m.type_store) tMin.add(m.type_store);
      }
      for (const s of sts) {
        if (s.company && s.type_store && s.type_store !== "DC" && !stMap.has(s.company)) stMap.set(s.company, s.type_store);
        if (s.type_store && s.type_store !== "DC") tStk.add(s.type_store);
      }
      for (const sl of sls) {
        if (sl.store_name && sl.type_store && !stMap.has(sl.store_name)) stMap.set(sl.store_name, sl.type_store);
        if (sl.type_store) tAvg.add(sl.type_store);
      }
      const storeNames = [...stMap.keys()].sort((a, b) => {
        const ta = stMap.get(a) || "";
        const tb = stMap.get(b) || "";
        if (ta !== tb) return ta.localeCompare(tb);
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      });
      setStoreTypeMap(stMap);
      setAllStoreNames(storeNames);
      setTypeStoresMinMax([...tMin].sort());
      setTypeStoresStock([...tStk].sort());
      setTypeStoresAvg([...tAvg].sort());
      // Reset filters on new Read
      setPendingStoreMinMax([]); setPendingStoreStock([]); setPendingStoreAvg([]);
      setPendingTypeMinMax([]); setPendingTypeStock([]); setPendingTypeAvg([]);
      setAppliedStoreMinMax([]); setAppliedStoreStock([]); setAppliedStoreAvg([]);
      setAppliedTypeMinMax([]); setAppliedTypeStock([]); setAppliedTypeAvg([]);

      setReadProgress(95);

      // Pack/Box debug counters
      let packFound = 0, boxFound = 0;

      const built = skuRows.map((s, idx): SpecialRow => {
        const u = s.unit;
        // Pack/Box: lookup ALL data_master rows with same sku_code, find min packing_size_qty per uom
        const skuFamily = familyBySku.get(u.sku_code) || s.family;
        const vm = vmMap.get(u.vendor_code) || {};
        const pc = pcMap.get(u.sku_code) || {};

        const packQtys = skuFamily
          .filter((f: any) => (f.unit_of_measure || "").trim().toLowerCase() === "pack" && Number(f.packing_size_qty) > 0)
          .map((f: any) => Number(f.packing_size_qty));
        const boxQtys = skuFamily
          .filter((f: any) => (f.unit_of_measure || "").trim().toLowerCase() === "box" && Number(f.packing_size_qty) > 0)
          .map((f: any) => Number(f.packing_size_qty));
        if (packQtys.length > 0) packFound++;
        if (boxQtys.length > 0) boxFound++;

        const costStd = Number(u.standard_price) || 0;
        const moq = Number(pc.moq) || 1;
        const poCost = Number(pc.po_cost) || 0;
        // Po Cost Unit = Po Cost / 1x (MOQ) — calculated, not from DB
        const poCostUnit = moq > 0 ? poCost / moq : 0;

        // Imported quantity (if user provided Qty column)
        const impQty = importedQty.get(s.imp) || 0;
        const unitForRound = boxQtys.length > 0 ? Math.min(...boxQtys) : (packQtys.length > 0 ? Math.min(...packQtys) : 1);
        const roundedQty = impQty > 0 ? Math.ceil(impQty / unitForRound) * unitForRound : 0;

        return {
          id: `sp-${idx}-${u.sku_code}`,
          division_group: u.division_group || "", division: u.division || "",
          department: u.department || "", sub_department: u.sub_department || "",
          class: u.class || "", sub_class: u.sub_class || "",
          po_group: u.po_group || "", replenishment_type: u.replenishment_type || "",
          vendor_code: u.vendor_code || "",
          vendor_display: u.vendor_code ? `${u.vendor_code} - ${u.vendor_display_name || ""}` : "",
          currency: vm.supplier_currency || "",
          spc_name: vm.spc_name || "",
          imp_barcode: s.imp, sku_code: u.sku_code || "", main_barcode: u.main_barcode || "",
          product_name_la: u.product_name_la || "", product_name_en: u.product_name_en || "",
          buying_status: u.buying_status || "", item_type: u.item_type || "",
          pack_qty: packQtys.length > 0 ? Math.min(...packQtys) : 0,
          box_qty: boxQtys.length > 0 ? Math.min(...boxQtys) : 0,
          price: Number(u.list_price) || 0,
          cost_std: costStd,
          po_cost: poCost,
          moq,
          po_cost_unit: poCostUnit,
          min_by_store: {}, max_by_store: {}, stock_by_store: {}, avg_by_store: {},
          min_all: 0, max_all: 0, stock_dc: 0, stock_all: 0, stock_all_dc: 0, avg_all: 0,
          quantity: roundedQty,
        };
      });

      // Apply Vendor Override (from "Import [SKU, Vendor]" file) — replaces vendor_code + vendor_display
      if (vendorOverrides.size > 0) {
        for (const r of built) {
          const ov = vendorOverrides.get(r.sku_code);
          if (!ov) continue;
          r.vendor_code = ov.vendor_code;
          r.vendor_display = ov.vendor_display_name
            ? `${ov.vendor_code} - ${ov.vendor_display_name}`
            : ov.vendor_code;
        }
      }

      // Helpful debug for user when Pack/Box stays at 0
      console.log(`[Special Order] Pack/Box detection: pack=${packFound}/${built.length} · box=${boxFound}/${built.length}`);
      if (packFound === 0 && boxFound === 0) {
        const sampleSku = skuRows[0]?.unit?.sku_code;
        const sampleFamily = familyBySku.get(sampleSku) || skuRows[0]?.family || [];
        console.warn(
          `[Special Order] No Pack/Box found. Sample SKU=${sampleSku} → UOM list:`,
          sampleFamily.map((f: any) => ({ uom: f.unit_of_measure, qty: f.packing_size_qty, barcode: f.barcode }))
        );
      }

      setRows(built);
      setReadProgress(100);
      const qtyMsg = importedQty.size > 0 ? ` · ใส่ Qty ${built.filter(b => b.quantity > 0).length} แถว` : "";
      toast({ title: `Read สำเร็จ`, description: `${built.length} รายการ · ${storeNames.length} stores${qtyMsg}` });
    } catch (err: any) {
      if (err.message === "__ABORTED__") {
        toast({ title: "ยกเลิก Read แล้ว" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setReading(false);
    }
  };

  // ============ Re-aggregate when APPLIED filters or data change ============
  useEffect(() => {
    if (rows.length === 0) return;

    const minMaxStoreSet = appliedStoreMinMax.length > 0 ? new Set(appliedStoreMinMax) : null;
    const stockStoreSet = appliedStoreStock.length > 0 ? new Set(appliedStoreStock) : null;
    const avgStoreSet = appliedStoreAvg.length > 0 ? new Set(appliedStoreAvg) : null;
    const minMaxTypeSet = appliedTypeMinMax.length > 0 ? new Set(appliedTypeMinMax) : null;
    const stockTypeSet = appliedTypeStock.length > 0 ? new Set(appliedTypeStock) : null;
    const avgTypeSet = appliedTypeAvg.length > 0 ? new Set(appliedTypeAvg) : null;

    const minPS = new Map<string, Record<string, number>>();
    const maxPS = new Map<string, Record<string, number>>();
    const minAll = new Map<string, number>();
    const maxAll = new Map<string, number>();
    for (const m of perStoreData.minmax) {
      const sn = m.store_name || "";
      const ts = m.type_store || "";
      const k = m.item_id || "";
      minAll.set(k, (minAll.get(k) || 0) + (Number(m.min_val) || 0));
      maxAll.set(k, (maxAll.get(k) || 0) + (Number(m.max_val) || 0));
      if (minMaxStoreSet && !minMaxStoreSet.has(sn)) continue;
      if (minMaxTypeSet && !minMaxTypeSet.has(ts)) continue;
      const mp = minPS.get(k) || {}; mp[sn] = (mp[sn] || 0) + (Number(m.min_val) || 0); minPS.set(k, mp);
      const xp = maxPS.get(k) || {}; xp[sn] = (xp[sn] || 0) + (Number(m.max_val) || 0); maxPS.set(k, xp);
    }

    const stockPS = new Map<string, Record<string, number>>();
    const stockAll = new Map<string, number>();
    const stockDc = new Map<string, number>();
    for (const s of perStoreData.stock) {
      const k = s.item_id || "";
      const ts = s.type_store || "";
      const sn = s.company || "";
      const qty = Number(s.quantity) || 0;
      if (ts === "DC") {
        stockDc.set(k, (stockDc.get(k) || 0) + qty);
        continue;
      }
      stockAll.set(k, (stockAll.get(k) || 0) + qty);
      if (stockStoreSet && !stockStoreSet.has(sn)) continue;
      if (stockTypeSet && !stockTypeSet.has(ts)) continue;
      const sp = stockPS.get(k) || {}; sp[sn] = (sp[sn] || 0) + qty; stockPS.set(k, sp);
    }

    const avgPS = new Map<string, Record<string, number>>();
    const avgAll = new Map<string, number>();
    for (const sl of perStoreData.sales) {
      const k = sl.id18 || "";
      const sn = sl.store_name || "";
      const ts = sl.type_store || "";
      const v = Number(sl.avg_day) || 0;
      avgAll.set(k, (avgAll.get(k) || 0) + v);
      if (avgStoreSet && !avgStoreSet.has(sn)) continue;
      if (avgTypeSet && !avgTypeSet.has(ts)) continue;
      const ap = avgPS.get(k) || {}; ap[sn] = (ap[sn] || 0) + v; avgPS.set(k, ap);
    }

    setRows(prev => prev.map(r => {
      const dc = stockDc.get(r.sku_code) || 0;
      const sa = stockAll.get(r.sku_code) || 0;
      return {
        ...r,
        min_by_store: minPS.get(r.sku_code) || {},
        max_by_store: maxPS.get(r.sku_code) || {},
        stock_by_store: stockPS.get(r.sku_code) || {},
        avg_by_store: avgPS.get(r.sku_code) || {},
        min_all: minAll.get(r.sku_code) || 0,
        max_all: maxAll.get(r.sku_code) || 0,
        stock_dc: dc,
        stock_all: sa,
        stock_all_dc: sa + dc,
        avg_all: Math.round((avgAll.get(r.sku_code) || 0) * 100) / 100,
      };
    }));
  }, [appliedStoreMinMax, appliedStoreStock, appliedStoreAvg, appliedTypeMinMax, appliedTypeStock, appliedTypeAvg, perStoreData]);

  const updateQuantity = (id: string, val: string) => {
    const num = Number(val);
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      if (!val || isNaN(num) || num <= 0) return { ...r, quantity: 0 };
      const unit = r.box_qty > 0 ? r.box_qty : (r.pack_qty > 0 ? r.pack_qty : 1);
      const rounded = Math.ceil(num / unit) * unit;
      return { ...r, quantity: rounded };
    }));
  };

  // Per-store columns are filtered by their applied type filter and sorted by type_store, store_name
  const storesForGroup = useMemo(() => {
    const filterByType = (typeFilter: string[]): string[] => {
      if (typeFilter.length === 0) return allStoreNames;
      const tset = new Set(typeFilter);
      return allStoreNames.filter(sn => tset.has(storeTypeMap.get(sn) || ""));
    };
    return {
      minmax: filterByType(appliedTypeMinMax),
      stock: filterByType(appliedTypeStock),
      avg: filterByType(appliedTypeAvg),
    };
  }, [allStoreNames, storeTypeMap, appliedTypeMinMax, appliedTypeStock, appliedTypeAvg]);

  // Build dynamic column list (per-store cross-tab cols, sorted by type_store > store_name)
  const allColumns = useMemo<ColDef[]>(() => {
    const groups = prepared?.groups || selectedGroups;
    const out: ColDef[] = [];

    const pushPerStore = (perStore: "min" | "max" | "stock" | "avg", group: GroupKey, prefix: string) => {
      if (!groups.has(group)) return;
      const list = perStore === "min" || perStore === "max" ? storesForGroup.minmax
                 : perStore === "stock" ? storesForGroup.stock
                 : storesForGroup.avg;
      for (const sn of list) {
        out.push({ key: `${perStore}_s::${sn}`, label: `${prefix} ${sn}`, group, width: 100, numeric: true, perStore, storeName: sn });
      }
    };

    for (const c of STATIC_COLS) {
      if (!groups.has(c.group)) continue;
      // Inject per-store cols just before their corresponding aggregate
      if (c.key === "min_all") pushPerStore("min", "minmax_per", "Min");
      if (c.key === "max_all") pushPerStore("max", "minmax_per", "Max");
      if (c.key === "stock_dc") {
        // stock_dc itself is in stock_per group, then per-store cols, then stock_all/stock_all_dc
      }
      if (c.key === "stock_all") pushPerStore("stock", "stock_per", "Stock");
      if (c.key === "avg_all") pushPerStore("avg", "avg_per", "Avg");
      out.push(c);
    }
    return out;
  }, [storesForGroup, prepared, selectedGroups]);

  const displayColumns = useMemo(() => allColumns.filter(c => !hiddenCols.has(c.key)), [allColumns, hiddenCols]);

  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      r.sku_code.toLowerCase().includes(s) ||
      r.imp_barcode.toLowerCase().includes(s) ||
      r.main_barcode.toLowerCase().includes(s) ||
      r.product_name_la.toLowerCase().includes(s) ||
      r.product_name_en.toLowerCase().includes(s) ||
      r.vendor_display.toLowerCase().includes(s)
    );
  }, [rows, search]);

  const getCellValue = (row: SpecialRow, c: ColDef): any => {
    if (c.perStore === "min") return row.min_by_store[c.storeName!] || 0;
    if (c.perStore === "max") return row.max_by_store[c.storeName!] || 0;
    if (c.perStore === "stock") return row.stock_by_store[c.storeName!] || 0;
    if (c.perStore === "avg") return row.avg_by_store[c.storeName!] || 0;
    return (row as any)[c.key];
  };

  const exportData = () => {
    if (rows.length === 0) return;
    const exportRows = rows.map(r => {
      const obj: any = {};
      for (const c of displayColumns) obj[c.label] = getCellValue(r, c);
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Special Order");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    XLSX.writeFile(wb, `special-order-${ts}.xlsx`);
  };

  const totalQty = useMemo(() => rows.reduce((s, r) => s + r.quantity, 0), [rows]);

  const toggleGroup = (k: GroupKey) => {
    setSelectedGroups(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const minMaxOpts = useMemo(() => typeStoresMinMax.map(t => ({ value: t, display: t })), [typeStoresMinMax]);
  const stockOpts = useMemo(() => typeStoresStock.map(t => ({ value: t, display: t })), [typeStoresStock]);
  const avgOpts = useMemo(() => typeStoresAvg.map(t => ({ value: t, display: t })), [typeStoresAvg]);

  // Cascade: store options narrow to those whose type matches the selected type filter
  const storeOptsMinMax = useMemo(() => {
    const tset = pendingTypeMinMax.length > 0 ? new Set(pendingTypeMinMax) : null;
    return allStoreNames
      .filter(s => !tset || tset.has(storeTypeMap.get(s) || ""))
      .map(s => ({ value: s, display: s }));
  }, [allStoreNames, storeTypeMap, pendingTypeMinMax]);
  const storeOptsStock = useMemo(() => {
    const tset = pendingTypeStock.length > 0 ? new Set(pendingTypeStock) : null;
    return allStoreNames
      .filter(s => !tset || tset.has(storeTypeMap.get(s) || ""))
      .map(s => ({ value: s, display: s }));
  }, [allStoreNames, storeTypeMap, pendingTypeStock]);
  const storeOptsAvg = useMemo(() => {
    const tset = pendingTypeAvg.length > 0 ? new Set(pendingTypeAvg) : null;
    return allStoreNames
      .filter(s => !tset || tset.has(storeTypeMap.get(s) || ""))
      .map(s => ({ value: s, display: s }));
  }, [allStoreNames, storeTypeMap, pendingTypeAvg]);

  // Show button: detect pending != applied
  const filtersDirty =
    JSON.stringify([...pendingStoreMinMax].sort()) !== JSON.stringify([...appliedStoreMinMax].sort()) ||
    JSON.stringify([...pendingStoreStock].sort()) !== JSON.stringify([...appliedStoreStock].sort()) ||
    JSON.stringify([...pendingStoreAvg].sort()) !== JSON.stringify([...appliedStoreAvg].sort()) ||
    JSON.stringify([...pendingTypeMinMax].sort()) !== JSON.stringify([...appliedTypeMinMax].sort()) ||
    JSON.stringify([...pendingTypeStock].sort()) !== JSON.stringify([...appliedTypeStock].sort()) ||
    JSON.stringify([...pendingTypeAvg].sort()) !== JSON.stringify([...appliedTypeAvg].sort());

  const applyFilters = () => {
    setAppliedStoreMinMax(pendingStoreMinMax);
    setAppliedStoreStock(pendingStoreStock);
    setAppliedStoreAvg(pendingStoreAvg);
    setAppliedTypeMinMax(pendingTypeMinMax);
    setAppliedTypeStock(pendingTypeStock);
    setAppliedTypeAvg(pendingTypeAvg);
  };

  // ============ Save / Load / Delete documents (Tab 2) ============
  const confirmSave = () => {
    if (rows.length === 0) {
      toast({ title: "ไม่มีข้อมูลให้บันทึก", variant: "destructive" });
      return;
    }
    const filename = tsFilename(saveName);
    const doc: SavedSpecialDoc = {
      id: `sd-${Date.now()}`,
      name: saveName.trim() || "untitled",
      filename,
      created_at: new Date().toISOString(),
      rows,
      columns: displayColumns.map(c => c.key),
      storeNames: allStoreNames,
      storeTypeMap: [...storeTypeMap.entries()],
      selectedGroups: [...(prepared?.groups || selectedGroups)],
    };
    const next = [doc, ...savedDocs];
    setSavedDocs(next);
    saveSpecialDocs(next);
    setSaveOpen(false);
    setSaveName("");
    toast({ title: "บันทึกเป็น Document แล้ว", description: filename });
  };

  // ============ Save PO (Special) — ส่งไปยัง "List Import PO (Special)" ============
  // Spec: Picking Type=2540 (DC), Inter Transfer=ว่าง, group by SPC/วันที่/Vendor
  const savePOSpecial = () => {
    try {
      const eligibleRows = rows.filter(r => r.quantity > 0 && r.vendor_code);
      if (eligibleRows.length === 0) {
        toast({ title: "ไม่มีรายการที่มี Quantity > 0", variant: "destructive" });
        return;
      }
      const description = poDescription.trim();
      const now = new Date();
      const ts = now.getFullYear().toString()
        + String(now.getMonth() + 1).padStart(2, "0")
        + String(now.getDate()).padStart(2, "0")
        + String(now.getHours()).padStart(2, "0")
        + String(now.getMinutes()).padStart(2, "0")
        + String(now.getSeconds()).padStart(2, "0");
      const spcManager = "SPC manager01";
      const pickingDbId = "2540";   // DC fixed
      const interTransfer = "";      // DC = empty

      // Group by Vendor (each vendor = 1 PO doc)
      const vendorMap = new Map<string, SpecialRow[]>();
      for (const r of eligibleRows) {
        const arr = vendorMap.get(r.vendor_code) || [];
        arr.push(r);
        vendorMap.set(r.vendor_code, arr);
      }

      const STORAGE_KEY = "srr_saved_pos_special";
      const existing = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
      })();
      const newPOs: any[] = [];

      for (const [vc, vRows] of vendorMap) {
        const first = vRows[0];
        const exportRows = vRows.map((r, idx) => ({
          "partner_id": idx === 0 ? r.vendor_code : "",
          "Picking Type / Database ID": idx === 0 ? pickingDbId : "",
          "Inter Transfer": idx === 0 ? interTransfer : "",
          "Products to Purchase/barcode": r.main_barcode,
          "Products to Purchase/Product": r.main_barcode,
          "Product name": r.product_name_la,
          "Products to Purchase/UoM": r.main_barcode ? "Unit" : "",
          "Products to Purchase/Exclude In Package": "True",
          "Products to Purchase/Quantity": r.quantity,
          "Products to Purchase/Unit Price": r.po_cost_unit,
          "assigned_to": idx === 0 ? spcManager : "",
          "description": idx === 0 ? description : "",
        }));
        newPOs.push({
          id: `po-sp-${ts}-${vc}`,
          name: `${ts} - ${vc} - ${first.vendor_display.replace(`${vc} - `, "")}`,
          date: now.toISOString(),
          vendor_code: vc,
          vendor_name: first.vendor_display.replace(`${vc} - `, ""),
          spc_name: first.spc_name || "Special Order",
          rows: exportRows,
          pickingType: pickingDbId,
          description,
        });
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...newPOs]));
      } catch {
        toast({ title: "พื้นที่จัดเก็บเต็ม", description: "กรุณาลบ PO เก่าในเมนู List Import PO (Special)", variant: "destructive" });
        return;
      }
      toast({
        title: "บันทึก PO สำเร็จ",
        description: `${newPOs.length} เอกสาร · ดูที่เมนู "List Import PO (Special)"`,
      });
      setSavePOOpen(false);
      setPoDescription("");
    } catch (err: any) {
      toast({ title: "บันทึก PO ไม่สำเร็จ", description: err.message, variant: "destructive" });
    }
  };

  const loadDocument = (doc: SavedSpecialDoc) => {
    setRows(doc.rows);
    setAllStoreNames(doc.storeNames);
    setStoreTypeMap(new Map(doc.storeTypeMap));
    setSelectedGroups(new Set(doc.selectedGroups));
    setHiddenCols(new Set()); // show all
    // Reset filters so loaded data displays as saved
    setPendingStoreMinMax([]); setPendingStoreStock([]); setPendingStoreAvg([]);
    setPendingTypeMinMax([]); setPendingTypeStock([]); setPendingTypeAvg([]);
    setAppliedStoreMinMax([]); setAppliedStoreStock([]); setAppliedStoreAvg([]);
    setAppliedTypeMinMax([]); setAppliedTypeStock([]); setAppliedTypeAvg([]);
    // Re-derive perStoreData empty (loaded rows already contain per-store maps)
    setActiveTab("order");
    toast({ title: "โหลด Document แล้ว", description: doc.filename });
  };

  const deleteDocument = (id: string) => {
    const next = savedDocs.filter(d => d.id !== id);
    setSavedDocs(next);
    saveSpecialDocs(next);
    toast({ title: "ลบแล้ว" });
  };

  const exportDocument = (doc: SavedSpecialDoc) => {
    const cols = doc.columns.length > 0
      ? doc.columns.map(k => allColumns.find(c => c.key === k) || STATIC_COLS.find(c => c.key === k)).filter(Boolean) as ColDef[]
      : displayColumns;
    const exportRows = doc.rows.map(r => {
      const obj: any = {};
      for (const c of cols) {
        const val = c.perStore === "min" ? r.min_by_store[c.storeName!]
                  : c.perStore === "max" ? r.max_by_store[c.storeName!]
                  : c.perStore === "stock" ? r.stock_by_store[c.storeName!]
                  : c.perStore === "avg" ? r.avg_by_store[c.storeName!]
                  : (r as any)[c.key];
        obj[c.label] = val ?? "";
      }
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Special Order");
    XLSX.writeFile(wb, `${doc.filename}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">Special Order</h1>
          <p className="text-xs text-muted-foreground">
            {barcodes.length > 0 ? `📋 ${barcodes.length} barcodes · ` : ""}
            {prepared ? `🟢 Prepared (${prepared.rowCount} rows) · ` : ""}
            {rows.length > 0 ? `${rows.length} รายการ · Quantity รวม ${totalQty.toLocaleString()}` : "Import → Select Groups → Prepare → Read"}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-2 bg-card border-b border-border">
          <TabsList className="h-8">
            <TabsTrigger value="order" className="text-xs gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Order</TabsTrigger>
            <TabsTrigger value="document" className="text-xs gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Document {savedDocs.length > 0 && `(${savedDocs.length})`}</TabsTrigger>
            <TabsTrigger value="list-po" className="text-xs gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> List Import PO</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="order" className="flex-1 flex flex-col overflow-hidden mt-0">
          {/* Row 1: Action bar (Import / Prepare / Read / Columns) */}
          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-card border-b border-border flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5 h-8 text-xs">
              <Upload className="w-3.5 h-3.5" /> 1. Import Barcodes
            </Button>
            <Button variant="outline" size="sm" onClick={() => setVendorOverrideOpen(true)} className="gap-1.5 h-8 text-xs"
              title="Import [SKU, Vendor] เพื่อแทนค่า Vendor">
              <Upload className="w-3.5 h-3.5" /> Vendor Override{vendorOverrides.size > 0 ? ` (${vendorOverrides.size})` : ""}
            </Button>
            {barcodes.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setBarcodes([]); setImportedQty(new Map()); setVendorOverrides(new Map()); setRows([]); setPrepared(null); }} className="gap-1 h-8 text-xs text-destructive">
                <Trash2 className="w-3 h-3" /> Clear ({barcodes.length})
              </Button>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                  <Columns className="w-3.5 h-3.5" /> 2. กลุ่มคอลัมน์ ({selectedGroups.size}/{GROUP_DEFS.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-2 bg-popover z-50" align="start">
                <div className="text-xs font-semibold mb-2 px-1">เลือกกลุ่มข้อมูลที่จะโหลด</div>
                <ScrollArea className="h-80">
                  {GROUP_DEFS.map(g => (
                    <label key={g.key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer">
                      <Checkbox checked={selectedGroups.has(g.key)} onCheckedChange={() => toggleGroup(g.key)} />
                      <span className="text-xs">{g.label}</span>
                    </label>
                  ))}
                </ScrollArea>
              </PopoverContent>
            </Popover>

            <Button onClick={prepareData} disabled={barcodes.length === 0} size="sm" variant={prepared ? "outline" : "default"} className="gap-1.5 h-8 text-xs">
              {preparing ? <><StopCircle className="w-3.5 h-3.5" /> หยุด</> : <><Database className="w-3.5 h-3.5" /> {prepared ? "Re-Prepare" : "3. Prepare"}</>}
            </Button>

            <Button onClick={readData} disabled={!preparing && !prepared} size="sm" className="gap-1.5 h-8 text-xs">
              {reading ? <><StopCircle className="w-3.5 h-3.5" /> หยุด</> : <><Play className="w-3.5 h-3.5" /> 4. Read</>}
            </Button>

            {skippedItems.length > 0 && (
              <ImportSkipBar
                count={skippedItems.length}
                context="Special Order Import"
                items={skippedItems}
                title="srr_special_order"
                onClear={() => setSkippedItems([])}
              />
            )}

            {rows.length > 0 && (
              <Popover open={colSelectorOpen} onOpenChange={setColSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                    <Columns className="w-3.5 h-3.5" /> คอลัมน์ ({displayColumns.length}/{allColumns.length})
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2 bg-popover z-50" align="start">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs font-semibold">ซ่อน/แสดงคอลัมน์</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setHiddenCols(new Set())}>
                      <CheckSquare className="w-3 h-3 mr-1" /> แสดงทั้งหมด
                    </Button>
                  </div>
                  <ScrollArea className="h-80">
                    {allColumns.map(c => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer">
                        <Checkbox checked={!hiddenCols.has(c.key)} onCheckedChange={(v) => {
                          setHiddenCols(prev => { const n = new Set(prev); v ? n.delete(c.key) : n.add(c.key); return n; });
                        }} />
                        <span className="text-xs truncate">{c.label}</span>
                      </label>
                    ))}
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}

            {rows.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-40 text-xs" />
                  {search && <button onClick={() => setSearch("")}><X className="w-3 h-3 text-muted-foreground" /></button>}
                </div>
                <Button variant="default" size="sm" onClick={() => { setPoDescription(""); setSavePOOpen(true); }} className="gap-1.5 h-8 text-xs">
                  <Save className="w-3.5 h-3.5" /> Save PO
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setSaveName(""); setSaveOpen(true); }} className="gap-1.5 h-8 text-xs">
                  <Save className="w-3.5 h-3.5" /> Save Doc
                </Button>
                <Button variant="outline" size="sm" onClick={exportData} className="gap-1.5 h-8 text-xs">
                  <Download className="w-3.5 h-3.5" /> Export
                </Button>
              </div>
            )}
          </div>

          {/* Row 2: Filter chips (Type/Store filters) */}
          {rows.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 bg-muted/20 border-b border-border flex-wrap">
              <MultiSelect label="Type Min/Max" options={minMaxOpts} selected={pendingTypeMinMax} onChange={setPendingTypeMinMax} />
              <MultiSelect label="Store Min/Max" options={storeOptsMinMax} selected={pendingStoreMinMax} onChange={setPendingStoreMinMax} />
              <MultiSelect label="Type Stock" options={stockOpts} selected={pendingTypeStock} onChange={setPendingTypeStock} />
              <MultiSelect label="Store Stock" options={storeOptsStock} selected={pendingStoreStock} onChange={setPendingStoreStock} />
              <MultiSelect label="Type Avg" options={avgOpts} selected={pendingTypeAvg} onChange={setPendingTypeAvg} />
              <MultiSelect label="Store Avg" options={storeOptsAvg} selected={pendingStoreAvg} onChange={setPendingStoreAvg} />
              <Button onClick={applyFilters} disabled={!filtersDirty} size="sm" variant={filtersDirty ? "default" : "outline"} className="gap-1.5 h-8 text-xs ml-1"
                title="กดเพื่อใช้ Filter">
                <Eye className="w-3.5 h-3.5" /> {filtersDirty ? "Show (มีการเปลี่ยนแปลง)" : "Show"}
              </Button>
            </div>
          )}


          {(preparing || reading) && (
            <div className="px-4 py-2 bg-muted/30 border-b border-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> {preparing ? prepStage : readStage}
                </span>
                <span className="text-xs text-muted-foreground">{preparing ? prepProgress : readProgress}%</span>
              </div>
              <Progress value={preparing ? prepProgress : readProgress} className="h-1.5" />
            </div>
          )}

          <div className="flex-1 overflow-auto bg-background">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">ยังไม่มีข้อมูล</p>
                <p className="text-xs mt-2">1. Import Barcodes → 2. เลือกกลุ่มคอลัมน์ → 3. Prepare → 4. Read</p>
              </div>
            ) : (
              <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr>
                    {displayColumns.map(c => {
                      const w = columnWidths[c.key] || c.width;
                      return (
                        <th key={c.key} style={{ width: w, minWidth: w, maxWidth: w }}
                            className={cn("relative px-2 py-2 border-b border-r border-border font-semibold text-foreground select-none", c.numeric ? "text-right" : "text-left")}>
                          {c.label}
                          <span onMouseDown={(e) => startResize(c.key, e)} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40" />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => (
                    <tr key={row.id} className={cn("hover:bg-muted/40", idx % 2 === 0 && "bg-muted/20")}>
                      {displayColumns.map(c => {
                        const w = columnWidths[c.key] || c.width;
                        if (c.key === "quantity") {
                          return (
                            <td key={c.key} style={{ width: w, minWidth: w, maxWidth: w }} className="px-1 py-0.5 border-b border-r border-border">
                              <Input type="number" value={row.quantity || ""} onChange={e => updateQuantity(row.id, e.target.value)}
                                className="h-7 text-xs text-right bg-accent/30 border-border" placeholder="0" />
                            </td>
                          );
                        }
                        const val = getCellValue(row, c);
                        return (
                          <td key={c.key} style={{ width: w, minWidth: w, maxWidth: w }}
                              className={cn("px-2 py-1.5 border-b border-r border-border truncate", c.numeric ? "text-right tabular-nums" : "text-left")}>
                            {c.numeric ? fmt(Number(val)) : String(val ?? "")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="document" className="flex-1 overflow-auto mt-0 p-4 bg-background">
          {savedDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">ยังไม่มี Document ที่บันทึก</p>
              <p className="text-xs mt-2">หลัง Read แล้ว กดปุ่ม Save เพื่อบันทึกเป็น Document</p>
            </div>
          ) : (
            <div className="space-y-2">
              {savedDocs.map(doc => (
                <div
                  key={doc.id}
                  onDoubleClick={() => setPreviewDoc(doc)}
                  title="ดับเบิลคลิกเพื่อดู Preview"
                  className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-md hover:bg-muted/40 cursor-pointer select-none"
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.rows.length.toLocaleString()} รายการ · {new Date(doc.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setPreviewDoc(doc); }} className="gap-1.5 text-xs">
                    <FileText className="w-3.5 h-3.5" /> Preview
                  </Button>
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); loadDocument(doc); }} className="gap-1.5 text-xs">
                    <FolderOpen className="w-3.5 h-3.5" /> Load
                  </Button>
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); exportDocument(doc); }} className="gap-1.5 text-xs">
                    <Download className="w-3.5 h-3.5" /> Export
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }} className="gap-1 text-xs text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="list-po" className="flex-1 overflow-auto mt-0 bg-background">
          <ListImportPO storageKey="srr_saved_pos_special" title="List Import PO (Special)" />
        </TabsContent>
      </Tabs>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>บันทึก Document</DialogTitle></DialogHeader>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              ไฟล์จะถูกบันทึกในรูปแบบ <code className="bg-muted px-1 rounded">yyyymmddhhmmss - ชื่อ</code>
            </p>
            <Input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="ชื่อ Document..." className="text-sm"
              onKeyDown={e => { if (e.key === "Enter") confirmSave(); }} />
            <p className="text-xs text-muted-foreground">
              Preview: <span className="font-mono text-foreground">{tsFilename(saveName || "ชื่อ")}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)}>ยกเลิก</Button>
            <Button size="sm" onClick={confirmSave} className="gap-1.5"><Save className="w-3.5 h-3.5" /> บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import Barcodes</DialogTitle></DialogHeader>
          <Tabs value={importTab} onValueChange={setImportTab}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="upload" className="text-xs">Upload File</TabsTrigger>
              <TabsTrigger value="paste" className="text-xs">Paste</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                เลือกไฟล์ Excel/CSV ที่มีคอลัมน์ <code className="bg-muted px-1 rounded">Barcode</code>
                <br />
                <span className="text-muted-foreground/80">
                  (ถ้าใส่คอลัมน์ <code className="bg-muted px-1 rounded">Quantity</code> หรือ <code className="bg-muted px-1 rounded">Qty</code> ด้วย จะนำไปใส่ในช่อง Quantity อัตโนมัติ)
                </span>
              </p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer" />
            </TabsContent>
            <TabsContent value="paste" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                วาง barcode บรรทัดละ 1 รายการ
                <br />
                <span className="text-muted-foreground/80">(ใส่ qty คั่นด้วย Tab/comma/space ได้: <code className="bg-muted px-1 rounded">8851111111111  10</code>)</span>
              </p>
              <Textarea value={pasteText} onChange={e => setPasteText(e.target.value)} className="text-xs h-40 font-mono" placeholder="8851111111111&#10;8851111111112" />
              <DialogFooter>
                <Button onClick={handlePasteImport} size="sm" className="gap-1.5 text-xs"><Upload className="w-3.5 h-3.5" /> Import</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog (double-click) */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Preview: {previewDoc?.filename}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {previewDoc?.rows.length.toLocaleString()} รายการ · {previewDoc && new Date(previewDoc.created_at).toLocaleString()}
            </p>
          </DialogHeader>
          {previewDoc && (() => {
            // Build full column list: prefer saved columns, else union of all keys
            const savedCols = (previewDoc as any).columns as string[] | undefined;
            const allKeys = new Set<string>();
            for (const r of previewDoc.rows.slice(0, 50)) {
              Object.keys(r as any).forEach(k => allKeys.add(k));
            }
            const cols = (savedCols && savedCols.length > 0 ? savedCols : Array.from(allKeys))
              .filter(k => k !== "id");
            const fmt = (v: any) => {
              if (v === null || v === undefined || v === "") return "";
              if (typeof v === "number") return v.toLocaleString();
              if (typeof v === "object") return JSON.stringify(v);
              return String(v);
            };
            return (
              <div className="flex-1 overflow-auto border border-border rounded-md">
                <table className="text-xs">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr>
                      {cols.map(c => (
                        <th key={c} className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewDoc.rows.slice(0, 500).map((r, i) => (
                      <tr key={(r as any).id || i} className="hover:bg-muted/40">
                        {cols.map(c => (
                          <td key={c} className="px-2 py-1 border-b border-border/50 whitespace-nowrap" title={fmt((r as any)[c])}>
                            {fmt((r as any)[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewDoc.rows.length > 500 && (
                  <p className="text-xs text-muted-foreground p-2 text-center bg-muted/30 sticky bottom-0">
                    แสดง 500 แถวแรกจาก {previewDoc.rows.length.toLocaleString()} แถว · กด Load เพื่อดูทั้งหมด
                  </p>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewDoc(null)}>ปิด</Button>
            {previewDoc && (
              <>
                <Button variant="outline" size="sm" onClick={() => exportDocument(previewDoc)} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export
                </Button>
                <Button size="sm" onClick={() => { loadDocument(previewDoc); setPreviewDoc(null); }} className="gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5" /> Load
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save PO (Special) Dialog — popup ใส่ description */}
      <Dialog open={savePOOpen} onOpenChange={setSavePOOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Save PO (Special)</DialogTitle></DialogHeader>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              ข้อมูลจะถูกส่งไปยังเมนู <code className="bg-muted px-1 rounded">List Import PO (Special)</code> โดย Group ตาม Vendor
            </p>
            <label className="text-xs font-medium">Description</label>
            <Textarea
              autoFocus
              value={poDescription}
              onChange={e => setPoDescription(e.target.value)}
              placeholder="กรอกรายละเอียด PO..."
              className="text-sm h-24"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSavePOOpen(false)}>ยกเลิก</Button>
            <Button size="sm" onClick={savePOSpecial} className="gap-1.5">
              <Save className="w-3.5 h-3.5" /> Save PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendor Override Dialog — Import [SKU, Vendor] Excel ทับค่า */}
      <Dialog open={vendorOverrideOpen} onOpenChange={setVendorOverrideOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Override Vendor</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              อัปโหลดไฟล์ Excel/CSV ที่มี 2 คอลัมน์: <code className="bg-muted px-1 rounded">SKU_Code</code> และ <code className="bg-muted px-1 rounded">Vendor</code>
              <br />
              <span className="text-muted-foreground/80">ระบบจะ match ตาม SKU แล้วเปลี่ยน vendor_code ของรายการในตาราง</span>
            </p>
            <input
              ref={vendorOverrideFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files?.[0] && handleVendorOverrideFile(e.target.files[0])}
              className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
            />
            {vendorOverrides.size > 0 && (
              <div className="text-xs bg-muted/50 rounded p-2 flex items-center justify-between">
                <span>มี Override อยู่: <strong>{vendorOverrides.size}</strong> SKU</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setVendorOverrides(new Map()); stateRef.vendorOverrides = new Map(); toast({ title: "ล้าง Override แล้ว" }); }}>
                  <X className="w-3 h-3 mr-1" /> ล้างทั้งหมด
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVendorOverrideOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
