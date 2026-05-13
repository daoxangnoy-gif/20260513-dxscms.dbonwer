import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Download, FileSpreadsheet, AlertTriangle, X, Filter, FileInput, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";

export type SrrImportMode = "filter" | "import" | "vendor";

export interface ImportedItem {
  /** key as typed in the file (barcode or sku) */
  key: string;
  /** Qty Uom — quantity in UOM (Order UOM EDIT). 0 if not provided. */
  qty: number;
  /** Qty Unit — quantity in Unit/pcs. Overrides Final Suggest/Final Order Qty (roundup to MOQ). */
  qtyUnit?: number;
  /** Optional PO cost override (per unit) */
  poCost?: number;
  /** Optional store name (Direct only) */
  storeName?: string;
}

export interface ImportedVendor {
  vendor_code: string;
}

interface Props {
  mode: SrrImportMode;
  onModeChange: (m: SrrImportMode) => void;
  importedItems: ImportedItem[];
  onImportedChange: (items: ImportedItem[]) => void;
  /** items resolved/skipped after Prepare — to show small status */
  matchedCount?: number;
  skippedCount?: number;
  disabled?: boolean;
  /** Set true to show Vendor Code import option (SRR Direct only) */
  enableVendorMode?: boolean;
  importedVendors?: ImportedVendor[];
  onImportedVendorsChange?: (v: ImportedVendor[]) => void;
  /** Set true to show storeName column in template (SRR Direct only) */
  showStoreNameInTemplate?: boolean;
  /** Compact size (h-7) for tight toolbars */
  compact?: boolean;
}

/**
 * Toggle Filter Mode / Import Mode + import excel handler.
 * File format: 1 column "Barcode&SkuCode" (required) + optional "Qty", "Po cost", "Store name" columns.
 * Header is flexible (case-insensitive).
 */
export function SrrImportFilter({
  mode, onModeChange, importedItems, onImportedChange,
  matchedCount, skippedCount, disabled,
  enableVendorMode, importedVendors, onImportedVendorsChange,
  showStoreNameInTemplate, compact,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const vendorFileRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [vendorPreviewOpen, setVendorPreviewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [vendorImportOpen, setVendorImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("upload");
  const [vendorImportTab, setVendorImportTab] = useState("upload");
  const [pasteText, setPasteText] = useState("");
  const [vendorPasteText, setVendorPasteText] = useState("");
  const { toast } = useToast();

  const handlePasteImport = () => {
    const lines = pasteText.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast({ title: "กรุณากรอก barcode/SKU", variant: "destructive" });
      return;
    }
    // Paste columns order: key, qtyUom, qtyUnit, po_cost[, store]
    const items: ImportedItem[] = [];
    const seen = new Set<string>();
    let conflictCount = 0;
    for (const line of lines) {
      const parts = line.split(/[\t,\s]+/).map(p => p.trim()).filter(Boolean);
      const key = parts[0];
      if (!key) continue;
      const store = parts[4] || "";
      const dedupKey = `${key}|${store}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const qtyUomNum = parts[1] ? Number(parts[1]) : 0;
      const qtyUnitNum = parts[2] ? Number(parts[2]) : 0;
      const poCostNum = parts[3] ? Number(parts[3]) : undefined;
      if (qtyUomNum > 0 && qtyUnitNum > 0) conflictCount++;
      items.push({
        key,
        qty: isNaN(qtyUomNum) ? 0 : qtyUomNum,
        qtyUnit: !isNaN(qtyUnitNum) && qtyUnitNum > 0 ? qtyUnitNum : undefined,
        poCost: poCostNum != null && !isNaN(poCostNum) && poCostNum > 0 ? poCostNum : undefined,
        storeName: store || undefined,
      });
    }
    if (conflictCount > 0) {
      toast({
        title: "พบข้อมูลขัดแย้ง",
        description: `${conflictCount} แถว กรอกทั้ง Qty Uom และ Qty Unit — กรุณากรอกแค่ช่องเดียว`,
        variant: "destructive",
      });
      return;
    }
    if (items.length === 0) {
      toast({ title: "ไม่พบรายการที่อ่านได้", variant: "destructive" });
      return;
    }
    onImportedChange(items);
    toast({ title: "Import สำเร็จ", description: `${items.length} รายการ พร้อม Prepare` });
    setImportOpen(false);
    setPasteText("");
  };

  const downloadTemplate = () => {
    const headers = ["Barcode&SkuCode", "Qty Uom", "Qty Unit", "Po cost"];
    const sample: any[][] = [headers, ["8851234567890", 5, "", 12.50], ["SKU-00123", "", 25, ""], ["8851111122223", 12, "", 8.75]];
    if (showStoreNameInTemplate) {
      headers.push("Store name");
      sample[0] = headers;
      sample[1].push("Jmart-001");
      sample[2].push("");
      sample[3].push("Kokkok-002");
    }
    const ws = XLSX.utils.aoa_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "srr_import_template.xlsx");
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      if (rows.length === 0) {
        toast({ title: "ไฟล์ว่าง", variant: "destructive" });
        return;
      }
      const normalizeRow = (row: any) =>
        Object.fromEntries(
          Object.entries(row || {}).map(([k, v]) => [String(k).trim(), v]),
        );
      const toNumber = (value: any): number => {
        if (value === "" || value == null) return 0;
        if (typeof value === "number") return Number.isFinite(value) ? value : 0;
        const normalized = String(value)
          .replace(/,/g, "")
          .replace(/\u00A0/g, " ")
          .trim();
        if (!normalized) return 0;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const items: ImportedItem[] = [];
      const seen = new Set<string>();
      const lookupKey = (r: any, names: string[]): any => {
        for (const n of names) {
          if (r[n] !== undefined && r[n] !== "") return r[n];
          for (const k of Object.keys(r)) {
            if (k.trim().toLowerCase() === n.trim().toLowerCase() && r[k] !== undefined && r[k] !== "") return r[k];
          }
        }
        return undefined;
      };
      const conflictRows: { row: number; key: string }[] = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const r = normalizeRow(rows[idx]);
        const keyRaw = lookupKey(r, ["Barcode&SkuCode", "barcode&skucode", "Barcode", "SkuCode", "SKU", "sku"]) ?? Object.values(r)[0];
        const qtyUomRaw = lookupKey(r, ["Qty Uom", "Qty UOM", "qty uom", "QtyUom", "qty_uom", "Qty", "qty", "QTY", "Quantity"]) ?? "";
        const qtyUnitRaw = lookupKey(r, ["Qty Unit", "qty unit", "QtyUnit", "qty_unit", "Qty unit"]) ?? "";
        const poCostRaw = lookupKey(r, ["Po cost", "PO Cost", "po_cost", "PoCost", "Cost"]) ?? "";
        const storeRaw = lookupKey(r, ["Store name", "store_name", "Store Name", "StoreName"]) ?? "";
        const key = String(keyRaw ?? "").trim();
        if (!key) continue;
        const storeName = storeRaw ? String(storeRaw).trim() : "";
        const dedupKey = `${key}|${storeName}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const qtyUomNum = toNumber(qtyUomRaw);
        const qtyUnitNum = toNumber(qtyUnitRaw);
        const poCostNum = poCostRaw === "" || poCostRaw == null ? undefined : toNumber(poCostRaw);
        if (qtyUomNum > 0 && qtyUnitNum > 0) {
          conflictRows.push({ row: idx + 2, key }); // +2 = header row + 1-indexed
        }
        items.push({
          key,
          qty: qtyUomNum,
          qtyUnit: qtyUnitNum > 0 ? qtyUnitNum : undefined,
          poCost: poCostNum != null && poCostNum > 0 ? poCostNum : undefined,
          storeName: storeName || undefined,
        });
      }
      if (conflictRows.length > 0) {
        const sample = conflictRows.slice(0, 5).map((c) => `แถว ${c.row}: ${c.key}`).join(", ");
        toast({
          title: `พบ ${conflictRows.length} แถวกรอก Qty Uom และ Qty Unit พร้อมกัน`,
          description: `กรุณากรอกแค่ช่องเดียว — ${sample}${conflictRows.length > 5 ? "..." : ""}`,
          variant: "destructive",
        });
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      if (items.length === 0) {
        toast({ title: "ไม่พบรายการที่อ่านได้", variant: "destructive" });
        return;
      }
      onImportedChange(items);
      const withCost = items.filter(i => i.poCost && i.poCost > 0).length;
      const withStore = items.filter(i => i.storeName).length;
      const withUnit = items.filter(i => i.qtyUnit && i.qtyUnit > 0).length;
      toast({
        title: "Import สำเร็จ",
        description: `${items.length} รายการ${withUnit > 0 ? ` · ${withUnit} ใช้ Qty Unit` : ""}${withCost > 0 ? ` · ${withCost} มี Po cost` : ""}${withStore > 0 ? ` · ${withStore} ระบุ Store` : ""}`,
      });
      setImportOpen(false);
    } catch (e: any) {
      toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ===== Vendor Code Import =====
  const handleVendorPasteImport = () => {
    const lines = vendorPasteText.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast({ title: "กรุณากรอก vendor_code", variant: "destructive" });
      return;
    }
    const seen = new Set<string>();
    const vendors: ImportedVendor[] = [];
    for (const line of lines) {
      const v = line.split(/[\t,\s]+/)[0]?.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      vendors.push({ vendor_code: v });
    }
    if (vendors.length === 0) {
      toast({ title: "ไม่พบ vendor_code", variant: "destructive" });
      return;
    }
    onImportedVendorsChange?.(vendors);
    toast({ title: "Import Vendor สำเร็จ", description: `${vendors.length} vendor` });
    setVendorImportOpen(false);
    setVendorPasteText("");
  };

  const downloadVendorTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([["vendor_code"], ["V001"], ["V002"], ["V003"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendors");
    XLSX.writeFile(wb, "srr_vendor_import_template.xlsx");
  };

  const handleVendorFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      if (rows.length === 0) {
        toast({ title: "ไฟล์ว่าง", variant: "destructive" });
        return;
      }
      const seen = new Set<string>();
      const vendors: ImportedVendor[] = [];
      for (const r of rows) {
        const vRaw = r["vendor_code"] ?? r["Vendor Code"] ?? r["VendorCode"] ?? r["vendor"] ?? Object.values(r)[0];
        const v = String(vRaw ?? "").trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        vendors.push({ vendor_code: v });
      }
      if (vendors.length === 0) {
        toast({ title: "ไม่พบ vendor_code", variant: "destructive" });
        return;
      }
      onImportedVendorsChange?.(vendors);
      toast({ title: "Import Vendor สำเร็จ", description: `${vendors.length} vendor` });
      setVendorImportOpen(false);
    } catch (e: any) {
      toast({ title: "อ่านไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      if (vendorFileRef.current) vendorFileRef.current.value = "";
    }
  };

  const sz = compact ? "h-6" : "h-8";
  const px = compact ? "px-1.5 py-0.5" : "px-2.5 py-1.5";
  const ic = compact ? "w-3 h-3" : "w-3.5 h-3.5";
  const lbl = compact
    ? { filter: "Filter", import: "SKU", vendor: "Ven" }
    : { filter: "Filter", import: "Import SKU", vendor: "Import Vendor" };

  return (
    <>
      <div className="flex items-center gap-1 flex-nowrap">
        {/* Mode toggle — active mode highlighted strongly per color, inactive faded */}
        <div className={`flex items-center rounded-md border border-border overflow-hidden bg-card ${sz}`}>
          <button
            type="button"
            onClick={() => onModeChange("filter")}
            disabled={disabled}
            className={`flex items-center gap-1 ${px} text-xs font-medium transition-colors h-full ${
              mode === "filter"
                ? "bg-violet-600 text-white shadow-inner"
                : "bg-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted"
            }`}
          >
            <Filter className={ic} /> <span className={mode === "filter" ? "text-white font-bold" : "text-muted-foreground/60 font-bold"}>1.</span> {lbl.filter}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("import")}
            disabled={disabled}
            className={`flex items-center gap-1 ${px} text-xs font-medium border-l border-border transition-colors h-full ${
              mode === "import"
                ? "bg-sky-600 text-white shadow-inner"
                : "bg-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted"
            }`}
          >
            <FileInput className={ic} /> <span className={mode === "import" ? "text-white font-bold" : "text-muted-foreground/60 font-bold"}>2.</span> {lbl.import}
          </button>
          {enableVendorMode && (
            <button
              type="button"
              onClick={() => onModeChange("vendor")}
              disabled={disabled}
              className={`flex items-center gap-1 ${px} text-xs font-medium border-l border-border transition-colors h-full ${
                mode === "vendor"
                  ? "bg-orange-600 text-white shadow-inner"
                  : "bg-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted"
              }`}
            >
              <Users className={ic} /> <span className={mode === "vendor" ? "text-white font-bold" : "text-muted-foreground/60 font-bold"}>3.</span> {lbl.vendor}
            </button>
          )}
        </div>

        {mode === "import" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setImportOpen(true)} className={`gap-1 text-xs ${sz} ${compact ? "px-1.5" : "px-2"}`}>
              <Upload className={ic} /> {compact ? "Import" : "Import Barcode/SKU"}
            </Button>

            {importedItems.length > 0 && (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className={`flex items-center gap-1 ${px} rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 ${sz}`}
              >
                <FileSpreadsheet className={ic} />
                {importedItems.length} รายการ
                {typeof matchedCount === "number" && (
                  <span className="ml-1 opacity-80">(match {matchedCount}{typeof skippedCount === "number" && skippedCount > 0 ? ` · skip ${skippedCount}` : ""})</span>
                )}
              </button>
            )}

            {importedItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onImportedChange([])} className={`gap-1 text-xs text-destructive ${sz} ${compact ? "px-1.5" : "px-2"}`}>
                <X className={ic} /> Clear
              </Button>
            )}
          </>
        )}

        {mode === "vendor" && enableVendorMode && (
          <>
            <input
              ref={vendorFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && handleVendorFile(e.target.files[0])}
            />
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setVendorImportOpen(true)} className={`gap-1 text-xs ${sz} ${compact ? "px-1.5" : "px-2"}`}>
              <Upload className={ic} /> {compact ? "Import" : "Import Vendor Code"}
            </Button>

            {(importedVendors?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setVendorPreviewOpen(true)}
                className={`flex items-center gap-1 ${px} rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 ${sz}`}
              >
                <Users className={ic} />
                {importedVendors?.length} {compact ? "V" : "vendor"}
              </button>
            )}

            {(importedVendors?.length ?? 0) > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onImportedVendorsChange?.([])} className={`gap-1 text-xs text-destructive ${sz} ${compact ? "px-1.5" : "px-2"}`}>
                <X className={ic} /> Clear
              </Button>
            )}
          </>
        )}
      </div>

      {/* Import Upload/Paste dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Import Barcode / SKU
            </DialogTitle>
          </DialogHeader>
          <Tabs value={importTab} onValueChange={setImportTab}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="upload" className="text-xs">Upload File</TabsTrigger>
              <TabsTrigger value="paste" className="text-xs">Paste</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                ไฟล์ <code className="bg-muted px-1 rounded">.xlsx / .csv</code> — คอลัมน์ <code className="bg-muted px-1 rounded">Barcode&amp;SkuCode</code> (จำเป็น), <code className="bg-muted px-1 rounded">Qty Uom</code>, <code className="bg-muted px-1 rounded">Qty Unit</code>, <code className="bg-muted px-1 rounded">Po cost</code>{showStoreNameInTemplate && <>, <code className="bg-muted px-1 rounded">Store name</code></>} (optional)
                <br />
                <span className="text-amber-600 dark:text-amber-400">⚠ Qty Uom และ Qty Unit เลือกใส่แค่ช่องเดียวในแต่ละแถว</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
              <Button variant="ghost" size="sm" onClick={downloadTemplate} className="gap-1.5 text-xs">
                <Download className="w-3.5 h-3.5" /> ดาวน์โหลด Template
              </Button>
            </TabsContent>
            <TabsContent value="paste" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                วาง 1 บรรทัด/รายการ — คั่นด้วย Tab/comma:{" "}
                <code className="bg-muted px-1 rounded">key,qty_uom,qty_unit,po_cost{showStoreNameInTemplate ? ",store" : ""}</code>
              </p>
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="text-xs h-40 font-mono"
                placeholder={`8851111111111\nSKU-00123,5,,12.50${showStoreNameInTemplate ? ",Jmart-001" : ""}\n8851111111112,,25,8.75`}
              />
              <DialogFooter>
                <Button onClick={handlePasteImport} size="sm" className="gap-1.5 text-xs">
                  <Upload className="w-3.5 h-3.5" /> Import
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Vendor Code Import dialog */}
      <Dialog open={vendorImportOpen} onOpenChange={setVendorImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Import Vendor Code
            </DialogTitle>
          </DialogHeader>
          <Tabs value={vendorImportTab} onValueChange={setVendorImportTab}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="upload" className="text-xs">Upload File</TabsTrigger>
              <TabsTrigger value="paste" className="text-xs">Paste</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                ไฟล์ <code className="bg-muted px-1 rounded">.xlsx / .csv</code> — คอลัมน์ <code className="bg-muted px-1 rounded">vendor_code</code> (จำเป็น) — ระบบจะดึง SKU ทุกตัวที่ active ของ vendor นั้นมาคำนวณ
              </p>
              <input
                ref={vendorFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleVendorFile(e.target.files[0])}
                className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
              <Button variant="ghost" size="sm" onClick={downloadVendorTemplate} className="gap-1.5 text-xs">
                <Download className="w-3.5 h-3.5" /> ดาวน์โหลด Template
              </Button>
            </TabsContent>
            <TabsContent value="paste" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">วาง vendor_code บรรทัดละ 1 รายการ</p>
              <Textarea
                value={vendorPasteText}
                onChange={(e) => setVendorPasteText(e.target.value)}
                className="text-xs h-40 font-mono"
                placeholder={"V001\nV002\nV003"}
              />
              <DialogFooter>
                <Button onClick={handleVendorPasteImport} size="sm" className="gap-1.5 text-xs">
                  <Upload className="w-3.5 h-3.5" /> Import
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Preview / Skip dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Imported Items ({importedItems.length})
              {typeof skippedCount === "number" && skippedCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3" /> {skippedCount} ไม่เจอใน Master
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-14">#</th>
                  <th className="text-left px-3 py-2">Barcode / SKU Code</th>
                  <th className="text-right px-3 py-2 w-24">Qty Uom</th>
                  <th className="text-right px-3 py-2 w-24">Qty Unit</th>
                  <th className="text-right px-3 py-2 w-24">Po cost</th>
                  {showStoreNameInTemplate && <th className="text-left px-3 py-2 w-32">Store</th>}
                </tr>
              </thead>
              <tbody>
                {importedItems.map((it, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{it.key}</td>
                    <td className="px-3 py-1.5 text-right">{it.qty || "-"}</td>
                    <td className="px-3 py-1.5 text-right">{it.qtyUnit ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right">{it.poCost ?? "-"}</td>
                    {showStoreNameInTemplate && <td className="px-3 py-1.5">{it.storeName || "-"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendor preview */}
      <Dialog open={vendorPreviewOpen} onOpenChange={setVendorPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Imported Vendors ({importedVendors?.length ?? 0})
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-14">#</th>
                  <th className="text-left px-3 py-2">Vendor Code</th>
                </tr>
              </thead>
              <tbody>
                {(importedVendors ?? []).map((v, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{v.vendor_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVendorPreviewOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
