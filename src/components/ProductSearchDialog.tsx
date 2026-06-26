import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
// คอลัมน์ที่ใช้ค้นหา (ช่องเดียว ค้นข้ามคอลัมน์)
const SEARCH_COLS = ["sku_code", "main_barcode", "barcode", "product_name_la", "product_name_en"];

// operator แบบ Odoo
const OPS: { value: string; label: string; negate?: boolean }[] = [
  { value: "contain", label: "contains" },
  { value: "ncontain", label: "does not contain", negate: true },
  { value: "equal", label: "= (equal)" },
  { value: "nequal", label: "!= (not equal)", negate: true },
  { value: "start", label: "starts with" },
  { value: "end", label: "ends with" },
];

const patternOf = (op: string, v: string) => {
  switch (op) {
    case "contain": case "ncontain": return `%${v}%`;
    case "start": return `${v}%`;
    case "end": return `%${v}`;
    default: return v; // equal / nequal → ไม่มี wildcard (ilike = case-insensitive)
  }
};

export default function ProductSearchDialog({ trigger }: { trigger: React.ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState("contain");
  const [val, setVal] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = async () => {
    const v = val.trim();
    if (!v) { toast({ title: "กรอกคำค้นหา", variant: "destructive" }); return; }
    const negate = OPS.find((o) => o.value === op)?.negate;
    const pattern = patternOf(op, v);
    setLoading(true);
    setSearched(true);
    try {
      let q = (supabase as any).from("data_master").select(SELECT_COLS).limit(300);
      if (negate) {
        // ไม่ตรงทุกคอลัมน์ (AND ของ NOT) = ไม่มีคอลัมน์ไหน match
        for (const c of SEARCH_COLS) q = q.not(c, "ilike", pattern);
      } else {
        // ตรงคอลัมน์ใดคอลัมน์หนึ่ง (OR)
        q = q.or(SEARCH_COLS.map((c) => `${c}.ilike.${pattern}`).join(","));
      }
      const { data, error } = await q;
      if (error) throw error;
      const sorted = (data || []).sort((a: any, b: any) => String(a.sku_code ?? "").localeCompare(String(b.sku_code ?? "")));
      setRows(sorted);
    } catch (e: any) {
      toast({ title: "ค้นหาไม่สำเร็จ", description: e.message, variant: "destructive" });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // ไฮไลต์ row ที่ packing_size_qty = 1 — ถ้า sku เดียวกันมีหลาย row qty=1 ไฮไลต์แค่ row แรก
  const hlSet = (() => {
    const s = new Set<number>();
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (Number(r.packing_size_qty) === 1 && !seen.has(String(r.sku_code))) { s.add(i); seen.add(String(r.sku_code)); }
    });
    return s;
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>ค้นหาสินค้า (Data Master)</DialogTitle>
        </DialogHeader>

        {/* ช่องค้นหาเดียว + operator แบบ Odoo */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={op} onChange={(e) => setOp(e.target.value)} className="h-9 text-sm border rounded-md px-2 bg-background">
            {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
              className="h-9 pl-8"
              placeholder="ค้นหา ID / Barcode / ชื่อสินค้า (LA/EN)"
            />
          </div>
          <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={doSearch} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} ค้นหา
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {searched && <span className="text-xs text-muted-foreground">{rows.length} รายการ{rows.length >= 300 ? " (แสดงสูงสุด 300)" : ""}</span>}
          <span className="text-[11px] text-muted-foreground ml-auto">แถวไฮไลต์ = Packing Size Qty 1 · คลิกค่าในตารางเพื่อเลือก/คัดลอก</span>
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
                <tr key={i} className={cn("border-b last:border-0 hover:bg-muted/40 [&_td]:px-2.5 [&_td]:py-1", hlSet.has(i) && "bg-amber-100/70 hover:bg-amber-100")}>
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
                    {searched ? "ไม่พบสินค้า" : "เลือก operator + พิมพ์คำค้นหา แล้วกด \"ค้นหา\""}
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
