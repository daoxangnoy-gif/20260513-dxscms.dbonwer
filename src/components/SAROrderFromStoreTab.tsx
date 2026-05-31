import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileSpreadsheet, Upload, Download, Loader2, AlertCircle, ClipboardPaste } from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import { SARRow, computeRow } from "@/lib/sarCalc";

// --------------- Types ---------------
interface ImportRow { code: string; qty: number; }

interface SkipRow {
  barcode: string;
  product_name_la: string;
  qty: number;
  reason: string;
  store_name: string;
}

// subset of minmax_cal_documents row needed here
interface DocRowRaw {
  sku_code: string;
  store_name: string;
  type_store?: string;
  unit_pick?: number;
  unit_pick_edit?: number | null;
  avg_sale?: number;
  rank_sale?: string;
  rank_factor?: number;
  min_cal?: number;
  max_cal?: number;
  min_final?: number;
  max_final?: number;
}

interface ProcessedRow extends SARRow {
  qty_import: number;
  division_group: string;
}

// --------------- Column definitions ---------------
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
  { key: "suggest_order_edit", label: "Suggest Order Edit", w: 130, right: true },
  { key: "final_order_unit", label: "Final Order/Unit", w: 120, right: true },
  { key: "final_order_uom", label: "Final Order/UOM", w: 120, right: true },
  { key: "doh_min", label: "DOH MIN", w: 80, right: true },
  { key: "doh_max", label: "DOH MAX", w: 80, right: true },
  { key: "doh_stock", label: "DOH Stock", w: 80, right: true },
  { key: "doh_tobe", label: "DOH Tobe", w: 80, right: true },
];

const HIGHLIGHT_COLS = new Set(["sar_suggest1", "sar_suggest2", "tt_order", "final_order_unit", "final_order_uom", "qty_import"]);
const NUM_COLS = new Set(["unit_pick", "pack_qty", "box_qty", "cost", "price2km", "price_jm", "avg_sale", "rank_factor", "min_val", "max_val", "stock_dc", "stock_store", "sar_suggest1", "sar_suggest2", "on_order", "tt_order", "suggest_order_edit", "qty_import", "final_order_unit", "final_order_uom", "doh_min", "doh_max", "doh_stock", "doh_tobe"]);

// --------------- Helpers ---------------
async function queryInChunks<T>(
  tableName: string,
  field: string,
  values: string[],
  selectFields: string,
  extraFilters?: (q: any) => any,
): Promise<T[]> {
  if (!values.length) return [];
  const CHUNK = 200;
  const results: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    let q = (supabase.from(tableName as any) as any).select(selectFields).in(field, chunk);
    if (extraFilters) q = extraFilters(q);
    const { data } = await q;
    if (data) results.push(...(data as T[]));
  }
  return results;
}

function effFinalUnit(r: ProcessedRow, useQtyImport: boolean): number {
  if (useQtyImport) {
    const up = Math.max(r.unit_pick, 1);
    return Math.ceil(r.qty_import / up) * up;
  }
  return r.final_order_unit;
}

function fmtNum(v: any): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v !== "number") return String(v);
  if (v === 0) return "-";
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// --------------- Component ---------------
export default function SAROrderFromStoreTab() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"idle" | "done">("idle");
  const [processing, setProcessing] = useState(false);

  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [storePopupOpen, setStorePopupOpen] = useState(false);
  const [stores, setStores] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [storeTypeMap, setStoreTypeMap] = useState<Record<string, string>>({});

  const [skipRows, setSkipRows] = useState<SkipRow[]>([]);
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>([]);
  const [currentStore, setCurrentStore] = useState("");

  const [subTab, setSubTab] = useState<"ro" | "po">("ro");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [useQtyImport, setUseQtyImport] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // ----------- Download Template -----------
  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "Barcode/SKUCode": "8857123456789", "Qty": 5 },
      { "Barcode/SKUCode": "8857987654321", "Qty": 10 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "OFS_Import_Template.xlsx");
  };

  // ----------- Helper: load stores & open store popup -----------
  const openStorePopup = async (imported: ImportRow[]) => {
    setImportRows(imported);
    const { data: storeData } = await supabase
      .from("store_type" as any)
      .select("store_name, type_store")
      .order("store_name");
    const names = [...new Set((storeData || []).map((r: any) => r.store_name).filter(Boolean) as string[])];
    const typeMap: Record<string, string> = {};
    for (const r of (storeData || []) as any[]) {
      if (r.store_name) typeMap[r.store_name] = r.type_store || "";
    }
    setStoreTypeMap(typeMap);
    setStores(names);
    setSelectedStore(names[0] ?? "");
    setStorePopupOpen(true);
    toast({ title: `Import ${imported.length} รายการ`, description: "เลือก Store เพื่อดำเนินการต่อ" });
  };

  // ----------- Paste Import -----------
  const handlePasteImport = async () => {
    const lines = pasteText.trim().split(/\r?\n/).filter(l => l.trim());
    const imported: ImportRow[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const code = parts[0].trim();
      const qty = Number(parts[1]);
      if (!code || !Number.isFinite(qty) || qty <= 0) continue;
      imported.push({ code, qty });
    }
    if (!imported.length) {
      toast({ title: "ไม่พบข้อมูลที่ valid", description: "รูปแบบ: barcode qty (คั่นด้วย space, 1 บรรทัดต่อรายการ)", variant: "destructive" });
      return;
    }
    setPasteOpen(false);
    setPasteText("");
    await openStorePopup(imported);
  };

  // ----------- File Import -----------
  const handleFile = async (file: File) => {
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rawRows.length < 2) { toast({ title: "ไฟล์ว่างเปล่า", variant: "destructive" }); return; }

      const headers = (rawRows[0] as string[]).map(h => String(h ?? "").toLowerCase().trim());
      const codeIdx = headers.findIndex(h => h.includes("barcode") || h.includes("sku") || h.includes("code"));
      const qtyIdx = headers.findIndex(h => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));

      if (codeIdx < 0 || qtyIdx < 0) {
        toast({ title: "ไม่พบคอลัมน์ barcode/skucode และ qty", variant: "destructive" });
        return;
      }

      const imported: ImportRow[] = rawRows.slice(1)
        .map(r => ({ code: String(r[codeIdx] ?? "").trim(), qty: Number(r[qtyIdx]) || 0 }))
        .filter(r => r.code && r.qty > 0);

      if (!imported.length) { toast({ title: "ไม่พบข้อมูลที่ valid", variant: "destructive" }); return; }
      await openStorePopup(imported);
    } catch (e: any) {
      toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // ----------- Process -----------
  const processData = async () => {
    if (!selectedStore) { toast({ title: "กรุณาเลือก Store", variant: "destructive" }); return; }
    setProcessing(true);
    try {
      const codes = importRows.map(r => r.code);
      const dmSelect = "sku_code,main_barcode,product_name_la,product_name_en,unit_of_measure,buying_status,item_type,product_owner,division_group,division,department,sub_department,standard_price,list_price,jmart_price";

      // 1) Query data_master
      const [dmByBarcode, dmBySku] = await Promise.all([
        queryInChunks<any>("data_master", "main_barcode", codes, dmSelect, q => q.eq("packing_size_qty", 1)),
        queryInChunks<any>("data_master", "sku_code", codes, dmSelect, q => q.eq("packing_size_qty", 1)),
      ]);

      const dmMap: Record<string, any> = {};
      dmByBarcode.forEach((r: any) => { if (r.main_barcode) dmMap[r.main_barcode] = r; });
      dmBySku.forEach((r: any) => { if (r.sku_code && !dmMap[r.sku_code]) dmMap[r.sku_code] = r; });

      // Detect sku_code duplicates
      const skuToImportCodes: Record<string, string[]> = {};
      importRows.forEach(r => {
        const sku = dmMap[r.code]?.sku_code;
        if (sku) (skuToImportCodes[sku] ??= []).push(r.code);
      });
      const dupSkuSet = new Set(
        Object.entries(skuToImportCodes).filter(([, arr]) => arr.length > 1).map(([sku]) => sku),
      );

      // 2) Range store check
      const allSkus = [...new Set(Object.values(dmMap).map((r: any) => r.sku_code).filter(Boolean) as string[])];
      const rsRows = await queryInChunks<any>(
        "range_store", "sku_code", allSkus, "sku_code",
        q => q.eq("apply_yn", "Y").eq("store_name", selectedStore),
      );
      const rangeSkuSet = new Set(rsRows.map((r: any) => r.sku_code));

      // 3) Apply skip conditions
      const skips: SkipRow[] = [];
      const validItems: { code: string; qty: number; dm: any }[] = [];

      for (const r of importRows) {
        const dm = dmMap[r.code];
        const pnLa = dm?.product_name_la ?? "";

        if (!dm) {
          skips.push({ barcode: r.code, product_name_la: "", qty: r.qty, reason: "ไม่พบในข้อมูล Data master", store_name: selectedStore });
          continue;
        }
        const bs = (dm.buying_status ?? "").trim();
        if (bs === "Inactive" || bs === "Discontinue") {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Buying Status: ${bs}`, store_name: selectedStore });
          continue;
        }
        if ((dm.item_type ?? "").trim() === "Non basic") {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: "Item type: Non basic", store_name: selectedStore });
          continue;
        }
        // ✅ แก้ไข: skip เมื่อ product_owner ไม่ใช่ Lanexang green property (NOT LIKE)
        if (!(dm.product_owner ?? "").toLowerCase().includes("lanexang green property")) {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `Product owner ไม่ใช่ Lanexang green property (${dm.product_owner || "-"})`, store_name: selectedStore });
          continue;
        }
        if (!rangeSkuSet.has(dm.sku_code)) {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `ไม่อยู่ใน Range store (${selectedStore})`, store_name: selectedStore });
          continue;
        }
        if (dupSkuSet.has(dm.sku_code)) {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: `SKU ซ้ำ (${dm.sku_code})`, store_name: selectedStore });
          continue;
        }
        validItems.push({ code: r.code, qty: r.qty, dm });
      }

      if (!validItems.length) {
        setSkipRows(skips);
        setProcessedRows([]);
        setCurrentStore(selectedStore);
        setSelectedIds(new Set());
        setSubTab("ro");
        setStep("done");
        setStorePopupOpen(false);
        toast({ title: "ไม่มีรายการที่ผ่าน", description: `Skip ทั้งหมด ${skips.length} รายการ` });
        return;
      }

      const validSkus = validItems.map(r => r.dm.sku_code).filter(Boolean) as string[];

      // 4) Load minmax_cal_documents → min, max, avg, rank, unit_pick
      const { data: mmDoc } = await supabase
        .from("minmax_cal_documents")
        .select("data")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();

      const mmRows = ((mmDoc?.data || []) as unknown as DocRowRaw[]);
      const validSkuSet = new Set(validSkus);
      const mmMap = new Map<string, DocRowRaw>();
      for (const r of mmRows) {
        if (validSkuSet.has(r.sku_code) && r.store_name === selectedStore) {
          mmMap.set(r.sku_code, r);
        }
      }

      // 5) Fetch stock DC + store stock
      const stockDCMap = new Map<string, number>();
      const stockStoreMap = new Map<string, number>();
      const PAGE = 1000;
      for (let i = 0; i < validSkus.length; i += 500) {
        const slice = validSkus.slice(i, i + 500);
        let off = 0;
        while (true) {
          const { data, error } = await supabase
            .from("stock")
            .select("item_id, type_store, company, quantity")
            .in("item_id", slice)
            .range(off, off + PAGE - 1);
          if (error) break;
          const batch = (data || []) as any[];
          for (const s of batch) {
            const qty = Number(s.quantity) || 0;
            if (s.type_store === "DC") stockDCMap.set(s.item_id, (stockDCMap.get(s.item_id) || 0) + qty);
            if (String(s.company || "").trim() === selectedStore) stockStoreMap.set(s.item_id, (stockStoreMap.get(s.item_id) || 0) + qty);
          }
          if (batch.length < PAGE) break;
          off += PAGE;
        }
      }

      // 6) Fetch on_order_dc
      const onOrderMap = new Map<string, number>();
      for (let i = 0; i < validSkus.length; i += 500) {
        const slice = validSkus.slice(i, i + 500);
        let off = 0;
        while (true) {
          const { data, error } = await supabase
            .from("on_order_dc")
            .select("sku_code, qty")
            .in("sku_code", slice)
            .eq("store_name", selectedStore)
            .range(off, off + PAGE - 1);
          if (error) break;
          const batch = (data || []) as any[];
          for (const o of batch) onOrderMap.set(o.sku_code, (onOrderMap.get(o.sku_code) || 0) + (Number(o.qty) || 0));
          if (batch.length < PAGE) break;
          off += PAGE;
        }
      }

      // 7) Fetch pack/box from range_store_view
      const rsvMap = new Map<string, { pack_qty: number | null; box_qty: number | null }>();
      const rsvRows = await queryInChunks<any>("range_store_view", "sku_code", validSkus, "sku_code, pack_qty, box_qty");
      for (const r of rsvRows) {
        if (r.sku_code) rsvMap.set(r.sku_code, { pack_qty: r.pack_qty ?? null, box_qty: r.box_qty ?? null });
      }

      // 8) Build full SARRow + computeRow
      const typeStore = storeTypeMap[selectedStore] || "";
      const processed: ProcessedRow[] = validItems.map(r => {
        const dm = r.dm;
        const sku = dm.sku_code as string;
        const mm = mmMap.get(sku);
        const rsv = rsvMap.get(sku);
        const up = Number(mm?.unit_pick_edit ?? mm?.unit_pick ?? 1) || 1;

        const sarRow: SARRow = {
          sku_code: sku,
          main_barcode: dm.main_barcode ?? null,
          product_name_la: dm.product_name_la ?? null,
          product_name_en: dm.product_name_en ?? null,
          unit_of_measure: dm.unit_of_measure ?? null,
          store_name: selectedStore,
          type_store: mm?.type_store || typeStore,
          division: dm.division ?? "",
          department: dm.department ?? "",
          sub_department: dm.sub_department ?? "",
          item_type: dm.item_type ?? "",
          buying_status: dm.buying_status ?? "",
          unit_pick: up,
          pack_qty: rsv?.pack_qty ?? null,
          box_qty: rsv?.box_qty ?? null,
          cost: dm.standard_price != null ? Number(dm.standard_price) : null,
          price2km: dm.list_price != null ? Number(dm.list_price) : null,
          price_jm: dm.jmart_price != null ? Number(dm.jmart_price) : null,
          pack_size: up === 1 ? "Unit" : `1x${up}`,
          avg_sale: Number(mm?.avg_sale) || 0,
          rank_sale: mm?.rank_sale || "D",
          rank_factor: Number(mm?.rank_factor) || 7,
          min_val: Number(mm?.min_final ?? mm?.min_cal ?? 0) || 0,
          max_val: Number(mm?.max_final ?? mm?.max_cal ?? 0) || 0,
          stock_dc: stockDCMap.get(sku) || 0,
          stock_store: stockStoreMap.get(sku) || 0,
          on_order: onOrderMap.get(sku) || 0,
          sar_suggest1: 0, sar_suggest2: 0, tt_order: 0,
          suggest_order_edit: null,
          final_order_unit: 0, final_order_uom: 0,
          doh_min: 0, doh_max: 0, doh_stock: 0, doh_tobe: 0,
          calculated: false,
        };
        const computed = computeRow(sarRow);
        return {
          ...computed,
          qty_import: r.qty,
          division_group: dm.division_group ?? "",
        };
      });

      setSkipRows(skips);
      setProcessedRows(processed);
      setCurrentStore(selectedStore);
      setSelectedIds(new Set());
      setSubTab("ro");
      setStep("done");
      setStorePopupOpen(false);
      setUseQtyImport(false);
      toast({ title: "สำเร็จ", description: `ผ่าน ${processed.length} รายการ / Skip ${skips.length} รายการ` });
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  // ----------- Derived: RO / PO split (based on toggle) -----------
  const roRows = processedRows.filter(r => r.stock_dc >= effFinalUnit(r, useQtyImport));
  const poRows = processedRows.filter(r => r.stock_dc < effFinalUnit(r, useQtyImport));

  // ----------- Selection -----------
  const toggleRow = (sku: string) => setSelectedIds(prev => {
    const n = new Set(prev);
    n.has(sku) ? n.delete(sku) : n.add(sku);
    return n;
  });

  const toggleAll = (rows: ProcessedRow[], checked: boolean) => {
    if (checked) setSelectedIds(new Set(rows.map(r => r.sku_code)));
    else setSelectedIds(new Set());
  };

  const getExportTarget = (rows: ProcessedRow[]) =>
    selectedIds.size > 0 ? rows.filter(r => selectedIds.has(r.sku_code)) : rows;

  // ----------- Export -----------
  const toExportObj = (r: ProcessedRow) => {
    const effUnit = effFinalUnit(r, useQtyImport);
    const effUom = effUnit / Math.max(r.unit_pick, 1);
    const obj: Record<string, any> = {};
    for (const col of COLS) {
      if (col.key === "final_order_unit") obj[col.label] = effUnit;
      else if (col.key === "final_order_uom") obj[col.label] = effUom;
      else obj[col.label] = (r as any)[col.key];
    }
    return obj;
  };

  const exportExcel = (rows: ProcessedRow[], label: string) => {
    const target = getExportTarget(rows);
    if (!target.length) { toast({ title: "ไม่มีรายการ", variant: "destructive" }); return; }
    const ws = XLSX.utils.json_to_sheet(target.map(toExportObj));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, label);
    XLSX.writeFile(wb, `ofs_${label}_${Date.now()}.xlsx`);
  };

  const exportTpl = async (rows: ProcessedRow[], menu: "srr_special_po" | "srr_special_ro", label: string) => {
    const target = getExportTarget(rows);
    if (!target.length) { toast({ title: "ไม่มีรายการ", variant: "destructive" }); return; }
    const raw = target.map(r => ({
      division_group: r.division_group, division: r.division, department: r.department,
      sku_code: r.sku_code, main_barcode: r.main_barcode,
      product_name_la: r.product_name_la, product_name_en: r.product_name_en,
      qty: effFinalUnit(r, useQtyImport),
      stock_dc: r.stock_dc,
    }));
    try {
      const mapped = await remapRowsByTemplate(menu, raw);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, label);
      XLSX.writeFile(wb, `ofs_${label}_${Date.now()}.xlsx`);
      toast({ title: "Export Template สำเร็จ" });
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const downloadSkipList = () => {
    if (!skipRows.length) return;
    const ws = XLSX.utils.json_to_sheet(skipRows.map(r => ({
      "Barcode Import": r.barcode,
      "Product Name LA": r.product_name_la,
      "Qty": r.qty,
      "Reason": r.reason,
      "Store Name": r.store_name,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skip List");
    XLSX.writeFile(wb, `ofs_skip_${currentStore}_${Date.now()}.xlsx`);
  };

  const resetImport = () => {
    setStep("idle");
    setImportRows([]);
    setSkipRows([]);
    setProcessedRows([]);
    setSelectedIds(new Set());
    setUseQtyImport(false);
  };

  // ----------- Table Renderer -----------
  const renderTable = (rows: ProcessedRow[]) => {
    const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.sku_code));
    return (
      <div className="flex-1 overflow-auto">
        <table className="text-xs border-collapse w-max">
          <thead className="sticky top-0 z-10 bg-muted shadow-sm">
            <tr>
              <th className="px-2 py-1.5 w-8 text-center border-b">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={c => toggleAll(rows, c === true)}
                />
              </th>
              {COLS.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    "px-2 py-1.5 font-semibold border-b whitespace-nowrap",
                    col.right ? "text-right" : "text-left",
                    HIGHLIGHT_COLS.has(col.key) && "bg-amber-100",
                  )}
                  style={{ width: col.w, minWidth: col.w }}
                >
                  {col.key === "final_order_unit" ? (
                    <div className="flex items-center gap-1 justify-end">
                      <span>{col.label}</span>
                      <button
                        onClick={() => setUseQtyImport(v => !v)}
                        className={cn(
                          "text-[9px] px-1.5 py-0.5 rounded font-normal border transition-colors",
                          useQtyImport
                            ? "bg-amber-200 text-amber-800 border-amber-400"
                            : "bg-primary/10 text-primary border-primary/30"
                        )}
                        title="Toggle: ใช้ค่าที่คำนวณ หรือ Qty Import"
                      >
                        {useQtyImport ? "Qty Import" : "Calculated"}
                      </button>
                    </div>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 1} className="text-center p-6 text-muted-foreground">ไม่มีรายการ</td>
              </tr>
            ) : rows.map(r => {
              const effUnit = effFinalUnit(r, useQtyImport);
              const effUom = effUnit / Math.max(r.unit_pick, 1);
              return (
                <tr
                  key={r.sku_code}
                  className={cn(
                    "border-b hover:bg-emerald-100/70 cursor-pointer",
                    selectedIds.has(r.sku_code) && "bg-primary/5"
                  )}
                  onClick={() => toggleRow(r.sku_code)}
                >
                  <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(r.sku_code)} onCheckedChange={() => toggleRow(r.sku_code)} />
                  </td>
                  {COLS.map(col => {
                    let v: any = (r as any)[col.key];
                    if (col.key === "final_order_unit") v = effUnit;
                    else if (col.key === "final_order_uom") v = effUom;
                    const isNum = NUM_COLS.has(col.key);
                    const isHighlight = HIGHLIGHT_COLS.has(col.key);
                    const isQtyImportActive = col.key === "qty_import" && useQtyImport;
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-2 py-1 border-r border-r-border/40",
                          col.right && "text-right tabular-nums",
                          isHighlight && "bg-amber-50 font-semibold",
                          isQtyImportActive && "!bg-amber-200",
                          col.key === "final_order_unit" && useQtyImport && "!bg-amber-200 font-bold",
                        )}
                        style={{ width: col.w, minWidth: col.w, maxWidth: col.w }}
                        title={typeof v === "string" ? v : undefined}
                      >
                        <div className="truncate">
                          {isNum ? fmtNum(v) : (v ?? "")}
                        </div>
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
  };

  // ----------- Render -----------
  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Paste Dialog */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>วางข้อมูล</DialogTitle>
            <DialogDescription>
              วางข้อมูล 1 บรรทัดต่อรายการ รูปแบบ: <b>barcode qty</b> (คั่นด้วย space)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              placeholder={"8857123456789 5\n8857987654321 10\n..."}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              className="font-mono text-xs min-h-[200px]"
              autoFocus
            />
            <div className="text-[11px] text-muted-foreground">
              {pasteText.trim()
                ? (() => {
                    const n = pasteText.trim().split(/\r?\n/).filter(l => {
                      const p = l.trim().split(/\s+/);
                      return p.length >= 2 && Number(p[1]) > 0;
                    }).length;
                    return `${n} รายการที่ valid`;
                  })()
                : "ยังไม่มีข้อมูล"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasteOpen(false); setPasteText(""); }}>ยกเลิก</Button>
            <Button onClick={handlePasteImport} disabled={!pasteText.trim()}>
              <ClipboardPaste className="w-4 h-4 mr-1" />นำเข้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Store Select Popup */}
      <Dialog open={storePopupOpen} onOpenChange={setStorePopupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>เลือก Store Name</DialogTitle>
            <DialogDescription>Import {importRows.length} รายการ — เลือก Store ที่ต้องการสั่ง</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1">
            <Label className="text-xs">Store Name</Label>
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger>
                <SelectValue placeholder="เลือก Store..." />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStorePopupOpen(false)} disabled={processing}>ยกเลิก</Button>
            <Button onClick={processData} disabled={processing || !selectedStore}>
              {processing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IDLE */}
      {step === "idle" && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-xs">
            <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <div>
              <div className="font-semibold text-sm">Order From Store</div>
              <div className="text-xs text-muted-foreground mt-1">
                Import 2 คอลัมน์: <b>barcode</b> (หรือ skucode) + <b>qty</b>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => fileRef.current?.click()} className="w-full">
                <Upload className="w-4 h-4 mr-2" />เลือกไฟล์ Excel
              </Button>
              <Button variant="outline" onClick={() => setPasteOpen(true)} className="w-full">
                <ClipboardPaste className="w-4 h-4 mr-2" />วางข้อมูล
              </Button>
              <Button variant="ghost" onClick={downloadTemplate} className="w-full text-muted-foreground">
                <Download className="w-4 h-4 mr-2" />Download Template
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <>
          {/* Toolbar */}
          <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/20 flex-wrap shrink-0">
            <div className="text-sm font-semibold">Order From Store</div>
            <Badge variant="outline" className="text-xs">{currentStore}</Badge>
            {/* ✅ แสดงสถานะ 3 ตัวเลขชัดเจน */}
            <div className="flex items-center gap-1 text-xs">
              <Badge variant="secondary">Import {importRows.length} รายการ</Badge>
              <span className="text-muted-foreground">/</span>
              <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-100">
                ผ่าน {processedRows.length} รายการ
              </Badge>
              <span className="text-muted-foreground">/</span>
              <Badge className={cn(
                "border hover:bg-current",
                skipRows.length > 0
                  ? "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                Skip {skipRows.length} รายการ
              </Badge>
              {skipRows.length > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={downloadSkipList} title="Download Skip List">
                  <AlertCircle className="w-3 h-3 text-amber-500 mr-0.5" />
                  <Download className="w-3 h-3" />
                </Button>
              )}
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={resetImport}>
              <Upload className="w-3.5 h-3.5 mr-1" />Import ใหม่
            </Button>
          </div>

          {/* Sub-tabs */}
          <Tabs
            value={subTab}
            onValueChange={v => { setSubTab(v as "ro" | "po"); setSelectedIds(new Set()); }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="border-b px-4 pt-2 bg-background shrink-0">
              <TabsList>
                <TabsTrigger value="ro">
                  Doc RO
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{roRows.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="po">
                  Doc PO
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{poRows.length}</Badge>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Doc RO */}
            <TabsContent value="ro" className="flex-1 overflow-hidden flex flex-col mt-0">
              <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap shrink-0 bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size > 0 ? `เลือก ${selectedIds.size} / ${roRows.length} รายการ` : `${roRows.length} รายการ`}
                  {" "}— Stock DC ≥ {useQtyImport ? "Qty Import" : "Final Order/Unit"}
                </span>
                <div className="ml-auto flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportExcel(roRows, "Doc_RO")}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Excel
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportTpl(roRows, "srr_special_ro", "Doc_RO_Template")}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Template RO
                  </Button>
                </div>
              </div>
              {renderTable(roRows)}
            </TabsContent>

            {/* Doc PO */}
            <TabsContent value="po" className="flex-1 overflow-hidden flex flex-col mt-0">
              <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap shrink-0 bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size > 0 ? `เลือก ${selectedIds.size} / ${poRows.length} รายการ` : `${poRows.length} รายการ`}
                  {" "}— Stock DC &lt; {useQtyImport ? "Qty Import" : "Final Order/Unit"}
                </span>
                <div className="ml-auto flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportExcel(poRows, "Doc_PO")}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Excel
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportTpl(poRows, "srr_special_po", "Doc_PO_Template")}>
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Export Template PO
                  </Button>
                </div>
              </div>
              {renderTable(poRows)}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
