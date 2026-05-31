import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSpreadsheet, Upload, Download, Loader2, AlertCircle, ClipboardPaste,
  RefreshCw, Calculator, Save, Search, Trash2, ChevronLeft, CheckCircle2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import { SARRow, computeRow } from "@/lib/sarCalc";

// --------------- Types ---------------
type OfsSubTab = "import" | "import_docs" | "result_docs";

interface ImportRow { code: string; qty: number; }

interface SkipRow {
  barcode: string; product_name_la: string;
  qty: number; reason: string; store_name: string;
}

interface OfsImportLine {
  sku_code: string; main_barcode: string | null;
  product_name_la: string | null; qty: number;
}

interface OfsImportDoc {
  id: string; doc_name: string; store_name: string;
  import_count: number; pass_count: number; skip_count: number;
  data: OfsImportLine[]; user_id: string | null; created_at: string;
}

interface OfsResultDoc {
  id: string; doc_name: string; doc_type: "RO" | "PO";
  store_name: string; source_doc_ids: string[];
  item_count: number; user_id: string | null; created_at: string;
}

interface DocRowRaw {
  sku_code: string; store_name: string; type_store?: string;
  unit_pick?: number; unit_pick_edit?: number | null;
  avg_sale?: number; rank_sale?: string; rank_factor?: number;
  min_cal?: number; max_cal?: number; min_final?: number; max_final?: number;
}

interface ProcessedRow extends SARRow {
  qty_import: number; division_group: string;
  _doc_type?: string;
}

// --------------- Columns ---------------
const COLS: { key: string; label: string; w: number; right?: boolean }[] = [
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
async function queryInChunks<T>(table: string, field: string, values: string[], sel: string, extra?: (q: any) => any): Promise<T[]> {
  if (!values.length) return [];
  const results: T[] = [];
  for (let i = 0; i < values.length; i += 200) {
    let q = (supabase.from(table as any) as any).select(sel).in(field, values.slice(i, i + 200));
    if (extra) q = extra(q);
    const { data } = await q;
    if (data) results.push(...(data as T[]));
  }
  return results;
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

// --------------- Component ---------------
export default function SAROrderFromStoreTab() {
  const { user, isAdmin, canViewMenu } = useAuth();
  const { toast } = useToast();

  const canImport = isAdmin || canViewMenu("ofs_import");
  const canHQ = isAdmin || canViewMenu("ofs_hq");
  const canResult = isAdmin || canViewMenu("ofs_result");
  const hasAny = canImport || canHQ || canResult;

  const [subTab, setSubTab] = useState<OfsSubTab>("import");
  const initialSet = useRef(false);
  useEffect(() => {
    if (initialSet.current || !hasAny) return;
    initialSet.current = true;
    if (!canImport) setSubTab(canHQ ? "import_docs" : "result_docs");
  }, [canImport, canHQ, canResult, hasAny]);

  // ---- Shared ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // ---- IMPORT TAB ----
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [storeSelectOpen, setStoreSelectOpen] = useState(false);
  const [storeList, setStoreList] = useState<string[]>([]);
  const [storeTypeCache, setStoreTypeCache] = useState<Record<string, string>>({});
  const [selectedStore, setSelectedStore] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const [importStep, setImportStep] = useState<"idle" | "done">("idle");
  const [lastSave, setLastSave] = useState<{ total: number; pass: number; skip: number } | null>(null);
  const [pendingSkips, setPendingSkips] = useState<SkipRow[]>([]);

  // ---- HQ TAB ----
  const [importDocs, setImportDocs] = useState<OfsImportDoc[]>([]);
  const [importDocsLoading, setImportDocsLoading] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [hqRows, setHqRows] = useState<ProcessedRow[]>([]);
  const [hqFetched, setHqFetched] = useState(false);
  const [hqCalculated, setHqCalculated] = useState(false);
  const [hqLoading, setHqLoading] = useState(false);
  const [hqCalculating, setHqCalculating] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [useQtyImport, setUseQtyImport] = useState(false);
  const [hqSearch, setHqSearch] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [hqSaving, setHqSaving] = useState(false);

  // ---- RESULT DOCS TAB ----
  const [resultDocs, setResultDocs] = useState<OfsResultDoc[]>([]);
  const [resultDocsLoading, setResultDocsLoading] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [viewItems, setViewItems] = useState<ProcessedRow[] | null>(null);
  const [viewTitle, setViewTitle] = useState("");
  const [viewDocType, setViewDocType] = useState<"RO" | "PO" | "MIXED" | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // ============================================================
  // IMPORT TAB — logic
  // ============================================================

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ "Barcode/SKUCode": "8857123456789", "Qty": 5 }]);
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
      if (cIdx < 0 || qIdx < 0) { toast({ title: "ไม่พบคอลัมน์ barcode/qty", variant: "destructive" }); return; }
      const rows = rawRows.slice(1).map(r => ({ code: String(r[cIdx] ?? "").trim(), qty: Number(r[qIdx]) || 0 })).filter(r => r.code && r.qty > 0);
      if (!rows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
      await openStoreSelect(rows);
    } catch (e: any) { toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
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
    try {
      const codes = importRows.map(r => r.code);
      // ไม่กรอง packing_size_qty=1 ตอน validate — barcode อาจอยู่ใน row ที่เป็น pack/box
      // ค้น 3 ทาง: main_barcode / barcode / sku_code
      const dmSel = "sku_code,main_barcode,barcode,product_name_la,buying_status,item_type,product_owner";
      const [dmByMainBarcode, dmBySku, dmByBarcode] = await Promise.all([
        queryInChunks<any>("data_master", "main_barcode", codes, dmSel),
        queryInChunks<any>("data_master", "sku_code", codes, dmSel, q => q.eq("packing_size_qty", 1)),
        queryInChunks<any>("data_master", "barcode", codes, dmSel),
      ]);
      const dmMap: Record<string, any> = {};
      // ลำดับความสำคัญ: main_barcode > sku_code > barcode (non-unit)
      dmByMainBarcode.forEach((r: any) => { if (r.main_barcode && !dmMap[r.main_barcode]) dmMap[r.main_barcode] = r; });
      dmBySku.forEach((r: any) => { if (r.sku_code && !dmMap[r.sku_code]) dmMap[r.sku_code] = r; });
      dmByBarcode.forEach((r: any) => { if (r.barcode && !dmMap[r.barcode]) dmMap[r.barcode] = r; });

      // Detect dup sku
      const skuToCode: Record<string, string[]> = {};
      importRows.forEach(r => { const sku = dmMap[r.code]?.sku_code; if (sku) (skuToCode[sku] ??= []).push(r.code); });
      const dupSkus = new Set(Object.entries(skuToCode).filter(([, arr]) => arr.length > 1).map(([s]) => s));

      // Range store
      const allSkus = [...new Set(Object.values(dmMap).map((r: any) => r.sku_code).filter(Boolean) as string[])];
      const rsRows = await queryInChunks<any>("range_store", "sku_code", allSkus, "sku_code", q => q.eq("apply_yn", "Y").eq("store_name", selectedStore));
      const rangeSet = new Set(rsRows.map((r: any) => r.sku_code));

      const skips: SkipRow[] = [];
      const valid: OfsImportLine[] = [];

      for (const r of importRows) {
        const dm = dmMap[r.code];
        const pnLa = dm?.product_name_la ?? "";
        if (!dm) { skips.push({ barcode: r.code, product_name_la: "", qty: r.qty, reason: "ไม่พบใน Data master", store_name: selectedStore }); continue; }
        const bs = (dm.buying_status ?? "").trim();
        if (bs === "Inactive" || bs === "Discontinue") { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Buying Status: ${bs}`, store_name: selectedStore }); continue; }
        if ((dm.item_type ?? "").trim() === "Non basic") { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: "Item type: Non basic", store_name: selectedStore }); continue; }
        if (!(dm.product_owner ?? "").toLowerCase().includes("lanexang green property")) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Product owner ไม่ใช่ Lanexang green property`, store_name: selectedStore }); continue; }
        if (!rangeSet.has(dm.sku_code)) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `ไม่อยู่ใน Range store (${selectedStore})`, store_name: selectedStore }); continue; }
        if (dupSkus.has(dm.sku_code)) { skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `SKU ซ้ำ (${dm.sku_code})`, store_name: selectedStore }); continue; }
        valid.push({ sku_code: dm.sku_code, main_barcode: dm.main_barcode ?? null, product_name_la: pnLa, qty: r.qty });
      }

      const docName = `OFS-${selectedStore}-${fmtFile(new Date())}`;
      const { error } = await (supabase as any).from("ofs_import_docs").insert({
        doc_name: docName, store_name: selectedStore,
        import_count: importRows.length, pass_count: valid.length, skip_count: skips.length,
        data: valid, user_id: user?.id,
      });
      if (error) throw error;

      setPendingSkips(skips);
      setLastSave({ total: importRows.length, pass: valid.length, skip: skips.length });
      setStoreSelectOpen(false);
      setImportStep("done");
      toast({ title: "บันทึกสำเร็จ", description: `${docName}` });
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally { setImportSaving(false); }
  };

  const downloadSkipList = () => {
    if (!pendingSkips.length) return;
    const ws = XLSX.utils.json_to_sheet(pendingSkips.map(r => ({
      "Barcode Import": r.barcode, "Product Name LA": r.product_name_la,
      "Qty": r.qty, "Reason": r.reason, "Store Name": r.store_name,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skip List");
    XLSX.writeFile(wb, `OFS_Skip_${Date.now()}.xlsx`);
  };

  const resetImport = () => {
    setImportStep("idle"); setImportRows([]); setPendingSkips([]); setLastSave(null);
  };

  // ============================================================
  // HQ TAB — logic
  // ============================================================

  const loadImportDocs = useCallback(async () => {
    setImportDocsLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_import_docs")
        .select("id, doc_name, store_name, import_count, pass_count, skip_count, user_id, created_at, data")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      setImportDocs(data || []);
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setImportDocsLoading(false); }
  }, [toast]);

  useEffect(() => { if (subTab === "import_docs") loadImportDocs(); }, [subTab, loadImportDocs]);

  const getEffUnit = useCallback((r: ProcessedRow) => {
    const up = Math.max(r.unit_pick, 1);
    return useQtyImport ? Math.ceil(r.qty_import / up) * up : r.final_order_unit;
  }, [useQtyImport]);

  const filteredHqRows = useMemo(() => {
    if (!hqSearch.trim()) return hqRows;
    const q = hqSearch.toLowerCase();
    return hqRows.filter(r =>
      r.sku_code.toLowerCase().includes(q) ||
      (r.main_barcode || "").toLowerCase().includes(q) ||
      (r.product_name_la || "").toLowerCase().includes(q) ||
      r.store_name.toLowerCase().includes(q)
    );
  }, [hqRows, hqSearch]);

  const saveSummary = useMemo(() => {
    if (!hqCalculated || !hqRows.length) return [];
    const byStore = new Map<string, { ro: number; po: number }>();
    for (const r of hqRows) {
      if (!byStore.has(r.store_name)) byStore.set(r.store_name, { ro: 0, po: 0 });
      const e = byStore.get(r.store_name)!;
      if (r.stock_dc >= getEffUnit(r)) e.ro++; else e.po++;
    }
    return Array.from(byStore.entries()).map(([store, { ro, po }]) => ({ store, ro, po }));
  }, [hqRows, hqCalculated, getEffUnit]);

  const handleFetchData = async () => {
    const selectedDocs = importDocs.filter(d => selectedDocIds.has(d.id));
    if (!selectedDocs.length) return;
    setHqLoading(true); setHqFetched(false); setHqCalculated(false); setHqRows([]);
    setProgressPct(5); setProgressLabel("รวบรวมรายการ...");
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

      setProgressPct(10); setProgressLabel("ดึง Data master...");
      const dmMap = new Map<string, any>();
      for (let i = 0; i < allSkus.length; i += 200) {
        const slice = allSkus.slice(i, i + 200);
        const { data } = await (supabase.from("data_master") as any)
          .select("sku_code,main_barcode,product_name_la,product_name_en,unit_of_measure,division_group,division,department,sub_department,item_type,buying_status,standard_price,list_price,jmart_price")
          .in("sku_code", slice).eq("packing_size_qty", 1);
        for (const r of (data || []) as any[]) { if (r.sku_code && !dmMap.has(r.sku_code)) dmMap.set(r.sku_code, r); }
      }

      setProgressPct(25); setProgressLabel("โหลด Min/Max doc...");
      const { data: mmDoc } = await supabase.from("minmax_cal_documents").select("data").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const allMm = ((mmDoc?.data || []) as unknown as DocRowRaw[]);
      const mmMap = new Map<string, DocRowRaw>();
      for (const r of allMm) { const k = `${r.sku_code}\x00${r.store_name}`; if (!mmMap.has(k)) mmMap.set(k, r); }

      setProgressPct(40); setProgressLabel("โหลด Stock...");
      const stockDCMap = new Map<string, number>();
      const stockStoreMap = new Map<string, number>();
      const PAGE = 1000;
      for (let i = 0; i < allSkus.length; i += 500) {
        const slice = allSkus.slice(i, i + 500); let off = 0;
        while (true) {
          const { data, error } = await supabase.from("stock").select("item_id,type_store,company,quantity").in("item_id", slice).range(off, off + PAGE - 1);
          if (error) break;
          const batch = (data || []) as any[];
          for (const s of batch) {
            const qty = Number(s.quantity) || 0;
            if (s.type_store === "DC") stockDCMap.set(s.item_id, (stockDCMap.get(s.item_id) || 0) + qty);
            const co = String(s.company || "").trim();
            if (allStores.includes(co)) stockStoreMap.set(`${s.item_id}\x00${co}`, (stockStoreMap.get(`${s.item_id}\x00${co}`) || 0) + qty);
          }
          if (batch.length < PAGE) break; off += PAGE;
        }
      }

      setProgressPct(60); setProgressLabel("โหลด On Order...");
      const onOrderMap = new Map<string, number>();
      for (let i = 0; i < allSkus.length; i += 500) {
        const slice = allSkus.slice(i, i + 500); let off = 0;
        while (true) {
          const { data, error } = await supabase.from("on_order_dc").select("sku_code,store_name,qty").in("sku_code", slice).range(off, off + PAGE - 1);
          if (error) break;
          const batch = (data || []) as any[];
          for (const o of batch) { if (allStores.includes(o.store_name)) onOrderMap.set(`${o.sku_code}\x00${o.store_name}`, (onOrderMap.get(`${o.sku_code}\x00${o.store_name}`) || 0) + (Number(o.qty) || 0)); }
          if (batch.length < PAGE) break; off += PAGE;
        }
      }

      setProgressPct(75); setProgressLabel("โหลด Pack/Box + Store type...");
      const rsvMap = new Map<string, { pack_qty: number | null; box_qty: number | null }>();
      const rsvRows = await queryInChunks<any>("range_store_view", "sku_code", allSkus, "sku_code,pack_qty,box_qty");
      for (const r of rsvRows) { if (r.sku_code && !rsvMap.has(r.sku_code)) rsvMap.set(r.sku_code, { pack_qty: r.pack_qty ?? null, box_qty: r.box_qty ?? null }); }

      const { data: stTypeData } = await (supabase.from("store_type") as any).select("store_name,type_store").in("store_name", allStores);
      const stTypeMap = new Map<string, string>();
      for (const r of (stTypeData || []) as any[]) stTypeMap.set(r.store_name, r.type_store || "");

      setProgressPct(90); setProgressLabel("สร้าง rows...");
      const rows: ProcessedRow[] = [];
      for (const [key, { qty, main_barcode: mb, product_name_la: pnLa }] of storeSkuMap) {
        const [storeName, sku] = key.split("\x00");
        const dm = dmMap.get(sku);
        const mm = mmMap.get(key);
        const rsv = rsvMap.get(sku);
        const up = Number(mm?.unit_pick_edit ?? mm?.unit_pick ?? 1) || 1;
        const sarRow: SARRow = {
          sku_code: sku, main_barcode: dm?.main_barcode ?? mb ?? null,
          product_name_la: dm?.product_name_la ?? pnLa ?? null, product_name_en: dm?.product_name_en ?? null,
          unit_of_measure: dm?.unit_of_measure ?? null, store_name: storeName,
          type_store: mm?.type_store || stTypeMap.get(storeName) || "",
          division: dm?.division ?? "", department: dm?.department ?? "", sub_department: dm?.sub_department ?? "",
          item_type: dm?.item_type ?? "", buying_status: dm?.buying_status ?? "",
          unit_pick: up, pack_qty: rsv?.pack_qty ?? null, box_qty: rsv?.box_qty ?? null,
          cost: dm?.standard_price != null ? Number(dm.standard_price) : null,
          price2km: dm?.list_price != null ? Number(dm.list_price) : null,
          price_jm: dm?.jmart_price != null ? Number(dm.jmart_price) : null,
          pack_size: up === 1 ? "Unit" : `1x${up}`,
          avg_sale: Number(mm?.avg_sale) || 0, rank_sale: mm?.rank_sale || "D", rank_factor: Number(mm?.rank_factor) || 7,
          min_val: Number(mm?.min_final ?? mm?.min_cal ?? 0) || 0, max_val: Number(mm?.max_final ?? mm?.max_cal ?? 0) || 0,
          stock_dc: stockDCMap.get(sku) || 0, stock_store: stockStoreMap.get(key) || 0,
          on_order: onOrderMap.get(key) || 0,
          sar_suggest1: 0, sar_suggest2: 0, tt_order: 0, suggest_order_edit: null,
          final_order_unit: 0, final_order_uom: 0, doh_min: 0, doh_max: 0, doh_stock: 0, doh_tobe: 0, calculated: false,
        };
        rows.push({ ...sarRow, qty_import: qty, division_group: dm?.division_group ?? "" });
      }

      setHqRows(rows); setHqFetched(true); setProgressPct(100);
      toast({ title: "ดึงข้อมูลสำเร็จ", description: `${rows.length} รายการ จาก ${allStores.length} store` });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setHqLoading(false); setTimeout(() => { setProgressPct(0); setProgressLabel(""); }, 800); }
  };

  const handleCalculate = () => {
    if (!hqFetched || !hqRows.length) return;
    setHqCalculating(true);
    const next = hqRows.map(r => ({ ...computeRow(r), qty_import: r.qty_import, division_group: r.division_group }));
    setHqRows(next); setHqCalculated(true);
    setHqCalculating(false);
    toast({ title: "คำนวณเสร็จ", description: `${next.length} แถว` });
  };

  const handleHQSave = async () => {
    if (!user) return;
    setHqSaving(true);
    try {
      const ts = fmtFile(new Date());
      const prefix = saveName.trim() || ts;
      const srcIds = Array.from(selectedDocIds);
      const byStore = new Map<string, ProcessedRow[]>();
      for (const r of hqRows) { if (!byStore.has(r.store_name)) byStore.set(r.store_name, []); byStore.get(r.store_name)!.push(r); }
      let saved = 0;
      for (const [storeName, rows] of byStore) {
        const toSave = (r: ProcessedRow): ProcessedRow => {
          const eu = getEffUnit(r);
          return { ...r, final_order_unit: eu, final_order_uom: eu / Math.max(r.unit_pick, 1) };
        };
        const roRows = rows.filter(r => r.stock_dc >= getEffUnit(r)).map(toSave);
        const poRows = rows.filter(r => r.stock_dc < getEffUnit(r)).map(toSave);
        if (roRows.length > 0) {
          const { error } = await (supabase as any).from("ofs_result_docs").insert({ doc_name: `${prefix}-RO-${storeName}`, doc_type: "RO", store_name: storeName, source_doc_ids: srcIds, item_count: roRows.length, data: roRows, user_id: user.id });
          if (error) throw error; saved++;
        }
        if (poRows.length > 0) {
          const { error } = await (supabase as any).from("ofs_result_docs").insert({ doc_name: `${prefix}-PO-${storeName}`, doc_type: "PO", store_name: storeName, source_doc_ids: srcIds, item_count: poRows.length, data: poRows, user_id: user.id });
          if (error) throw error; saved++;
        }
      }
      toast({ title: "บันทึกสำเร็จ", description: `${saved} Doc` });
      setSaveOpen(false); setSaveName(""); setHqRows([]); setHqFetched(false); setHqCalculated(false);
      setSelectedDocIds(new Set()); setUseQtyImport(false); await loadImportDocs();
    } catch (e: any) { toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" }); }
    finally { setHqSaving(false); }
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

  const loadResultDocs = useCallback(async () => {
    setResultDocsLoading(true);
    try {
      const { data, error } = await (supabase as any).from("ofs_result_docs")
        .select("id,doc_name,doc_type,store_name,source_doc_ids,item_count,user_id,created_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      setResultDocs(data || []);
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
      setViewTitle(data.doc_name); setViewDocType(data.doc_type as "RO" | "PO");
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setViewLoading(false); }
  };

  const showSelectedResultDocs = async () => {
    const ids = Array.from(selectedResultIds);
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
      setViewTitle(`${ids.length} docs selected`);
      setViewDocType(types.size === 1 ? (types.values().next().value as "RO" | "PO") : "MIXED");
    } catch (e: any) { toast({ title: "Load error", description: e.message, variant: "destructive" }); }
    finally { setViewLoading(false); }
  };

  const deleteResultDoc = async (id: string, name: string) => {
    if (!confirm(`ลบ "${name}"?`)) return;
    await (supabase as any).from("ofs_result_docs").delete().eq("id", id);
    setResultDocs(d => d.filter(x => x.id !== id));
    setSelectedResultIds(s => { const n = new Set(s); n.delete(id); return n; });
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

  const exportTemplateRO = async (rows: ProcessedRow[]) => {
    const target = rows.filter(r => !r._doc_type || r._doc_type === "RO");
    if (!target.length) { toast({ title: "ไม่มีรายการ RO", variant: "destructive" }); return; }
    try {
      const mapped = await remapRowsByTemplate("srr_special_ro", target.map(toRaw));
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "RO");
      XLSX.writeFile(wb, `OFS_RO_Template_${Date.now()}.xlsx`);
      toast({ title: "Export Template RO สำเร็จ" });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  const exportPODC = async (rows: ProcessedRow[]) => {
    const target = rows.filter(r => !r._doc_type || r._doc_type === "PO");
    if (!target.length) { toast({ title: "ไม่มีรายการ PO", variant: "destructive" }); return; }
    // Sum by sku → 1 row per sku
    const bySkuQty = new Map<string, number>();
    const bySkuRow = new Map<string, ProcessedRow>();
    for (const r of target) { bySkuQty.set(r.sku_code, (bySkuQty.get(r.sku_code) || 0) + r.final_order_unit); if (!bySkuRow.has(r.sku_code)) bySkuRow.set(r.sku_code, r); }
    try {
      const raw = Array.from(bySkuRow.entries()).map(([sku, r]) => ({ ...toRaw(r), qty: bySkuQty.get(sku) || 0 }));
      const mapped = await remapRowsByTemplate("srr_special_po", raw);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PO_DC");
      XLSX.writeFile(wb, `OFS_PO_DC_${Date.now()}.xlsx`);
      toast({ title: "Export PO DC สำเร็จ", description: `${raw.length} SKU` });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
  };

  const exportPOD2S = async (rows: ProcessedRow[]) => {
    const target = rows.filter(r => !r._doc_type || r._doc_type === "PO");
    if (!target.length) { toast({ title: "ไม่มีรายการ PO", variant: "destructive" }); return; }
    try {
      const raw = target.map(r => ({ ...toRaw(r), store_name: r.store_name }));
      const mapped = await remapRowsByTemplate("srr_special_po", raw);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PO_D2S");
      XLSX.writeFile(wb, `OFS_PO_D2S_${Date.now()}.xlsx`);
      toast({ title: "Export PO D2S สำเร็จ", description: `${target.length} rows` });
    } catch (e: any) { toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" }); }
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
                  <div className="flex items-center gap-1 justify-end">
                    <span>{col.label}</span>
                    <button onClick={() => setUseQtyImport(v => !v)} className={cn("text-[9px] px-1.5 py-0.5 rounded border font-normal", useQtyImport ? "bg-amber-200 text-amber-800 border-amber-400" : "bg-primary/10 text-primary border-primary/30")}>
                      {useQtyImport ? "Qty Import" : "Calculated"}
                    </button>
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
                <tr key={`${r.sku_code}-${r.store_name}-${i}`} className="border-b hover:bg-emerald-100/70">
                  {COLS.map(col => {
                    let v: any = (r as any)[col.key];
                    if (col.key === "final_order_unit") v = eu;
                    else if (col.key === "final_order_uom") v = eu / Math.max(r.unit_pick, 1);
                    const isHL = HIGHLIGHT_COLS.has(col.key);
                    const isQA = showToggle && useQtyImport && col.key === "qty_import";
                    const isFA = showToggle && useQtyImport && col.key === "final_order_unit";
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

      <Dialog open={storeSelectOpen} onOpenChange={setStoreSelectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>เลือก Store Name</DialogTitle><DialogDescription>Import {importRows.length} รายการ</DialogDescription></DialogHeader>
          <div className="py-2 space-y-1">
            <Label className="text-xs">Store Name</Label>
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger><SelectValue placeholder="เลือก Store..." /></SelectTrigger>
              <SelectContent>{storeList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
            <div><Label className="text-xs">ชื่อ prefix (ไม่ใส่ = auto timestamp)</Label><Input className="mt-1" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={fmtFile(new Date())} /></div>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleHQSave} disabled={hqSaving}>{hqSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}<Save className="w-4 h-4 mr-1" />บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

      {/* ---- Sub-tabs ---- */}
      <Tabs value={subTab} onValueChange={v => setSubTab(v as OfsSubTab)} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-2 bg-background shrink-0">
          <TabsList>
            {canImport && <TabsTrigger value="import">Import</TabsTrigger>}
            {canHQ && <TabsTrigger value="import_docs">Import Docs</TabsTrigger>}
            {canResult && <TabsTrigger value="result_docs">Result Docs</TabsTrigger>}
          </TabsList>
        </div>

        {/* ============ IMPORT TAB ============ */}
        {canImport && (
          <TabsContent value="import" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            {importStep === "idle" ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center space-y-4 max-w-xs">
                  <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/50" />
                  <div><div className="font-semibold text-sm">Order From Store — Import</div><div className="text-xs text-muted-foreground mt-1">Import 2 คอลัมน์: <b>barcode/skucode</b> + <b>qty</b></div></div>
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => fileRef.current?.click()} className="w-full"><Upload className="w-4 h-4 mr-2" />เลือกไฟล์ Excel</Button>
                    <Button variant="outline" onClick={() => setPasteOpen(true)} className="w-full"><ClipboardPaste className="w-4 h-4 mr-2" />วางข้อมูล</Button>
                    <Button variant="ghost" onClick={downloadTemplate} className="w-full text-muted-foreground"><Download className="w-4 h-4 mr-2" />Download Template</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center space-y-4 max-w-sm">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
                  <div>
                    <div className="font-semibold">บันทึกสำเร็จ</div>
                    {lastSave && (
                      <div className="flex items-center gap-1 justify-center mt-2 text-xs">
                        <Badge variant="secondary">Import {lastSave.total} รายการ</Badge>
                        <span className="text-muted-foreground">/</span>
                        <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-300">ผ่าน {lastSave.pass} รายการ</Badge>
                        <span className="text-muted-foreground">/</span>
                        <Badge className={cn("border", lastSave.skip > 0 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-muted text-muted-foreground")}>Skip {lastSave.skip} รายการ</Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-center">
                    {pendingSkips.length > 0 && (
                      <Button size="sm" variant="outline" onClick={downloadSkipList}><AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-500" /><Download className="w-3.5 h-3.5 mr-1" />Skip List ({pendingSkips.length})</Button>
                    )}
                    <Button size="sm" onClick={resetImport}><Upload className="w-3.5 h-3.5 mr-1" />Import ใหม่</Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        )}

        {/* ============ IMPORT DOCS (HQ) TAB ============ */}
        {canHQ && (
          <TabsContent value="import_docs" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex flex-col">
            {/* Toolbar */}
            <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
              <div className="text-sm font-semibold">Import Docs</div>
              {selectedDocIds.size > 0 && <Badge variant="secondary" className="text-xs">เลือก {selectedDocIds.size}</Badge>}
              <Button size="sm" variant="outline" onClick={loadImportDocs} disabled={importDocsLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", importDocsLoading && "animate-spin")} />Refresh</Button>
              {selectedDocIds.size > 0 && !hqFetched && (
                <Button size="sm" onClick={handleFetchData} disabled={hqLoading}>{hqLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}ดึงข้อมูล</Button>
              )}
              {hqFetched && (
                <Button size="sm" onClick={handleCalculate} disabled={hqCalculating || hqCalculated}>{hqCalculating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}คำนวณ</Button>
              )}
              {hqCalculated && (
                <Button size="sm" onClick={() => setSaveOpen(true)}><Save className="w-4 h-4 mr-1" />Save</Button>
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
            </div>

            {/* Doc list (compact) */}
            <div className="shrink-0 max-h-52 overflow-y-auto border-b">
              {importDocsLoading ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-1.5 w-8">
                        <Checkbox checked={importDocs.length > 0 && selectedDocIds.size === importDocs.length} onCheckedChange={c => setSelectedDocIds(c ? new Set(importDocs.map(d => d.id)) : new Set())} />
                      </th>
                      <th className="px-2 py-1.5 text-left">Doc Name</th>
                      <th className="px-2 py-1.5 text-left">Store</th>
                      <th className="px-2 py-1.5 text-center">สถานะ Import</th>
                      <th className="px-2 py-1.5 text-left">วันที่</th>
                      <th className="px-2 py-1.5 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {importDocs.length === 0
                      ? <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">ยังไม่มี Doc</td></tr>
                      : importDocs.map(d => (
                        <tr key={d.id} className={cn("border-t hover:bg-muted/40 cursor-pointer", selectedDocIds.has(d.id) && "bg-primary/5")} onClick={() => setSelectedDocIds(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })}>
                          <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}><Checkbox checked={selectedDocIds.has(d.id)} onCheckedChange={() => setSelectedDocIds(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} /></td>
                          <td className="px-2 py-1 font-mono">{d.doc_name}</td>
                          <td className="px-2 py-1">{d.store_name}</td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1 justify-center flex-wrap">
                              <Badge variant="secondary" className="text-[10px] px-1">Import {d.import_count}</Badge>
                              <span className="text-muted-foreground text-[10px]">/</span>
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px] px-1">ผ่าน {d.pass_count}</Badge>
                              <span className="text-muted-foreground text-[10px]">/</span>
                              <Badge className={cn("text-[10px] px-1 border", d.skip_count > 0 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-muted text-muted-foreground")}>Skip {d.skip_count}</Badge>
                            </div>
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{new Date(d.created_at).toLocaleString()}</td>
                          <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteImportDoc(d.id, d.doc_name)}><Trash2 className="w-3 h-3" /></Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Progress */}
            {(hqLoading || progressPct > 0) && (
              <div className="px-4 py-2 space-y-1 shrink-0">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{progressLabel}</span><span>{progressPct}%</span></div>
                <Progress value={progressPct} className="h-1.5" />
              </div>
            )}

            {/* SAR Table */}
            {hqFetched && renderTable(filteredHqRows, true)}

            {!hqFetched && !hqLoading && (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                {selectedDocIds.size > 0 ? "กด ดึงข้อมูล เพื่อโหลด" : "เลือก Doc แล้วกด ดึงข้อมูล"}
              </div>
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
                  {selectedResultIds.size > 0 && <Badge variant="secondary" className="text-xs">เลือก {selectedResultIds.size}</Badge>}
                  <Button size="sm" variant="outline" onClick={loadResultDocs} disabled={resultDocsLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", resultDocsLoading && "animate-spin")} />Refresh</Button>
                  {selectedResultIds.size > 1 && (
                    <Button size="sm" variant="outline" onClick={showSelectedResultDocs} disabled={viewLoading}>{viewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Show Selected ({selectedResultIds.size})</Button>
                  )}
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 w-8"><Checkbox checked={resultDocs.length > 0 && selectedResultIds.size === resultDocs.length} onCheckedChange={c => setSelectedResultIds(c ? new Set(resultDocs.map(d => d.id)) : new Set())} /></th>
                        <th className="px-2 py-1.5 text-left">Doc Name</th>
                        <th className="px-2 py-1.5 text-left">Type</th>
                        <th className="px-2 py-1.5 text-left">Store</th>
                        <th className="px-2 py-1.5 text-right">Items</th>
                        <th className="px-2 py-1.5 text-left">วันที่</th>
                        <th className="px-2 py-1.5 w-32"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultDocsLoading
                        ? <tr><td colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                        : resultDocs.length === 0
                          ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">ยังไม่มี Result Doc</td></tr>
                          : resultDocs.map(d => (
                            <tr key={d.id} className={cn("border-t hover:bg-muted/40", selectedResultIds.has(d.id) && "bg-primary/5")}>
                              <td className="px-2 py-1 text-center"><Checkbox checked={selectedResultIds.has(d.id)} onCheckedChange={() => setSelectedResultIds(s => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} /></td>
                              <td className="px-2 py-1 font-mono">{d.doc_name}</td>
                              <td className="px-2 py-1"><Badge className={cn("text-[10px] px-1.5 border", d.doc_type === "RO" ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-blue-100 text-blue-700 border-blue-300")}>{d.doc_type}</Badge></td>
                              <td className="px-2 py-1">{d.store_name}</td>
                              <td className="px-2 py-1 text-right">{d.item_count.toLocaleString()}</td>
                              <td className="px-2 py-1 text-muted-foreground">{new Date(d.created_at).toLocaleString()}</td>
                              <td className="px-2 py-1 flex gap-1 justify-end">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => openResultDoc(d)} disabled={viewLoading}>Open</Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => deleteResultDoc(d.id, d.doc_name)}><Trash2 className="w-3 h-3" /></Button>
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              // Detail view
              <>
                <div className="border-b px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
                  <Button size="sm" variant="ghost" onClick={() => { setViewItems(null); setViewTitle(""); setViewDocType(null); }}><ChevronLeft className="w-4 h-4 mr-1" />กลับ</Button>
                  <div className="text-sm font-semibold truncate max-w-xs">{viewTitle}</div>
                  {viewDocType && viewDocType !== "MIXED" && <Badge className={cn("text-[10px] px-1.5 border", viewDocType === "RO" ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-blue-100 text-blue-700 border-blue-300")}>{viewDocType}</Badge>}
                  <span className="text-xs text-muted-foreground">{viewItems.length.toLocaleString()} แถว</span>
                  <div className="ml-auto flex gap-1.5 flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportExcelItems(viewItems, "Result")}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Excel</Button>
                    {(viewDocType === "RO" || viewDocType === "MIXED") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" onClick={() => exportTemplateRO(viewItems)}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Template RO</Button>
                    )}
                    {(viewDocType === "PO" || viewDocType === "MIXED") && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={() => exportPODC(viewItems)}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />PO DC</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={() => exportPOD2S(viewItems)}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />PO D2S</Button>
                      </>
                    )}
                  </div>
                </div>
                {renderTable(viewItems, false)}
              </>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
