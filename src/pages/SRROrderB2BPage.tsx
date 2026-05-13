import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Upload, Search, X, Download, FileSpreadsheet, Save, Eye,
  Database, Play, ChevronDown, ChevronRight, Trash2, CheckSquare, RefreshCw, Sigma,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

// ============================================================
// Constants
// ============================================================
const PRODUCT_OWNER = "Lanexang Green Property Sole Co.,Ltd";
const COMPANY = "Lanexang Green Property Sole Co.,Ltd";
const WAREHOUSE = "DC Thongpong";
const PRICELIST = "WSPRICE 2 (Internal B2B)";
const PICKING_DB_ID = "2540";
const SPC_MANAGER = "SPC manager01";
const SAVED_DOCS_KEY = "order_b2b_saved_docs";

// ============================================================
// Types
// ============================================================
interface B2BRow {
  id: string;
  // From import
  imp_key: string;            // user-typed barcode/sku
  product_name_imp: string;   // user-typed name (NEVER overwritten)
  qty: number;
  store_name: string;           // optional, from import — block SO/PO when present
  customer_name: string;        // optional, from import — block RO when present
  order_group: string;          // optional, from import (RO split only)
  // From data master
  sku_code: string;
  main_barcode: string;
  product_name_la: string;
  product_name_en: string;
  unit_of_measure: string;
  vendor_code: string;
  buying_status: string;
  item_type: string;
  product_owner: string;
  po_group: string;
  pack_qty: number | null;
  box_qty: number | null;
  // From vendor master
  vendor_name_en: string;
  vendor_origin: string;
  trade_term: string;
  currency: string;
  vendor_display: string;
  // From po_cost
  po_cost_unit: number;
  // From stock
  stock_dc: number;
  // skip reason (only in skipList)
  reason?: string;
}

interface SavedB2BDoc {
  id: string;
  filename: string;        // yyyymmddhhmm-name
  name: string;
  created_at: string;      // ISO
  doc_type: "so" | "po" | "ro";   // which tab it appears in
  customer_name?: string;
  source_document?: string;
  description?: string;
  rows: B2BRow[];
  /** Batch id — one per Save action. Used to group docs in list so that
   * re-saving the same customer/store creates a NEW group line. */
  batch_id?: string;
  /** Display label for batch group (yyyymmddhhmmss). */
  batch_label?: string;
}

interface SkipItem {
  imp_key: string;
  product_name_imp: string;
  reason: string;
  qty: number;
}

interface CustomerOpt {
  customer_code: string;
  name: string;
}

interface StoreOpt {
  type_store: string;
  store_name: string;
}

// ============================================================
// Helpers
// ============================================================
function tsCompact(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}
function tsCompactSec(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function newBatchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function fmt(n: number): string {
  if (n === 0 || !n) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function loadDocs(): SavedB2BDoc[] {
  try { return JSON.parse(localStorage.getItem(SAVED_DOCS_KEY) || "[]"); } catch { return []; }
}
function persistDocs(docs: SavedB2BDoc[]) {
  try { localStorage.setItem(SAVED_DOCS_KEY, JSON.stringify(docs)); }
  catch { /* quota */ }
}

// Fetch rows whose value in `inColumn` is in `ids` — chunked + parallel.
// Uses .range() pagination per chunk to bypass PostgREST 1000-row default cap.
async function fetchByIdsParallel<T>(
  table: string, selectCols: string, inColumn: string, ids: string[],
  chunkSize = 200, concurrency = 6,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const out: T[] = [];
  const PAGE = 1000;
  const fetchChunk = async (slice: string[]): Promise<T[]> => {
    const acc: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (supabase as any)
        .from(table).select(selectCols).in(inColumn, slice).range(from, from + PAGE - 1);
      if (error) throw error;
      const arr = (data || []) as T[];
      acc.push(...arr);
      if (arr.length < PAGE) break;
    }
    return acc;
  };
  for (let i = 0; i < chunks.length; i += concurrency) {
    const wave = chunks.slice(i, i + concurrency);
    const results = await Promise.all(wave.map(fetchChunk));
    for (const r of results) out.push(...r);
  }
  return out;
}

// ============================================================
// Module-level state ref (survives navigation)
// ============================================================
const stateRef: {
  importedRaw: { key: string; product_name_imp: string; qty: number; store_name: string; customer_name: string; order_group: string }[];
  rows: B2BRow[];
  skips: SkipItem[];
  activeTab: string;
} = { importedRaw: [], rows: [], skips: [], activeTab: "data" };

// ============================================================
// MultiSelect (for Tab 1 dropdown filters)
// ============================================================
function MultiSelect({ label, options, selected, onChange, width = 140 }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  width?: number;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => (o || "").toLowerCase().includes(search.toLowerCase()));
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
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange(filtered)}>เลือกทั้งหมด</Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([])}>ล้าง</Button>
        </div>
        <ScrollArea className="h-48">
          {filtered.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer">
              <Checkbox checked={selected.includes(opt)} onCheckedChange={c => onChange(c ? [...selected, opt] : selected.filter(v => v !== opt))} />
              <span className="text-xs truncate">{opt || "(ว่าง)"}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4">ไม่พบข้อมูล</p>}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function SRROrderB2BPage() {
  const { toast } = useToast();
  const { user, canDo } = useAuth();
  const MENU = "order_b2b";
  const canImport = canDo(MENU, "create");
  const canSave   = canDo(MENU, "create");
  const canExport = canDo(MENU, "export");
  const canDelete = canDo(MENU, "delete");
  const canEdit   = canDo(MENU, "edit");

  // ----- import -----
  const [importedRaw, setImportedRaw] = useState(stateRef.importedRaw);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("upload");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ----- data -----
  const [rows, setRows] = useState<B2BRow[]>(stateRef.rows);
  const [skips, setSkips] = useState<SkipItem[]>(stateRef.skips);
  const [phase1Done, setPhase1Done] = useState(rows.length > 0);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("");

  // Phase 1 cache between Get Date and Read
  const phase1CacheRef = useRef<{ rows: B2BRow[] } | null>(null);

  // ----- selection / filters -----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filVendor, setFilVendor] = useState<string[]>([]);
  const [filVendorOrigin, setFilVendorOrigin] = useState<string[]>([]);
  const [filTradeTerm, setFilTradeTerm] = useState<string[]>([]);
  const [filBuying, setFilBuying] = useState<string[]>([]);
  const [filItemType, setFilItemType] = useState<string[]>([]);
  const [stockDcMode, setStockDcMode] = useState<"none" | "gt" | "lt">("none");

  // ----- save dialogs -----
  const [savePOOpen, setSavePOOpen] = useState(false);
  const [poCustomer, setPoCustomer] = useState("");
  const [poCustomerSearch, setPoCustomerSearch] = useState("");
  const [poSourceDoc, setPoSourceDoc] = useState("");
  const [poDescription, setPoDescription] = useState("");
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);

  // ----- Save RO dialog -----
  const [saveROOpen, setSaveROOpen] = useState(false);
  const [roStores, setRoStores] = useState<StoreOpt[]>([]);
  const [roStoreSearch, setRoStoreSearch] = useState("");
  const [roSourceDoc, setRoSourceDoc] = useState("");
  const [stores, setStores] = useState<StoreOpt[]>([]);

  // ----- saved docs -----
  const [savedDocs, setSavedDocs] = useState<SavedB2BDoc[]>(() => loadDocs());

  // Preview modal (shared across tabs)
  const [previewDoc, setPreviewDoc] = useState<SavedB2BDoc | null>(null);

  // Tab
  const [activeTab, setActiveTab] = useState(stateRef.activeTab);

  // ----- Manual resolver dialog (replaces fuzzy match) -----
  // For each unique typed name not exactly matched, user picks the correct
  // store/customer from a dropdown of master data, or skips.
  type ResolveEntry = {
    typed: string;
    target: "customer" | "store";
    pick: string; // selected label, "" means skip
  };
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<"so_po" | "ro">("so_po");
  const [resolveEntries, setResolveEntries] = useState<ResolveEntry[]>([]);

  // Has-import flags for button disabling
  const hasStoreInImport = useMemo(
    () => rows.some(r => (r.store_name || "").trim() !== ""),
    [rows]
  );
  const hasCustomerInImport = useMemo(
    () => rows.some(r => (r.customer_name || "").trim() !== ""),
    [rows]
  );

  // Open Save SO/PO — resolve any unmatched customer names in rows first
  const openSaveSOPO = () => {
    const typedNames = [...new Set(rows.map(r => (r.customer_name || "").trim()).filter(Boolean))];
    const customerNames = customers.map(c => c.name);
    const unmatched = typedNames.filter(t => !customerNames.some(c => c.toLowerCase() === t.toLowerCase()));
    if (unmatched.length > 0) {
      setResolveTarget("so_po");
      setResolveEntries(unmatched.map(t => ({ typed: t, target: "customer", pick: "" })));
      setResolveOpen(true);
      return;
    }
    // If import provides customer_name → auto-split, skip dialog
    if (typedNames.length > 0) { doSaveSOPO(); return; }
    setSavePOOpen(true);
  };
  const openSaveRO = () => {
    const typedNames = [...new Set(rows.map(r => (r.store_name || "").trim()).filter(Boolean))];
    const storeNames = stores.map(s => s.store_name);
    const unmatched = typedNames.filter(t => !storeNames.some(c => c.toLowerCase() === t.toLowerCase()));
    if (unmatched.length > 0) {
      setResolveTarget("ro");
      setResolveEntries(unmatched.map(t => ({ typed: t, target: "store", pick: "" })));
      setResolveOpen(true);
      return;
    }
    if (typedNames.length > 0) { doSaveRO(); return; }
    setSaveROOpen(true);
  };
  // Apply resolver picks → update rows.customer_name / store_name in place
  const applyResolver = () => {
    const map = new Map<string, string>(); // typed lower → picked label ("" = skip)
    for (const e of resolveEntries) map.set(e.typed.toLowerCase(), e.pick);
    setRows(prev => prev.map(r => {
      if (resolveTarget === "so_po") {
        const t = (r.customer_name || "").trim();
        if (!t) return r;
        const picked = map.get(t.toLowerCase());
        if (picked === undefined) return r;
        return { ...r, customer_name: picked || "" };
      } else {
        const t = (r.store_name || "").trim();
        if (!t) return r;
        const picked = map.get(t.toLowerCase());
        if (picked === undefined) return r;
        return { ...r, store_name: picked || "" };
      }
    }));
    setResolveOpen(false);
    // After resolver, names came from import → auto-save (no extra dialog)
    setTimeout(() => {
      if (resolveTarget === "so_po") doSaveSOPO();
      else doSaveRO();
    }, 50);
  };

  // Persist
  useEffect(() => { stateRef.importedRaw = importedRaw; }, [importedRaw]);
  useEffect(() => { stateRef.rows = rows; }, [rows]);
  useEffect(() => { stateRef.skips = skips; }, [skips]);
  useEffect(() => { stateRef.activeTab = activeTab; }, [activeTab]);

  // Load customers (Tab 2/3 popups) and stores (RO popup)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers").select("customer_code,name").order("name");
      setCustomers((data || []).filter(c => c.name) as CustomerOpt[]);
      const { data: sd } = await supabase.from("store_type").select("type_store,store_name").order("type_store");
      setStores(((sd || []).filter((s: any) => s.store_name && s.type_store)) as StoreOpt[]);
    })();
  }, []);

  // ============================================================
  // IMPORT — file & paste
  // ============================================================
  const parsePasteImport = () => {
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items: { key: string; product_name_imp: string; qty: number; store_name: string; customer_name: string; order_group: string }[] = [];
    for (const line of lines) {
      // delimiters: comma OR space (NOT newline). tab also accepted.
      const parts = line.split(/[\t,\s]+/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      const key = parts[0];
      // remainder may include name (multi-token) + qty as last token. Try qty as last numeric.
      let name = "";
      let qty = 0;
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const lastNum = Number(last);
        if (!isNaN(lastNum) && parts.length >= 2) {
          qty = lastNum;
          name = parts.slice(1, -1).join(" ");
        } else {
          name = parts.slice(1).join(" ");
        }
      }
      items.push({ key, product_name_imp: name, qty, store_name: "", customer_name: "", order_group: "" });
    }
    if (items.length === 0) { toast({ title: "ไม่พบรายการ", variant: "destructive" }); return; }
    setImportedRaw(items);
    setImportOpen(false); setPasteText("");
    setRows([]); setSkips([]); setPhase1Done(false); phase1CacheRef.current = null;
    toast({ title: "Import สำเร็จ", description: `${items.length} รายการ — กด Get Date` });
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      const items: { key: string; product_name_imp: string; qty: number; store_name: string; customer_name: string; order_group: string }[] = [];
      const lookup = (r: any, names: string[]): any => {
        for (const n of names) {
          if (r[n] !== undefined && r[n] !== "") return r[n];
          for (const k of Object.keys(r)) {
            if (k.trim().toLowerCase() === n.trim().toLowerCase() && r[k] !== "") return r[k];
          }
        }
        return undefined;
      };
      for (const r of data) {
        const keyRaw = lookup(r, ["barcode", "skucode", "sku_code", "barcode/skucode", "Barcode&SkuCode"]) ?? Object.values(r)[0];
        const nameRaw = lookup(r, ["product_name_imp", "product_name", "name", "Product name (imp)", "Product Name"]) ?? "";
        const qtyRaw = lookup(r, ["qty", "Qty", "Quantity"]) ?? 0;
        const storeRaw = lookup(r, ["store_name", "Store Name", "store"]) ?? "";
        const customerRaw = lookup(r, ["customer_name", "Customer Name", "customer"]) ?? "";
        const groupRaw = lookup(r, ["order_group", "Order group", "order group", "Order Group"]) ?? "";
        const key = String(keyRaw ?? "").trim();
        if (!key) continue;
        items.push({
          key,
          product_name_imp: String(nameRaw ?? "").trim(),
          qty: Number(qtyRaw) || 0,
          store_name: String(storeRaw ?? "").trim(),
          customer_name: String(customerRaw ?? "").trim(),
          order_group: String(groupRaw ?? "").trim(),
        });
      }
      if (items.length === 0) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      setImportedRaw(items);
      setImportOpen(false);
      setRows([]); setSkips([]); setPhase1Done(false); phase1CacheRef.current = null;
      toast({ title: "Import สำเร็จ", description: `${items.length} รายการ — กด Get Date` });
    } catch (e: any) {
      toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["barcode/skucode", "product_name_imp", "qty", "store_name", "customer_name", "order_group"],
      ["8851234567890", "ตัวอย่างชื่อสินค้า", 5, "40193 Bonchon Dongdok (B2B)", "", "1"],
      ["SKU-00123", "ตัวอย่าง 2", 12, "", "Lao Premium Co.", "2"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "order_b2b_import_template.xlsx");
  };

  // ============================================================
  // GET DATE — Phase 1: data_master only
  // ============================================================
  const handleGetDate = async () => {
    if (importedRaw.length === 0) { toast({ title: "กรุณา Import ก่อน", variant: "destructive" }); return; }
    setLoading(true); setLoadingStage("Phase 1: data master");
    try {
      const keys = [...new Set(importedRaw.map(i => i.key))];

      // Try barcode and sku_code lookups in parallel; product_owner filter applied client-side
      const dmCols = "sku_code,main_barcode,barcode,product_name_la,product_name_en,unit_of_measure,packing_size_qty,vendor_code,buying_status,item_type,product_owner,po_group";
      const [byBarcode, bySku, byMain] = await Promise.all([
        fetchByIdsParallel<any>("data_master", dmCols, "barcode", keys),
        fetchByIdsParallel<any>("data_master", dmCols, "sku_code", keys),
        fetchByIdsParallel<any>("data_master", dmCols, "main_barcode", keys),
      ]);

      // Resolve all matched SKUs first
      const matched = [...byBarcode, ...bySku, ...byMain];
      const skuSet = new Set<string>();
      for (const r of matched) if (r.sku_code) skuSet.add(String(r.sku_code).trim());

      // Phase 1b: fetch FULL family (all packing variants) for matched SKUs —
      // needed because imported key may be a pack/box barcode but we must find the unit row (packing_size_qty=1)
      const fullFamily = skuSet.size > 0
        ? await fetchByIdsParallel<any>("data_master", dmCols, "sku_code", [...skuSet])
        : [];

      // Build family lookups from FULL family
      const familyBySku = new Map<string, any[]>();
      for (const r of fullFamily) {
        if (!r.sku_code) continue;
        if (!familyBySku.has(r.sku_code)) familyBySku.set(r.sku_code, []);
        familyBySku.get(r.sku_code)!.push(r);
      }
      // Barcode→SKU lookup uses ALL rows (matched + full family) so any variant resolves
      const skuByBarcode = new Map<string, string>();
      const allLookup = [...matched, ...fullFamily];
      for (const r of allLookup) {
        if (r.barcode) skuByBarcode.set(String(r.barcode).trim(), r.sku_code);
        if (r.main_barcode) skuByBarcode.set(String(r.main_barcode).trim(), r.sku_code);
        if (r.sku_code) skuByBarcode.set(String(r.sku_code).trim(), r.sku_code);
      }

      // Build rows + skips
      const newRows: B2BRow[] = [];
      const newSkips: SkipItem[] = [];
      const seenSkuByStore = new Map<string, Set<string>>(); // store_customer_name → set of sku

      for (const imp of importedRaw) {
        // FIX 1: skip rows where qty = 0
        if (!imp.qty || Number(imp.qty) === 0) {
          newSkips.push({ imp_key: imp.key, product_name_imp: imp.product_name_imp, reason: "qty = 0", qty: 0 });
          continue;
        }
        const sku = skuByBarcode.get(imp.key);
        if (!sku) {
          newSkips.push({ imp_key: imp.key, product_name_imp: imp.product_name_imp, reason: "ไม่พบใน Data Master", qty: imp.qty });
          continue;
        }
        const family = familyBySku.get(sku) || [];
        const head = family[0];
        if ((head?.product_owner || "") !== PRODUCT_OWNER) {
          newSkips.push({ imp_key: imp.key, product_name_imp: imp.product_name_imp, reason: `Product owner ≠ ${PRODUCT_OWNER}`, qty: imp.qty });
          continue;
        }
        // FIX 2: dedup SKU per (store, customer) — ไม่ dedup ข้ามสาขา/ลูกค้า
        const sName = (imp.store_name || "").trim();
        const cName = (imp.customer_name || "").trim();
        const dedupKey = `${sName.toLowerCase()}||${cName.toLowerCase()}` || "_default_";
        let seen = seenSkuByStore.get(dedupKey);
        if (!seen) { seen = new Set<string>(); seenSkuByStore.set(dedupKey, seen); }
        if (seen.has(sku)) {
          const label = sName || cName || "(ไม่ระบุ)";
          newSkips.push({ imp_key: imp.key, product_name_imp: imp.product_name_imp, reason: `SKU ซ้ำในสาขา ${label}`, qty: imp.qty });
          continue;
        }
        seen.add(sku);

        // Pack: row where unit_of_measure='pack' (case-insensitive)
        const packRow = family.find(f => String(f.unit_of_measure || "").toLowerCase() === "pack");
        const boxRow  = family.find(f => String(f.unit_of_measure || "").toLowerCase() === "box");
        // Main barcode (unit) — STRICT: must be packing_size_qty=1 record
        // Prefer the row whose barcode === main_barcode (canonical EAN), avoid PLU/scale codes
        const unitRows = family.filter(f => Number(f.packing_size_qty) === 1);
        const canonicalUnit = unitRows.find(f => String(f.barcode || "").trim() === String(f.main_barcode || "").trim());
        const unitRow = canonicalUnit || unitRows[0];
        const mainBarcode = unitRow ? String(unitRow.main_barcode || unitRow.barcode || "") : "";
        if (!mainBarcode) {
          newSkips.push({ imp_key: imp.key, product_name_imp: imp.product_name_imp, reason: "main barcode not found", qty: imp.qty });
        }

        newRows.push({
          id: `b2b-${sku}-${Math.random().toString(36).slice(2, 7)}`,
          imp_key: imp.key,
          product_name_imp: imp.product_name_imp,
          qty: imp.qty,
          store_name: sName,
          customer_name: cName,
          order_group: imp.order_group || "",
          sku_code: sku,
          main_barcode: mainBarcode,
          product_name_la: head.product_name_la || "",
          product_name_en: head.product_name_en || "",
          unit_of_measure: unitRow?.unit_of_measure || head.unit_of_measure || "",
          vendor_code: head.vendor_code || "",
          buying_status: head.buying_status || "",
          item_type: head.item_type || "",
          product_owner: head.product_owner || "",
          po_group: head.po_group || "",
          pack_qty: packRow ? Number(packRow.packing_size_qty) || null : null,
          box_qty:  boxRow  ? Number(boxRow.packing_size_qty)  || null : null,
          vendor_name_en: "", vendor_origin: "", trade_term: "", currency: "", vendor_display: "",
          po_cost_unit: 0, stock_dc: 0,
        });
      }

      phase1CacheRef.current = { rows: newRows };
      setRows(newRows);
      setSkips(newSkips);
      setPhase1Done(true);
      toast({ title: "Get Date เสร็จ", description: `match ${newRows.length} · skip ${newSkips.length} — กด Read ต่อ` });
    } catch (e: any) {
      toast({ title: "Get Date ล้มเหลว", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false); setLoadingStage("");
    }
  };

  // ============================================================
  // READ — Phase 2: vendor_master + Phase 3: po_cost + stock
  // ============================================================
  const handleRead = async () => {
    if (!phase1Done || rows.length === 0) { toast({ title: "กรุณากด Get Date ก่อน", variant: "destructive" }); return; }
    setLoading(true); setLoadingStage("Phase 2: vendor master");
    try {
      const vCodes = [...new Set(rows.map(r => r.vendor_code).filter(Boolean))];
      const vendors = await fetchByIdsParallel<any>(
        "vendor_master",
        "vendor_code,vendor_name_en,vendor_origin,trade_term,supplier_currency",
        "vendor_code", vCodes,
      );
      const vMap = new Map<string, any>();
      for (const v of vendors) vMap.set(v.vendor_code, v);

      setLoadingStage("Phase 3: po_cost + stock");
      const skus = rows.map(r => r.sku_code);
      const [poCostRows, stockRows] = await Promise.all([
        fetchByIdsParallel<any>("po_cost", "item_id,po_cost_unit", "item_id", skus),
        fetchByIdsParallel<any>("stock", "item_id,quantity,type_store", "item_id", skus),
      ]);
      const poCostMap = new Map<string, number>();
      for (const r of poCostRows) {
        if (!poCostMap.has(r.item_id)) poCostMap.set(r.item_id, Number(r.po_cost_unit) || 0);
      }
      const stockMap = new Map<string, number>();
      for (const r of stockRows) {
        const ts = String(r.type_store || "").toLowerCase();
        if (ts !== "dc") continue;
        stockMap.set(r.item_id, (stockMap.get(r.item_id) || 0) + (Number(r.quantity) || 0));
      }

      const enriched = rows.map(r => {
        const v = vMap.get(r.vendor_code);
        const cur = v?.supplier_currency || "";
        const vName = v?.vendor_name_en || "";
        return {
          ...r,
          vendor_name_en: vName,
          vendor_origin: v?.vendor_origin || "",
          trade_term: v?.trade_term || "",
          currency: cur,
          vendor_display: [cur, r.vendor_code, vName].filter(Boolean).join(" - "),
          po_cost_unit: poCostMap.get(r.sku_code) || 0,
          stock_dc: stockMap.get(r.sku_code) || 0,
        };
      });
      setRows(enriched);
      toast({ title: "Read เสร็จ", description: `${enriched.length} รายการพร้อมใช้งาน` });
    } catch (e: any) {
      toast({ title: "Read ล้มเหลว", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false); setLoadingStage("");
    }
  };

  // ============================================================
  // EXPORT — current data + skip list + template
  // ============================================================
  const exportData = () => {
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    const out = rows.map(r => ({
      Vendor: r.vendor_display, "Vendor origin": r.vendor_origin, Tradeterm: r.trade_term,
      "Buying Status": r.buying_status, "Item type": r.item_type,
      SKUcode: r.sku_code, "Main barcode unit": r.main_barcode,
      Pack: r.pack_qty, Box: r.box_qty,
      "barcode/sku (imp)": r.imp_key,
      "Product name LA": r.product_name_la, "Product name EN": r.product_name_en,
      "Product name (imp)": r.product_name_imp,
      Qty: r.qty, "Stock DC": r.stock_dc,
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order B2B");
    XLSX.writeFile(wb, `${tsCompact()}-OrderB2B-Data.xlsx`);
  };
  const exportSkipList = () => {
    if (skips.length === 0) { toast({ title: "ไม่มี Skip list" }); return; }
    const ws = XLSX.utils.json_to_sheet(skips.map(s => ({
      barcode_import: s.imp_key, product_name_import: s.product_name_imp, reason: s.reason, qty: s.qty,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skip");
    XLSX.writeFile(wb, `${tsCompact()}-OrderB2B-Skip.xlsx`);
  };

  // Download a saved Data View doc as Excel
  const downloadSavedDoc = (doc: SavedB2BDoc) => {
    const out = doc.rows.map(r => ({
      Vendor: r.vendor_display, "Vendor origin": r.vendor_origin, Tradeterm: r.trade_term,
      "Buying Status": r.buying_status, "Item type": r.item_type,
      SKUcode: r.sku_code, "Main barcode unit": r.main_barcode,
      Pack: r.pack_qty, Box: r.box_qty,
      "barcode/sku (imp)": r.imp_key,
      "Product name LA": r.product_name_la, "Product name EN": r.product_name_en,
      "Product name (imp)": r.product_name_imp,
      Qty: r.qty, "Stock DC": r.stock_dc,
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order B2B");
    XLSX.writeFile(wb, `${doc.filename}.xlsx`);
  };

  const deleteSavedDoc = (id: string) => {
    const upd = savedDocs.filter(d => d.id !== id);
    setSavedDocs(upd); persistDocs(upd);
  };

  // ============================================================
  // SAVE SO/PO
  //   - Auto split per customer_name when import provided customer_name
  //   - Otherwise use poCustomer from dialog (single doc)
  //   - SO doc: copy of all rows in group · PO doc: subset where stock_dc < qty
  // ============================================================
  const doSaveSOPO = () => {
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    if (hasStoreInImport) {
      toast({ title: "พบ Store name ในข้อมูล", description: "Store name → ใช้ Save RO เท่านั้น", variant: "destructive" });
      return;
    }

    const now = new Date();
    const ts = tsCompact(now);
    const batchId = newBatchId();
    const batchLabel = tsCompactSec(now);
    const allRows: B2BRow[] = JSON.parse(JSON.stringify(rows));

    // Group by customer_name (auto-split). If empty → use single dialog customer.
    const groups = new Map<string, B2BRow[]>();
    if (hasCustomerInImport) {
      for (const r of allRows) {
        const k = (r.customer_name || "").trim();
        if (!k) continue; // skip rows without customer_name when split mode
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
    } else {
      if (!poCustomer) { toast({ title: "กรุณาเลือก Customer", variant: "destructive" }); return; }
      groups.set(poCustomer, allRows);
    }

    const newDocs: SavedB2BDoc[] = [];
    let i = 0;
    for (const [cust, gRows] of groups) {
      const poRows = gRows.filter(r => r.stock_dc < r.qty);
      newDocs.push({
        id: `b2b-${ts}-so-${i}-${Math.random().toString(36).slice(2, 6)}`,
        filename: `${ts}-${cust}-SO`,
        name: cust, created_at: now.toISOString(),
        doc_type: "so",
        customer_name: cust,
        source_document: poSourceDoc,
        description: poDescription,
        rows: gRows,
        batch_id: batchId,
        batch_label: batchLabel,
      });
      if (poRows.length > 0) {
        newDocs.push({
          id: `b2b-${ts}-po-${i}-${Math.random().toString(36).slice(2, 6)}`,
          filename: `${ts}-${cust}-PO`,
          name: cust, created_at: now.toISOString(),
          doc_type: "po",
          customer_name: cust,
          source_document: poSourceDoc,
          description: poDescription,
          rows: poRows,
          batch_id: batchId,
          batch_label: batchLabel,
        });
      }
      i++;
    }

    const updated = [...savedDocs, ...newDocs];
    persistDocs(updated); setSavedDocs(updated);
    setSavePOOpen(false);
    setPoCustomer(""); setPoSourceDoc(""); setPoDescription("");
    toast({
      title: "บันทึก SO/PO สำเร็จ",
      description: `${groups.size} customer · ${newDocs.length} เอกสาร`,
    });
  };

  // SAVE RO — Auto split per store_name when import provided store_name; else use selected roStores.
  const doSaveRO = () => {
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูล", variant: "destructive" }); return; }
    if (hasCustomerInImport) {
      toast({ title: "พบ Customer name ในข้อมูล", description: "Customer name → ใช้ Save SO/PO เท่านั้น", variant: "destructive" });
      return;
    }
    const now = new Date();
    const ts = tsCompact(now);
    const batchId = newBatchId();
    const batchLabel = tsCompactSec(now);
    const allRows: B2BRow[] = JSON.parse(JSON.stringify(rows));

    type Group = { storeName: string; typeStore: string; rows: B2BRow[] };
    const groups: Group[] = [];
    if (hasStoreInImport) {
      const map = new Map<string, B2BRow[]>();
      for (const r of allRows) {
        const k = (r.store_name || "").trim();
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(r);
      }
      for (const [storeName, gRows] of map) {
        const found = stores.find(s => s.store_name.toLowerCase() === storeName.toLowerCase());
        groups.push({ storeName, typeStore: found?.type_store || "", rows: gRows });
      }
    } else {
      if (roStores.length === 0) { toast({ title: "กรุณาเลือก Store อย่างน้อย 1 รายการ", variant: "destructive" }); return; }
      for (const s of roStores) groups.push({ storeName: s.store_name, typeStore: s.type_store, rows: allRows });
    }

    if (groups.length === 0) { toast({ title: "ไม่พบ store name ในข้อมูล", variant: "destructive" }); return; }

    const newDocs: SavedB2BDoc[] = groups.map((g, i) => ({
      id: `b2b-${ts}-ro-${i}-${Math.random().toString(36).slice(2, 6)}`,
      filename: `${ts}-${g.storeName}-RO`,
      name: g.storeName, created_at: now.toISOString(),
      doc_type: "ro",
      customer_name: g.storeName,
      source_document: roSourceDoc,
      description: g.typeStore,
      rows: g.rows,
      batch_id: batchId,
      batch_label: batchLabel,
    }));
    const updated = [...savedDocs, ...newDocs];
    persistDocs(updated); setSavedDocs(updated);
    setSaveROOpen(false);
    setRoStores([]); setRoSourceDoc(""); setRoStoreSearch("");
    toast({ title: "บันทึก RO สำเร็จ", description: `${newDocs.length} เอกสาร` });
  };

  // ============================================================
  // Tab 1 — derived options + filtered display
  // ============================================================
  const opts = useMemo(() => ({
    vendor: [...new Set(rows.map(r => r.vendor_display).filter(Boolean))].sort(),
    vendorOrigin: [...new Set(rows.map(r => r.vendor_origin).filter(Boolean))].sort(),
    tradeTerm: [...new Set(rows.map(r => r.trade_term).filter(Boolean))].sort(),
    buying: [...new Set(rows.map(r => r.buying_status).filter(Boolean))].sort(),
    itemType: [...new Set(rows.map(r => r.item_type).filter(Boolean))].sort(),
  }), [rows]);

  const displayRows = useMemo(() => {
    let out = rows;
    if (filVendor.length) out = out.filter(r => filVendor.includes(r.vendor_display));
    if (filVendorOrigin.length) out = out.filter(r => filVendorOrigin.includes(r.vendor_origin));
    if (filTradeTerm.length) out = out.filter(r => filTradeTerm.includes(r.trade_term));
    if (filBuying.length) out = out.filter(r => filBuying.includes(r.buying_status));
    if (filItemType.length) out = out.filter(r => filItemType.includes(r.item_type));
    if (stockDcMode === "gt") out = out.filter(r => r.stock_dc > r.qty);
    else if (stockDcMode === "lt") out = out.filter(r => r.stock_dc < r.qty);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r =>
        r.sku_code.toLowerCase().includes(q) ||
        r.imp_key.toLowerCase().includes(q) ||
        r.main_barcode.toLowerCase().includes(q) ||
        (r.product_name_la || "").toLowerCase().includes(q) ||
        (r.product_name_en || "").toLowerCase().includes(q) ||
        (r.product_name_imp || "").toLowerCase().includes(q) ||
        (r.vendor_display || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, filVendor, filVendorOrigin, filTradeTerm, filBuying, filItemType, stockDcMode, search]);

  const allSelected = displayRows.length > 0 && displayRows.every(r => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      for (const r of displayRows) next.delete(r.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const r of displayRows) next.add(r.id);
      setSelected(next);
    }
  };
  const toggleRow = (id: string) => {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ============================================================
  // RENDER
  // ============================================================
  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(poCustomerSearch.toLowerCase()));
  const filteredStoresRO = stores.filter(s =>
    s.store_name.toLowerCase().includes(roStoreSearch.toLowerCase()) ||
    (s.type_store || "").toLowerCase().includes(roStoreSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">Order B2B</h1>
          <p className="text-xs text-muted-foreground">
            Product Owner = {PRODUCT_OWNER} · {rows.length} match · {skips.length} skip
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {canImport && (
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={loading} className="text-xs h-8">
              <Upload className="w-3.5 h-3.5 mr-1" /> Import
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={downloadTemplate} className="text-xs h-8">
            <Download className="w-3.5 h-3.5 mr-1" /> Template
          </Button>
          {canExport && (
            <Button size="sm" variant="ghost" onClick={exportData} disabled={rows.length === 0} className="text-xs h-8">
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Export Data
            </Button>
          )}
          <div className="w-px h-5 bg-border mx-1" />
          {canImport && (
            <>
              <Button size="sm" onClick={handleGetDate} disabled={loading || importedRaw.length === 0} className="text-xs h-8">
                <Database className="w-3.5 h-3.5 mr-1" /> Get Date
              </Button>
              <Button size="sm" onClick={handleRead} disabled={loading || !phase1Done} className="text-xs h-8">
                <Play className="w-3.5 h-3.5 mr-1" /> Read
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
            </>
          )}
          {canSave && (
            <>
              <Button
                size="sm" variant="outline"
                onClick={() => openSaveSOPO()}
                disabled={rows.length === 0 || hasStoreInImport}
                title={hasStoreInImport ? "Import มี Store name → ใช้ Save RO" : ""}
                className="text-xs h-8"
              >
                <Save className="w-3.5 h-3.5 mr-1" /> Save SO/PO
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => openSaveRO()}
                disabled={rows.length === 0 || hasCustomerInImport}
                title={hasCustomerInImport ? "Import มี Customer name → ใช้ Save SO/PO" : ""}
                className="text-xs h-8"
              >
                <Save className="w-3.5 h-3.5 mr-1" /> Save RO
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRows([]);
                setSkips([]);
                setImportedRaw([]);
                setSelected(new Set());
                setPhase1Done(false);
                phase1CacheRef.current = null;
                toast({ title: "Clear Data สำเร็จ", description: "ล้างข้อมูลในตาราง (saved docs ไม่ถูกลบ)" });
              }}
              disabled={rows.length === 0 && skips.length === 0 && importedRaw.length === 0}
              className="text-xs h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear Data
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className="px-4 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> {loadingStage}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className={`mx-4 mt-2 grid max-w-lg ${canExport ? "grid-cols-4" : "grid-cols-1"}`}>
          <TabsTrigger value="data" className="text-xs">Data View</TabsTrigger>
          {canExport && <TabsTrigger value="so" className="text-xs">SO Doc</TabsTrigger>}
          {canExport && <TabsTrigger value="po" className="text-xs">PO Doc</TabsTrigger>}
          {canExport && <TabsTrigger value="ro" className="text-xs">RO Doc</TabsTrigger>}
        </TabsList>

        {/* ============== TAB 1 — DATA VIEW ============== */}
        <TabsContent value="data" className="flex-1 flex flex-col overflow-hidden m-0">
          {/* Filter bar */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)}
                className="h-8 pl-7 w-48 text-xs" />
            </div>
            <MultiSelect label="Vendor" options={opts.vendor} selected={filVendor} onChange={setFilVendor} width={120} />
            <MultiSelect label="Origin" options={opts.vendorOrigin} selected={filVendorOrigin} onChange={setFilVendorOrigin} width={100} />
            <MultiSelect label="Tradeterm" options={opts.tradeTerm} selected={filTradeTerm} onChange={setFilTradeTerm} width={120} />
            <MultiSelect label="Buying" options={opts.buying} selected={filBuying} onChange={setFilBuying} width={100} />
            <MultiSelect label="Item Type" options={opts.itemType} selected={filItemType} onChange={setFilItemType} width={110} />
            <Select value={stockDcMode} onValueChange={(v: any) => setStockDcMode(v)}>
              <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="none" className="text-xs">Stock DC: ทั้งหมด</SelectItem>
                <SelectItem value="gt" className="text-xs">Stock DC &gt; qty</SelectItem>
                <SelectItem value="lt" className="text-xs">Stock DC &lt; qty</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {selected.size > 0 && `เลือก ${selected.size} · `}{displayRows.length} แถว
            </span>
            {skips.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportSkipList} className="h-8 text-xs gap-1">
                <Download className="w-3 h-3" /> Skip List ({skips.length})
              </Button>
            )}
          </div>

          {/* Saved Docs UI removed — Data View is for loading/viewing only.
              Use [Save SO/PO] to push docs into SO Doc / PO Doc tabs. */}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {displayRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">ยังไม่มีข้อมูล — Import แล้วกด Get Date → Read</p>
              </div>
            ) : (
              <table className="text-xs w-full border-collapse">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 border-b border-border w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-3.5 w-3.5" />
                    </th>
                    {[
                      "Vendor", "Origin", "Tradeterm", "Buying", "Item Type",
                      "SKUcode", "Main Barcode", "Pack", "Box",
                      "Barcode/SKU (imp)", "Product Name LA", "Product Name EN", "Product Name (imp)",
                      "Qty", "Store Name", "Customer Name", "Order Group", "Stock DC",
                    ].map(h => (
                      <th key={h} className="px-2 py-1.5 border-b border-border font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(r => {
                    const isSel = selected.has(r.id);
                    return (
                      <tr key={r.id} className={cn("border-b border-border/40", isSel && "bg-primary/5")}>
                        <td className="px-2 py-1"><Checkbox checked={isSel} onCheckedChange={() => toggleRow(r.id)} className="h-3.5 w-3.5" /></td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.vendor_display}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.vendor_origin}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.trade_term}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.buying_status}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.item_type}</td>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{r.sku_code}</td>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{r.main_barcode}</td>
                        <td className="px-2 py-1 text-right">{fmt(r.pack_qty || 0)}</td>
                        <td className="px-2 py-1 text-right">{fmt(r.box_qty || 0)}</td>
                        <td className="px-2 py-1 whitespace-nowrap font-mono">{r.imp_key}</td>
                        <td className="px-2 py-1">{r.product_name_la}</td>
                        <td className="px-2 py-1">{r.product_name_en}</td>
                        <td className="px-2 py-1">{r.product_name_imp}</td>
                        <td className="px-2 py-1 text-right font-medium">{fmt(r.qty)}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.store_name || ""}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.customer_name || ""}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.order_group || ""}</td>
                        <td className={cn("px-2 py-1 text-right",
                          r.stock_dc <= 0 ? "text-destructive" :
                          r.stock_dc < r.qty ? "text-amber-600 dark:text-amber-400" : ""
                        )}>{fmt(r.stock_dc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ============== TAB 2 — SO Doc ============== */}
        <TabsContent value="so" className="flex-1 overflow-auto m-0 px-4 pt-2 pb-4">
          <SODocList docs={savedDocs.filter(d => d.doc_type === "so")} onChange={setSavedDocs} allDocs={savedDocs} onPreview={setPreviewDoc} />
        </TabsContent>

        {/* ============== TAB 3 — PO Doc ============== */}
        <TabsContent value="po" className="flex-1 overflow-auto m-0 px-4 pt-2 pb-4">
          <PODocList docs={savedDocs.filter(d => d.doc_type === "po")} onChange={setSavedDocs} allDocs={savedDocs} onPreview={setPreviewDoc} />
        </TabsContent>

        {/* ============== TAB 4 — RO Doc (same logic as SO) ============== */}
        <TabsContent value="ro" className="flex-1 overflow-auto m-0 px-4 pt-2 pb-4">
          <SODocList docs={savedDocs.filter(d => d.doc_type === "ro")} onChange={setSavedDocs} allDocs={savedDocs} onPreview={setPreviewDoc} />
        </TabsContent>
      </Tabs>

      {/* ============== IMPORT DIALOG ============== */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Import Order B2B</DialogTitle>
          </DialogHeader>
          <Tabs value={importTab} onValueChange={setImportTab}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="upload" className="text-xs">Upload File</TabsTrigger>
              <TabsTrigger value="paste" className="text-xs">Paste</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                คอลัมน์: <code className="bg-muted px-1 rounded">barcode/skucode</code>,{" "}
                <code className="bg-muted px-1 rounded">product_name_imp</code>,{" "}
                <code className="bg-muted px-1 rounded">qty</code>,{" "}
                <code className="bg-muted px-1 rounded">store_name</code>,{" "}
                <code className="bg-muted px-1 rounded">customer_name</code>,{" "}
                <code className="bg-muted px-1 rounded">order_group</code>
                <br />
                <span className="text-[10px]">มี <b>store_name</b> → save ได้เฉพาะ RO · มี <b>customer_name</b> → save ได้เฉพาะ SO/PO</span>
              </p>
              <input type="file" accept=".xlsx,.xls,.csv"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground" />
              <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-xs gap-1">
                <Download className="w-3.5 h-3.5" /> Template
              </Button>
            </TabsContent>
            <TabsContent value="paste" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                1 บรรทัด = 1 รายการ · ตัวคั่นในบรรทัด: <strong>comma</strong> หรือ <strong>space</strong> (token แรก = barcode/sku, token สุดท้าย = qty ถ้าเป็นตัวเลข, ที่เหลือ = product name)
              </p>
              <Textarea rows={8} value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={"8851234567890,ตัวอย่างชื่อสินค้า,5\nSKU-00123 ชื่อ 12"}
                className="font-mono text-xs" />
              <Button onClick={parsePasteImport} size="sm" className="text-xs">วาง Import</Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* SAVE DOC dialog removed — Data View has no save action */}

      {/* ============== SAVE SO/PO DIALOG ============== */}
      <Dialog open={savePOOpen} onOpenChange={setSavePOOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>บันทึก SO/PO</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Customer (จาก Customer table)</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-9 text-sm justify-between font-normal">
                    <span className="truncate">{poCustomer || "-- เลือก Customer --"}</span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-2 bg-popover z-50">
                  <Input placeholder="ค้นหา customer..." value={poCustomerSearch}
                    onChange={e => setPoCustomerSearch(e.target.value)} className="h-8 text-xs mb-2" />
                  <ScrollArea className="h-64">
                    {filteredCustomers.length === 0 && <p className="text-xs text-muted-foreground p-2">ไม่พบ</p>}
                    {filteredCustomers.map(c => (
                      <button key={c.customer_code} type="button"
                        onClick={() => { setPoCustomer(c.name); setPoCustomerSearch(""); }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-muted-foreground text-[10px]">{c.customer_code}</div>
                      </button>
                    ))}
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Source Document (สำหรับ SO doc)</label>
              <Input value={poSourceDoc} onChange={e => setPoSourceDoc(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description (สำหรับ PO doc)</label>
              <Input value={poDescription} onChange={e => setPoDescription(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavePOOpen(false)}>ยกเลิก</Button>
            <Button onClick={doSaveSOPO}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== SAVE RO DIALOG ============== */}
      <Dialog open={saveROOpen} onOpenChange={setSaveROOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>บันทึก RO</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Stores (เลือกได้หลายสาขา)</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-9 text-sm justify-between font-normal">
                    <span className="truncate">
                      {roStores.length === 0
                        ? "-- เลือก Store --"
                        : roStores.length === 1
                          ? `${roStores[0].type_store} [${roStores[0].store_name}]`
                          : `เลือกแล้ว ${roStores.length} สาขา`}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-2 bg-popover z-50">
                  <div className="flex items-center gap-2 mb-2">
                    <Input placeholder="ค้นหา type / store..." value={roStoreSearch}
                      onChange={e => setRoStoreSearch(e.target.value)} className="h-8 text-xs" />
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2"
                      onClick={() => {
                        const allSel = filteredStoresRO.length > 0 && filteredStoresRO.every(s =>
                          roStores.some(x => x.type_store === s.type_store && x.store_name === s.store_name));
                        if (allSel) {
                          setRoStores(roStores.filter(x =>
                            !filteredStoresRO.some(s => s.type_store === x.type_store && s.store_name === x.store_name)));
                        } else {
                          const merged = [...roStores];
                          for (const s of filteredStoresRO) {
                            if (!merged.some(x => x.type_store === s.type_store && x.store_name === s.store_name)) merged.push(s);
                          }
                          setRoStores(merged);
                        }
                      }}>
                      {filteredStoresRO.length > 0 && filteredStoresRO.every(s => roStores.some(x => x.type_store === s.type_store && x.store_name === s.store_name)) ? "ล้าง" : "เลือกทั้งหมด"}
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    {filteredStoresRO.length === 0 && <p className="text-xs text-muted-foreground p-2">ไม่พบ</p>}
                    {filteredStoresRO.map(s => {
                      const checked = roStores.some(x => x.type_store === s.type_store && x.store_name === s.store_name);
                      return (
                        <label key={`${s.type_store}-${s.store_name}`}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted rounded cursor-pointer">
                          <Checkbox checked={checked} onCheckedChange={(c) => {
                            if (c) setRoStores([...roStores, s]);
                            else setRoStores(roStores.filter(x => !(x.type_store === s.type_store && x.store_name === s.store_name)));
                          }} />
                          <span className="font-medium">{s.type_store} [{s.store_name}]</span>
                        </label>
                      );
                    })}
                  </ScrollArea>
                  {roStores.length > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t">
                      เลือกแล้ว {roStores.length} สาขา · จะสร้าง {roStores.length} เอกสาร
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Source Document</label>
              <Input value={roSourceDoc} onChange={e => setRoSourceDoc(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveROOpen(false)}>ยกเลิก</Button>
            <Button onClick={doSaveRO}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== MANUAL RESOLVER DIALOG ============== */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>ยืนยันชื่อ {resolveTarget === "ro" ? "Store" : "Customer"}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            ค่าที่นำเข้าด้านซ้ายไม่ตรงกับฐานข้อมูล — เลือกค่าจริงทางขวา หรือ Skip (ปล่อยว่าง) ก่อนบันทึก
          </p>
          <ScrollArea className="flex-1 max-h-[60vh] border rounded-md">
            <div className="divide-y">
              {resolveEntries.map((e, i) => {
                const opts = resolveTarget === "ro" ? stores.map(s => s.store_name) : customers.map(c => c.name);
                return (
                  <div key={i} className="p-3 grid grid-cols-2 gap-3 items-start">
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">นำเข้า:</div>
                      <div className="text-xs font-mono p-2 bg-muted rounded break-all">{e.typed}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">เลือก {resolveTarget === "ro" ? "Store" : "Customer"} ที่ถูกต้อง:</div>
                      <Select value={e.pick || "__skip__"} onValueChange={(v) => {
                        const pick = v === "__skip__" ? "" : v;
                        setResolveEntries(arr => arr.map((x, j) => j === i ? { ...x, pick } : x));
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-popover z-50 max-h-72">
                          <SelectItem value="__skip__" className="text-xs text-muted-foreground">— Skip (ปล่อยว่าง) —</SelectItem>
                          {opts.map(o => (
                            <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>ยกเลิก</Button>
            <Button onClick={applyResolver}>ยืนยัน &amp; ดำเนินการต่อ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== PREVIEW DIALOG (shared) ============== */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" /> Preview · {previewDoc?.filename}
            </DialogTitle>
          </DialogHeader>
          {previewDoc && (
            <>
              <div className="text-xs text-muted-foreground -mt-2">
                {previewDoc.rows.length} รายการ
                {previewDoc.customer_name && <> · 👤 {previewDoc.customer_name}</>}
                {previewDoc.source_document && <> · Source: {previewDoc.source_document}</>}
                {previewDoc.description && <> · Desc: {previewDoc.description}</>}
              </div>
              <div className="overflow-auto border border-border rounded">
                <table className="text-xs w-full border-collapse">
                  <thead className="bg-muted sticky top-0">
                    <tr className="text-left">
                      {["Vendor", "SKU", "Main Barcode", "Product LA", "Product (imp)", "UoM", "Qty", "Stock DC"].map(h => (
                        <th key={h} className="px-2 py-1.5 border-b border-border whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewDoc.rows.map(r => (
                      <tr key={r.id} className="border-b border-border/30">
                        <td className="px-2 py-1 whitespace-nowrap">{r.vendor_display}</td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">{r.sku_code}</td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">{r.main_barcode}</td>
                        <td className="px-2 py-1">{r.product_name_la}</td>
                        <td className="px-2 py-1">{r.product_name_imp}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.unit_of_measure}</td>
                        <td className="px-2 py-1 text-right">{fmt(r.qty)}</td>
                        <td className="px-2 py-1 text-right">{fmt(r.stock_dc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// SO DOC LIST (Tab 2)
// Group by yyyymmddhhmm → Customer
// Only rows where stock_dc <= 0
// ============================================================
function SODocList({ docs, onChange, allDocs, onPreview }: {
  docs: SavedB2BDoc[]; onChange: (d: SavedB2BDoc[]) => void;
  allDocs: SavedB2BDoc[]; onPreview: (d: SavedB2BDoc) => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [soMode, setSoMode] = useState<"all" | "gt0">("all");
  const [docSearch, setDocSearch] = useState("");
  // FIX 2.2: Items per SO (default 20, min 1)
  const [itemsPerSOInput, setItemsPerSOInput] = useState<string>("20");
  const itemsPerSO = useMemo(() => {
    const n = parseInt(itemsPerSOInput, 10);
    return !n || n < 1 ? 20 : n;
  }, [itemsPerSOInput]);

  const rowFilter = (r: B2BRow) => {
    if (soMode === "all") return true;
    const v = r.stock_dc as unknown;
    if (v === null || v === undefined || v === "") return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  };

  const eligible = useMemo(
    () => docs.filter(d => d.customer_name && d.rows.some(rowFilter)),
    [docs, soMode]
  );
  const filteredEligible = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(d =>
      d.filename.toLowerCase().includes(q) ||
      (d.customer_name || "").toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q)
    );
  }, [eligible, docSearch]);

  // Group key = batch_id (one Save = one group). Display label = batch_label (with seconds)
  // so re-saving the same customer creates a NEW group line.
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; custMap: Map<string, SavedB2BDoc[]> }>();
    for (const d of filteredEligible) {
      const key = d.batch_id || d.filename.split("-")[0];
      const label = d.batch_label || d.filename.split("-")[0];
      const cust = d.customer_name || "";
      if (!m.has(key)) m.set(key, { label, custMap: new Map() });
      const cm = m.get(key)!.custMap;
      if (!cm.has(cust)) cm.set(cust, []);
      cm.get(cust)!.push(d);
    }
    return m;
  }, [filteredEligible]);

  const toggle = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleStamp = (s: string) => setExpanded(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });

  // Build SO rows for one doc, splitting into chunks of `itemsPerSO`.
  // Each chunk = its own SO group with its own main row at index 0.
  const buildSORows = (d: SavedB2BDoc): any[] => {
    const elig = d.rows.filter(rowFilter);
    const out: any[] = [];
    if (elig.length === 0) return out;
    const isRO = d.doc_type === "ro";

    // For RO: group by order_group first, then split each group into chunks of itemsPerSO.
    // Each (group × chunk) becomes its own RO with its own main row at idx 0.
    const groups: { key: string; rows: B2BRow[]; displayKey: string }[] = [];
    if (isRO) {
      const m = new Map<string, { rows: B2BRow[]; displayKey: string }>();
      for (const r of elig) {
        const raw = (r.order_group || "").trim();
        const k = raw.toLowerCase() || "_";
        if (!m.has(k)) m.set(k, { rows: [], displayKey: raw });
        m.get(k)!.rows.push(r);
      }
      for (const [k, v] of m) groups.push({ key: k, rows: v.rows, displayKey: v.displayKey });
    } else {
      groups.push({ key: "_", rows: elig, displayKey: "" });
    }

    for (const g of groups) {
      for (let i = 0; i < g.rows.length; i += itemsPerSO) {
        const chunk = g.rows.slice(i, i + itemsPerSO);
        chunk.forEach((r, idx) => {
          if (isRO) {
            out.push({
              "Company": idx === 0 ? (d.customer_name || "") : "",
              "Partner": idx === 0 ? COMPANY : "",
              "RPM Type": idx === 0 ? "DC Item" : "",
              "Currency": idx === 0 ? "LAK" : "",
              "Order Group": idx === 0 ? g.displayKey : "",
              "Order Lines/Barcode": r.main_barcode,
              "Order Lines/Product": r.main_barcode,
              "Order Lines/Unit of Measure": r.unit_of_measure,
              "Order Lines/Quantity": r.qty,
              "Order Lines/Exclude In Package": "TRUE",
              "Order Lines/Unit Price": 0,
            });
          } else {
            out.push({
              "Order Reference": "",
              "Customer": idx === 0 ? (d.customer_name || "") : "",
              "Pricelist": idx === 0 ? PRICELIST : "",
              "Order Lines/Barcode": r.main_barcode,
              "Order Lines/Product": r.main_barcode,
            "Product Name": r.product_name_la,
            "UOM": r.unit_of_measure,
            "Order Lines/Quantity": r.qty,
            "Source Document": idx === 0 ? (d.source_document || "") : "",
            "Warehouse": idx === 0 ? WAREHOUSE : "",
            "Company": idx === 0 ? COMPANY : "",
          });
          }
        });
      }
    }
    return out;
  };

  // Total SO count across selected docs (for the helper text)
  const splitInfo = useMemo(() => {
    const list = filteredEligible.filter(d => selected.has(d.id));
    let totalSOs = 0;
    let totalItems = 0;
    for (const d of list) {
      const elig = d.rows.filter(rowFilter);
      if (elig.length === 0) continue;
      const isRO = d.doc_type === "ro";
      if (isRO) {
        const m = new Map<string, number>();
        for (const r of elig) {
          const k = (r.order_group || "").trim().toLowerCase() || "_";
          m.set(k, (m.get(k) || 0) + 1);
        }
        for (const c of m.values()) totalSOs += Math.ceil(c / itemsPerSO);
      } else {
        totalSOs += Math.ceil(elig.length / itemsPerSO);
      }
      totalItems += elig.length;
    }
    return { totalSOs, totalItems };
  }, [filteredEligible, selected, itemsPerSO, soMode]);

  const exportSelected = () => {
    const list = filteredEligible.filter(d => selected.has(d.id));
    if (list.length === 0) { toast({ title: "กรุณาเลือกเอกสาร", variant: "destructive" }); return; }
    const all: any[] = [];
    for (const d of list) all.push(...buildSORows(d));
    const ws = XLSX.utils.json_to_sheet(all);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SO");
    XLSX.writeFile(wb, `${tsCompact()}-SO-Combined.xlsx`);
    toast({ title: "Export SO สำเร็จ", description: `${list.length} เอกสาร · ${splitInfo.totalSOs} SO` });
  };
  const exportSingle = (d: SavedB2BDoc) => {
    const ws = XLSX.utils.json_to_sheet(buildSORows(d));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SO");
    XLSX.writeFile(wb, `${d.filename}-SO.xlsx`);
  };
  const deleteDoc = (id: string) => {
    const upd = allDocs.filter(d => d.id !== id);
    onChange(upd);
    persistDocs(upd);
    setSelected(p => { const n = new Set(p); n.delete(id); return n; });
  };

  return (
    <div className="space-y-2">
      {/* Toggle + search bar */}
      <div className="flex items-center gap-2 flex-wrap p-2 border border-border rounded-lg bg-muted/30">
        <span className="text-xs font-semibold">เงื่อนไข:</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button onClick={() => setSoMode("all")}
            className={cn("px-3 py-1 text-xs", soMode === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
            ทั้งหมด
          </button>
          <button onClick={() => setSoMode("gt0")}
            className={cn("px-3 py-1 text-xs border-l border-border", soMode === "gt0" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
            Stock DC &gt; 0
          </button>
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="ค้นหา doc / customer / วันที่..." value={docSearch} onChange={e => setDocSearch(e.target.value)} className="h-8 pl-7 text-xs" />
        </div>
      </div>

      {eligible.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">ยังไม่มี SO Doc สำหรับเงื่อนไขนี้</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted-foreground">
              {filteredEligible.length} / {eligible.length} doc · {grouped.size} time groups
              {selected.size > 0 && (
                <> · จะแบ่งเป็น <strong>{splitInfo.totalSOs}</strong> SO ({splitInfo.totalItems} items)</>
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-muted-foreground">Items per SO</label>
              <Input
                type="number" min={1} value={itemsPerSOInput}
                onChange={e => setItemsPerSOInput(e.target.value)}
                onBlur={() => { const n = parseInt(itemsPerSOInput, 10); if (!n || n < 1) setItemsPerSOInput("20"); }}
                className="h-8 w-20 text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(filteredEligible.map(d => d.id)))} className="text-xs h-8">
                <CheckSquare className="w-3 h-3 mr-1" /> Select All
              </Button>
              {selected.size > 0 && (
                <Button size="sm" onClick={exportSelected} className="text-xs h-8">
                  <Download className="w-3 h-3 mr-1" /> Export ({selected.size})
                </Button>
              )}
            </div>
          </div>
          {[...grouped.entries()].sort((a, b) => b[1].label.localeCompare(a[1].label)).map(([batchKey, { label, custMap }]) => {
            const isExp = expanded.has(batchKey);
            return (
              <div key={batchKey} className="border border-border rounded-lg overflow-hidden">
                <button onClick={() => toggleStamp(batchKey)} className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted">
                  {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{[...custMap.values()].flat().length} doc</span>
                </button>
                {isExp && [...custMap.entries()].map(([cust, list]) => (
                  <div key={cust}>
                    <div className="px-6 py-1 bg-muted/20 text-xs font-medium text-muted-foreground">👤 {cust}</div>
                    {list.map(d => (
                      <div key={d.id} className={cn("flex items-center gap-2 px-8 py-2 border-b border-border/30",
                        selected.has(d.id) && "bg-primary/5")}>
                        <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} className="h-3.5 w-3.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{d.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.rows.filter(rowFilter).length} / {d.rows.length} รายการ · Source: {d.source_document || "-"}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => onPreview({ ...d, rows: d.rows.filter(rowFilter) })} className="h-7 px-2 text-[10px] gap-1"><Eye className="w-3.5 h-3.5" /> Preview</Button>
                        <Button size="sm" variant="ghost" onClick={() => exportSingle(d)} className="h-7 w-7 p-0"><Download className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteDoc(d.id)} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ============================================================
// PO DOC LIST (Tab 3)
// Only rows where stock_dc < qty
// Group: yyyymmddhhmm → Vendor
// Buttons: Sum Qty, Regenerate, Export
// ============================================================
function PODocList({ docs, onChange, allDocs, onPreview }: {
  docs: SavedB2BDoc[]; onChange: (d: SavedB2BDoc[]) => void;
  allDocs: SavedB2BDoc[]; onPreview: (d: SavedB2BDoc) => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summedByDoc, setSummedByDoc] = useState<Map<string, B2BRow[]>>(new Map());
  const [docSearch, setDocSearch] = useState("");
  // FIX 3.4: Items per PO (default 20, min 1)
  const [itemsPerPOInput, setItemsPerPOInput] = useState<string>("20");
  const itemsPerPO = useMemo(() => {
    const n = parseInt(itemsPerPOInput, 10);
    return !n || n < 1 ? 20 : n;
  }, [itemsPerPOInput]);

  const eligibleAll = useMemo(() => docs.filter(d => d.rows.some(r => r.stock_dc < r.qty)), [docs]);
  const eligible = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return eligibleAll;
    return eligibleAll.filter(d =>
      d.filename.toLowerCase().includes(q) ||
      (d.customer_name || "").toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q)
    );
  }, [eligibleAll, docSearch]);

  // Sum helper: group by vendor_code + Picking + PO Group + SKU, sum qty
  const sumRows = (rows: B2BRow[]): B2BRow[] => {
    const map = new Map<string, B2BRow>();
    for (const r of rows) {
      const k = `${r.vendor_code}|${PICKING_DB_ID}|${r.po_group || ""}|${r.sku_code}`;
      const cur = map.get(k);
      if (cur) cur.qty += r.qty;
      else map.set(k, { ...r });
    }
    return [...map.values()];
  };

  // Per-doc effective rows (post-sum if applied)
  const effectiveRows = (d: SavedB2BDoc): B2BRow[] => {
    const summed = summedByDoc.get(d.id);
    if (summed) return summed;
    return d.rows.filter(r => r.stock_dc < r.qty);
  };

  // Always-summed rows for export (Regenerate auto-sums)
  const exportRows = (d: SavedB2BDoc): B2BRow[] => {
    const summed = summedByDoc.get(d.id);
    if (summed) return summed;
    return sumRows(d.rows.filter(r => r.stock_dc < r.qty));
  };

  // Grouping by batch_id (one Save = one group line)
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; vMap: Map<string, SavedB2BDoc[]> }>();
    for (const d of eligible) {
      const key = d.batch_id || d.filename.split("-")[0];
      const label = d.batch_label || d.filename.split("-")[0];
      const vKey = "(multi)";
      if (!m.has(key)) m.set(key, { label, vMap: new Map() });
      const vm = m.get(key)!.vMap;
      if (!vm.has(vKey)) vm.set(vKey, []);
      vm.get(vKey)!.push(d);
    }
    return m;
  }, [eligible]);

  const toggle = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleStamp = (s: string) => setExpanded(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });

  // Sum Qty: only on selected docs. Group rows within each doc by
  // partner_id (vendor_code) + Picking Type/Database ID + PO Group + SKUcode, sum qty.
  const doSumQty = () => {
    if (selected.size === 0) { toast({ title: "กรุณาเลือกเอกสาร", variant: "destructive" }); return; }
    const next = new Map(summedByDoc);
    for (const d of eligible) {
      if (!selected.has(d.id)) continue;
      const elig = d.rows.filter(r => r.stock_dc < r.qty);
      next.set(d.id, sumRows(elig));
    }
    setSummedByDoc(next);
    toast({ title: "Sum Qty สำเร็จ", description: `${selected.size} เอกสาร` });
  };

  const buildPORows = (d: SavedB2BDoc): any[] => {
    // Always sum before export (Regenerate auto-sums by vendor_code + PO Group + SKU)
    const erows = exportRows(d);
    const byVendor = new Map<string, B2BRow[]>();
    for (const r of erows) {
      if (!byVendor.has(r.vendor_code)) byVendor.set(r.vendor_code, []);
      byVendor.get(r.vendor_code)!.push(r);
    }
    const out: any[] = [];
    for (const [vc, list] of byVendor) {
      for (let i = 0; i < list.length; i += itemsPerPO) {
        const chunk = list.slice(i, i + itemsPerPO);
        chunk.forEach((r, idx) => {
          const isMain = idx === 0;
          out.push({
            "partner_id": isMain ? vc : null,
            "Picking Type / Database ID": isMain ? PICKING_DB_ID : null,
            "Inter Transfer": isMain ? "" : null,
            "PO Group": isMain ? (r.po_group || "G01") : null,
            "Products to Purchase/barcode": r.main_barcode,
            "Products to Purchase/Product": r.main_barcode,
            "Product name": r.product_name_la,
            "Products to Purchase/UoM": r.unit_of_measure,
            "Products to Purchase/Exclude In Package": "true",
            "Products to Purchase/Quantity": r.qty,
            "Products to Purchase/Unit Price": r.po_cost_unit,
            "assigned_to": isMain ? SPC_MANAGER : null,
            "description": isMain ? (d.description || "") : null,
          });
        });
      }
    }
    return out;
  };

  // Total PO count helper text
  const splitInfo = useMemo(() => {
    const list = eligible.filter(d => selected.has(d.id));
    let totalPOs = 0;
    let totalItems = 0;
    for (const d of list) {
      const erows = effectiveRows(d);
      const byVendor = new Map<string, B2BRow[]>();
      for (const r of erows) {
        if (!byVendor.has(r.vendor_code)) byVendor.set(r.vendor_code, []);
        byVendor.get(r.vendor_code)!.push(r);
      }
      for (const [, list2] of byVendor) {
        totalPOs += Math.ceil(list2.length / itemsPerPO);
        totalItems += list2.length;
      }
    }
    return { totalPOs, totalItems };
  }, [eligible, selected, itemsPerPO, summedByDoc]);

  // Build PO rows from a merged pool of B2BRow across multiple docs.
  // Groups by vendor_code + Picking + PO Group + SKU and sums qty.
  const buildPORowsMerged = (rows: B2BRow[], descByVendor: Map<string, string>): any[] => {
    const merged = sumRows(rows);
    const byVendor = new Map<string, B2BRow[]>();
    for (const r of merged) {
      if (!byVendor.has(r.vendor_code)) byVendor.set(r.vendor_code, []);
      byVendor.get(r.vendor_code)!.push(r);
    }
    const out: any[] = [];
    for (const [vc, list] of byVendor) {
      for (let i = 0; i < list.length; i += itemsPerPO) {
        const chunk = list.slice(i, i + itemsPerPO);
        chunk.forEach((r, idx) => {
          const isMain = idx === 0;
          out.push({
            "partner_id": isMain ? vc : null,
            "Picking Type / Database ID": isMain ? PICKING_DB_ID : null,
            "Inter Transfer": isMain ? "" : null,
            "PO Group": isMain ? (r.po_group || "G01") : null,
            "Products to Purchase/barcode": r.main_barcode,
            "Products to Purchase/Product": r.main_barcode,
            "Product name": r.product_name_la,
            "Products to Purchase/UoM": r.unit_of_measure,
            "Products to Purchase/Exclude In Package": "true",
            "Products to Purchase/Quantity": r.qty,
            "Products to Purchase/Unit Price": r.po_cost_unit,
            "assigned_to": isMain ? SPC_MANAGER : null,
            "description": isMain ? (descByVendor.get(vc) || "") : null,
          });
        });
      }
    }
    return out;
  };

  const doRegenerate = () => {
    if (selected.size === 0) { toast({ title: "กรุณาเลือกเอกสาร", variant: "destructive" }); return; }
    const list = eligible.filter(d => selected.has(d.id));
    // STEP 1: Merge all selected docs' detail rows into one pool BEFORE grouping
    const allRows: B2BRow[] = [];
    const descByVendor = new Map<string, string>();
    for (const d of list) {
      const elig = d.rows.filter(r => r.stock_dc < r.qty);
      for (const r of elig) {
        allRows.push(r);
        if (!descByVendor.has(r.vendor_code)) descByVendor.set(r.vendor_code, d.description || "");
      }
    }
    // STEP 2-4: sum + rebuild main rows + split by Items per PO
    const all = buildPORowsMerged(allRows, descByVendor);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(all);
    XLSX.utils.book_append_sheet(wb, ws, "PO");
    XLSX.writeFile(wb, `${tsCompact()}-PO-Regenerate.xlsx`);
    toast({ title: "Regenerate สำเร็จ", description: `${list.length} เอกสาร · ${all.length} แถว` });
  };

  const exportSelected = () => {
    if (selected.size === 0) { toast({ title: "กรุณาเลือกเอกสาร", variant: "destructive" }); return; }
    doRegenerate();
  };
  const exportSingle = (d: SavedB2BDoc) => {
    const ws = XLSX.utils.json_to_sheet(buildPORows(d));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PO");
    XLSX.writeFile(wb, `${d.filename}-PO.xlsx`);
  };
  const deleteDoc = (id: string) => {
    const upd = allDocs.filter(d => d.id !== id);
    onChange(upd); persistDocs(upd);
    setSelected(p => { const n = new Set(p); n.delete(id); return n; });
    setSummedByDoc(p => { const n = new Map(p); n.delete(id); return n; });
  };

  if (eligibleAll.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">ยังไม่มี PO Doc (ต้องมีรายการที่ Stock DC &lt; qty)</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search bar */}
      <div className="flex items-center gap-2 p-2 border border-border rounded-lg bg-muted/30">
        <div className="relative flex-1 min-w-[180px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="ค้นหา doc / vendor / วันที่..." value={docSearch} onChange={e => setDocSearch(e.target.value)} className="h-8 pl-7 text-xs" />
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          {eligible.length} / {eligibleAll.length} doc · {grouped.size} time groups
          {selected.size > 0 && (
            <> · จะแบ่งเป็น <strong>{splitInfo.totalPOs}</strong> PO ({splitInfo.totalItems} items)</>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground">Items per PO</label>
          <Input
            type="number" min={1} value={itemsPerPOInput}
            onChange={e => setItemsPerPOInput(e.target.value)}
            onBlur={() => { const n = parseInt(itemsPerPOInput, 10); if (!n || n < 1) setItemsPerPOInput("20"); }}
            className="h-8 w-20 text-xs"
          />
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set(eligible.map(d => d.id)))} className="text-xs h-8">
            <CheckSquare className="w-3 h-3 mr-1" /> Select All
          </Button>
          <Button size="sm" variant="outline" onClick={doSumQty} disabled={selected.size === 0} className="text-xs h-8">
            <Sigma className="w-3 h-3 mr-1" /> Sum Qty
          </Button>
          <Button size="sm" variant="outline" onClick={doRegenerate} disabled={selected.size === 0} className="text-xs h-8">
            <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
          </Button>
          {selected.size > 0 && (
            <Button size="sm" onClick={exportSelected} className="text-xs h-8">
              <Download className="w-3 h-3 mr-1" /> Export ({selected.size})
            </Button>
          )}
        </div>
      </div>
      {[...grouped.entries()].sort((a, b) => b[1].label.localeCompare(a[1].label)).map(([batchKey, { label, vMap }]) => {
        const isExp = expanded.has(batchKey);
        const list = [...vMap.values()].flat();
        return (
          <div key={batchKey} className="border border-border rounded-lg overflow-hidden">
            <button onClick={() => toggleStamp(batchKey)} className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted">
              {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span className="text-sm font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground ml-auto">{list.length} doc</span>
            </button>
            {isExp && list.map(d => {
              const erows = effectiveRows(d);
              const isSummed = summedByDoc.has(d.id);
              const vendors = [...new Set(erows.map(r => r.vendor_code))];
              return (
                <div key={d.id} className={cn("flex items-center gap-2 px-6 py-2 border-b border-border/30",
                  selected.has(d.id) && "bg-primary/5")}>
                  <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} className="h-3.5 w-3.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {d.filename}
                      {isSummed && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded">SUMMED</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {erows.length} รายการ · {vendors.length} vendor · Desc: {d.description || "-"}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onPreview(d)} className="h-7 px-2 text-[10px] gap-1"><Eye className="w-3.5 h-3.5" /> Preview</Button>
                  <Button size="sm" variant="ghost" onClick={() => exportSingle(d)} className="h-7 w-7 p-0"><Download className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteDoc(d.id)} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
