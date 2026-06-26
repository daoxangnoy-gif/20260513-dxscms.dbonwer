import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2 } from "lucide-react";

// คอลัมน์ที่แสดง (key ใน data_master → label)
const COLS: [string, string][] = [
  ["sku_code", "SKU Code"],
  ["main_barcode", "Main Barcode"],
  ["barcode", "Barcode"],
  ["product_name_la", "Product Name (LA)"],
  ["product_name_en", "Product Name (EN)"],
  ["unit_of_measure", "Unit of Measure"],
  ["packing_size_qty", "Packing Size Qty"],
  ["packing_size", "Packing Size"],
  ["division_group", "Division Group"],
  ["division", "Division"],
  ["department", "Department"],
  ["sub_department", "Sub-Department"],
  ["class", "Class"],
  ["product_owner", "Product Owner"],
  ["item_type", "Item Type"],
  ["buying_status", "Buying Status"],
];
const SELECT_COLS = COLS.map((c) => c[0]).join(", ");

export default function ProductSearchDialog({ trigger }: { trigger: React.ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fId, setFId] = useState("");
  const [fBc, setFBc] = useState("");
  const [fLa, setFLa] = useState("");
  const [fEn, setFEn] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = async () => {
    const id = fId.trim(), bc = fBc.trim(), la = fLa.trim(), en = fEn.trim();
    if (!id && !bc && !la && !en) { toast({ title: "กรอกอย่างน้อย 1 ช่องค้นหา", variant: "destructive" }); return; }
    setLoading(true);
    setSearched(true);
    try {
      let q = (supabase as any).from("data_master").select(SELECT_COLS).limit(300);
      if (id) q = q.ilike("sku_code", `%${id}%`);
      if (bc) q = q.or(`main_barcode.ilike.%${bc}%,barcode.ilike.%${bc}%`);
      if (la) q = q.ilike("product_name_la", `%${la}%`);
      if (en) q = q.ilike("product_name_en", `%${en}%`);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      toast({ title: "ค้นหาไม่สำเร็จ", description: e.message, variant: "destructive" });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>ค้นหาสินค้า (Data Master)</DialogTitle>
        </DialogHeader>

        {/* ช่องค้นหา */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div className="space-y-1"><Label className="text-xs">ID</Label><Input value={fId} onChange={(e) => setFId(e.target.value)} onKeyDown={onKey} className="h-9" placeholder="SKU Code" /></div>
          <div className="space-y-1"><Label className="text-xs">Barcode</Label><Input value={fBc} onChange={(e) => setFBc(e.target.value)} onKeyDown={onKey} className="h-9" placeholder="Main / Barcode" /></div>
          <div className="space-y-1"><Label className="text-xs">Product name LA</Label><Input value={fLa} onChange={(e) => setFLa(e.target.value)} onKeyDown={onKey} className="h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Product name EN</Label><Input value={fEn} onChange={(e) => setFEn(e.target.value)} onKeyDown={onKey} className="h-9" /></div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={doSearch} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} ค้นหา
          </Button>
          {searched && <span className="text-xs text-muted-foreground">{rows.length} รายการ{rows.length >= 300 ? " (แสดงสูงสุด 300)" : ""}</span>}
          <span className="text-[11px] text-muted-foreground ml-auto">คลิกที่ค่าในตารางเพื่อเลือก/คัดลอก</span>
        </div>

        {/* ตารางผล */}
        <div className="border rounded-lg flex-1 overflow-auto min-h-0">
          <table className="text-xs border-collapse whitespace-nowrap">
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-medium">
                {COLS.map(([k, label]) => <th key={k}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/40 [&_td]:px-2.5 [&_td]:py-1">
                  {COLS.map(([k]) => (
                    <td key={k} className="select-all cursor-text" title={String(r[k] ?? "")}>
                      {r[k] === "" || r[k] == null ? "-" : String(r[k])}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="px-3 py-8 text-center text-muted-foreground">
                    {searched ? "ไม่พบสินค้า" : "กรอกช่องค้นหาแล้วกด \"ค้นหา\""}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
