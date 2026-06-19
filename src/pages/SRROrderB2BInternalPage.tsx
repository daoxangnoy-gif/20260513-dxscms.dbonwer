import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Trash2, Loader2, Search, Copy, BarChart3, Upload, Camera, X, Eye, Download, Pencil, ChevronsUpDown, Check, FileSpreadsheet, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures";

// ซ่อนคอลัมน์ Branch + ปุ่ม Duplicate ใน dialog List Brand ชั่วคราว
// เปิดใช้ทีหลังได้ด้วยการเปลี่ยนเป็น true
const SHOW_BRAND_BRANCH = false;
const SHOW_BRAND_DUPLICATE = false;

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
  // คอลัมน์อ้างอิงจาก data_master / vendor_master (derive ตอนแสดงผล ไม่ได้เก็บลง DB)
  division_group: string;
  division: string;
  department: string;
  buying_status: string;
  vendor_origin: string;
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
  division_group: "",
  division: "",
  department: "",
  buying_status: "",
  vendor_origin: "",
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// คอลัมน์ของตาราง Monthly usage (1 item = 1 แถว) + ความกว้างเริ่มต้น (px) — ลากปรับได้
const MU_COLS = [
  { key: "idx", label: "#", def: 44, min: 36 },
  { key: "dgroup", label: "Division Group", def: 130, min: 90 },
  { key: "division", label: "Division", def: 120, min: 90 },
  { key: "dept", label: "Department", def: 130, min: 90 },
  { key: "bstatus", label: "Buying Status", def: 120, min: 90 },
  { key: "vorigin", label: "Vendor Origin", def: 180, min: 100 },
  { key: "barcode", label: "Barcode (คีย์เอง)", def: 150, min: 90 },
  { key: "sku", label: "ID (SKU)", def: 120, min: 80 },
  { key: "bunit", label: "Barcode Unit", def: 140, min: 90 },
  { key: "uom", label: "UOM", def: 80, min: 60 },
  { key: "pname", label: "Product name", def: 240, min: 120 },
  { key: "mqty", label: "Monthly qty", def: 110, min: 80 },
  { key: "dqty", label: "Daily qty (÷30)", def: 110, min: 70 },
  { key: "pic", label: "Picture", def: 150, min: 120 },
  { key: "remark", label: "Remark", def: 200, min: 100 },
  { key: "act", label: "", def: 74, min: 64 },
] as const;
const MU_COL_KEY = "mu_col_widths_v1";
const MU_VIS_KEY = "mu_col_visible_v3";
// คอลัมน์ที่ติกซ่อน/แสดงได้ (ยกเว้น # และ action)
const MU_TOGGLE_COLS = MU_COLS.filter((c) => c.key !== "idx" && c.key !== "act");
// คอลัมน์อ้างอิงที่ default ซ่อนไว้ (อยากดูค่อยติกเอง)
const MU_DEFAULT_HIDDEN = new Set(["dgroup", "division", "dept", "bstatus", "vorigin"]);

// ลำดับคอลัมน์ที่ใช้ keyboard navigation (มี input) — index = data-c
const MU_NAV_COLS = ["barcode", "sku", "bunit", "uom", "pname", "mqty", "dqty", "remark"] as const;

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
    // กันชื่อ Brand ซ้ำ (ไม่สนตัวพิมพ์ใหญ่/เล็ก, ตัดช่องว่างหน้า-หลัง)
    const names = rows.map((r) => r.brand_name.trim().toLowerCase());
    const dupIdx = names.findIndex((n, i) => n !== "" && names.indexOf(n) !== i);
    if (dupIdx !== -1) {
      toast({ title: "มีชื่อ Brand ซ้ำ", description: `"${rows[dupIdx].brand_name.trim()}" ถูกใช้มากกว่า 1 ครั้ง — แก้ให้ไม่ซ้ำก่อนบันทึก`, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = rows.map((r) => ({ code: r.code, brand_name: r.brand_name.trim(), branch: r.branch.trim() }));
      // upsert แถวที่เหลือในจอ
      if (payload.length) {
        const { error } = await (supabase as any).from("brand").upsert(payload, { onConflict: "code" });
        if (error) throw error;
      }
      // ลบ Brand ที่ถูกลบออกจากจอ (code ที่ไม่อยู่ในรายการปัจจุบัน) — ให้ DB ตรงกับจอ
      const keepCodes = rows.map((r) => r.code);
      const delQ = (supabase as any).from("brand").delete();
      const { error: delErr } = await (keepCodes.length
        ? delQ.not("code", "in", `(${keepCodes.join(",")})`)
        : delQ.gte("code", -2147483648));
      if (delErr) throw delErr;
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
  const [noOdooMap, setNoOdooMap] = useState<Record<string, number>>({}); // doc_id -> จำนวน SKU ที่ resolve ไม่เจอ
  const vendorOriginMapRef = useRef<Record<string, string>>({}); // vendor_code -> vendor_origin (Laos/Thailand) จาก vendor_master

  // โหลด vendor_origin จาก vendor_master ครั้งเดียว (vendor_code -> origin)
  useEffect(() => {
    (async () => {
      const m: Record<string, string> = {};
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("vendor_master")
          .select("vendor_code, vendor_origin")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const v of data as any[]) { if (v.vendor_code) m[String(v.vendor_code)] = v.vendor_origin || ""; }
        if (data.length < PAGE) break;
      }
      vendorOriginMapRef.current = m;
    })();
  }, []);

  const loadDocs = async () => {
    setDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("monthly_usage_doc")
        .select("id, doc_no, doc_label, brand_name, branch, item_count, created_at")
        .order("doc_no", { ascending: false });
      if (error) throw error;
      setDocs(data || []);
      // นับ SKU No Odoo (sku_code ว่าง) ต่อ doc
      const ids = (data || []).map((d: any) => d.id);
      if (ids.length) {
        const { data: items } = await (supabase as any)
          .from("monthly_usage_item")
          .select("doc_id, sku_code")
          .in("doc_id", ids);
        const m: Record<string, number> = {};
        for (const it of (items || []) as any[]) {
          if (!String(it.sku_code ?? "").trim()) m[it.doc_id] = (m[it.doc_id] || 0) + 1;
        }
        setNoOdooMap(m);
      } else {
        setNoOdooMap({});
      }
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
      // enrich ข้อมูลอ้างอิงจาก data_master ตาม sku_code
      const skus = [...new Set(items.map((it: any) => it.sku_code).filter(Boolean))] as string[];
      const dmMap: Record<string, any> = {};
      if (skus.length) {
        const { data: dm } = await (supabase as any)
          .from("data_master")
          .select("sku_code, division_group, division, department, buying_status, vendor_code, vendor_display_name")
          .in("sku_code", skus);
        for (const d of (dm || []) as any[]) { if (d.sku_code && !dmMap[d.sku_code]) dmMap[d.sku_code] = d; }
      }
      const rows = items.map((it: any, i: number) => {
        const d = dmMap[it.sku_code] || {};
        const vendorOrigin = (d.vendor_code && vendorOriginMapRef.current[d.vendor_code]) || "";
        return {
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
          "Division Group": d.division_group || "",
          Division: d.division || "",
          Department: d.department || "",
          "Buying Status": d.buying_status || "",
          "Vendor Origin": vendorOrigin,
        };
      });
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
        { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 22 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Monthly usage");
      const safeName = doc.doc_label.replace(/[\\/:*?"<>|]/g, "_");
      XLSX.writeFile(wb, `${safeName}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const [muOpen, setMuOpen] = useState(false);   // editor panel (in-app tab "แสดงข้อมูล") เปิดอยู่ไหม
  const [muReadOnly, setMuReadOnly] = useState(false); // true = โหมดดู, false = โหมดแก้ไข
  const [dupDocPrompt, setDupDocPrompt] = useState<MUDoc | null>(null); // เอกสารเดิมของ brand ที่เลือก (ถ้ามี)
  const [brandPickerOpen, setBrandPickerOpen] = useState(false); // เปิด dropdown ค้นหา Brand
  const [muImporting, setMuImporting] = useState(false); // กำลังนำเข้า Excel
  const [muLoading, setMuLoading] = useState(false);
  const [muSaving, setMuSaving] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocNo, setEditingDocNo] = useState<number | null>(null);
  const [editingDocLabel, setEditingDocLabel] = useState<string | null>(null); // เก็บชื่อ doc เดิมไว้ ตอนแก้ไขจะไม่เปลี่ยนชื่อ
  const [brandOptions, setBrandOptions] = useState<BrandRow[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<{ id: string; brand_name: string; branch: string } | null>(null);
  const [muRows, setMuRows] = useState<MonthlyUsageForm[]>([]);
  const [lookup, setLookup] = useState<Record<number, boolean>>({});

  // ความกว้างคอลัมน์ (จำไว้ใน localStorage)
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(MU_COL_KEY);
      if (raw) return { ...Object.fromEntries(MU_COLS.map((c) => [c.key, c.def])), ...JSON.parse(raw) };
    } catch {}
    return Object.fromEntries(MU_COLS.map((c) => [c.key, c.def]));
  });
  useEffect(() => {
    try {
      localStorage.setItem(MU_COL_KEY, JSON.stringify(colW));
    } catch {}
  }, [colW]);

  // คอลัมน์ที่แสดง (ติกเลือกได้แบบ SRR) — จำค่าใน localStorage
  const [visibleMuCols, setVisibleMuCols] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(MU_VIS_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    // ค่าเริ่มต้น: แสดงทุกคอลัมน์ ยกเว้น 5 คอลัมน์อ้างอิงใหม่ (อยากดูค่อยติกเอง)
    return new Set(MU_TOGGLE_COLS.filter((c) => !MU_DEFAULT_HIDDEN.has(c.key)).map((c) => c.key));
  });
  useEffect(() => {
    try {
      localStorage.setItem(MU_VIS_KEY, JSON.stringify([...visibleMuCols]));
    } catch {}
  }, [visibleMuCols]);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  // คอลัมน์ที่จะ render จริง (idx + act แสดงเสมอ)
  const muShownCols = MU_COLS.filter((c) => c.key === "idx" || c.key === "act" || visibleMuCols.has(c.key));
  const isColShown = (key: string) => key === "idx" || key === "act" || visibleMuCols.has(key);

  const startColResize = (key: string, minW: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colW[key] ?? 100;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(minW, startW + ev.clientX - startX);
      setColW((prev) => ({ ...prev, [key]: w }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const muTotalW = muShownCols.reduce((s, c) => s + (colW[c.key] ?? c.def), 0);

  // ===== keyboard navigation ในตาราง (Enter / ลูกศร ขึ้น-ลง-ซ้าย-ขวา; Tab = default) =====
  const muTableRef = useRef<HTMLDivElement>(null);
  const muImportRef = useRef<HTMLInputElement>(null);

  const focusCell = (r: number, c: number) => {
    const cc = Math.max(0, Math.min(MU_NAV_COLS.length - 1, c));
    const el = muTableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${cc}"]`);
    if (el) {
      el.focus();
      try {
        el.select();
      } catch {}
    }
  };

  const handleCellKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const el = e.currentTarget;
    // ตำแหน่ง caret (input type=number เข้าถึง selectionStart ไม่ได้ → ถือว่าอยู่สุดขอบทั้งสองด้าน)
    let atStart = true;
    let atEnd = true;
    try {
      const ss = el.selectionStart;
      if (ss !== null) {
        atStart = ss <= 0;
        atEnd = ss >= el.value.length;
      }
    } catch {}

    if (e.key === "Enter") {
      e.preventDefault();
      if (c === 0) handleBarcodeLookup(r); // คอลัมน์ Barcode → resolve ก่อนเลื่อน
      focusCell(r + 1, c);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(r + 1, c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (e.key === "ArrowRight") {
      if (atEnd) {
        e.preventDefault();
        focusCell(r, c + 1);
      }
    } else if (e.key === "ArrowLeft") {
      if (atStart) {
        e.preventDefault();
        focusCell(r, c - 1);
      }
    }
  };

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
    setEditingDocLabel(null);
    setSelectedBrand(null);
    setMuRows([{ ...EMPTY_MU }]);
    setLookup({});
    setMuReadOnly(false);
    setMuOpen(true);
    setActiveTab("view");
    await loadBrandOptions();
  };

  const openMuView = async (doc: MUDoc, readOnly = true) => {
    setMuOpen(true);
    setMuReadOnly(readOnly);
    setActiveTab("view");
    setMuLoading(true);
    setEditingDocId(doc.id);
    setEditingDocNo(doc.doc_no);
    setEditingDocLabel(doc.doc_label);
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
      // เติมคอลัมน์อ้างอิงจาก data_master (Division/Department/Buying Status/Vendor Origin) ตาม sku_code
      const skus = [...new Set((data || []).map((it: any) => it.sku_code).filter(Boolean))] as string[];
      const dmMap: Record<string, any> = {};
      if (skus.length) {
        const { data: dm } = await (supabase as any)
          .from("data_master")
          .select("sku_code, division_group, division, department, buying_status, vendor_code, vendor_display_name")
          .in("sku_code", skus);
        for (const d of (dm || []) as any[]) { if (d.sku_code && !dmMap[d.sku_code]) dmMap[d.sku_code] = d; }
      }
      setMuRows(
        (data || []).map((it: any) => {
          const d = dmMap[it.sku_code] || {};
          const vendorOrigin = (d.vendor_code && vendorOriginMapRef.current[d.vendor_code]) || "";
          return {
            barcode: it.barcode ?? "",
            sku_code: it.sku_code ?? "",
            barcode_unit: it.barcode_unit ?? "",
            product_name: it.product_name ?? "",
            uom: it.uom ?? "",
            monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
            picture: it.picture ?? "",
            remark: it.remark ?? "",
            division_group: d.division_group ?? "",
            division: d.division ?? "",
            department: d.department ?? "",
            buying_status: d.buying_status ?? "",
            vendor_origin: vendorOrigin,
          };
        }),
      );
    } catch (e: any) {
      toast({ title: "เปิดเอกสารไม่สำเร็จ", description: e.message, variant: "destructive" });
      setMuRows([{ ...EMPTY_MU }]);
    } finally {
      setMuLoading(false);
    }
  };

  // เลือก Brand — ตอนสร้างใหม่ ถ้า brand นี้มี doc แล้ว เด้งถามให้เปิดแก้ไขเอกสารเดิม
  const handleBrandSelect = async (id: string) => {
    const o = mergedBrandOptions.find((b) => b.id === id);
    if (!o) return;
    setSelectedBrand({ id: o.id!, brand_name: o.brand_name, branch: o.branch });
    if (editingDocId) return; // กำลังแก้ไขเอกสารเดิมอยู่ ไม่ต้องเช็ค
    const { data } = await (supabase as any)
      .from("monthly_usage_doc")
      .select("id, doc_no, doc_label, brand_name, branch, item_count, created_at")
      .eq("brand_name", o.brand_name)
      .eq("branch", o.branch)
      .limit(1);
    if (data && data.length) setDupDocPrompt(data[0]);
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
    const sel = "sku_code, main_barcode, unit_of_measure, product_name_la, product_name_en, product_name_th, division_group, division, department, buying_status, vendor_code, vendor_display_name";
    let { data: base } = await (supabase as any).from("data_master").select(sel).eq("sku_code", sku).eq("packing_size_qty", 1).limit(1);
    let rec = base?.[0];
    if (!rec) {
      const { data: any1 } = await (supabase as any).from("data_master").select(sel).eq("sku_code", sku).limit(1);
      rec = any1?.[0];
    }
    const name = rec?.product_name_la || rec?.product_name_en || rec?.product_name_th || "";
    const vendorOrigin = (rec?.vendor_code && vendorOriginMapRef.current[rec.vendor_code]) || "";
    return {
      found: true,
      sku_code: rec?.sku_code || sku,
      barcode_unit: rec?.main_barcode || "",
      uom: rec?.unit_of_measure || "",
      product_name: name,
      division_group: rec?.division_group || "",
      division: rec?.division || "",
      department: rec?.department || "",
      buying_status: rec?.buying_status || "",
      vendor_origin: vendorOrigin,
    };
  };

  const handleBarcodeLookup = async (idx: number) => {
    const code = muRows[idx]?.barcode || "";
    if (!code.trim()) return;
    setLookup((p) => ({ ...p, [idx]: true }));
    try {
      const res = await resolveBarcode(code);
      // กัน SKU (ID) ซ้ำกับแถวอื่น — ถ้าซ้ำ ไม่ให้เพิ่ม (ล้างแถวนี้)
      if (res.found && muRows.some((r, i) => i !== idx && r.sku_code && r.sku_code === res.sku_code)) {
        toast({ title: "SKU ซ้ำ", description: `${res.product_name} (ID ${res.sku_code}) มีอยู่ในรายการแล้ว`, variant: "destructive" });
        setMuRows((prev) => prev.map((r, i) => (i === idx ? { ...EMPTY_MU } : r)));
        return;
      }
      setMuRows((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                sku_code: res.found ? res.sku_code : "",
                barcode_unit: res.found ? res.barcode_unit : "",
                uom: res.found ? res.uom : "",
                product_name: res.found ? res.product_name : "ไม่พบข้อมูล",
                division_group: res.found ? res.division_group : "",
                division: res.found ? res.division : "",
                department: res.found ? res.department : "",
                buying_status: res.found ? res.buying_status : "",
                vendor_origin: res.found ? res.vendor_origin : "",
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

  // ดาวน์โหลด template สำหรับนำเข้า Monthly usage
  const downloadMuTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Barcode: "8857000000001", "จำนวน/เดือน": 10, หมายเหตุ: "" },
      { Barcode: "8857000000002", "จำนวน/เดือน": 5, หมายเหตุ: "" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "MonthlyUsage_Template.xlsx");
  };

  // นำเข้ารายการจาก Excel → resolve barcode → เติมลงตาราง
  const handleMuImport = async (file: File) => {
    setMuImporting(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (raw[0] as string[]).map((h) => String(h ?? "").toLowerCase().trim());
      const bIdx = headers.findIndex((h) => h.includes("barcode") || h.includes("sku") || h.includes("code"));
      const qIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      const rIdx = headers.findIndex((h) => h.includes("remark") || h.includes("หมายเหตุ") || h.includes("note"));
      if (bIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }
      const dataRows = raw.slice(1).filter((r) => String(r[bIdx] ?? "").trim());
      if (!dataRows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
      const resolved: MonthlyUsageForm[] = await Promise.all(
        dataRows.map(async (r) => {
          const code = String(r[bIdx] ?? "").trim();
          const qty = qIdx >= 0 ? String(r[qIdx] ?? "").trim() : "";
          const remark = rIdx >= 0 ? String(r[rIdx] ?? "").trim() : "";
          const res = await resolveBarcode(code);
          return {
            barcode: code,
            sku_code: res.found ? res.sku_code : "",
            barcode_unit: res.found ? res.barcode_unit : "",
            uom: res.found ? res.uom : "",
            product_name: res.found ? res.product_name : "ไม่พบข้อมูล",
            monthly_qty: qty,
            picture: "",
            remark,
            division_group: res.found ? res.division_group : "",
            division: res.found ? res.division : "",
            department: res.found ? res.department : "",
            buying_status: res.found ? res.buying_status : "",
            vendor_origin: res.found ? res.vendor_origin : "",
          };
        }),
      );
      // upsert by SKU (ID) — SKU เดียวกันให้อัปเดตแถวเดิม ไม่เพิ่มซ้ำ (ถ้าไม่มี SKU ใช้ barcode แทน)
      const keyOf = (r: MonthlyUsageForm) =>
        r.sku_code?.trim() ? `sku:${r.sku_code.trim()}` : (r.barcode.trim() ? `bc:${r.barcode.trim()}` : "");
      const result = muRows
        .filter((r) => r.barcode.trim() || r.product_name.trim() || r.monthly_qty.trim())
        .map((r) => ({ ...r }));
      const byKey = new Map<string, number>();
      result.forEach((r, i) => { const k = keyOf(r); if (k) byKey.set(k, i); });
      let updated = 0;
      let added = 0;
      for (const row of resolved) {
        const k = keyOf(row);
        const exIdx = k ? byKey.get(k) : undefined;
        if (exIdx !== undefined) {
          // อัปเดตแถวเดิม — เก็บรูปเดิมไว้ถ้าไฟล์ import ไม่มีรูป
          result[exIdx] = { ...result[exIdx], ...row, picture: result[exIdx].picture || row.picture };
          updated++;
        } else {
          result.push(row);
          if (k) byKey.set(k, result.length - 1);
          added++;
        }
      }
      setMuRows(result.length ? result : [{ ...EMPTY_MU }]);
      const notFound = resolved.filter((r) => r.product_name === "ไม่พบข้อมูล").length;
      toast({ title: "นำเข้าสำเร็จ", description: `เพิ่ม ${added} · อัปเดต ${updated}${notFound ? ` · ไม่พบ ${notFound}` : ""}` });
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMuImporting(false);
    }
  };

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
      // 0) กฎ 1 Brand = 1 Doc — ตอนสร้างใหม่ ถ้า brand นี้มีเอกสารแล้ว ห้ามสร้างซ้ำ (ให้แก้ไขเอกสารเดิมแทน)
      if (!editingDocId) {
        const { data: existing } = await (supabase as any)
          .from("monthly_usage_doc")
          .select("doc_label")
          .eq("brand_name", selectedBrand.brand_name)
          .eq("branch", selectedBrand.branch)
          .limit(1);
        if (existing && existing.length) {
          toast({ title: "Brand นี้มีเอกสารแล้ว", description: `"${selectedBrand.brand_name}" มีเอกสาร ${existing[0].doc_label} อยู่แล้ว — 1 Brand สร้างได้ 1 Doc (ให้แก้ไขเอกสารเดิมแทน)`, variant: "destructive" });
          setMuSaving(false);
          return;
        }
      }

      // 1) อัปรูปก่อน (data URL → public URL) — ถ้าพัง (เช่น bucket หาย) จะ throw ออกก่อน
      //    ยังไม่สร้าง doc/items → ไม่เหลือ doc ขยะ
      const pictureUrls = await Promise.all(
        rowsToSave.map(async (r) => {
          if (!r.picture) return null;
          if (r.picture.startsWith("data:")) return await uploadPicture(r.picture);
          return r.picture;
        }),
      );

      let docNo = editingDocNo;
      if (!editingDocId) {
        const { data: maxd } = await (supabase as any)
          .from("monthly_usage_doc")
          .select("doc_no")
          .order("doc_no", { ascending: false })
          .limit(1);
        docNo = (maxd?.[0]?.doc_no || 0) + 1;
      }
      // ชื่อ doc รูปแบบ yyyymmddhhmm - brandname (ตอนแก้ไขเอกสารเดิม ใช้ชื่อเดิม ไม่เปลี่ยน)
      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
      const label = editingDocId && editingDocLabel
        ? editingDocLabel
        : `${stamp} - ${selectedBrand.brand_name}`.trim();
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
      setActiveTab("brand");
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
            {muOpen && (
              <TabsTrigger value="view" className="text-xs gap-1.5">
                <Eye className="w-3.5 h-3.5" /> แสดงข้อมูล
              </TabsTrigger>
            )}
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
                  <th className="px-3 py-1.5 font-medium w-24 text-right">Total SKU</th>
                  <th className="px-3 py-1.5 font-medium w-28 text-right">SKU No Odoo</th>
                  <th className="px-3 py-1.5 font-medium w-36">วันที่</th>
                  <th className="px-3 py-1.5 font-medium w-44" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{d.doc_label}</td>
                    <td className="px-3 py-1.5">{d.brand_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {(noOdooMap[d.id] || 0) > 0
                        ? <span className="text-destructive font-medium">{noOdooMap[d.id]}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
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

      {/* ============ List Brand dialog ============ */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
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
                    {SHOW_BRAND_BRANCH && <th className="px-2 py-1.5 font-medium">Branch</th>}
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
                      {SHOW_BRAND_BRANCH && (
                        <td className="px-2 py-1">
                          <Input
                            value={row.branch}
                            onChange={(e) => updateRow(idx, "branch", e.target.value)}
                            className="h-8"
                            placeholder="Branch"
                          />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5">
                          {SHOW_BRAND_DUPLICATE && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateRow(idx)}>
                              <Copy className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeRow(idx)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={SHOW_BRAND_BRANCH ? 4 : 3} className="px-2 py-6 text-center text-muted-foreground">
                        ยังไม่มีข้อมูล กดปุ่ม + เพื่อเพิ่ม
                      </td>
                    </tr>
                  )}
                  {rows.length > 0 && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={SHOW_BRAND_BRANCH ? 4 : 3} className="px-2 py-6 text-center text-muted-foreground">
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

        {/* ============ แสดงข้อมูล / แก้ไข (in-app tab) ============ */}
        <TabsContent value="view" className="flex-1 overflow-auto mt-0 p-4 bg-background space-y-3">
          {/* header toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => { setMuOpen(false); setActiveTab("brand"); }}>
              <X className="w-4 h-4" /> ปิด
            </Button>
            <div className="text-sm font-semibold">
              {editingDocId ? `Monthly usage — ${editingDocLabel || ""}` : "Monthly usage (สร้างใหม่)"}
              {muReadOnly && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(โหมดดู)</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Popover open={colMenuOpen} onOpenChange={setColMenuOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5">
                    <Columns3 className="w-4 h-4" /> คอลัมน์ ({visibleMuCols.size}/{MU_TOGGLE_COLS.length})
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="end">
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-xs font-medium">แสดงคอลัมน์</span>
                    <button className="text-[11px] text-primary hover:underline" onClick={() => setVisibleMuCols(new Set(MU_TOGGLE_COLS.map((c) => c.key)))}>เลือกทั้งหมด</button>
                  </div>
                  <div className="max-h-72 overflow-auto space-y-0.5">
                    {MU_TOGGLE_COLS.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={visibleMuCols.has(c.key)}
                          onChange={() => setVisibleMuCols((prev) => { const n = new Set(prev); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {muReadOnly ? (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setMuReadOnly(false)}>
                  <Pencil className="w-4 h-4" /> แก้ไข
                </Button>
              ) : (
                <>
                  {editingDocId && (
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setMuReadOnly(true)} disabled={muSaving}>
                      ยกเลิก
                    </Button>
                  )}
                  <Button size="sm" className="h-8 gap-1.5" onClick={saveMuDoc} disabled={muSaving || muLoading}>
                    {muSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save
                  </Button>
                </>
              )}
            </div>
          </div>

          {muLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Brand selector */}
              <div className="space-y-1.5">
                <Label className="text-xs">Brand</Label>
                {(muReadOnly || editingDocId) ? (
                  <div className="h-9 flex items-center px-3 border rounded-md bg-muted/40 text-sm">
                    {selectedBrand?.brand_name || "—"}
                    {editingDocId && !muReadOnly && (
                      <span className="ml-2 text-[11px] text-muted-foreground">(แก้ไขเอกสารเดิม — เปลี่ยน Brand ไม่ได้)</span>
                    )}
                  </div>
                ) : (
                  <Popover open={brandPickerOpen} onOpenChange={setBrandPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="h-9 w-full justify-between font-normal">
                        {selectedBrand?.brand_name || "เลือก Brand"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                      <Command>
                        <CommandInput placeholder="ค้นหา Brand..." />
                        <CommandList>
                          <CommandEmpty>{mergedBrandOptions.length === 0 ? "ยังไม่มี Brand — เพิ่มใน List Brand ก่อน" : "ไม่พบ Brand"}</CommandEmpty>
                          <CommandGroup>
                            {mergedBrandOptions.map((b) => (
                              <CommandItem key={b.id} value={b.brand_name} onSelect={() => { setBrandPickerOpen(false); handleBrandSelect(b.id!); }}>
                                <Check className={cn("mr-2 h-4 w-4", selectedBrand?.id === b.id ? "opacity-100" : "opacity-0")} />
                                {b.brand_name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {(!muReadOnly && !selectedBrand) ? (
                <div className="border rounded-md p-6 text-center text-sm text-muted-foreground bg-muted/20">
                  เลือก Brand ก่อน จึงจะกรอก / นำเข้าข้อมูลได้
                </div>
              ) : (
              <>
              {!muReadOnly && (
                <div className="flex items-center gap-2">
                  <input
                    ref={muImportRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMuImport(f); e.target.value = ""; }}
                  />
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => muImportRef.current?.click()} disabled={muImporting}>
                    {muImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} นำเข้า Excel
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={downloadMuTemplate}>
                    <FileSpreadsheet className="w-4 h-4" /> Template
                  </Button>
                </div>
              )}

              {/* Item table — 1 รายการ = 1 แถว, เลื่อนแนวนอน + ลากปรับความกว้างคอลัมน์ */}
              <div ref={muTableRef} className="overflow-x-auto border rounded-md">
                <table className="text-sm border-collapse" style={{ width: muTotalW, tableLayout: "fixed" }}>
                  <colgroup>
                    {muShownCols.map((c) => (
                      <col key={c.key} style={{ width: colW[c.key] ?? c.def }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted text-left">
                      {muShownCols.map((c) => (
                        <th key={c.key} className="relative px-2 py-1.5 font-medium border-r last:border-r-0 select-none whitespace-nowrap">
                          <span className="block truncate">{c.label}</span>
                          {c.key !== "act" && (
                            <span
                              onMouseDown={(e) => startColResize(c.key, c.min, e)}
                              className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                            />
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {muRows.map((row, idx) => {
                      const daily =
                        row.monthly_qty.trim() && !isNaN(Number(row.monthly_qty)) ? (Number(row.monthly_qty) / 30).toFixed(2) : "";
                      return (
                        <tr key={idx} className="border-t align-middle">
                          <td className="px-2 py-1 text-center text-muted-foreground tabular-nums">{idx + 1}</td>
                          {isColShown("dgroup") && <td className="px-2 py-1 text-xs text-muted-foreground truncate" title={row.division_group}>{row.division_group || "-"}</td>}
                          {isColShown("division") && <td className="px-2 py-1 text-xs text-muted-foreground truncate" title={row.division}>{row.division || "-"}</td>}
                          {isColShown("dept") && <td className="px-2 py-1 text-xs text-muted-foreground truncate" title={row.department}>{row.department || "-"}</td>}
                          {isColShown("bstatus") && <td className="px-2 py-1 text-xs truncate" title={row.buying_status}>{row.buying_status || "-"}</td>}
                          {isColShown("vorigin") && <td className="px-2 py-1 text-xs text-muted-foreground truncate" title={row.vendor_origin}>{row.vendor_origin || "-"}</td>}
                          {isColShown("barcode") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={0}
                              value={row.barcode}
                              readOnly={muReadOnly}
                              onChange={(e) => updateMuField(idx, "barcode", e.target.value)}
                              onBlur={() => handleBarcodeLookup(idx)}
                              onKeyDown={(e) => handleCellKey(e, idx, 0)}
                              className={`h-8 w-full ${muReadOnly ? "bg-muted/50" : ""}`}
                              placeholder="คีย์ barcode"
                            />
                          </td>}
                          {isColShown("sku") && <td className="px-1 py-1">
                            <div className="relative">
                              <Input
                                data-r={idx}
                                data-c={1}
                                value={row.sku_code}
                                readOnly
                                onKeyDown={(e) => handleCellKey(e, idx, 1)}
                                className="h-8 w-full bg-muted/50 pr-6"
                                placeholder="auto"
                              />
                              {lookup[idx] && <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin" />}
                            </div>
                          </td>}
                          {isColShown("bunit") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={2}
                              value={row.barcode_unit}
                              readOnly
                              onKeyDown={(e) => handleCellKey(e, idx, 2)}
                              className="h-8 w-full bg-muted/50"
                              placeholder="auto"
                            />
                          </td>}
                          {isColShown("uom") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={3}
                              value={row.uom}
                              readOnly
                              onKeyDown={(e) => handleCellKey(e, idx, 3)}
                              className="h-8 w-full bg-muted/50"
                              placeholder="auto"
                            />
                          </td>}
                          {isColShown("pname") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={4}
                              value={row.product_name}
                              readOnly
                              title={row.product_name}
                              onKeyDown={(e) => handleCellKey(e, idx, 4)}
                              className={`h-8 w-full bg-muted/50 ${row.product_name === "ไม่พบข้อมูล" ? "text-destructive" : ""}`}
                              placeholder="auto"
                            />
                          </td>}
                          {isColShown("mqty") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={5}
                              type="number"
                              value={row.monthly_qty}
                              readOnly={muReadOnly}
                              onChange={(e) => updateMuField(idx, "monthly_qty", e.target.value)}
                              onKeyDown={(e) => handleCellKey(e, idx, 5)}
                              className={`h-8 w-full ${muReadOnly ? "bg-muted/50" : ""}`}
                              placeholder="0"
                            />
                          </td>}
                          {isColShown("dqty") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={6}
                              value={daily}
                              readOnly
                              onKeyDown={(e) => handleCellKey(e, idx, 6)}
                              className="h-8 w-full bg-muted/50"
                              placeholder="auto"
                            />
                          </td>}
                          {isColShown("pic") && <td className="px-1 py-1">
                            {muReadOnly ? (
                              <div className="w-14 h-14 border rounded flex items-center justify-center bg-muted/30 overflow-hidden">
                                {row.picture
                                  ? <img src={row.picture} alt="picture" className="w-full h-full object-cover cursor-zoom-in" onClick={() => window.open(row.picture, "_blank")} />
                                  : <span className="text-[9px] text-muted-foreground">-</span>}
                              </div>
                            ) : (
                            <div className="flex items-center gap-1">
                              <div
                                tabIndex={0}
                                onPaste={(e) => handleRowPaste(idx, e)}
                                className="relative w-14 h-14 border rounded flex items-center justify-center bg-muted/30 overflow-hidden outline-none focus:ring-2 focus:ring-primary shrink-0"
                                title="คลิกแล้ว Ctrl+V เพื่อวางรูป"
                              >
                                {row.picture ? (
                                  <>
                                    <img
                                      src={row.picture}
                                      alt="picture"
                                      className="w-full h-full object-cover cursor-zoom-in"
                                      onClick={() => window.open(row.picture, "_blank")}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => updateMuField(idx, "picture", "")}
                                      className="absolute -top-1 -right-1 bg-background rounded-full p-0.5 border hover:bg-muted"
                                      title="ลบรูป"
                                    >
                                      <X className="w-3 h-3 text-destructive" />
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-[9px] text-muted-foreground text-center leading-tight px-0.5">Ctrl+V</span>
                                )}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <label
                                  className="inline-flex items-center justify-center h-6 w-6 border rounded cursor-pointer hover:bg-muted"
                                  title="นำเข้ารูป"
                                >
                                  <Upload className="w-3.5 h-3.5" />
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRowFile(idx, e)} />
                                </label>
                                <label
                                  className="inline-flex items-center justify-center h-6 w-6 border rounded cursor-pointer hover:bg-muted"
                                  title="ถ่ายรูป"
                                >
                                  <Camera className="w-3.5 h-3.5" />
                                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleRowFile(idx, e)} />
                                </label>
                              </div>
                            </div>
                            )}
                          </td>}
                          {isColShown("remark") && <td className="px-1 py-1">
                            <Input
                              data-r={idx}
                              data-c={7}
                              value={row.remark}
                              readOnly={muReadOnly}
                              onChange={(e) => updateMuField(idx, "remark", e.target.value)}
                              onKeyDown={(e) => handleCellKey(e, idx, 7)}
                              className={`h-8 w-full ${muReadOnly ? "bg-muted/50" : ""}`}
                              placeholder="หมายเหตุ"
                            />
                          </td>}
                          <td className="px-1 py-1">
                            {!muReadOnly && (
                            <div className="flex items-center justify-center gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateMuRow(idx)}>
                                <Copy className="w-4 h-4 text-muted-foreground" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeMuRow(idx)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {muRows.length === 0 && (
                      <tr>
                        <td colSpan={muShownCols.length} className="px-2 py-6 text-center text-muted-foreground">
                          ยังไม่มีรายการ — กด "เพิ่มรายการ"
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!muReadOnly && (
                <Button variant="outline" size="sm" onClick={addMuRow} className="gap-1.5">
                  <Plus className="w-4 h-4" /> เพิ่มรายการ
                </Button>
              )}
              </>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ถาม: Brand นี้มีเอกสารแล้ว เปิดแก้ไขเอกสารเดิมไหม */}
      <Dialog open={!!dupDocPrompt} onOpenChange={(o) => { if (!o) { setDupDocPrompt(null); setSelectedBrand(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Brand นี้มีเอกสารแล้ว</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            "{dupDocPrompt?.brand_name}" มีเอกสาร <b>{dupDocPrompt?.doc_label}</b> อยู่แล้ว (1 Brand ได้ 1 Doc)
            <br />ต้องการเปิดแก้ไขเอกสารเดิมไหม?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDupDocPrompt(null); setSelectedBrand(null); }}>
              ยกเลิก
            </Button>
            <Button onClick={() => { const d = dupDocPrompt; setDupDocPrompt(null); if (d) openMuView(d, false); }}>
              <Pencil className="w-4 h-4 mr-1.5" /> เปิดแก้ไขเอกสารเดิม
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
