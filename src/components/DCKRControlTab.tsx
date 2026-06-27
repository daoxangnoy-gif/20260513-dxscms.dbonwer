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
import BarcodeScanButton from "@/components/BarcodeScanButton";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures";

async function uploadPicture(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type.split("/")[1] || "png").split("+")[0];
  const path = `dckr/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MU_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(MU_BUCKET).getPublicUrl(path).data.publicUrl;
}

// บรรทัด UOM (raw)
type UomLine = { main_barcode: string; barcode: string; uom: string; uom_qty: string };
// หัวสินค้า (form ใน dialog)
type ItemForm = {
  barcode_key: string;
  sku_code: string;
  product_name_la: string;
  product_name_en: string;
  cost: string;
  picture: string;
  picture_brand: string;
  found: boolean;
  uoms: UomLine[];
};
// แถว flat ในตาราง (1 บรรทัด UOM)
type FlatRow = ItemForm & { item_id: string; uom_id: string } & UomLine;

const newUom = (): UomLine => ({ main_barcode: "", barcode: "", uom: "", uom_qty: "" });
const newForm = (): ItemForm => ({
  barcode_key: "", sku_code: "", product_name_la: "", product_name_en: "",
  cost: "", picture: "", picture_brand: "", found: false, uoms: [newUom()],
});

const DCKR_SUB_LS = "dckr_sub_tab";
const remarkSku = (found: boolean) => (found ? "Data odoo" : "Data คีเอง");

// resolve barcode → หัวสินค้า + UOM ทุกบรรทัดของ SKU (raw จาก data_master)
async function resolveItem(code: string): Promise<{ found: boolean } & Partial<ItemForm>> {
  const c = code.trim();
  if (!c) return { found: false };
  let sku: string | null = null;
  for (const col of ["main_barcode", "sku_code", "barcode"]) {
    const { data } = await (supabase as any).from("data_master").select("sku_code").eq(col, c).limit(1);
    if (data?.[0]?.sku_code) { sku = data[0].sku_code; break; }
  }
  if (!sku) return { found: false };
  const { data: rows } = await (supabase as any)
    .from("data_master")
    .select("main_barcode, barcode, unit_of_measure, packing_size_qty, product_name_la, product_name_en")
    .eq("sku_code", sku);
  const all: any[] = rows || [];
  const num = (v: any) => (v == null || v === "" ? Infinity : Number(v));
  const uoms: UomLine[] = all
    .map((r) => ({
      main_barcode: r.main_barcode || "",
      barcode: r.barcode || "",
      uom: r.unit_of_measure || "",
      uom_qty: r.packing_size_qty == null ? "" : String(r.packing_size_qty),
    }))
    .sort((a, b) => num(a.uom_qty) - num(b.uom_qty));
  const nameSrc = all.find((r) => num(r.packing_size_qty) === 1) || all[0] || {};
  // รูปจาก Monthly usage
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
    product_name_la: nameSrc.product_name_la || "",
    product_name_en: nameSrc.product_name_en || "",
    picture, picture_brand,
    uoms: uoms.length ? uoms : [newUom()],
  };
}

export default function DCKRControlTab() {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState(() => localStorage.getItem(DCKR_SUB_LS) || "data");
  const setSub = (v: string) => { setSubTab(v); localStorage.setItem(DCKR_SUB_LS, v); };

  const [rows, setRows] = useState<FlatRow[]>([]);   // flat (1 แถว = 1 UOM)
  const [, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // uom_id ที่เลือก

  const loadItems = async () => {
    setLoading(true);
    try {
      const [itemsRes, uomRes] = await Promise.all([
        (supabase as any).from("dckr_item").select("*").order("created_at", { ascending: true }),
        (supabase as any).from("dckr_item_uom").select("*").order("sort_order", { ascending: true }),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      const uomByItem = new Map<string, any[]>();
      for (const u of (uomRes.data || []) as any[]) { const a = uomByItem.get(u.item_id) || []; a.push(u); uomByItem.set(u.item_id, a); }
      const flat: FlatRow[] = [];
      for (const d of (itemsRes.data || []) as any[]) {
        const header: ItemForm = {
          barcode_key: d.barcode_key ?? "", sku_code: d.sku_code ?? "",
          product_name_la: d.product_name_la ?? "", product_name_en: d.product_name_en ?? "",
          cost: d.cost ?? "", picture: d.picture ?? "", picture_brand: d.picture_brand ?? "",
          found: !!d.found, uoms: [],
        };
        const lines = uomByItem.get(d.id) || [];
        if (lines.length === 0) {
          flat.push({ ...header, item_id: d.id, uom_id: "", main_barcode: "", barcode: "", uom: "", uom_qty: "" });
        } else {
          for (const l of lines) flat.push({ ...header, item_id: d.id, uom_id: l.id, main_barcode: l.main_barcode ?? "", barcode: l.barcode ?? "", uom: l.uom ?? "", uom_qty: l.uom_qty == null ? "" : String(l.uom_qty) });
        }
      }
      setRows(flat);
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadItems(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ----- Add dialog -----
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<ItemForm>(newForm());
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPic, setUploadingPic] = useState(false);
  const setF = (k: keyof ItemForm, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const setUom = (i: number, k: keyof UomLine, v: string) => setForm((p) => ({ ...p, uoms: p.uoms.map((u, idx) => (idx === i ? { ...u, [k]: v } : u)) }));
  const addUomRow = () => setForm((p) => ({ ...p, uoms: [...p.uoms, newUom()] }));
  const delUomRow = (i: number) => setForm((p) => ({ ...p, uoms: p.uoms.filter((_, idx) => idx !== i) }));

  const openAdd = () => { setForm(newForm()); setAddOpen(true); };

  const resolveCode = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setResolving(true);
    try {
      const res = await resolveItem(code);
      if (!res.found) {
        toast({ title: "ไม่พบใน Data Master", description: "ล้างข้อมูลเดิม — คีย์เองได้", variant: "destructive" });
        // เคลียร์ข้อมูลที่ดึงมาก่อนหน้า (กันค่าค้างจาก barcode เดิมที่เคยเจอ) แต่คง Key Barcode
        setForm({ ...newForm(), barcode_key: code });
        return;
      }
      setForm((p) => ({ ...p, ...res, barcode_key: code } as ItemForm));
    } catch (e: any) {
      toast({ title: "ดึงข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };
  const resolveForm = () => resolveCode(form.barcode_key);
  // สแกนจากกล้อง → ใส่ Key Barcode + ดึงข้อมูลทันที
  const onScanned = (code: string) => { setForm((p) => ({ ...p, barcode_key: code })); resolveCode(code); };

  const uploadAndSet = async (file: File) => {
    setUploadingPic(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
      const url = await uploadPicture(dataUrl);
      setForm((p) => ({ ...p, picture: url, picture_brand: "" }));
    } catch (e: any) {
      toast({ title: "อัปรูปไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setUploadingPic(false); }
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) { e.preventDefault(); uploadAndSet(file); }
  };

  const saveForm = async () => {
    if (!form.barcode_key.trim() && !form.sku_code.trim()) {
      toast({ title: "กรุณาคีย์ Barcode Key หรือ Sku code", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const header = {
        barcode_key: form.barcode_key, sku_code: form.sku_code,
        product_name_la: form.product_name_la, product_name_en: form.product_name_en,
        cost: form.cost, picture: form.picture, picture_brand: form.picture_brand, found: form.found,
      };
      const { data, error } = await (supabase as any).from("dckr_item").insert(header).select("id").limit(1);
      if (error) throw error;
      const itemId = data?.[0]?.id;
      const lines = form.uoms
        .filter((u) => u.main_barcode.trim() || u.barcode.trim() || u.uom.trim() || u.uom_qty.trim())
        .map((u, i) => ({ item_id: itemId, main_barcode: u.main_barcode || null, barcode: u.barcode || null, uom: u.uom || null, uom_qty: u.uom_qty.trim() ? Number(u.uom_qty) : null, sort_order: i }));
      if (lines.length) {
        const { error: ue } = await (supabase as any).from("dckr_item_uom").insert(lines);
        if (ue) throw ue;
      }
      setAddOpen(false);
      toast({ title: "เพิ่มสินค้าแล้ว" });
      loadItems();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  // ----- selection (line-level) -----
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectableRows = rows.filter((r) => r.uom_id);
  const allChecked = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.uom_id));
  const toggleAll = (c: boolean) => setSelected(c ? new Set(selectableRows.map((r) => r.uom_id)) : new Set());

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    try {
      // ลบทั้ง item ถ้าทุกบรรทัดของ item ถูกเลือก, ไม่งั้นลบเฉพาะบรรทัด
      const linesByItem = new Map<string, string[]>();      // item_id → uom_id ทั้งหมด
      const selByItem = new Map<string, string[]>();        // item_id → uom_id ที่เลือก
      for (const r of rows) {
        if (!r.uom_id) continue;
        (linesByItem.get(r.item_id) || linesByItem.set(r.item_id, []).get(r.item_id)!).push(r.uom_id);
        if (selected.has(r.uom_id)) (selByItem.get(r.item_id) || selByItem.set(r.item_id, []).get(r.item_id)!).push(r.uom_id);
      }
      const itemsToDelete: string[] = [];
      const linesToDelete: string[] = [];
      for (const [itemId, sel] of selByItem) {
        const all = linesByItem.get(itemId) || [];
        if (sel.length >= all.length) itemsToDelete.push(itemId);
        else linesToDelete.push(...sel);
      }
      if (linesToDelete.length) { const { error } = await (supabase as any).from("dckr_item_uom").delete().in("id", linesToDelete); if (error) throw error; }
      if (itemsToDelete.length) { const { error } = await (supabase as any).from("dckr_item").delete().in("id", itemsToDelete); if (error) throw error; } // cascade ลบ uom
      setSelected(new Set());
      loadItems();
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const exportSelected = () => {
    const list = rows.filter((r) => r.uom_id && selected.has(r.uom_id));
    if (list.length === 0) { toast({ title: "เลือกรายการก่อน", variant: "destructive" }); return; }
    const out = list.map((r) => ({
      "Key Barcode": r.barcode_key, "Sku code": r.sku_code,
      "Product name En": r.product_name_en, "Product name LA": r.product_name_la,
      "Cost": r.cost, "Mainbarcode": r.main_barcode, "Barcode": r.barcode,
      "UOM": r.uom, "UOM Qty": r.uom_qty, "Picture": r.picture, "Remark Sku": remarkSku(r.found),
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DCKR Data");
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    XLSX.writeFile(wb, `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}-DCKR-Data.xlsx`);
  };

  const COLS: { key: keyof FlatRow; label: string; w: number; right?: boolean }[] = [
    { key: "barcode_key", label: "Key Barcode", w: 140 },
    { key: "sku_code", label: "Sku code", w: 110 },
    { key: "product_name_en", label: "Product name En", w: 210 },
    { key: "product_name_la", label: "Product name LA", w: 210 },
    { key: "cost", label: "Cost", w: 90, right: true },
    { key: "main_barcode", label: "Mainbarcode", w: 150 },
    { key: "barcode", label: "Barcode", w: 150 },
    { key: "uom", label: "UOM", w: 80 },
    { key: "uom_qty", label: "UOM Qty", w: 80, right: true },
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
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAdd}><Plus className="w-3.5 h-3.5" /> Add new item</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportSelected} disabled={selected.size === 0}><Download className="w-3.5 h-3.5" /> Export ({selected.size})</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive border-destructive/40" onClick={deleteSelected} disabled={selected.size === 0}><Trash2 className="w-3.5 h-3.5" /> ลบที่เลือก ({selected.size})</Button>
          <span className="text-xs text-muted-foreground ml-auto">{rows.length} แถว</span>
        </div>

        <div className="border rounded-lg flex-1 overflow-auto min-h-0">
          <table className="text-sm border-collapse whitespace-nowrap table-fixed" style={{ width: 40 + 48 + 90 + COLS.reduce((s, c) => s + c.w, 0) + 130 }}>
            <colgroup>
              <col style={{ width: 40 }} /><col style={{ width: 48 }} /><col style={{ width: 90 }} />
              {COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}
              <col style={{ width: 130 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
                <th><input type="checkbox" className="h-4 w-4 align-middle" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /></th>
                <th>#</th>
                <th>Picture</th>
                {COLS.map((c) => <th key={c.key} className={c.right ? "text-right" : ""}>{c.label}</th>)}
                <th>Remark SKU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.uom_id || `nouom-${r.item_id}`} className={cn("border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1.5 [&_td]:overflow-hidden [&_td]:text-ellipsis", r.uom_id && selected.has(r.uom_id) && "bg-primary/5")}>
                  <td>{r.uom_id ? <input type="checkbox" className="h-4 w-4 align-middle" checked={selected.has(r.uom_id)} onChange={() => toggle(r.uom_id)} /> : null}</td>
                  <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                  <td>
                    {r.picture ? (
                      <a href={r.picture} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-0.5 w-fit">
                        <img src={r.picture} alt="" className="w-12 h-12 object-contain rounded border border-border" />
                        {r.picture_brand && <span className="text-[10px] text-muted-foreground leading-tight text-center max-w-[72px] truncate">{r.picture_brand}</span>}
                      </a>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className={c.right ? "text-right tabular-nums" : "truncate"} title={String(r[c.key] ?? "")}>
                      {r[c.key] === "" || r[c.key] == null ? "-" : String(r[c.key])}
                    </td>
                  ))}
                  <td><span className={cn("text-xs font-medium", r.found ? "text-emerald-600" : "text-amber-600")}>{remarkSku(r.found)}</span></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={COLS.length + 4} className="px-3 py-8 text-center text-muted-foreground">กด "Add new item" เพื่อเพิ่มสินค้า</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {["take_in", "take_out", "count_stock", "stock_movement", "location"].map((t) => (
        <TabsContent key={t} value={t} className="mt-0 flex-1 data-[state=active]:flex items-center justify-center text-sm text-muted-foreground">
          ส่วนนี้จะออกแบบภายหลัง
        </TabsContent>
      ))}

      {/* ===== Add Dialog (Raw data) ===== */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[760px] max-w-[95vw] max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>เพิ่มสินค้า (DC KR)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Key Barcode + ดึง */}
            <div className="space-y-1">
              <Label className="text-xs">Key Barcode</Label>
              <div className="flex items-center gap-1.5">
                <Input value={form.barcode_key} onChange={(e) => setF("barcode_key", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolveForm(); } }} placeholder="คีย์ / สแกน barcode แล้วกด Enter" className="h-9" />
                <BarcodeScanButton onScan={onScanned} className="h-9 w-9 p-0 shrink-0" />
                <Button size="sm" variant="outline" className="h-9 gap-1 shrink-0" onClick={resolveForm} disabled={resolving}>{resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} ดึง</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Product name En</Label><Input value={form.product_name_en} onChange={(e) => setF("product_name_en", e.target.value)} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Product name LA</Label><Input value={form.product_name_la} onChange={(e) => setF("product_name_la", e.target.value)} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Cost</Label><Input value={form.cost} disabled className="h-9 bg-muted/40" placeholder="-" /></div>
              <div className="space-y-1"><Label className="text-xs">Sku code</Label><Input value={form.sku_code} onChange={(e) => setF("sku_code", e.target.value)} className="h-9" /></div>
            </div>

            {/* ตาราง UOM (raw) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">UOM (Mainbarcode / Barcode / UOM / UOM Qty)</Label>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1" onClick={addUomRow}><Plus className="w-3 h-3" /> เพิ่มบรรทัด</Button>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/50 text-muted-foreground [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium text-left">
                    <th>Mainbarcode</th><th>Barcode</th><th className="w-20">UOM</th><th className="w-20 text-right">UOM Qty</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {form.uoms.map((u, i) => (
                      <tr key={i} className="border-t [&_td]:px-1.5 [&_td]:py-1">
                        <td><Input value={u.main_barcode} onChange={(e) => setUom(i, "main_barcode", e.target.value)} className="h-8 text-xs" /></td>
                        <td><Input value={u.barcode} onChange={(e) => setUom(i, "barcode", e.target.value)} className="h-8 text-xs" /></td>
                        <td><Input value={u.uom} onChange={(e) => setUom(i, "uom", e.target.value)} className="h-8 text-xs" placeholder="Unit/Pack/Box" /></td>
                        <td><Input type="number" value={u.uom_qty} onChange={(e) => setUom(i, "uom_qty", e.target.value)} className="h-8 text-xs text-right" /></td>
                        <td><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delUomRow(i)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></td>
                      </tr>
                    ))}
                    {form.uoms.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-center text-muted-foreground">กด "เพิ่มบรรทัด" เพื่อใส่ UOM</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Picture */}
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
                <div onPaste={handlePaste} tabIndex={0} className="border border-dashed rounded-md p-3 text-xs text-muted-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary">
                  {uploadingPic ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังอัป...</span> : (
                    <>คลิกที่นี่แล้ววางรูป (Ctrl+V) หรือ <label className="text-primary underline cursor-pointer">เลือกไฟล์<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSet(f); e.target.value = ""; }} /></label></>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Remark Sku</Label>
              <div className={cn("h-9 flex items-center px-3 rounded-md border text-sm font-medium", form.found ? "text-emerald-600" : "text-amber-600")}>{remarkSku(form.found)}</div>
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
