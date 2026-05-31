import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileSpreadsheet, Upload, Download, Loader2, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { remapRowsByTemplate } from "@/lib/exportTemplate";

// --------------- Types ---------------
interface ImportRow { code: string; qty: number; }

interface SkipRow {
  barcode: string;
  product_name_la: string;
  qty: number;
  reason: string;
  store_name: string;
}

interface ProcessedRow {
  id: string;
  sku_code: string;
  main_barcode: string;
  product_name_la: string;
  product_name_en: string;
  division_group: string;
  division: string;
  department: string;
  qty: number;
  stock_dc: number;
}

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

  const [skipRows, setSkipRows] = useState<SkipRow[]>([]);
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>([]);
  const [currentStore, setCurrentStore] = useState("");

  const [subTab, setSubTab] = useState<"ro" | "po">("ro");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

      setImportRows(imported);

      const { data: storeData } = await supabase
        .from("store_type" as any)
        .select("store_name")
        .order("store_name");
      const names = [...new Set((storeData || []).map((r: any) => r.store_name).filter(Boolean) as string[])];
      setStores(names);
      setSelectedStore(names[0] ?? "");
      setStorePopupOpen(true);
      toast({ title: `Import ${imported.length} รายการ`, description: "เลือก Store เพื่อดำเนินการต่อ" });
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
      const dmSelect = "sku_code,main_barcode,product_name_la,product_name_en,buying_status,item_type,product_owner,division_group,division,department";

      // Query data_master by main_barcode and sku_code (packing_size_qty = 1)
      const [dmByBarcode, dmBySku] = await Promise.all([
        queryInChunks<any>("data_master", "main_barcode", codes, dmSelect, q => q.eq("packing_size_qty", 1)),
        queryInChunks<any>("data_master", "sku_code", codes, dmSelect, q => q.eq("packing_size_qty", 1)),
      ]);

      // Build map: import code → data_master row
      const dmMap: Record<string, any> = {};
      dmByBarcode.forEach((r: any) => { if (r.main_barcode) dmMap[r.main_barcode] = r; });
      dmBySku.forEach((r: any) => { if (r.sku_code && !dmMap[r.sku_code]) dmMap[r.sku_code] = r; });

      // Detect sku_code duplicates after data_master join
      const skuToImportCodes: Record<string, string[]> = {};
      importRows.forEach(r => {
        const sku = dmMap[r.code]?.sku_code;
        if (sku) (skuToImportCodes[sku] ??= []).push(r.code);
      });
      const dupSkuSet = new Set(
        Object.entries(skuToImportCodes)
          .filter(([, arr]) => arr.length > 1)
          .map(([sku]) => sku),
      );

      // Range store — valid sku_codes for selected store with apply_yn = Y
      const allSkus = [...new Set(Object.values(dmMap).map((r: any) => r.sku_code).filter(Boolean) as string[])];
      const rsRows = await queryInChunks<any>(
        "range_store", "sku_code", allSkus, "sku_code",
        q => q.eq("apply_yn", "Y").eq("store_name", selectedStore),
      );
      const rangeSkuSet = new Set(rsRows.map((r: any) => r.sku_code));

      // Apply skip conditions
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
        if ((dm.product_owner ?? "").toLowerCase().includes("lanexang green property")) {
          skips.push({ barcode: r.code, product_name_la: pnLa, qty: r.qty, reason: "Product owner: Lanexang green property", store_name: selectedStore });
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

      // Stock DC
      const validBarcodes = validItems.map(r => r.dm.main_barcode).filter(Boolean) as string[];
      const stockRows = validBarcodes.length
        ? await queryInChunks<any>("stock", "barcode", validBarcodes, "barcode,on_hand", q => q.eq("type_store", "DC"))
        : [];
      const stockMap: Record<string, number> = {};
      stockRows.forEach((s: any) => { stockMap[s.barcode] = (stockMap[s.barcode] ?? 0) + (Number(s.on_hand) || 0); });

      // Build processed rows
      const processed: ProcessedRow[] = validItems.map(r => ({
        id: r.dm.sku_code,
        sku_code: r.dm.sku_code ?? "",
        main_barcode: r.dm.main_barcode ?? "",
        product_name_la: r.dm.product_name_la ?? "",
        product_name_en: r.dm.product_name_en ?? "",
        division_group: r.dm.division_group ?? "",
        division: r.dm.division ?? "",
        department: r.dm.department ?? "",
        qty: r.qty,
        stock_dc: stockMap[r.dm.main_barcode] ?? 0,
      }));

      setSkipRows(skips);
      setProcessedRows(processed);
      setCurrentStore(selectedStore);
      setSelectedIds(new Set());
      setSubTab("ro");
      setStep("done");
      setStorePopupOpen(false);
      toast({ title: "สำเร็จ", description: `ผ่าน ${processed.length} รายการ / Skip ${skips.length} รายการ` });
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  // ----------- Derived -----------
  const roRows = processedRows.filter(r => r.stock_dc >= r.qty);
  const poRows = processedRows.filter(r => r.stock_dc < r.qty);

  // ----------- Selection -----------
  const toggleRow = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const toggleAll = (rows: ProcessedRow[], checked: boolean) => {
    if (checked) setSelectedIds(new Set(rows.map(r => r.id)));
    else setSelectedIds(new Set());
  };

  const getExportTarget = (rows: ProcessedRow[]) =>
    selectedIds.size > 0 ? rows.filter(r => selectedIds.has(r.id)) : rows;

  // ----------- Export -----------
  const toExportObj = (r: ProcessedRow) => ({
    "Division Group": r.division_group,
    "Division": r.division,
    "Department": r.department,
    "SKU Code": r.sku_code,
    "Main Barcode": r.main_barcode,
    "Product Name LA": r.product_name_la,
    "Product Name EN": r.product_name_en,
    "Qty": r.qty,
    "Stock DC": r.stock_dc,
  });

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
      qty: r.qty, stock_dc: r.stock_dc,
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
  };

  // ----------- Table Renderer -----------
  const renderTable = (rows: ProcessedRow[], isPO: boolean) => {
    const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));
    return (
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="p-2 w-8 text-center">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={c => toggleAll(rows, c === true)}
                />
              </th>
              <th className="p-2 text-left whitespace-nowrap">Division Group</th>
              <th className="p-2 text-left whitespace-nowrap">Division</th>
              <th className="p-2 text-left whitespace-nowrap">Department</th>
              <th className="p-2 text-left whitespace-nowrap">SKU Code</th>
              <th className="p-2 text-left whitespace-nowrap">Main Barcode</th>
              <th className="p-2 text-left whitespace-nowrap">Product Name LA</th>
              <th className="p-2 text-left whitespace-nowrap">Product Name EN</th>
              <th className="p-2 text-right whitespace-nowrap">Qty</th>
              <th className="p-2 text-right whitespace-nowrap">Stock DC</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center p-6 text-muted-foreground">ไม่มีรายการ</td>
              </tr>
            ) : rows.map(r => (
              <tr
                key={r.id}
                className={`border-t hover:bg-muted/40 cursor-pointer ${selectedIds.has(r.id) ? "bg-primary/5" : ""}`}
                onClick={() => toggleRow(r.id)}
              >
                <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleRow(r.id)} />
                </td>
                <td className="p-2">{r.division_group}</td>
                <td className="p-2">{r.division}</td>
                <td className="p-2">{r.department}</td>
                <td className="p-2 font-mono">{r.sku_code}</td>
                <td className="p-2 font-mono">{r.main_barcode}</td>
                <td className="p-2">{r.product_name_la}</td>
                <td className="p-2">{r.product_name_en}</td>
                <td className="p-2 text-right font-medium">{r.qty.toLocaleString()}</td>
                <td className={`p-2 text-right font-medium ${isPO ? "text-red-600" : "text-emerald-600"}`}>
                  {r.stock_dc.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ----------- Render -----------
  return (
    <div className="flex-1 flex flex-col overflow-hidden">

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
                Import Excel 2 คอลัมน์: <b>barcode</b> (หรือ skucode) + <b>qty</b>
              </div>
            </div>
            <Button onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />Import Excel
            </Button>
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
            <Badge variant="secondary" className="text-xs">Import {importRows.length}</Badge>
            <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-400">ผ่าน {processedRows.length}</Badge>
            {skipRows.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={downloadSkipList}>
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                Skip {skipRows.length}
                <Download className="w-3 h-3 ml-0.5" />
              </Button>
            )}
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
                  {" "}— Stock DC ≥ Qty
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
              {renderTable(roRows, false)}
            </TabsContent>

            {/* Doc PO */}
            <TabsContent value="po" className="flex-1 overflow-hidden flex flex-col mt-0">
              <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap shrink-0 bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size > 0 ? `เลือก ${selectedIds.size} / ${poRows.length} รายการ` : `${poRows.length} รายการ`}
                  {" "}— Stock DC &lt; Qty
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
              {renderTable(poRows, true)}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
