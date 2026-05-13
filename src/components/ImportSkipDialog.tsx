import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, X } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export type SkipKind = "vendor" | "sku" | "store" | "qty" | "other";

export interface SkippedItem {
  /** type ของ skip — ใช้ filter/แสดงสีต่างกัน */
  kind: SkipKind;
  /** key ที่ลูกค้าใส่มา เช่น barcode/sku/vendor_code/store_name */
  key: string;
  /** เหตุผลย่อ เช่น "ไม่พบใน Master", "Inactive", "Consignment" */
  reason: string;
  /** รายละเอียดเพิ่ม (optional) */
  detail?: string;
  /** raw row (optional) — ใช้สำหรับ Export */
  original?: Record<string, any>;
}

interface BarProps {
  /** จำนวนรายการที่ skip */
  count: number;
  /** label ของชุดข้อมูล เช่น "Import Barcode/SKU" */
  context?: string;
  /** รายการที่ skip — ใช้สำหรับ download Excel โดยตรง */
  items: SkippedItem[];
  /** ชื่อ context สำหรับชื่อไฟล์ Export */
  title?: string;
  /** กดปิด/ล้าง */
  onClear?: () => void;
  /** บังคับให้แสดง bar แม้ count = 0 (เช่น หลัง import เสร็จ) */
  forceShow?: boolean;
  className?: string;
}

/** Inline warning bar — แสดงจำนวน skip + ปุ่ม Skip download Excel ทันที (แบบ Range Store) */
export function ImportSkipBar({ count, context, items, title, onClear, forceShow, className }: BarProps) {
  if (count <= 0 && !forceShow) return null;
  const isEmpty = count <= 0;

  const handleDownload = () => {
    if (!items || items.length === 0) {
      toast.info("ไม่มี skip list");
      return;
    }
    const byReason = new Map<string, number>();
    for (const s of items) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
    const summaryRows = [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, c]) => ({ "Skip Reason": reason, "Count": c }));
    const exportRows = items.map((s, i) => ({
      "Row #": i + 1,
      "Type": KIND_BADGE[s.kind].label,
      "Key": s.key,
      "Skip Reason": s.reason,
      "Detail": s.detail || "",
      ...(s.original || {}),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "Skipped Rows");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const safeTitle = (title || context || "import").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    XLSX.writeFile(wb, `skip_list_${safeTitle}_${stamp}.xlsx`);
    toast.success(`Export ${exportRows.length.toLocaleString()} rows`);
  };

  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border ${isEmpty ? "border-emerald-500/40 bg-emerald-500/10" : "border-warning/40 bg-warning/10"} ${className ?? ""}`}>
      <div className="flex items-center gap-1.5 text-xs min-w-0 flex-1">
        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${isEmpty ? "text-emerald-600 dark:text-emerald-400" : "text-warning"}`} />
        <span className={`font-semibold truncate ${isEmpty ? "text-emerald-700 dark:text-emerald-300" : "text-warning-foreground"}`}>
          {context ? `${context} - ` : ""}
          {isEmpty ? "Import สำเร็จ · ไม่มีรายการที่ถูกข้าม" : `${count.toLocaleString()} รายการ`}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1" onClick={handleDownload} disabled={isEmpty}>
          <Download className="h-3 w-3" /> Skip
        </Button>
        {onClear && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClear} title="ปิด">
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SkippedItem[];
  /** ชื่อ context — โชว์ในชื่อไฟล์ Export และใน title */
  title?: string;
  /** label ปุ่มปิด */
  closeLabel?: string;
  /** callback เมื่อกดปุ่มปิด — default = onOpenChange(false) */
  onClose?: () => void;
}

const KIND_BADGE: Record<SkipKind, { label: string; className: string }> = {
  vendor: { label: "Vendor", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  sku: { label: "SKU/Barcode", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  store: { label: "Store", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  qty: { label: "Qty", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  other: { label: "อื่นๆ", className: "bg-muted text-muted-foreground border-border" },
};

/** Skip List Dialog — เหมือน Range Store: ตาราง + Summary + Export Excel */
export function ImportSkipDialog({ open, onOpenChange, items, title, closeLabel, onClose }: DialogProps) {
  const summary = useMemo(() => {
    const byReason = new Map<string, number>();
    const byKind = new Map<SkipKind, number>();
    for (const s of items) {
      byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
      byKind.set(s.kind, (byKind.get(s.kind) || 0) + 1);
    }
    return {
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
      byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [items]);

  const exportSkipList = () => {
    if (items.length === 0) {
      toast.info("ไม่มี skip list");
      return;
    }
    const exportRows = items.map((s, i) => ({
      "Row #": i + 1,
      "Type": KIND_BADGE[s.kind].label,
      "Key": s.key,
      "Skip Reason": s.reason,
      "Detail": s.detail || "",
      ...(s.original || {}),
    }));
    const summaryRows = summary.byReason.map(([reason, count]) => ({ "Skip Reason": reason, "Count": count }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "Skipped Rows");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const safeTitle = (title || "import").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    XLSX.writeFile(wb, `skip_list_${safeTitle}_${stamp}.xlsx`);
    toast.success(`Export ${exportRows.length.toLocaleString()} rows`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Skip List {title ? `· ${title}` : ""} ({items.length.toLocaleString()})
          </DialogTitle>
        </DialogHeader>

        {/* Summary chips */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {summary.byKind.map(([k, c]) => (
              <span key={k} className={`text-[10px] px-2 py-0.5 rounded-full border ${KIND_BADGE[k].className}`}>
                {KIND_BADGE[k].label}: {c.toLocaleString()}
              </span>
            ))}
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              เหตุผล {summary.byReason.length} ชนิด
            </span>
          </div>
        )}

        {/* Reason summary */}
        {summary.byReason.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-28 overflow-auto">
            <div className="text-[10px] font-semibold text-muted-foreground mb-1">Summary by Reason</div>
            <div className="space-y-0.5">
              {summary.byReason.map(([reason, count]) => (
                <div key={reason} className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate">{reason}</span>
                  <span className="font-mono font-semibold tabular-nums shrink-0">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detail table */}
        <ScrollArea className="max-h-[45vh] border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 w-10">#</th>
                <th className="text-left px-2 py-1.5 w-20">Type</th>
                <th className="text-left px-2 py-1.5">Key</th>
                <th className="text-left px-2 py-1.5">Reason</th>
                <th className="text-left px-2 py-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center px-2 py-8 text-muted-foreground">
                    ไม่มีรายการที่ถูกข้าม
                  </td>
                </tr>
              ) : (
                items.map((s, i) => (
                  <tr key={i} className="border-t border-border hover:bg-accent/30">
                    <td className="px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${KIND_BADGE[s.kind].className}`}>
                        {KIND_BADGE[s.kind].label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 font-mono break-all">{s.key}</td>
                    <td className="px-2 py-1">{s.reason}</td>
                    <td className="px-2 py-1 text-muted-foreground">{s.detail || ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={exportSkipList} disabled={items.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export Excel
          </Button>
          <Button onClick={() => (onClose ? onClose() : onOpenChange(false))}>
            {closeLabel || "ปิด"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
