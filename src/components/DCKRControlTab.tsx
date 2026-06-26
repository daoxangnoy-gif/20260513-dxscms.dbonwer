import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Loader2, Download, Search } from "lucide-react";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures"; // ใช้ bucket เดียวกับ Monthly usage

// อัปรูป (data URL) → Storage → คืน public URL
async function uploadPicture(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type.split("/")[1] || "png").split("+")[0];
  const path = `dckr/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MU_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(MU_BUCKET).getPublicUrl(path).data.publicUrl;
}

// แถวข้อมูลสินค้าใน DC(KR) Control → Data
type DcKrItem = {
  id: string;              // DB uuid
  picture: string;         // URL รูปสินค้า
  picture_brand: string;   // แบรนด์ที่มาของรูป (แสดงใต้รูป)
  barcode_key: string;     // บาร์โค้ดที่คีย์
  sku_code: string;        // ID
  barcode_unit: string;    // main_barcode where packing_size_qty = 1
  barcode_pack: string;    // main_barcode where UoM = Pack
  barcode_box: string;     // main_barcode where UoM = Box
  product_name_la: string;
  product_name_en: string;
  pack_qty: string;        // packing_size_qty where UoM = Pack (min)
  box_qty: string;         // packing_size_qty where UoM = Box (min)
  cost: string;            // disable ไว้ก่อน
  found: boolean;          // พบใน data_master หรือไม่ → ใช้คำนวณ Remark SKU
};

const newItem = (): DcKrItem => ({
  id: "", picture: "", picture_brand: "",
  barcode_key: "", sku_code: "", barcode_unit: "", barcode_pack: "", barcode_box: "",
  product_name_la: "", product_name_en: "", pack_qty: "", box_qty: "", cost: "", found: false,
});

const DCKR_SUB_LS = "dckr_sub_tab";
// คอลัมน์ใน DB (ไม่รวม id/created_at) — ใช้ map ตอน insert
const DCKR_DB_COLS = ["picture", "picture_brand", "barcode_key", "sku_code", "barcode_unit", "barcode_pack", "barcode_box", "product_name_la", "product_name_en", "pack_qty", "box_qty", "cost", "found"] as const;
const remarkSku = (found: boolean) => (found ? "Data odoo" : "Data คีเอง");

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
  const pickBarcode = (arr: any[]) => {
    if (!arr.length) return "";
    const sorted = [...arr].sort((a, b) => (num(a.packing_size_qty) ?? Infinity) - (num(b.packing_size_qty) ?? Infinity));
    return sorted[0].main_barcode || "";
  };
  const nameSrc = unitRow || all[0] || {};
  const pq = minQty(packRows), bq = minQty(boxRows);
  // ดึงรูป 1 รูปจาก Monthly usage (monthly_usage_item) ของ sku นี้ + แบรนด์ที่มา
  let picture = "", picture_brand = "";
  try {
    const { data: mi } = await (supabase as any)
      .from("monthly_usage_item").select("picture, doc_id").eq("sku_code", sku).not("picture", "is", null).limit(1);
    if (mi?.[0]?.picture) {
      picture = mi[0].picture;
      const { data: doc } = await (supabase as any).from("monthly_usage_doc").select("brand_name").eq("id", mi[0].doc_id).limit(1);
      picture_brand = doc?.[0]?.brand_name || "";
    }
  } catch { /* ไม่มีรูปก็ข้าม */ }
  return {
    found: true,
    sku_code: sku,
    barcode_unit: unitRow?.main_barcode || "",
    barcode_pack: pickBarcode(packRows),
    barcode_box: pickBarcode(boxRows),
    product_name_la: nameSrc.product_name_la || "",
    product_name_en: nameSrc.product_name_en || "",
    pack_qty: pq == null ? "" : String(pq),
    box_qty: bq == null ? "" : String(bq),
    picture, picture_brand,
  };
}

export default function DCKRControlTab() {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState(() => localStorage.getItem(DCKR_SUB_LS) || "data");
  const setSub = (v: string) => { setSubTab(v); localStorage.setItem(DCKR_SUB_LS, v); };

  const [rows, setRows] = useState<DcKrItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).from("dckr_item").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      setRows((data || []).map((d: any) => ({
        id: d.id, picture: d.picture ?? "", picture_brand: d.picture_brand ?? "",
        barcode_key: d.barcode_key ?? "", sku_code: d.sku_code ?? "",
        barcode_unit: d.barcode_unit ?? "", barcode_pack: d.barcode_pack ?? "", barcode_box: d.barcode_box ?? "",
        product_name_la: d.product_name_la ?? "", product_name_en: d.product_name_en ?? "",
        pack_qty: d.pack_qty ?? "", box_qty: d.box_qty ?? "", cost: d.cost ?? "", found: !!d.found,
      })));
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadItems(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ----- Add dialog -----
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<DcKrItem>(newItem());
  const [resolving, setResolving] = useState(false);
  const setF = (k: keyof DcKrItem, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const openAdd = () => { setForm(newItem()); setAddOpen(true); };

  const resolveForm = async () => {
    const code = form.barcode_key.trim();
    if (!code) return;
    setResolving(true);
    try {
      const res = await resolveDcKrItem(code);
      if (!res.found) {
        toast({ title: "ไม่พบใน Data Master", description: "คีย์ข้อมูลคอลัมน์อื่นเองได้", variant: "destructive" });
        setForm((p) => ({ ...p, found: false }));
        return;
      }
      setForm((p) => ({ ...p, ...res } as DcKrItem));
    } catch (e: any) {
      toast({ title: "ดึงข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };

  // ----- รูปภาพ: อัปไฟล์ / วางคลิปบอร์ด -----
  const [uploadingPic, setUploadingPic] = useState(false);
  const uploadAndSet = async (file: File) => {
    setUploadingPic(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
      const url = await uploadPicture(dataUrl);
      setForm((p) => ({ ...p, picture: url, picture_brand: "" })); // อัปเอง = ไม่มีแบรนด์ที่มา
    } catch (e: any) {
      toast({ title: "อัปรูปไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setUploadingPic(false);
    }
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) { e.preventDefault(); uploadAndSet(file); }
  };

  const [saving, setSaving] = useState(false);
  const saveForm = async () => {
    if (!form.barcode_key.trim() && !form.sku_code.trim()) {
      toast({ title: "กรุณาคีย์ Barcode หรือ ID อย่างน้อย 1 ช่อง", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const c of DCKR_DB_COLS) payload[c] = (form as any)[c];
      const { data, error } = await (supabase as any).from("dckr_item").insert(payload).select("id").limit(1);
      if (error) throw error;
      setRows((prev) => [...prev, { ...form, id: data?.[0]?.id || crypto.randomUUID() }]);
      setAddOpen(false);
      toast({ title: "เพิ่มรายการแล้ว" });
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ----- selection -----
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = (c: boolean) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set());

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    try {
      const { error } = await (supabase as any).from("dckr_item").delete().in("id", ids);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const exportSelected = () => {
    const list = rows.filter((r) => selected.has(r.id));
    if (list.length === 0) { toast({ title: "เลือกรายการก่อน", variant: "destructive" }); return; }
    const out = list.map((r) => ({
      "Picture": r.picture,
      "Picture Brand": r.picture_brand,
      "Barcode Key": r.barcode_key,
      "ID": r.sku_code,
      "Barcode Unit": r.barcode_unit,
      "Barcode Pack": r.barcode_pack,
      "Barcode Box": r.barcode_box,
      "Product name La": r.product_name_la,
      "Product name En": r.product_name_en,
      "Pack": r.pack_qty,
      "Box": r.box_qty,
      "Cost": r.cost,
      "Remark SKU": remarkSku(r.found),
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DCKR Data");
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    XLSX.writeFile(wb, `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}-DCKR-Data.xlsx`);
  };

  // ฟิลด์ในฟอร์ม Add (เรียงบน→ล่าง) — ช่อง barcode_key มีปุ่มดึงข้อมูล
  const FORM_FIELDS: { key: keyof DcKrItem; label: string; type?: string; disabled?: boolean }[] = [
    { key: "sku_code", label: "ID" },
    { key: "barcode_unit", label: "Barcode Unit" },
    { key: "barcode_pack", label: "Barcode Pack" },
    { key: "barcode_box", label: "Barcode Box" },
    { key: "product_name_la", label: "Product name La" },
    { key: "product_name_en", label: "Product name En" },
    { key: "pack_qty", label: "Pack", type: "number" },
    { key: "box_qty", label: "Box", type: "number" },
    { key: "cost", label: "Cost", disabled: true },
  ];

  const TABLE_COLS: { key: keyof DcKrItem; label: string; w: number; right?: boolean }[] = [
    { key: "barcode_key", label: "Barcode Key", w: 150 },
    { key: "sku_code", label: "ID", w: 120 },
    { key: "barcode_unit", label: "Barcode Unit", w: 140 },
    { key: "barcode_pack", label: "Barcode Pack", w: 140 },
    { key: "barcode_box", label: "Barcode Box", w: 140 },
    { key: "product_name_la", label: "Product name La", w: 220 },
    { key: "product_name_en", label: "Product name En", w: 220 },
    { key: "pack_qty", label: "Pack", w: 70, right: true },
    { key: "box_qty", label: "Box", w: 70, right: true },
    { key: "cost", label: "Cost", w: 90, right: true },
  ];

  return (
    <Tabs value={subTab} onValueChange={setSub} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-3 p-4">
      <TabsList className="h-8 self-start">
        <TabsTrigger value="data" className="text-xs">Data</TabsTrigger>
        <TabsTrigger value="take_in" className="text-xs">Take in</TabsTrigger>
        <TabsTrigger value="take_out" className="text-xs">Take out</TabsTrigger>
        <TabsTrigger value="count_stock" className="text-xs">Count Stock</TabsTrigger>
        <TabsTrigger value="stock_movement" className="text-xs">Stock Movement</TabsTrigger>
        <TabsTrigger value="location" className="text-xs">Location</TabsTrigger>
      </TabsList>

      {/* ===== Data ===== */}
      <TabsContent value="data" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5" /> Add new item
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportSelected} disabled={selected.size === 0}>
            <Download className="w-3.5 h-3.5" /> Export ({selected.size})
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive border-destructive/40" onClick={deleteSelected} disabled={selected.size === 0}>
            <Trash2 className="w-3.5 h-3.5" /> ลบที่เลือก ({selected.size})
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">{rows.length} รายการ</span>
        </div>

        <div className="border rounded-lg flex-1 overflow-auto min-h-0">
          <table className="text-sm border-collapse whitespace-nowrap table-fixed" style={{ width: 40 + 48 + 90 + TABLE_COLS.reduce((s, c) => s + c.w, 0) + 130 }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 48 }} />
              <col style={{ width: 90 }} />
              {TABLE_COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}
              <col style={{ width: 130 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
                <th><input type="checkbox" className="h-4 w-4 align-middle" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /></th>
                <th>#</th>
                <th>Picture</th>
                {TABLE_COLS.map((c) => <th key={c.key} className={c.right ? "text-right" : ""}>{c.label}</th>)}
                <th>Remark SKU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={cn("border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1.5 [&_td]:overflow-hidden [&_td]:text-ellipsis", selected.has(r.id) && "bg-primary/5")}>
                  <td><input type="checkbox" className="h-4 w-4 align-middle" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                  <td>
                    {r.picture ? (
                      <a href={r.picture} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-0.5 w-fit">
                        <img src={r.picture} alt="" className="w-12 h-12 object-contain rounded border border-border" />
                        {r.picture_brand && <span className="text-[10px] text-muted-foreground leading-tight text-center max-w-[72px] truncate">{r.picture_brand}</span>}
                      </a>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  {TABLE_COLS.map((c) => (
                    <td key={c.key} className={c.right ? "text-right tabular-nums" : "truncate"} title={String(r[c.key] ?? "")}>
                      {r[c.key] === "" || r[c.key] == null ? "-" : String(r[c.key])}
                    </td>
                  ))}
                  <td>
                    <span className={cn("text-xs font-medium", r.found ? "text-emerald-600" : "text-amber-600")}>{remarkSku(r.found)}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={TABLE_COLS.length + 4} className="px-3 py-8 text-center text-muted-foreground">
                    กด "Add new item" เพื่อเพิ่มสินค้า
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {/* ===== Sub-tab อื่น — ออกแบบภายหลัง ===== */}
      {["take_in", "take_out", "count_stock", "stock_movement", "location"].map((t) => (
        <TabsContent key={t} value={t} className="mt-0 flex-1 data-[state=active]:flex items-center justify-center text-sm text-muted-foreground">
          ส่วนนี้จะออกแบบภายหลัง
        </TabsContent>
      ))}

      {/* ===== Add Dialog (ฟอร์มแนวตั้ง รองรับมือถือ) ===== */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[420px] max-w-[94vw] max-h-[88vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>เพิ่มสินค้า (DC KR)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            {/* Barcode Key + ปุ่มดึงข้อมูล */}
            <div className="space-y-1">
              <Label className="text-xs">Barcode Key</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  value={form.barcode_key}
                  onChange={(e) => setF("barcode_key", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolveForm(); } }}
                  placeholder="คีย์ barcode แล้วกด Enter / ดึงข้อมูล"
                  className="h-9"
                />
                <Button size="sm" variant="outline" className="h-9 gap-1 shrink-0" onClick={resolveForm} disabled={resolving}>
                  {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} ดึง
                </Button>
              </div>
            </div>
            {FORM_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type={f.type || "text"}
                  value={String(form[f.key] ?? "")}
                  onChange={(e) => setF(f.key, e.target.value)}
                  disabled={f.disabled}
                  className={cn("h-9", f.disabled && "bg-muted/40")}
                />
              </div>
            ))}
            {/* Picture — ดึงจาก Monthly / อัปเอง / วางคลิปบอร์ด */}
            <div className="space-y-1">
              <Label className="text-xs">Picture</Label>
              {form.picture ? (
                <div className="flex items-end gap-3">
                  <div className="flex flex-col items-center">
                    <img src={form.picture} alt="" className="w-24 h-24 object-contain border rounded" />
                    {form.picture_brand && <span className="text-[10px] text-muted-foreground mt-0.5 max-w-[96px] truncate" title={form.picture_brand}>{form.picture_brand}</span>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-destructive" onClick={() => setForm((p) => ({ ...p, picture: "", picture_brand: "" }))}>ลบรูป</Button>
                </div>
              ) : (
                <div
                  onPaste={handlePaste}
                  tabIndex={0}
                  className="border border-dashed rounded-md p-3 text-xs text-muted-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {uploadingPic ? (
                    <span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังอัป...</span>
                  ) : (
                    <>
                      คลิกที่นี่แล้ววางรูป (Ctrl+V) หรือ{" "}
                      <label className="text-primary underline cursor-pointer">
                        เลือกไฟล์
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSet(f); e.target.value = ""; }} />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Remark SKU</Label>
              <div className={cn("h-9 flex items-center px-3 rounded-md border text-sm font-medium", form.found ? "text-emerald-600" : "text-amber-600")}>
                {remarkSku(form.found)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={saveForm} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
