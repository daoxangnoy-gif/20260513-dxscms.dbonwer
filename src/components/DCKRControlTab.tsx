import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2 } from "lucide-react";

// แถวข้อมูลสินค้าใน DC(KR) Control → Data
type DcKrItem = {
  barcode_key: string;     // บาร์โค้ดที่คีย์
  sku_code: string;        // ID
  barcode_unit: string;    // main_barcode where packing_size_qty = 1
  barcode_pack: string;    // main_barcode where UoM = Pack
  barcode_box: string;     // main_barcode where UoM = Box
  product_name_la: string;
  product_name_en: string;
  pack_qty: number | null; // packing_size_qty where UoM = Pack (min)
  box_qty: number | null;  // packing_size_qty where UoM = Box (min)
  cost: number | null;     // disable ไว้ก่อน
};

const EMPTY_ITEM: DcKrItem = {
  barcode_key: "", sku_code: "", barcode_unit: "", barcode_pack: "", barcode_box: "",
  product_name_la: "", product_name_en: "", pack_qty: null, box_qty: null, cost: null,
};

const DCKR_DATA_LS = "dckr_data_rows";
const DCKR_SUB_LS = "dckr_sub_tab";

// resolve บาร์โค้ด → ดึงข้อมูลสินค้าจาก data_master (ทุก UoM variant ของ SKU เดียวกัน)
async function resolveDcKrItem(code: string): Promise<Partial<DcKrItem> & { found: boolean }> {
  const c = code.trim();
  if (!c) return { found: false };
  // 1) หา sku — เช็ค main_barcode ก่อน แล้ว sku_code, barcode
  let sku: string | null = null;
  for (const col of ["main_barcode", "sku_code", "barcode"]) {
    const { data } = await (supabase as any).from("data_master").select("sku_code").eq(col, c).limit(1);
    if (data?.[0]?.sku_code) { sku = data[0].sku_code; break; }
  }
  if (!sku) return { found: false };
  // 2) ดึงทุกแถวของ sku นั้น (แต่ละ UoM)
  const { data: rows } = await (supabase as any)
    .from("data_master")
    .select("main_barcode, unit_of_measure, packing_size_qty, product_name_la, product_name_en")
    .eq("sku_code", sku);
  const all: any[] = rows || [];
  const norm = (s: any) => String(s ?? "").trim().toLowerCase();
  const num = (v: any) => (v == null || v === "" ? null : Number(v));
  const unitRow = all.find((r) => num(r.packing_size_qty) === 1);
  const packRows = all.filter((r) => norm(r.unit_of_measure) === "pack");
  const boxRows = all.filter((r) => norm(r.unit_of_measure) === "box");
  const minQty = (arr: any[]) => {
    const qs = arr.map((r) => num(r.packing_size_qty)).filter((n): n is number => n != null && !isNaN(n));
    return qs.length ? Math.min(...qs) : null;
  };
  // เลือก barcode ของ pack/box จากแถวที่ qty น้อยสุด
  const pickBarcode = (arr: any[]) => {
    if (!arr.length) return "";
    const sorted = [...arr].sort((a, b) => (num(a.packing_size_qty) ?? Infinity) - (num(b.packing_size_qty) ?? Infinity));
    return sorted[0].main_barcode || "";
  };
  const nameSrc = unitRow || all[0] || {};
  return {
    found: true,
    sku_code: sku,
    barcode_unit: unitRow?.main_barcode || "",
    barcode_pack: pickBarcode(packRows),
    barcode_box: pickBarcode(boxRows),
    product_name_la: nameSrc.product_name_la || "",
    product_name_en: nameSrc.product_name_en || "",
    pack_qty: minQty(packRows),
    box_qty: minQty(boxRows),
  };
}

export default function DCKRControlTab() {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState(() => localStorage.getItem(DCKR_SUB_LS) || "data");
  const setSub = (v: string) => { setSubTab(v); localStorage.setItem(DCKR_SUB_LS, v); };

  const [rows, setRows] = useState<DcKrItem[]>(() => {
    try { const raw = localStorage.getItem(DCKR_DATA_LS); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return [];
  });
  const save = (next: DcKrItem[]) => { setRows(next); try { localStorage.setItem(DCKR_DATA_LS, JSON.stringify(next)); } catch { /* ignore */ } };
  const [looking, setLooking] = useState<Record<number, boolean>>({});

  const addItem = () => save([...rows, { ...EMPTY_ITEM }]);
  const delItem = (i: number) => save(rows.filter((_, idx) => idx !== i));
  const setKey = (i: number, v: string) => save(rows.map((r, idx) => (idx === i ? { ...r, barcode_key: v } : r)));

  const lookup = async (i: number) => {
    const code = rows[i]?.barcode_key?.trim();
    if (!code) return;
    setLooking((p) => ({ ...p, [i]: true }));
    try {
      const res = await resolveDcKrItem(code);
      if (!res.found) {
        toast({ title: "ไม่พบสินค้าในระบบ", description: code, variant: "destructive" });
        save(rows.map((r, idx) => (idx === i ? { ...EMPTY_ITEM, barcode_key: code } : r)));
        return;
      }
      save(rows.map((r, idx) => (idx === i ? { ...r, ...res } as DcKrItem : r)));
    } catch (e: any) {
      toast({ title: "ดึงข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLooking((p) => { const n = { ...p }; delete n[i]; return n; });
    }
  };

  const COLS: { key: keyof DcKrItem; label: string; w: number; right?: boolean }[] = [
    { key: "sku_code", label: "ID", w: 120 },
    { key: "barcode_unit", label: "Barcode Unit", w: 140 },
    { key: "barcode_pack", label: "Barcode Pack", w: 140 },
    { key: "barcode_box", label: "Barcode Box", w: 140 },
    { key: "product_name_la", label: "Product name La", w: 220 },
    { key: "product_name_en", label: "Product name En", w: 220 },
    { key: "pack_qty", label: "Pack", w: 70, right: true },
    { key: "box_qty", label: "Box", w: 70, right: true },
  ];

  return (
    <Tabs value={subTab} onValueChange={setSub} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-3 p-4">
      <TabsList className="h-8 self-start">
        <TabsTrigger value="data" className="text-xs">Data</TabsTrigger>
        <TabsTrigger value="take_in" className="text-xs">Take in</TabsTrigger>
        <TabsTrigger value="take_out" className="text-xs">Take out</TabsTrigger>
        <TabsTrigger value="stock_movement" className="text-xs">Stock Movement</TabsTrigger>
        <TabsTrigger value="location" className="text-xs">Location</TabsTrigger>
      </TabsList>

      {/* ===== Data ===== */}
      <TabsContent value="data" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" /> Add new item
          </Button>
          <span className="text-xs text-muted-foreground">{rows.length} รายการ</span>
        </div>

        <div className="border rounded-lg flex-1 overflow-auto min-h-0">
          <table className="text-sm border-collapse whitespace-nowrap table-fixed" style={{ width: 48 + 170 + COLS.reduce((s, c) => s + c.w, 0) + 110 + 48 }}>
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 170 }} />
              {COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}
              <col style={{ width: 110 }} />
              <col style={{ width: 48 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
                <th>#</th>
                <th>Barcode Key</th>
                {COLS.map((c) => <th key={c.key} className={c.right ? "text-right" : ""}>{c.label}</th>)}
                <th className="text-right">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1 [&_td]:overflow-hidden [&_td]:text-ellipsis">
                  <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Input
                        value={r.barcode_key}
                        onChange={(e) => setKey(i, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(i); } }}
                        onBlur={() => { if (r.barcode_key.trim() && !r.sku_code) lookup(i); }}
                        placeholder="คีย์ barcode"
                        className="h-7 text-xs"
                      />
                      {looking[i] && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-muted-foreground" />}
                    </div>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className={c.right ? "text-right tabular-nums" : "truncate"} title={String(r[c.key] ?? "")}>
                      {r[c.key] == null || r[c.key] === "" ? "-" : String(r[c.key])}
                    </td>
                  ))}
                  <td className="text-right">
                    <Input value="" disabled placeholder="-" className="h-7 text-xs text-right bg-muted/40" />
                  </td>
                  <td>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => delItem(i)} title="ลบแถว">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 4} className="px-3 py-8 text-center text-muted-foreground">
                    กด "Add new item" แล้วคีย์ barcode เพื่อดึงข้อมูลสินค้า
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {/* ===== Sub-tab อื่น — ออกแบบภายหลัง ===== */}
      {["take_in", "take_out", "stock_movement", "location"].map((t) => (
        <TabsContent key={t} value={t} className="mt-0 flex-1 data-[state=active]:flex items-center justify-center text-sm text-muted-foreground">
          ส่วนนี้จะออกแบบภายหลัง
        </TabsContent>
      ))}
    </Tabs>
  );
}
