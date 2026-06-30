import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Save, Loader2, ArrowUp, ArrowDown, Minus } from "lucide-react";

type CountRow = { category: string; count: number };
type Snap = { batch_id: string; saved_label: string; saved_at: string; report_type: string; category: string; sku_count: number };

export default function POReportDialog({
  open, onOpenChange, current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: { remark: CountRow[]; action2: CountRow[] };
}) {
  const { toast } = useToast();
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).from("po_report_snapshot").select("*").order("saved_at", { ascending: true });
      if (error) throw error;
      setSnaps(data || []);
    } catch (e: any) {
      toast({ title: "โหลด snapshot ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const batch_id = crypto.randomUUID();
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const saved_label = `${p(now.getDate())}/${p(now.getMonth() + 1)} ${p(now.getHours())}:${p(now.getMinutes())}`;
      const rows = [
        ...current.remark.map((r) => ({ batch_id, saved_label, report_type: "remark", category: r.category, sku_count: r.count })),
        ...current.action2.map((r) => ({ batch_id, saved_label, report_type: "action2", category: r.category, sku_count: r.count })),
      ];
      const { error } = await (supabase as any).from("po_report_snapshot").insert(rows);
      if (error) throw error;
      // เก็บได้สูงสุด 7 คอลัมน์ (batch) — เกินแล้วลบอันเก่าสุดทิ้ง (FIFO)
      const { data: all } = await (supabase as any).from("po_report_snapshot").select("batch_id, saved_at").order("saved_at", { ascending: false });
      const seen: string[] = [];
      for (const s of (all || []) as any[]) if (!seen.includes(s.batch_id)) seen.push(s.batch_id);
      const removeBatches = seen.slice(7); // เกิน 7 batch แรก = อันเก่า
      if (removeBatches.length) await (supabase as any).from("po_report_snapshot").delete().in("batch_id", removeBatches);
      toast({ title: "บันทึก snapshot แล้ว", description: `${saved_label}${removeBatches.length ? ` · ลบคอลัมน์เก่า ${removeBatches.length}` : ""}` });
      load();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  // สร้างตาราง pivot: แถว = category, คอลัมน์ = แต่ละ batch (เรียงเวลา) + ปัจจุบัน
  const renderTable = (type: "remark" | "action2", title: string) => {
    const cur = type === "remark" ? current.remark : current.action2;
    const curMap = new Map(cur.map((r) => [r.category, r.count]));
    const typeSnaps = snaps.filter((s) => s.report_type === type);
    // batches เรียงตามเวลา
    const batchMap = new Map<string, { label: string; at: string }>();
    for (const s of typeSnaps) if (!batchMap.has(s.batch_id)) batchMap.set(s.batch_id, { label: s.saved_label, at: s.saved_at });
    const batches = [...batchMap.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at)).map(([id, v]) => ({ id, ...v }));
    // ค่าต่อ (batch_id, category)
    const cellMap = new Map<string, number>();
    for (const s of typeSnaps) cellMap.set(`${s.batch_id}|${s.category}`, s.sku_count);
    // categories = union
    const cats = [...new Set([...curMap.keys(), ...typeSnaps.map((s) => s.category)])].sort((a, b) => a.localeCompare(b));
    const lastBatch = batches[batches.length - 1];

    return (
      <div className="space-y-1.5">
        <div className="text-sm font-medium">{title} <span className="text-xs text-muted-foreground">(Count distinct SKU)</span></div>
        <div className="border rounded-lg overflow-auto">
          <table className="text-xs border-collapse whitespace-nowrap w-full">
            <thead className="sticky top-0">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
                <th className="min-w-[200px]">{type === "remark" ? "Remark" : "Action2"}</th>
                {batches.map((b) => <th key={b.id} className="text-right">{b.label}</th>)}
                <th className="text-right text-primary">ปัจจุบัน</th>
                <th className="text-right">เทียบล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => {
                const curVal = curMap.get(cat) ?? 0;
                const lastVal = lastBatch ? (cellMap.get(`${lastBatch.id}|${cat}`) ?? 0) : null;
                const delta = lastVal == null ? null : curVal - lastVal;
                return (
                  <tr key={cat} className="border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1">
                    <td className="truncate max-w-[260px]" title={cat}>{cat || "-"}</td>
                    {batches.map((b) => <td key={b.id} className="text-right tabular-nums text-muted-foreground">{cellMap.get(`${b.id}|${cat}`) ?? 0}</td>)}
                    <td className="text-right tabular-nums font-semibold">{curVal}</td>
                    <td className="text-right tabular-nums">
                      {delta == null ? <span className="text-muted-foreground">-</span> : delta === 0 ? (
                        <span className="text-muted-foreground inline-flex items-center gap-0.5"><Minus className="w-3 h-3" />0</span>
                      ) : delta < 0 ? (
                        <span className="text-emerald-600 inline-flex items-center gap-0.5"><ArrowDown className="w-3 h-3" />{Math.abs(delta)}</span>
                      ) : (
                        <span className="text-red-500 inline-flex items-center gap-0.5"><ArrowUp className="w-3 h-3" />{delta}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {cats.length === 0 && <tr><td colSpan={batches.length + 3} className="px-3 py-6 text-center text-muted-foreground">ไม่มีข้อมูล</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[980px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Report — สรุปจำนวน SKU</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save snapshot (เพิ่มคอลัมน์วันนี้)
          </Button>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <span className="text-[11px] text-muted-foreground ml-auto">เทียบล่าสุด: <span className="text-emerald-600">↓ ลดลง</span> · <span className="text-red-500">↑ เพิ่มขึ้น</span> (เทียบ "ปัจจุบัน" กับ snapshot ล่าสุด)</span>
        </div>
        <div className="flex-1 overflow-auto min-h-0 space-y-4">
          {renderTable("remark", "Group by Remark")}
          {renderTable("action2", "Group by Action2")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
