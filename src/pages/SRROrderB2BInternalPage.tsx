import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Trash2, Loader2, Search, Copy, BarChart3, Upload, Camera, X, Eye, Download } from "lucide-react";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures";

// อัปรูป (data URL หรือ File) ขึ้น Storage → คืน public URL
async function uploadPicture(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type.split("/")[1] || "png").split("+")[0];
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MU_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(MU_BUCKET).getPublicUrl(path).data.publicUrl;
}

type BrandRow = { id?: string; code: number; brand_name: string; branch: string };

type MonthlyUsageForm = {
  barcode: string;
  sku_code: string;
  barcode_unit: string;
  product_name: string;
  uom: string;
  monthly_qty: string;
  picture: string;
  remark: string;
};

type MUDoc = {
  id: string;
  doc_no: number;
  doc_label: string;
  brand_name: string;
  branch: string;
  item_count: number;
  created_at: string;
};

const EMPTY_MU: MonthlyUsageForm = {
  barcode: "",
  sku_code: "",
  barcode_unit: "",
  product_name: "",
  uom: "",
  monthly_qty: "",
  picture: "",
  remark: "",
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function SRROrderB2BInternalPage() {
  const [activeTab, setActiveTab] = useState("brand");
  const { toast } = useToast();

  // ============================================================
  // List Brand dialog
  // ============================================================
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    setSearch("");
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("brand")
        .select("id, code, brand_name, branch")
        .order("code", { ascending: true });
      if (error) throw error;
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          code: r.code,
          brand_name: r.brand_name ?? "",
          branch: r.branch ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, { code: prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1, brand_name: "", branch: "" }]);
  };

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const duplicateRow = (idx: number) =>
    setRows((prev) => {
      const src = prev[idx];
      const newCode = prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1;
      const copy: BrandRow = { code: newCode, brand_name: src.brand_name, branch: src.branch };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });

  const updateRow = (idx: number, field: "brand_name" | "branch", value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const q = search.trim().toLowerCase();
  const visibleRows = rows
    .map((row, idx) => ({ row, idx }))
    .filter(
      ({ row }) =>
        !q ||
        row.brand_name.toLowerCase().includes(q) ||
        row.branch.toLowerCase().includes(q) ||
        String(row.code).includes(q),
    );

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = rows.map((r) => ({ code: r.code, brand_name: r.brand_name.trim(), branch: r.branch.trim() }));
      const { error } = await (supabase as any).from("brand").upsert(payload, { onConflict: "code" });
      if (error) throw error;
      toast({ title: "บันทึกสำเร็จ", description: `บันทึก ${payload.length} Brand` });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // Monthly usage — docs list + dialog
  // ============================================================
  const [docs, setDocs] = useState<MUDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const loadDocs = async () => {
    setDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("monthly_usage_doc")
        .select("id, doc_no, doc_label, brand_name, branch, item_count, created_at")
        .order("doc_no", { ascending: false });
      if (error) throw error;
      setDocs(data || []);
    } catch (e: any) {
      // ตารางยังไม่ถูกสร้าง / RLS — ไม่ขึ้น error รบกวน แค่ปล่อยว่าง
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteDoc = async (doc: MUDoc) => {
    if (!window.confirm(`ลบเอกสาร "${doc.doc_label}" และรายการทั้งหมด?`)) return;
    try {
      const { error } = await (supabase as any).from("monthly_usage_doc").delete().eq("id", doc.id);
      if (error) throw error;
      toast({ title: "ลบเอกสารแล้ว", description: doc.doc_label });
      loadDocs();
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const exportDoc = async (doc: MUDoc) => {
    try {
      const { data, error } = await (supabase as any)
        .from("monthly_usage_item")
        .select("*")
        .eq("doc_id", doc.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const items = data || [];
      if (items.length === 0) {
        toast({ title: "เอกสารว่าง ไม่มีรายการให้ export", variant: "destructive" });
        return;
      }
      const rows = items.map((it: any, i: number) => ({
        "#": i + 1,
        "ID (SKU)": it.sku_code || "",
        Barcode: it.barcode || "",
        "Barcode Unit": it.barcode_unit || "",
        "Product name": it.product_name || "",
        UOM: it.uom || "",
        "Monthly qty": it.monthly_qty ?? "",
        "Daily qty": it.daily_qty != null ? Number(it.daily_qty).toFixed(2) : "",
        Remark: it.remark || "",
        "รูป (ลิงก์)": it.picture ? "เปิดรูป" : "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // ใส่ hyperlink ในคอลัมน์รูป (คอลัมน์สุดท้าย index 9)
      const picCol = 9;
      items.forEach((it: any, i: number) => {
        if (it.picture) {
          const ref = XLSX.utils.encode_cell({ c: picCol, r: i + 1 });
          if (ws[ref]) ws[ref].l = { Target: it.picture, Tooltip: "เปิดรูป" };
        }
      });
      ws["!cols"] = [
        { wch: 4 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 36 },
        { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 12 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Monthly usage");
      const safeName = doc.doc_label.replace(/[\\/:*?"<>|]/g, "_");
      XLSX.writeFile(wb, `${safeName}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const [muOpen, setMuOpen] = useState(false);
  const [muLoading, setMuLoading] = useState(false);
  const [muSaving, setMuSaving] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocNo, setEditingDocNo] = useState<number | null>(null);
  const [brandOptions, setBrandOptions] = useState<BrandRow[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<{ id: string; brand_name: string; branch: string } | null>(null);
  const [muRows, setMuRows] = useState<MonthlyUsageForm[]>([]);
  const [lookup, setLookup] = useState<Record<number, boolean>>({});

  const loadBrandOptions = async (): Promise<BrandRow[]> => {
    try {
      const { data, error } = await (supabase as any)
        .from("brand")
        .select("id, code, brand_name, branch")
        .order("code", { ascending: true });
      if (error) throw error;
      const opts = (data || []).map((r: any) => ({
        id: r.id,
        code: r.code,
        brand_name: r.brand_name ?? "",
        branch: r.branch ?? "",
      }));
      setBrandOptions(opts);
      return opts;
    } catch {
      setBrandOptions([]);
      return [];
    }
  };

  const openMuNew = async () => {
    setEditingDocId(null);
    setEditingDocNo(null);
    setSelectedBrand(null);
    setMuRows([{ ...EMPTY_MU }]);
    setLookup({});
    setMuOpen(true);
    await loadBrandOptions();
  };

  const openMuView = async (doc: MUDoc) => {
    setMuOpen(true);
    setMuLoading(true);
    setEditingDocId(doc.id);
    setEditingDocNo(doc.doc_no);
    setLookup({});
    try {
      const opts = await loadBrandOptions();
      const found = opts.find((o) => o.brand_name === doc.brand_name && o.branch === doc.branch);
      setSelectedBrand(
        found ? { id: found.id!, brand_name: found.brand_name, branch: found.branch } : { id: "", brand_name: doc.brand_name, branch: doc.branch },
      );
      const { data, error } = await (supabase as any)
        .from("monthly_usage_item")
        .select("*")
        .eq("doc_id", doc.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setMuRows(
        (data || []).map((it: any) => ({
          barcode: it.barcode ?? "",
          sku_code: it.sku_code ?? "",
          barcode_unit: it.barcode_unit ?? "",
          product_name: it.product_name ?? "",
          uom: it.uom ?? "",
          monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
          picture: it.picture ?? "",
          remark: it.remark ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "เปิดเอกสารไม่สำเร็จ", description: e.message, variant: "destructive" });
      setMuRows([{ ...EMPTY_MU }]);
    } finally {
      setMuLoading(false);
    }
  };

  // resolve barcode → data_master (main_barcode → sku_code → barcode)
  const resolveBarcode = async (code: string) => {
    const c = code.trim();
    if (!c) return { found: false } as any;
    let sku: string | null = null;
    for (const col of ["main_barcode", "sku_code", "barcode"]) {
      const { data } = await (supabase as any).from("data_master").select("sku_code").eq(col, c).limit(1);
      if (data && data[0]?.sku_code) {
        sku = data[0].sku_code;
        break;
      }
    }
    if (!sku) return { found: false } as any;
    const sel = "sku_code, main_barcode, unit_of_measure, product_name_la, product_name_en, product_name_th";
    let { data: base } = await (supabase as any).from("data_master").select(sel).eq("sku_code", sku).eq("packing_size_qty", 1).limit(1);
    let rec = base?.[0];
    if (!rec) {
      const { data: any1 } = await (supabase as any).from("data_master").select(sel).eq("sku_code", sku).limit(1);
      rec = any1?.[0];
    }
    const name = rec?.product_name_la || rec?.product_name_en || rec?.product_name_th || "";
    return {
      found: true,
      sku_code: rec?.sku_code || sku,
      barcode_unit: rec?.main_barcode || "",
      uom: rec?.unit_of_measure || "",
      product_name: name,
    };
  };

  const handleBarcodeLookup = async (idx: number) => {
    const code = muRows[idx]?.barcode || "";
    if (!code.trim()) return;
    setLookup((p) => ({ ...p, [idx]: true }));
    try {
      const res = await resolveBarcode(code);
      setMuRows((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                sku_code: res.found ? res.sku_code : "",
                barcode_unit: res.found ? res.barcode_unit : "",
                uom: res.found ? res.uom : "",
                product_name: res.found ? res.product_name : "ไม่พบข้อมูล",
              }
            : r,
        ),
      );
    } catch (e: any) {
      toast({ title: "ค้นหาไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLookup((p) => ({ ...p, [idx]: false }));
    }
  };

  const updateMuField = (idx: number, field: keyof MonthlyUsageForm, value: string) =>
    setMuRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const addMuRow = () => setMuRows((prev) => [...prev, { ...EMPTY_MU }]);

  const duplicateMuRow = (idx: number) =>
    setMuRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next;
    });

  const removeMuRow = (idx: number) => setMuRows((prev) => prev.filter((_, i) => i !== idx));

  const handleRowFile = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        const url = await fileToDataUrl(f);
        updateMuField(idx, "picture", url);
      } catch {
        toast({ title: "อ่านรูปไม่สำเร็จ", variant: "destructive" });
      }
    }
    e.target.value = "";
  };

  const handleRowPaste = async (idx: number, e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          try {
            const url = await fileToDataUrl(f);
            updateMuField(idx, "picture", url);
          } catch {
            toast({ title: "วางรูปไม่สำเร็จ", variant: "destructive" });
          }
          break;
        }
      }
    }
  };

  const saveMuDoc = async () => {
    if (!selectedBrand || (!selectedBrand.id && !selectedBrand.brand_name)) {
      toast({ title: "กรุณาเลือก Brand ก่อน", variant: "destructive" });
      return;
    }
    const rowsToSave = muRows.filter((r) => r.barcode.trim() || r.product_name.trim() || r.monthly_qty.trim());
    if (rowsToSave.length === 0) {
      toast({ title: "ไม่มีรายการให้บันทึก", variant: "destructive" });
      return;
    }
    setMuSaving(true);
    try {
      let docNo = editingDocNo;
      if (!editingDocId) {
        const { data: maxd } = await (supabase as any)
          .from("monthly_usage_doc")
          .select("doc_no")
          .order("doc_no", { ascending: false })
          .limit(1);
        docNo = (maxd?.[0]?.doc_no || 0) + 1;
      }
      const label = `${selectedBrand.brand_name} ${selectedBrand.branch} MU-${String(docNo).padStart(4, "0")}`.trim();
      const docPayload: any = {
        doc_no: docNo,
        doc_label: label,
        brand_id: selectedBrand.id || null,
        brand_name: selectedBrand.brand_name,
        branch: selectedBrand.branch,
        item_count: rowsToSave.length,
        updated_at: new Date().toISOString(),
      };

      let docId = editingDocId;
      if (editingDocId) {
        const { error } = await (supabase as any).from("monthly_usage_doc").update(docPayload).eq("id", editingDocId);
        if (error) throw error;
        const { error: delErr } = await (supabase as any).from("monthly_usage_item").delete().eq("doc_id", editingDocId);
        if (delErr) throw delErr;
      } else {
        const { data: ins, error } = await (supabase as any).from("monthly_usage_doc").insert(docPayload).select("id").limit(1);
        if (error) throw error;
        docId = ins?.[0]?.id;
      }

      // อัปรูปที่เป็น data URL (รูปใหม่/วาง/ถ่าย) ขึ้น Storage → เก็บเป็น public URL
      // รูปที่เป็น http(s) อยู่แล้ว (เปิดจาก doc เดิม) ใช้ URL เดิม
      const pictureUrls = await Promise.all(
        rowsToSave.map(async (r) => {
          if (!r.picture) return null;
          if (r.picture.startsWith("data:")) return await uploadPicture(r.picture);
          return r.picture;
        }),
      );

      const itemsPayload = rowsToSave.map((r, i) => ({
        doc_id: docId,
        sort_order: i,
        sku_code: r.sku_code || null,
        barcode: r.barcode.trim() || null,
        barcode_unit: r.barcode_unit || null,
        product_name: r.product_name || null,
        uom: r.uom || null,
        monthly_qty: r.monthly_qty.trim() ? Number(r.monthly_qty) : null,
        daily_qty: r.monthly_qty.trim() ? Number(r.monthly_qty) / 30 : null,
        picture: pictureUrls[i],
        remark: r.remark.trim() || null,
      }));
      const { error: itErr } = await (supabase as any).from("monthly_usage_item").insert(itemsPayload);
      if (itErr) throw itErr;

      toast({ title: "บันทึกสำเร็จ", description: `${label} (${rowsToSave.length} รายการ)` });
      setMuOpen(false);
      loadDocs();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMuSaving(false);
    }
  };

  // ensure selected brand option appears even if it's not in the live list (deleted brand)
  const mergedBrandOptions =
    selectedBrand && selectedBrand.id && !brandOptions.find((o) => o.id === selectedBrand.id)
      ? [{ id: selectedBrand.id, code: 0, brand_name: selectedBrand.brand_name, branch: selectedBrand.branch }, ...brandOptions]
      : brandOptions;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-3">
          <TabsList className="h-8">
            <TabsTrigger value="brand" className="text-xs gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Brand control
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="brand" className="flex-1 overflow-auto mt-0 p-4 bg-background space-y-4">
          <div className="flex gap-2">
            <Button size="sm" onClick={openDialog} className="gap-1.5">
              <Tag className="w-4 h-4" /> List Brand
            </Button>
            <Button size="sm" variant="secondary" onClick={openMuNew} className="gap-1.5">
              <BarChart3 className="w-4 h-4" /> Monthly usage
            </Button>
          </div>

          {/* Monthly usage docs */}
          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/50">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">เอกสาร Monthly usage</span>
              {docsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="px-3 py-1.5 font-medium">Doc</th>
                  <th className="px-3 py-1.5 font-medium">Brand</th>
                  <th className="px-3 py-1.5 font-medium">Branch</th>
                  <th className="px-3 py-1.5 font-medium w-20 text-right">รายการ</th>
                  <th className="px-3 py-1.5 font-medium w-36">วันที่</th>
                  <th className="px-3 py-1.5 font-medium w-44" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{d.doc_label}</td>
                    <td className="px-3 py-1.5">{d.brand_name}</td>
                    <td className="px-3 py-1.5">{d.branch}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(d.created_at).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openMuView(d)}>
                          <Eye className="w-3.5 h-3.5" /> View
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" title="Export Excel" onClick={() => exportDoc(d)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบเอกสาร" onClick={() => deleteDoc(d)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {docs.length === 0 && !docsLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      ยังไม่มีเอกสาร — กด "Monthly usage" เพื่อสร้างใหม่
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============ List Brand dialog ============ */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>List Brand</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-auto">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8"
                  placeholder="ค้นหา Code / Brand name / Branch"
                />
              </div>

              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-20 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Brand name</th>
                    <th className="px-2 py-1.5 font-medium">Branch</th>
                    <th className="px-2 py-1.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, idx }) => (
                    <tr key={idx} className="border-b">
                      <td className="px-2 py-1 text-muted-foreground tabular-nums">{row.code}</td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.brand_name}
                          onChange={(e) => updateRow(idx, "brand_name", e.target.value)}
                          className="h-8"
                          placeholder="Brand name"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.branch}
                          onChange={(e) => updateRow(idx, "branch", e.target.value)}
                          className="h-8"
                          placeholder="Branch"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateRow(idx)}>
                            <Copy className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeRow(idx)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        ยังไม่มีข้อมูล กดปุ่ม + เพื่อเพิ่ม
                      </td>
                    </tr>
                  )}
                  {rows.length > 0 && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        ไม่พบรายการที่ค้นหา
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <Button variant="outline" size="sm" onClick={addRow} className="mt-2 gap-1.5">
                <Plus className="w-4 h-4" /> เพิ่ม
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ Monthly usage dialog ============ */}
      <Dialog open={muOpen} onOpenChange={setMuOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingDocId ? `Monthly usage — MU-${String(editingDocNo || 0).padStart(4, "0")}` : "Monthly usage (สร้างใหม่)"}
            </DialogTitle>
          </DialogHeader>

          {muLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto space-y-3">
              {/* Brand selector */}
              <div className="space-y-1.5">
                <Label className="text-xs">Brand</Label>
                <Select
                  value={selectedBrand?.id || ""}
                  onValueChange={(id) => {
                    const o = mergedBrandOptions.find((b) => b.id === id);
                    if (o) setSelectedBrand({ id: o.id!, brand_name: o.brand_name, branch: o.branch });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="เลือก Brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {mergedBrandOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id!}>
                        {b.brand_name} — {b.branch}
                      </SelectItem>
                    ))}
                    {mergedBrandOptions.length === 0 && (
                      <div className="px-2 py-3 text-xs text-muted-foreground">ยังไม่มี Brand — เพิ่มใน List Brand ก่อน</div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Item cards */}
              {muRows.map((row, idx) => {
                const daily = row.monthly_qty.trim() && !isNaN(Number(row.monthly_qty)) ? (Number(row.monthly_qty) / 30).toFixed(2) : "";
                return (
                  <div key={idx} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">#{idx + 1}</span>
                      <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateMuRow(idx)}>
                          <Copy className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeMuRow(idx)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Barcode (คีย์เอง)</Label>
                          <Input
                            value={row.barcode}
                            onChange={(e) => updateMuField(idx, "barcode", e.target.value)}
                            onBlur={() => handleBarcodeLookup(idx)}
                            onKeyDown={(e) => e.key === "Enter" && handleBarcodeLookup(idx)}
                            className="h-8"
                            placeholder="คีย์ barcode / รหัส"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] flex items-center gap-1">
                            ID (SKU) {lookup[idx] && <Loader2 className="w-3 h-3 animate-spin" />}
                          </Label>
                          <Input value={row.sku_code} readOnly className="h-8 bg-muted/50" placeholder="auto" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Barcode Unit</Label>
                          <Input value={row.barcode_unit} readOnly className="h-8 bg-muted/50" placeholder="auto" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">UOM</Label>
                          <Input value={row.uom} readOnly className="h-8 bg-muted/50" placeholder="auto" />
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-[11px]">Product name</Label>
                          <Input
                            value={row.product_name}
                            readOnly
                            className={`h-8 bg-muted/50 ${row.product_name === "ไม่พบข้อมูล" ? "text-destructive" : ""}`}
                            placeholder="auto"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Monthly qty</Label>
                          <Input
                            type="number"
                            value={row.monthly_qty}
                            onChange={(e) => updateMuField(idx, "monthly_qty", e.target.value)}
                            className="h-8"
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Daily qty (÷30)</Label>
                          <Input value={daily} readOnly className="h-8 bg-muted/50" placeholder="auto" />
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-[11px]">Remark</Label>
                          <Textarea
                            value={row.remark}
                            onChange={(e) => updateMuField(idx, "remark", e.target.value)}
                            className="min-h-[36px] text-sm"
                            rows={1}
                            placeholder="หมายเหตุ"
                          />
                        </div>
                      </div>

                      {/* Picture */}
                      <div className="w-40 shrink-0 space-y-1.5">
                        <Label className="text-[11px]">Picture</Label>
                        <div
                          tabIndex={0}
                          onPaste={(e) => handleRowPaste(idx, e)}
                          className="relative w-40 h-40 border rounded-md flex items-center justify-center bg-muted/30 overflow-hidden outline-none focus:ring-2 focus:ring-primary"
                          title="คลิกแล้ว Ctrl+V เพื่อวางรูป"
                        >
                          {row.picture ? (
                            <>
                              <img src={row.picture} alt="picture" className="w-full h-full object-contain" />
                              <button
                                type="button"
                                onClick={() => updateMuField(idx, "picture", "")}
                                className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 hover:bg-background"
                                title="ลบรูป"
                              >
                                <X className="w-4 h-4 text-destructive" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground px-2 text-center">คลิกแล้ว Ctrl+V<br />หรือเลือกด้านล่าง</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <label className="flex-1 inline-flex items-center justify-center gap-1 h-7 px-2 text-xs border rounded-md cursor-pointer hover:bg-muted">
                            <Upload className="w-3.5 h-3.5" /> นำเข้า
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRowFile(idx, e)} />
                          </label>
                          <label className="flex-1 inline-flex items-center justify-center gap-1 h-7 px-2 text-xs border rounded-md cursor-pointer hover:bg-muted">
                            <Camera className="w-3.5 h-3.5" /> ถ่ายรูป
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleRowFile(idx, e)} />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button variant="outline" size="sm" onClick={addMuRow} className="gap-1.5">
                <Plus className="w-4 h-4" /> เพิ่มรายการ
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMuOpen(false)} disabled={muSaving}>
              Cancel
            </Button>
            <Button onClick={saveMuDoc} disabled={muSaving || muLoading}>
              {muSaving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
