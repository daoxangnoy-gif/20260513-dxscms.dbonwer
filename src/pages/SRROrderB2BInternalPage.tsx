import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Trash2, Loader2, Search, Copy, BarChart3, Upload, Camera, X, Eye, Download, Pencil, ChevronsUpDown, Check, FileSpreadsheet, Columns3, Image as ImageIcon, Printer, FileSignature, ShoppingCart, Boxes, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures";

// ===== SO export (SCM Control → tab SO) — คอนเซ็ปต์/คอลัมน์ยืดจาก Order B2B (SO) =====
const SO_COMPANY = "Lanexang Green Property Sole Co.,Ltd";
const SO_WAREHOUSE = "DC Thongpong";
const SO_PRICELIST = "WSPRICE 2 (Internal B2B)";
const SO_DEFAULT_CUSTOMER = "40237 KR F&B Co.,LTD"; // Customer เริ่มต้นตอน export

// คอลัมน์ Branch ใน dialog List Brand (1 แบรนด์มีได้หลาย Branch = หลายแถว)
// Branch ใช้ตอน Order (เลือกจาก dropdown) — ในรายการเลือกแบรนด์มองเป็น distinct ตามชื่อ
const SHOW_BRAND_BRANCH = true;
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
  product_name: string;     // ชื่อสินค้า LA (ดั้งเดิม — ซ่อน default)
  product_name_en: string;  // ชื่อสินค้า EN
  uom: string;
  monthly_qty: string;
  order_group: string;  // ใช้แยก/จัดกลุ่มออเดอร์ภายหลัง (คีย์เอง)
  picture: string;
  remark: string;
  // คอลัมน์อ้างอิงจาก data_master / vendor_master (derive ตอนแสดงผล ไม่ได้เก็บลง DB)
  division_group: string;
  division: string;
  department: string;
  buying_status: string;
  vendor_origin: string;
  // รายการทดแทน (replacement) — คีย์ Barcode ทดแทน → resolve ที่เหลือ; Picture อัปเอง
  repl_barcode: string;
  repl_sku_code: string;
  repl_barcode_unit: string;
  repl_product_name_en: string;
  repl_picture: string;
};

type MUDoc = {
  id: string;
  doc_no: number;
  doc_label: string;
  brand_name: string;
  branch: string;
  item_count: number;
  created_at: string;
  updated_at: string | null; // เวลาแก้ไขล่าสุด
  need_date: string | null; // วันที่คาดว่าจะเบิก (DATE Need) — ใช้ออกฟอร์ม
  logo_url: string | null;  // โลโก้มุมซ้ายบนของฟอร์ม (หัวเอกสาร)
  brand_logo_url: string | null; // โลโก้ของแบรนด์ (แสดงในตาราง — คนละอันกับหัวฟอร์ม)
  signed_pdf_url: string | null;     // ไฟล์ PDF ที่เซ็นแล้ว (ล่าสุด)
  signed_uploaded_at: string | null; // วันที่/เวลาอัปล่าสุด
  signed_count: number | null;       // จำนวนครั้งที่อัป
};

const EMPTY_MU: MonthlyUsageForm = {
  barcode: "",
  sku_code: "",
  barcode_unit: "",
  product_name: "",
  product_name_en: "",
  uom: "",
  monthly_qty: "",
  order_group: "",
  picture: "",
  remark: "",
  division_group: "",
  division: "",
  department: "",
  buying_status: "",
  vendor_origin: "",
  repl_barcode: "",
  repl_sku_code: "",
  repl_barcode_unit: "",
  repl_product_name_en: "",
  repl_picture: "",
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// เรียงรายการ A-Z ตามชื่อสินค้า EN (ถ้าไม่มีใช้ LA) — รายการว่าง/ไม่พบไว้ท้ายสุด
const sortRowsAZ = (rows: MonthlyUsageForm[]): MonthlyUsageForm[] =>
  [...rows].sort((a, b) => {
    const ka = (a.product_name_en || a.product_name || "").trim();
    const kb = (b.product_name_en || b.product_name || "").trim();
    if (!ka && !kb) return 0;
    if (!ka) return 1;
    if (!kb) return -1;
    return ka.localeCompare(kb, undefined, { sensitivity: "base" });
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
  { key: "pname_en", label: "Product name (EN)", def: 240, min: 120 },
  { key: "pname", label: "Product name (LA)", def: 240, min: 120 },
  { key: "mqty", label: "Monthly qty", def: 110, min: 80 },
  { key: "order_group", label: "Order group", def: 130, min: 90 },
  { key: "dqty", label: "Daily qty (÷30)", def: 110, min: 70 },
  { key: "pic", label: "Picture", def: 150, min: 120 },
  { key: "remark", label: "Remark", def: 200, min: 100 },
  // รายการทดแทน (replacement) — ขวาสุดข้าง Remark
  { key: "repl_barcode", label: "Barcode ทดแทน (คีย์เอง)", def: 160, min: 100 },
  { key: "repl_sku", label: "ID ทดแทน", def: 120, min: 80 },
  { key: "repl_bunit", label: "Barcode Unit ทดแทน", def: 150, min: 90 },
  { key: "repl_pname_en", label: "Product name EN ทดแทน", def: 240, min: 120 },
  { key: "repl_pic", label: "Picture ทดแทน", def: 150, min: 120 },
  { key: "act", label: "", def: 74, min: 64 },
] as const;
const MU_COL_KEY = "mu_col_widths_v1";
const MU_VIS_KEY = "mu_col_visible_v7";
// คอลัมน์ที่ติกซ่อน/แสดงได้ (ยกเว้น # และ action)
const MU_TOGGLE_COLS = MU_COLS.filter((c) => c.key !== "idx" && c.key !== "act");
// คอลัมน์อ้างอิงที่ default ซ่อนไว้ (อยากดูค่อยติกเอง) — รวม Product name (LA) + Daily qty
const MU_DEFAULT_HIDDEN = new Set(["dgroup", "division", "dept", "bstatus", "vorigin", "pname", "dqty"]);

// ลำดับคอลัมน์ที่ใช้ keyboard navigation (มี input) — index = data-c
const MU_NAV_COLS = ["barcode", "sku", "bunit", "uom", "pname", "mqty", "dqty", "remark"] as const;

// ===== Order (ปุ่ม Order) =====
// 1 แถว = 1 รายการจาก Monthly Usage (read-only) + คอลัมน์ Order Qty ที่คีย์ได้
type OrderRow = {
  sku_code: string;
  barcode: string;
  barcode_unit: string;
  product_name: string;
  uom: string;
  monthly_qty: string; // snapshot อ้างอิง
  order_qty: string;   // คีย์เอง
  order_group: string; // มาจาก Monthly Usage (ใช้แยก SO)
  picture: string;
  remark: string;
};

type OrderDoc = {
  id: string;
  doc_no: number;
  doc_label: string;
  brand_name: string;
  branch: string;
  source_doc_id: string | null;
  item_count: number;
  created_at: string;
  updated_at: string | null; // เวลาแก้ไขล่าสุด
};

// ===== SO Doc (SCM Control → tab SO) — สร้างอัตโนมัติตอน Save Order, แยกตาม order_group =====
type SODoc = {
  id: string;
  doc_no: number;
  doc_label: string;
  brand_name: string;
  branch: string;
  order_doc_id: string | null;
  order_group: string | null;
  customer: string | null;
  item_count: number;
  created_at: string;
  updated_at: string | null;
};

type SOItem = {
  sku_code: string;
  barcode: string;
  barcode_unit: string;
  product_name: string;
  uom: string;
  order_qty: string;
  order_group: string;
};

// คอลัมน์ตาราง Order (หน้าตาคล้าย Monthly usage; ทุกคอลัมน์ read-only ยกเว้น Order Qty)
const ORDER_COLS = [
  { key: "idx", label: "#", w: 44 },
  { key: "barcode", label: "Barcode", w: 150 },
  { key: "sku", label: "ID (SKU)", w: 120 },
  { key: "bunit", label: "Barcode Unit", w: 140 },
  { key: "uom", label: "UOM", w: 70 },
  { key: "pname", label: "Product name", w: 240 },
  { key: "mqty", label: "Monthly qty", w: 100 },
  { key: "pic", label: "Picture", w: 90 },
  { key: "remark", label: "Remark", w: 180 },
  { key: "oqty", label: "Order Qty", w: 120 },
] as const;
const ORDER_TOTAL_W = ORDER_COLS.reduce((s, c) => s + c.w, 0);

export default function SRROrderB2BInternalPage() {
  const [activeTab, setActiveTab] = useState("brand");
  const [brandSubTab, setBrandSubTab] = useState("monthly"); // sub-tab ใต้ Brand control: monthly | order
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

  // แทรกแถวใหม่ (ว่าง) ใต้แถวที่กด
  const insertRowBelow = (idx: number) =>
    setRows((prev) => {
      const newCode = prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1;
      const next = [...prev];
      next.splice(idx + 1, 0, { code: newCode, brand_name: "", branch: "" });
      return next;
    });

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
    // กัน Brand + Branch ซ้ำ (แบรนด์เดียวกันมีได้หลาย Branch แต่คู่ Brand+Branch ห้ามซ้ำ)
    const keys = rows.map((r) => `${r.brand_name.trim().toLowerCase()}||${r.branch.trim().toLowerCase()}`);
    const dupIdx = keys.findIndex((k, i) => !k.startsWith("||") && keys.indexOf(k) !== i);
    if (dupIdx !== -1) {
      const r = rows[dupIdx];
      toast({ title: "มี Brand + Branch ซ้ำ", description: `"${r.brand_name.trim()}${r.branch.trim() ? ` / ${r.branch.trim()}` : ""}" ซ้ำกัน — แก้ให้ไม่ซ้ำก่อนบันทึก`, variant: "destructive" });
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
        .select("id, doc_no, doc_label, brand_name, branch, item_count, created_at, updated_at, need_date, logo_url, brand_logo_url, signed_pdf_url, signed_uploaded_at, signed_count")
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
    loadOrderDocs();
    loadRouteplan();
    loadSoDocs();
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

  // อัป/เปลี่ยนโลโก้ของเอกสาร → เก็บ public URL ลง monthly_usage_doc.logo_url (โชว์มุมซ้ายบนของฟอร์ม)
  const handleDocLogo = async (doc: MUDoc, file: File) => {
    setLogoUploadingId(doc.id);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPicture(dataUrl);
      const { error } = await (supabase as any).from("monthly_usage_doc").update({ logo_url: url }).eq("id", doc.id);
      if (error) throw error;
      toast({ title: "อัปโลโก้แล้ว", description: doc.doc_label });
      loadDocs();
    } catch (e: any) {
      toast({ title: "อัปโลโก้ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLogoUploadingId(null);
    }
  };

  // อัป/เปลี่ยนโลโก้ของแบรนด์ → เก็บลง monthly_usage_doc.brand_logo_url (แสดงในตาราง — คนละอันกับหัวฟอร์ม)
  const handleBrandLogo = async (doc: MUDoc, file: File) => {
    setBrandLogoUploadingId(doc.id);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPicture(dataUrl);
      const { error } = await (supabase as any).from("monthly_usage_doc").update({ brand_logo_url: url }).eq("id", doc.id);
      if (error) throw error;
      toast({ title: "อัปโลโก้แบรนด์แล้ว", description: doc.doc_label });
      loadDocs();
    } catch (e: any) {
      toast({ title: "อัปโลโก้แบรนด์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setBrandLogoUploadingId(null);
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
  // popup ถาม "วันที่คาดว่าจะเบิก" (DATE Need) ก่อน Save → ออกฟอร์ม
  const [needDateOpen, setNeedDateOpen] = useState(false);
  const [needDate, setNeedDate] = useState(""); // yyyy-mm-dd
  const [editNeedDate, setEditNeedDate] = useState(""); // need_date เดิมของเอกสารที่กำลังแก้ (prefill)
  const [editLogoUrl, setEditLogoUrl] = useState(""); // logo_url เดิมของเอกสารที่กำลังแก้ (คงไว้ตอน save + ใช้ออกฟอร์ม)
  const [logoUploadingId, setLogoUploadingId] = useState<string | null>(null); // doc_id ที่กำลังอัปโลโก้ (หัวฟอร์ม)
  const [brandLogoUploadingId, setBrandLogoUploadingId] = useState<string | null>(null); // doc_id ที่กำลังอัปโลโก้แบรนด์
  const [signedUploadingId, setSignedUploadingId] = useState<string | null>(null); // doc_id ที่กำลังอัปไฟล์เซ็น
  const [printingId, setPrintingId] = useState<string | null>(null); // doc_id ที่กำลังเตรียมพิมพ์
  // Import Monthly Excel หลายแบรนด์พร้อมกัน
  const [multiImporting, setMultiImporting] = useState(false);
  const [importSkips, setImportSkips] = useState<{ brand: string; reason: string; count: number }[]>([]);
  const [importSkipOpen, setImportSkipOpen] = useState(false);

  // ============================================================
  // Order (ปุ่ม Order) — docs list + editor
  // ============================================================
  const [orderDocs, setOrderDocs] = useState<OrderDoc[]>([]);
  const [orderDocsLoading, setOrderDocsLoading] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);       // editor เปิดอยู่ไหม (แท็บ Order edit)
  const [orderReadOnly, setOrderReadOnly] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderEditingDocId, setOrderEditingDocId] = useState<string | null>(null);
  const [orderEditingDocNo, setOrderEditingDocNo] = useState<number | null>(null);
  const [orderEditingDocLabel, setOrderEditingDocLabel] = useState<string | null>(null);
  const [orderBrand, setOrderBrand] = useState<{ id: string; brand_name: string; branch: string } | null>(null);
  const [orderSourceDocId, setOrderSourceDocId] = useState<string | null>(null);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [orderBrandPickOpen, setOrderBrandPickOpen] = useState(false); // popup เลือก Brand ก่อนเข้า Order
  const [orderBrandLoading, setOrderBrandLoading] = useState(false);
  const [orderPreparing, setOrderPreparing] = useState(false);         // กำลังเตรียมข้อมูลหลังเลือก Brand
  const [orderPickBrandName, setOrderPickBrandName] = useState<string | null>(null); // แบรนด์ที่ติกใน popup (distinct ตามชื่อ, ทีละ 1)
  const [orderPickBranch, setOrderPickBranch] = useState("");          // Branch ที่เลือกจาก dropdown (บังคับ)
  const [orderBrandSearch, setOrderBrandSearch] = useState("");        // ค้นหา Brand ใน popup

  // ============================================================
  // SCM Control → tab SO
  // ============================================================
  const [scmSubTab, setScmSubTab] = useState("so");
  const [soDocs, setSoDocs] = useState<SODoc[]>([]);
  const [soDocsLoading, setSoDocsLoading] = useState(false);
  const [soSearch, setSoSearch] = useState("");
  const [soItemHitIds, setSoItemHitIds] = useState<Set<string> | null>(null); // doc_id ที่ item match คำค้น (barcode/id/product)
  const [soSelected, setSoSelected] = useState<Set<string>>(new Set());
  const [soExporting, setSoExporting] = useState(false);
  const [soViewDoc, setSoViewDoc] = useState<SODoc | null>(null);
  const [soViewItems, setSoViewItems] = useState<SOItem[]>([]);
  const [soViewLoading, setSoViewLoading] = useState(false);

  // ============================================================
  // Routeplan — แนบ PDF (เก็บไฟล์ล่าสุด) + เวลาอัปล่าสุด
  // ============================================================
  const [routeplan, setRouteplan] = useState<{ pdf_url: string; uploaded_at: string | null; upload_count: number } | null>(null);
  const [routeplanUploading, setRouteplanUploading] = useState(false);

  const loadRouteplan = async () => {
    try {
      const { data } = await (supabase as any)
        .from("routeplan")
        .select("pdf_url, uploaded_at, upload_count")
        .eq("key", "default")
        .limit(1);
      setRouteplan(data?.[0] || null);
    } catch {
      setRouteplan(null);
    }
  };

  const handleRouteplanUpload = async (file: File) => {
    setRouteplanUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPicture(dataUrl); // bucket เดียวกัน รองรับ pdf
      const payload = {
        key: "default",
        pdf_url: url,
        uploaded_at: new Date().toISOString(),
        upload_count: (routeplan?.upload_count || 0) + 1,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any).from("routeplan").upsert(payload, { onConflict: "key" });
      if (error) throw error;
      toast({ title: "อัป Routeplan แล้ว" });
      loadRouteplan();
    } catch (e: any) {
      toast({ title: "อัป Routeplan ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setRouteplanUploading(false);
    }
  };

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
  // บันทึก localStorage เฉพาะตอนผู้ใช้เปลี่ยนเอง (ไม่ auto-save ตอนโหลด → default ไม่ถูกทับ)
  const setVisCols = (next: Set<string>) => {
    setVisibleMuCols(next);
    try { localStorage.setItem(MU_VIS_KEY, JSON.stringify([...next])); } catch {}
  };
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
    setEditNeedDate("");
    setEditLogoUrl("");
    setMuReadOnly(false);
    setMuOpen(true);
    setBrandSubTab("view");
    setActiveTab("brand");
    await loadBrandOptions();
  };

  const openMuView = async (doc: MUDoc, readOnly = true) => {
    setMuOpen(true);
    setMuReadOnly(readOnly);
    setBrandSubTab("view");
    setActiveTab("brand");
    setMuLoading(true);
    setEditingDocId(doc.id);
    setEditingDocNo(doc.doc_no);
    setEditingDocLabel(doc.doc_label);
    setEditNeedDate(doc.need_date || "");
    setEditLogoUrl(doc.logo_url || "");
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
      // เติมคอลัมน์อ้างอิงจาก data_master (Division/Department/Buying Status/Vendor Origin + repl EN) ตาม sku_code
      const skus = [...new Set([
        ...(data || []).map((it: any) => it.sku_code),
        ...(data || []).map((it: any) => it.repl_sku_code),
      ].filter(Boolean))] as string[];
      const dmMap: Record<string, any> = {};
      if (skus.length) {
        const { data: dm } = await (supabase as any)
          .from("data_master")
          .select("sku_code, product_name_en, division_group, division, department, buying_status, vendor_code, vendor_display_name")
          .in("sku_code", skus);
        for (const d of (dm || []) as any[]) { if (d.sku_code && !dmMap[d.sku_code]) dmMap[d.sku_code] = d; }
      }
      const loadedRows: MonthlyUsageForm[] = (data || []).map((it: any) => {
        const d = dmMap[it.sku_code] || {};
        const vendorOrigin = (d.vendor_code && vendorOriginMapRef.current[d.vendor_code]) || "";
        return {
          barcode: it.barcode ?? "",
          sku_code: it.sku_code ?? "",
          barcode_unit: it.barcode_unit ?? "",
          product_name: it.product_name ?? "",
          product_name_en: d.product_name_en ?? "",
          uom: it.uom ?? "",
          monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
          order_group: it.order_group ?? "",
          picture: it.picture ?? "",
          remark: it.remark ?? "",
          division_group: d.division_group ?? "",
          division: d.division ?? "",
          department: d.department ?? "",
          buying_status: d.buying_status ?? "",
          vendor_origin: vendorOrigin,
          repl_barcode: it.repl_barcode ?? "",
          repl_sku_code: it.repl_sku_code ?? "",
          repl_barcode_unit: it.repl_barcode_unit ?? "",
          repl_product_name_en: (dmMap[it.repl_sku_code]?.product_name_en) ?? "",
          repl_picture: it.repl_picture ?? "",
        };
      });
      setMuRows(sortRowsAZ(loadedRows));
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
      product_name_en: rec?.product_name_en || "",
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
                product_name_en: res.found ? res.product_name_en : "",
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

  // resolve Barcode ทดแทน → เติม ID/Barcode Unit/Product name EN ของรายการทดแทน
  const handleReplBarcodeLookup = async (idx: number) => {
    const code = muRows[idx]?.repl_barcode || "";
    if (!code.trim()) {
      // ล้างช่อง barcode ทดแทน → ล้างข้อมูลที่ resolve มา (คงรูปไว้)
      setMuRows((prev) => prev.map((r, i) => (i === idx ? { ...r, repl_sku_code: "", repl_barcode_unit: "", repl_product_name_en: "" } : r)));
      return;
    }
    try {
      const res = await resolveBarcode(code);
      setMuRows((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                repl_sku_code: res.found ? res.sku_code : "",
                repl_barcode_unit: res.found ? res.barcode_unit : "",
                repl_product_name_en: res.found ? res.product_name_en : "ไม่พบข้อมูลในระบบ",
              }
            : r,
        ),
      );
    } catch (e: any) {
      toast({ title: "ค้นหารายการทดแทนไม่สำเร็จ", description: e.message, variant: "destructive" });
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
      { Barcode: "8857000000001", "จำนวน/เดือน": 10, "Order group": "A", หมายเหตุ: "", "Barcode ทดแทน": "" },
      { Barcode: "8857000000002", "จำนวน/เดือน": 5, "Order group": "B", หมายเหตุ: "", "Barcode ทดแทน": "8857000000099" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "MonthlyUsage_Template.xlsx");
  };

  // template สำหรับ Import หลายแบรนด์ (ชีตเดียว มีคอลัมน์ Brand)
  const downloadMultiTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Brand: "Bonchon", Barcode: "8851123212021", "จำนวน/เดือน": 1000, หมายเหตุ: "" },
      { Brand: "Khiang", Barcode: "8059495230180", "จำนวน/เดือน": 2, หมายเหตุ: "" },
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "MonthlyUsage_MultiBrand_Template.xlsx");
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
      // คอลัมน์ Barcode ทดแทน (replacement) — ตรวจก่อน เพื่อไม่ให้ชนกับ Barcode หลัก
      const replIdx = headers.findIndex((h) => h.includes("ทดแทน") || h.includes("replace") || h.includes("repl") || h.includes("substitut"));
      const bIdx = headers.findIndex((h, i) => i !== replIdx && (h.includes("barcode") || h.includes("sku") || h.includes("code")));
      const qIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      const rIdx = headers.findIndex((h) => h.includes("remark") || h.includes("หมายเหตุ") || h.includes("note"));
      const gIdx = headers.findIndex((h) => h.includes("order group") || h.includes("order_group") || h.includes("group") || h.includes("กลุ่ม"));
      if (bIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }
      const dataRows = raw.slice(1).filter((r) => String(r[bIdx] ?? "").trim());
      if (!dataRows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
      const resolved: MonthlyUsageForm[] = await Promise.all(
        dataRows.map(async (r) => {
          const code = String(r[bIdx] ?? "").trim();
          const qty = qIdx >= 0 ? String(r[qIdx] ?? "").trim() : "";
          const remark = rIdx >= 0 ? String(r[rIdx] ?? "").trim() : "";
          const orderGroup = gIdx >= 0 ? String(r[gIdx] ?? "").trim() : "";
          const res = await resolveBarcode(code);
          // รายการทดแทน (ถ้ามีคอลัมน์)
          const replCode = replIdx >= 0 ? String(r[replIdx] ?? "").trim() : "";
          const replRes = replCode ? await resolveBarcode(replCode) : ({ found: false } as any);
          return {
            barcode: code,
            sku_code: res.found ? res.sku_code : "",
            barcode_unit: res.found ? res.barcode_unit : "",
            uom: res.found ? res.uom : "",
            product_name: res.found ? res.product_name : "ไม่พบข้อมูล",
            product_name_en: res.found ? res.product_name_en : "",
            monthly_qty: qty,
            order_group: orderGroup,
            picture: "",
            remark,
            division_group: res.found ? res.division_group : "",
            division: res.found ? res.division : "",
            department: res.found ? res.department : "",
            buying_status: res.found ? res.buying_status : "",
            vendor_origin: res.found ? res.vendor_origin : "",
            repl_barcode: replCode,
            repl_sku_code: replRes.found ? replRes.sku_code : "",
            repl_barcode_unit: replRes.found ? replRes.barcode_unit : "",
            repl_product_name_en: replCode ? (replRes.found ? replRes.product_name_en : "ไม่พบข้อมูลในระบบ") : "",
            repl_picture: "",
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
          result[exIdx] = { ...result[exIdx], ...row, picture: result[exIdx].picture || row.picture, repl_picture: result[exIdx].repl_picture || row.repl_picture };
          updated++;
        } else {
          result.push(row);
          if (k) byKey.set(k, result.length - 1);
          added++;
        }
      }
      setMuRows(result.length ? sortRowsAZ(result) : [{ ...EMPTY_MU }]);
      const notFound = resolved.filter((r) => r.product_name === "ไม่พบข้อมูล").length;
      toast({ title: "นำเข้าสำเร็จ", description: `เพิ่ม ${added} · อัปเดต ${updated}${notFound ? ` · ไม่พบ ${notFound}` : ""}` });
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMuImporting(false);
    }
  };

  const handleRowFile = async (idx: number, e: React.ChangeEvent<HTMLInputElement>, field: "picture" | "repl_picture" = "picture") => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        const url = await fileToDataUrl(f);
        updateMuField(idx, field, url);
      } catch {
        toast({ title: "อ่านรูปไม่สำเร็จ", variant: "destructive" });
      }
    }
    e.target.value = "";
  };

  const handleRowPaste = async (idx: number, e: React.ClipboardEvent, field: "picture" | "repl_picture" = "picture") => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          try {
            const url = await fileToDataUrl(f);
            updateMuField(idx, field, url);
          } catch {
            toast({ title: "วางรูปไม่สำเร็จ", variant: "destructive" });
          }
          break;
        }
      }
    }
  };

  // กด Save → ตรวจความถูกต้องก่อน แล้วเปิด popup ถาม "วันที่คาดว่าจะเบิก"
  const openNeedDatePopup = () => {
    if (!selectedBrand || (!selectedBrand.id && !selectedBrand.brand_name)) {
      toast({ title: "กรุณาเลือก Brand ก่อน", variant: "destructive" });
      return;
    }
    const hasRows = muRows.some((r) => r.barcode.trim() || r.product_name.trim() || r.monthly_qty.trim());
    if (!hasRows) {
      toast({ title: "ไม่มีรายการให้บันทึก", variant: "destructive" });
      return;
    }
    setNeedDate(editNeedDate || "");
    setNeedDateOpen(true);
  };

  // dd-mm-yyyy
  const fmtDMY = (iso: string) => {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-");
    return y && m && d ? `${d}-${m}-${y}` : iso;
  };

  // สร้างหน้าพิมพ์ฟอร์ม Monthly Usage Request → เปิด tab ใหม่ + เรียก print (Save as PDF)
  const openPrintForm = (rows: MonthlyUsageForm[], brandName: string, needDateISO: string, logoUrl?: string) => {
    const esc = (s: any) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const reqStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
    const needStr = fmtDMY(needDateISO);

    const rowsHtml = rows
      .map(
        (r, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${esc(r.barcode || r.barcode_unit)}</td>
          <td>${esc(r.product_name)}</td>
          <td class="pic">${r.picture ? `<img src="${esc(r.picture)}" />` : ""}</td>
          <td class="c">${esc(r.uom)}</td>
          <td class="c">${esc(r.monthly_qty)}</td>
          <td>${esc(r.remark)}</td>
        </tr>`,
      )
      .join("");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Monthly Usage Request - ${esc(brandName)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Leelawadee UI", "Phetsarath OT", Tahoma, sans-serif; color: #111; margin: 0; }
  .logobar { width: 100%; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid #333; }   /* เส้นคั่นใต้หัวโลโก้ */
  .logobar img { width: 100%; height: auto; max-height: 120px; object-fit: contain; object-position: left; display: block; }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .title { font-size: 20px; font-weight: 700; display: inline-block; background: #d4ebff; padding: 4px 12px; border-radius: 3px; }
  .meta { font-size: 12px; line-height: 1.7; }
  .meta b { display: inline-block; min-width: 92px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #333; table-layout: fixed; }   /* fixed = ตารางเต็มความกว้างพอดี เส้นขอบขวา/ล่างไม่หลุด */
  thead { display: table-header-group; }   /* ทำซ้ำหัวตารางทุกหน้าเมื่อเอกสารเกิน 1 หน้า */
  tfoot { display: table-footer-group; }   /* กล่องเซ็น = footer ทำซ้ำท้ายทุกหน้า + อยู่ล่างเสมอ */
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #333; padding: 5px 7px; font-size: 12px; vertical-align: middle; word-break: break-word; overflow-wrap: anywhere; }
  th { background: #f0f0f0; text-align: center; }
  td.c { text-align: center; }
  td.pic { text-align: center; padding: 3px; }
  td.pic img { max-width: 90px; max-height: 70px; object-fit: contain; }
  tfoot td.signcell { border: 0; padding: 14px 0 2px; }   /* ช่องกล่องเซ็น ไม่เอาเส้นตาราง */
  .sign { display: flex; justify-content: space-between; gap: 18px; page-break-inside: avoid; }   /* ทั้งแถวกล่องเซ็นไม่ตัดครึ่งข้ามหน้า */
  .sign .box { flex: 1; border: 1px solid #333; border-radius: 6px; padding: 12px 16px 14px; page-break-inside: avoid; }
  .sign .role { text-align: center; font-weight: 700; font-size: 13px; }
  .sign .sp { height: 80px; }                 /* ช่องว่างสำหรับเซ็น */
  .sign .ln { display: flex; align-items: flex-end; font-size: 12px; margin-top: 16px; }
  .sign .ln .k { flex: 0 0 72px; }
  .sign .ln .v { flex: 1; border-bottom: 1px dotted #333; height: 14px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  ${logoUrl ? `<div class="logobar"><img src="${esc(logoUrl)}" /></div>` : ""}
  <div class="hd">
    <div class="title">Monthly Usage Request</div>
    <div class="meta">
      <div><b>Brand</b>: ${esc(brandName)}</div>
      <div><b>DATE Request</b>: ${reqStr}</div>
      <div><b>DATE Need</b>: ${needStr}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">No.</th>
        <th style="width:120px">Barcode</th>
        <th>Product Name</th>
        <th style="width:110px">Product Picture</th>
        <th style="width:60px">UOM</th>
        <th style="width:55px">Qty</th>
        <th style="width:140px">Remarks</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td class="signcell" colspan="7">
          <div class="sign">
            ${["Requestor", "Head Of Brand", "General Manager"]
              .map(
                (role) => `<div class="box">
              <div class="role">${role}</div>
              <div class="sp"></div>
              <div class="ln"><span class="k">Signature</span><span class="v"></span></div>
              <div class="ln"><span class="k">Name</span><span class="v"></span></div>
              <div class="ln"><span class="k">Date</span><span class="v"></span></div>
            </div>`,
              )
              .join("")}
          </div>
        </td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    // พิมพ์ผ่าน hidden iframe → เด้ง print preview อย่างเดียว ไม่เปิด tab ใหม่
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const iwin = iframe.contentWindow;
    const idoc = iwin?.document;
    if (!iwin || !idoc) {
      iframe.remove();
      toast({ title: "เตรียมหน้าพิมพ์ไม่สำเร็จ", variant: "destructive" });
      return;
    }
    const cleanup = () => { setTimeout(() => iframe.remove(), 300); };
    iwin.onafterprint = cleanup;
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try { iwin.focus(); iwin.print(); } catch { cleanup(); }
    };
    idoc.open();
    idoc.write(html);
    idoc.close();
    // รอรูปโหลดครบก่อนพิมพ์ (กันรูปไม่ขึ้น) + fallback กันค้าง
    const imgs = idoc.images;
    const n = imgs.length;
    let c = 0;
    if (!n) {
      setTimeout(doPrint, 150);
    } else {
      for (let i = 0; i < n; i++) {
        const im = imgs[i];
        if (im.complete) { if (++c === n) setTimeout(doPrint, 100); }
        else { im.onload = im.onerror = () => { if (++c === n) setTimeout(doPrint, 100); }; }
      }
      setTimeout(doPrint, 3000);
    }
  };

  // พิมพ์ฟอร์มเอกสารเดิมซ้ำ (ดึงรายการ + need_date + logo จาก DB โดยไม่ต้องเข้าไปแก้ไข)
  const printDoc = async (doc: MUDoc) => {
    setPrintingId(doc.id);
    try {
      const { data, error } = await (supabase as any)
        .from("monthly_usage_item")
        .select("*")
        .eq("doc_id", doc.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const items = data || [];
      if (items.length === 0) {
        toast({ title: "เอกสารว่าง ไม่มีรายการให้พิมพ์", variant: "destructive" });
        return;
      }
      const formRows: MonthlyUsageForm[] = items.map((it: any) => ({
        ...EMPTY_MU,
        barcode: it.barcode ?? "",
        sku_code: it.sku_code ?? "",
        barcode_unit: it.barcode_unit ?? "",
        product_name: it.product_name ?? "",
        uom: it.uom ?? "",
        monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
        picture: it.picture ?? "",
        remark: it.remark ?? "",
      }));
      openPrintForm(formRows, doc.brand_name, doc.need_date || "", doc.logo_url || "");
    } catch (e: any) {
      toast({ title: "พิมพ์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setPrintingId(null);
    }
  };

  // อัปไฟล์ PDF ที่เซ็นแล้ว → เก็บลิงก์ + เวลา + นับจำนวนครั้ง
  const handleSignedUpload = async (doc: MUDoc, file: File) => {
    setSignedUploadingId(doc.id);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPicture(dataUrl); // bucket เดียวกัน รองรับ pdf
      const { error } = await (supabase as any)
        .from("monthly_usage_doc")
        .update({
          signed_pdf_url: url,
          signed_uploaded_at: new Date().toISOString(),
          signed_count: (doc.signed_count || 0) + 1,
        })
        .eq("id", doc.id);
      if (error) throw error;
      toast({ title: "อัปไฟล์เซ็นแล้ว", description: doc.doc_label });
      loadDocs();
    } catch (e: any) {
      toast({ title: "อัปไฟล์ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSignedUploadingId(null);
    }
  };

  // นำเข้า Excel หลายแบรนด์พร้อมกัน (ชีตเดียว มีคอลัมน์ Brand) → แบรนด์ละ 1 Doc
  // กฎ: แบรนด์ที่มี Doc อยู่แล้ว / ไม่พบใน List Brand → Skip (ขึ้น Skiplist)
  const handleMultiImport = async (file: File) => {
    setMultiImporting(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (raw[0] as string[]).map((h) => String(h ?? "").toLowerCase().trim());
      const brIdx = headers.findIndex((h) => h.includes("brand") || h.includes("แบรน"));
      const bIdx = headers.findIndex((h) => h.includes("barcode") || h.includes("sku") || h.includes("code"));
      const qIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      const rIdx = headers.findIndex((h) => h.includes("remark") || h.includes("หมายเหตุ") || h.includes("note"));
      if (brIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Brand", variant: "destructive" }); return; }
      if (bIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }

      // จัดกลุ่มแถวตาม Brand
      const groups = new Map<string, { brand: string; rows: { code: string; qty: string; remark: string }[] }>();
      for (const r of raw.slice(1)) {
        const brand = String(r[brIdx] ?? "").trim();
        const code = String(r[bIdx] ?? "").trim();
        if (!brand || !code) continue;
        const key = brand.toLowerCase();
        if (!groups.has(key)) groups.set(key, { brand, rows: [] });
        groups.get(key)!.rows.push({
          code,
          qty: qIdx >= 0 ? String(r[qIdx] ?? "").trim() : "",
          remark: rIdx >= 0 ? String(r[rIdx] ?? "").trim() : "",
        });
      }
      if (groups.size === 0) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }

      // master Brand (List Brand) + เอกสารที่มีอยู่แล้ว
      const brandOpts = await loadBrandOptions();
      const brandByName = new Map<string, BrandRow>();
      for (const b of brandOpts) if (b.brand_name) brandByName.set(b.brand_name.trim().toLowerCase(), b);
      let nextBrandCode = brandOpts.length ? Math.max(...brandOpts.map((b) => b.code || 0)) + 1 : 1;
      const { data: existDocs } = await (supabase as any).from("monthly_usage_doc").select("brand_name");
      const existSet = new Set<string>();
      for (const d of (existDocs || []) as any[]) existSet.add(String(d.brand_name ?? "").trim().toLowerCase());

      // เลข doc_no เริ่มต้น
      const { data: maxd } = await (supabase as any).from("monthly_usage_doc").select("doc_no").order("doc_no", { ascending: false }).limit(1);
      let nextDocNo = (maxd?.[0]?.doc_no || 0) + 1;

      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

      const skips: { brand: string; reason: string; count: number }[] = [];
      let createdDocs = 0, createdItems = 0;

      for (const { brand, rows } of groups.values()) {
        const lc = brand.trim().toLowerCase();
        let master = brandByName.get(lc);
        if (!master) {
          // ไม่มีใน List Brand → สร้างให้อัตโนมัติ แล้วใช้สร้าง Doc ต่อ
          const { data: insB, error: bErr } = await (supabase as any)
            .from("brand")
            .insert({ code: nextBrandCode, brand_name: brand.trim(), branch: "" })
            .select("id, code, brand_name, branch")
            .limit(1);
          if (bErr || !insB?.[0]) {
            skips.push({ brand, reason: "สร้าง Brand อัตโนมัติไม่สำเร็จ" + (bErr ? ": " + bErr.message : ""), count: rows.length });
            continue;
          }
          master = { id: insB[0].id, code: insB[0].code, brand_name: insB[0].brand_name, branch: insB[0].branch ?? "" };
          brandByName.set(lc, master);
          nextBrandCode++;
        }
        if (existSet.has(lc)) { skips.push({ brand, reason: "มี Doc อยู่แล้ว — ไปแก้ใน Doc เดิม", count: rows.length }); continue; }

        // resolve barcode → data_master
        const resolved = await Promise.all(
          rows.map(async (rr) => {
            const res = await resolveBarcode(rr.code);
            return {
              barcode: rr.code,
              sku_code: res.found ? res.sku_code : "",
              barcode_unit: res.found ? res.barcode_unit : "",
              uom: res.found ? res.uom : "",
              product_name: res.found ? res.product_name : "ไม่พบข้อมูล",
              monthly_qty: rr.qty,
              remark: rr.remark,
            };
          }),
        );
        // dedup ภายในแบรนด์: SKU ซ้ำเอาแถวหลังสุด (ถ้าไม่มี SKU ใช้ barcode)
        const keyOf = (x: any) => (x.sku_code?.trim() ? `sku:${x.sku_code.trim()}` : `bc:${x.barcode.trim()}`);
        const map = new Map<string, any>();
        for (const x of resolved) map.set(keyOf(x), x);
        const items = [...map.values()];
        if (items.length === 0) { skips.push({ brand, reason: "ไม่มีรายการ", count: 0 }); continue; }

        const label = `${stamp} - ${master.brand_name}`.trim();
        const { data: ins, error } = await (supabase as any)
          .from("monthly_usage_doc")
          .insert({
            doc_no: nextDocNo,
            doc_label: label,
            brand_id: master.id || null,
            brand_name: master.brand_name,
            branch: master.branch || "",
            item_count: items.length,
            need_date: null,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .limit(1);
        if (error) { skips.push({ brand, reason: "สร้าง Doc ไม่สำเร็จ: " + error.message, count: rows.length }); continue; }
        const docId = ins?.[0]?.id;
        nextDocNo++;
        existSet.add(lc); // กันแบรนด์ซ้ำในไฟล์เดียวกัน

        const itemsPayload = items.map((x, i) => ({
          doc_id: docId,
          sort_order: i,
          sku_code: x.sku_code || null,
          barcode: x.barcode || null,
          barcode_unit: x.barcode_unit || null,
          product_name: x.product_name || null,
          uom: x.uom || null,
          monthly_qty: x.monthly_qty.trim() ? Number(x.monthly_qty) : null,
          daily_qty: x.monthly_qty.trim() ? Number(x.monthly_qty) / 30 : null,
          picture: null,
          remark: x.remark.trim() || null,
        }));
        const { error: itErr } = await (supabase as any).from("monthly_usage_item").insert(itemsPayload);
        if (itErr) { skips.push({ brand, reason: "บันทึกรายการไม่สำเร็จ: " + itErr.message, count: items.length }); continue; }
        createdDocs++;
        createdItems += items.length;
      }

      setImportSkips(skips);
      if (skips.length) setImportSkipOpen(true);
      toast({ title: "นำเข้าเสร็จ", description: `สร้าง ${createdDocs} Doc · ${createdItems} รายการ${skips.length ? ` · ข้าม ${skips.length} แบรนด์` : ""}` });
      loadDocs();
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMultiImporting(false);
    }
  };

  const saveMuDoc = async (needDateISO: string) => {
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
      // อัปรูปรายการทดแทนด้วย
      const replPictureUrls = await Promise.all(
        rowsToSave.map(async (r) => {
          if (!r.repl_picture) return null;
          if (r.repl_picture.startsWith("data:")) return await uploadPicture(r.repl_picture);
          return r.repl_picture;
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
        need_date: needDateISO || null,
        logo_url: editLogoUrl || null,
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
        order_group: r.order_group.trim() || null,
        picture: pictureUrls[i],
        remark: r.remark.trim() || null,
        repl_barcode: r.repl_barcode.trim() || null,
        repl_sku_code: r.repl_sku_code || null,
        repl_barcode_unit: r.repl_barcode_unit || null,
        repl_picture: replPictureUrls[i],
      }));
      const { error: itErr } = await (supabase as any).from("monthly_usage_item").insert(itemsPayload);
      if (itErr) throw itErr;

      // ออกฟอร์ม Monthly Usage Request (หน้าพิมพ์ → Save as PDF) ด้วยข้อมูลที่เพิ่งบันทึก
      const formRows = rowsToSave.map((r, i) => ({ ...r, picture: pictureUrls[i] || "" }));
      openPrintForm(formRows, selectedBrand.brand_name, needDateISO, editLogoUrl);

      toast({ title: "บันทึกสำเร็จ", description: `${label} (${rowsToSave.length} รายการ)` });
      setNeedDateOpen(false);
      setMuOpen(false);
      setBrandSubTab("monthly");
      setActiveTab("brand");
      loadDocs();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMuSaving(false);
    }
  };

  // ============================================================
  // Order functions
  // ============================================================
  const loadOrderDocs = async () => {
    setOrderDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("order_doc")
        .select("id, doc_no, doc_label, brand_name, branch, source_doc_id, item_count, created_at, updated_at")
        .order("doc_no", { ascending: false });
      if (error) throw error;
      setOrderDocs(data || []);
    } catch {
      // ตารางยังไม่ถูกสร้าง / RLS — ปล่อยว่าง ไม่รบกวน
      setOrderDocs([]);
    } finally {
      setOrderDocsLoading(false);
    }
  };

  // กดปุ่ม Order → เปิด popup เลือก Brand ก่อน
  const openOrderBrandPicker = async () => {
    setOrderPickBrandName(null);
    setOrderPickBranch("");
    setOrderBrandSearch("");
    setOrderBrandPickOpen(true);
    setOrderBrandLoading(true);
    await loadBrandOptions();
    setOrderBrandLoading(false);
  };

  // ติก Brand + พิมพ์ Branch แล้วกด "ใส่จำนวน" → ตรวจเงื่อนไข แล้วเข้าหน้า Order
  // กฎ: ต้องมีเอกสาร Monthly Usage ของแบรนด์นั้นก่อน (ไม่มี = บล็อก)
  //     1 แบรนด์ + 1 Branch = 1 Order Doc (มีแล้ว = เปิดแก้ไขเอกสารเดิม)
  const handleOrderBrandPick = async (brandName: string, branchInput: string) => {
    const branch = branchInput.trim();
    if (!brandName) return;
    if (!branch) {
      toast({ title: "กรุณาเลือก Branch ก่อน", variant: "destructive" });
      return;
    }
    // หา brand row ที่ตรงชื่อ+branch (ไว้เอา brand_id) ไม่เจอก็ใช้ row ของชื่อนั้น
    const b =
      brandOptions.find((o) => o.brand_name === brandName && o.branch.trim() === branch) ||
      brandOptions.find((o) => o.brand_name === brandName);
    if (!b) return;
    setOrderPreparing(true);
    try {
      // 1) แบรนด์ + Branch นี้มี Order Doc แล้วหรือยัง → ถ้ามี เปิดแก้ไขเอกสารเดิม
      const { data: existOrder } = await (supabase as any)
        .from("order_doc")
        .select("id, doc_no, doc_label, brand_name, branch, source_doc_id, item_count, created_at, updated_at")
        .eq("brand_name", b.brand_name)
        .eq("branch", branch)
        .limit(1);
      if (existOrder && existOrder.length) {
        setOrderBrandPickOpen(false);
        await openOrderView(existOrder[0], false);
        return;
      }

      // 2) ต้องมี Monthly Usage Doc ของแบรนด์ก่อน (หาแบบ brand-level — Monthly เก็บ branch ว่าง)
      const { data: muDoc } = await (supabase as any)
        .from("monthly_usage_doc")
        .select("id")
        .eq("brand_name", b.brand_name)
        .limit(1);
      if (!muDoc || !muDoc.length) {
        toast({
          title: "แบรนด์นี้ยังไม่มีเอกสาร Monthly Usage",
          description: `"${b.brand_name}" — ต้องสร้าง Monthly Usage ก่อน จึงจะ Order ได้`,
          variant: "destructive",
        });
        return;
      }

      // 3) ดึงรายการ Monthly Usage มาเป็นตัวตั้ง (read-only) + เติม Order Qty ว่าง
      const sourceDocId = muDoc[0].id;
      const { data: items, error } = await (supabase as any)
        .from("monthly_usage_item")
        .select("*")
        .eq("doc_id", sourceDocId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      if (!items || items.length === 0) {
        toast({ title: "เอกสาร Monthly Usage ว่าง", description: "ไม่มีรายการให้ Order", variant: "destructive" });
        return;
      }
      const rows: OrderRow[] = items.map((it: any) => ({
        sku_code: it.sku_code ?? "",
        barcode: it.barcode ?? "",
        barcode_unit: it.barcode_unit ?? "",
        product_name: it.product_name ?? "",
        uom: it.uom ?? "",
        monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
        order_qty: "",
        order_group: it.order_group ?? "",
        picture: it.picture ?? "",
        remark: it.remark ?? "",
      }));
      setOrderEditingDocId(null);
      setOrderEditingDocNo(null);
      setOrderEditingDocLabel(null);
      setOrderBrand({ id: b.id!, brand_name: b.brand_name, branch });
      setOrderSourceDocId(sourceDocId);
      setOrderRows(rows);
      setOrderReadOnly(false);
      setOrderOpen(true);
      setOrderBrandPickOpen(false);
      setBrandSubTab("order_edit");
      setActiveTab("brand");
    } catch (e: any) {
      toast({ title: "เตรียมข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setOrderPreparing(false);
    }
  };

  // เปิดดู/แก้ไข Order Doc เดิม
  const openOrderView = async (doc: OrderDoc, readOnly = true) => {
    setOrderOpen(true);
    setOrderReadOnly(readOnly);
    setBrandSubTab("order_edit");
    setActiveTab("brand");
    setOrderLoading(true);
    setOrderEditingDocId(doc.id);
    setOrderEditingDocNo(doc.doc_no);
    setOrderEditingDocLabel(doc.doc_label);
    setOrderBrand({ id: "", brand_name: doc.brand_name, branch: doc.branch });
    setOrderSourceDocId(doc.source_doc_id);
    try {
      const { data, error } = await (supabase as any)
        .from("order_item")
        .select("*")
        .eq("doc_id", doc.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setOrderRows(
        (data || []).map((it: any) => ({
          sku_code: it.sku_code ?? "",
          barcode: it.barcode ?? "",
          barcode_unit: it.barcode_unit ?? "",
          product_name: it.product_name ?? "",
          uom: it.uom ?? "",
          monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
          order_qty: it.order_qty != null ? String(it.order_qty) : "",
          order_group: it.order_group ?? "",
          picture: it.picture ?? "",
          remark: it.remark ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "เปิดเอกสารไม่สำเร็จ", description: e.message, variant: "destructive" });
      setOrderRows([]);
    } finally {
      setOrderLoading(false);
    }
  };

  const updateOrderQty = (idx: number, value: string) =>
    setOrderRows((prev) => prev.map((r, i) => (i === idx ? { ...r, order_qty: value } : r)));

  const closeOrderEditor = () => {
    setOrderOpen(false);
    setBrandSubTab("order");
    setActiveTab("brand");
  };

  // บันทึก Order Doc (1 Brand = 1 Order Doc)
  const saveOrderDoc = async () => {
    if (!orderBrand || (!orderBrand.id && !orderBrand.brand_name)) {
      toast({ title: "ไม่พบ Brand", variant: "destructive" });
      return;
    }
    const ordered = orderRows.filter((r) => r.order_qty.trim() && Number(r.order_qty) > 0);
    if (ordered.length === 0) {
      toast({ title: "ยังไม่ได้ใส่จำนวน Order", description: "กรอก Order Qty อย่างน้อย 1 รายการ", variant: "destructive" });
      return;
    }
    setOrderSaving(true);
    try {
      // ตอนสร้างใหม่ — กันแบรนด์ที่มี Order Doc แล้ว (1 Brand = 1 Order Doc)
      if (!orderEditingDocId) {
        const { data: existing } = await (supabase as any)
          .from("order_doc")
          .select("doc_label")
          .eq("brand_name", orderBrand.brand_name)
          .eq("branch", orderBrand.branch)
          .limit(1);
        if (existing && existing.length) {
          toast({ title: "Brand นี้มี Order แล้ว", description: `"${orderBrand.brand_name}" มี ${existing[0].doc_label} อยู่แล้ว — 1 Brand ได้ 1 Order Doc`, variant: "destructive" });
          setOrderSaving(false);
          return;
        }
      }

      let docNo = orderEditingDocNo;
      if (!orderEditingDocId) {
        const { data: maxd } = await (supabase as any)
          .from("order_doc")
          .select("doc_no")
          .order("doc_no", { ascending: false })
          .limit(1);
        docNo = (maxd?.[0]?.doc_no || 0) + 1;
      }
      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
      const label = orderEditingDocId && orderEditingDocLabel
        ? orderEditingDocLabel
        : `${stamp} - ${orderBrand.brand_name} (Order)`.trim();
      const docPayload: any = {
        doc_no: docNo,
        doc_label: label,
        brand_id: orderBrand.id || null,
        brand_name: orderBrand.brand_name,
        branch: orderBrand.branch,
        source_doc_id: orderSourceDocId,
        item_count: ordered.length,
        updated_at: new Date().toISOString(),
      };

      let docId = orderEditingDocId;
      if (orderEditingDocId) {
        const { error } = await (supabase as any).from("order_doc").update(docPayload).eq("id", orderEditingDocId);
        if (error) throw error;
        const { error: delErr } = await (supabase as any).from("order_item").delete().eq("doc_id", orderEditingDocId);
        if (delErr) throw delErr;
      } else {
        const { data: ins, error } = await (supabase as any).from("order_doc").insert(docPayload).select("id").limit(1);
        if (error) throw error;
        docId = ins?.[0]?.id;
      }

      const itemsPayload = ordered.map((r, i) => ({
        doc_id: docId,
        sort_order: i,
        sku_code: r.sku_code || null,
        barcode: r.barcode.trim() || null,
        barcode_unit: r.barcode_unit || null,
        product_name: r.product_name || null,
        uom: r.uom || null,
        monthly_qty: r.monthly_qty.trim() ? Number(r.monthly_qty) : null,
        order_qty: Number(r.order_qty),
        order_group: r.order_group?.trim() || null,
        picture: r.picture || null,
        remark: r.remark.trim() || null,
      }));
      const { error: itErr } = await (supabase as any).from("order_item").insert(itemsPayload);
      if (itErr) throw itErr;

      // แยกสร้าง SO Doc (SCM Control → tab SO) ตาม order_group — เฉพาะรายการที่ resolve เจอข้อมูล
      const soCount = await generateSODocs(docId!, orderBrand, ordered);

      toast({
        title: "บันทึก Order สำเร็จ",
        description: `${label} (${ordered.length} รายการ)${soCount > 0 ? ` · สร้าง ${soCount} SO ใน SCM Control` : ""}`,
      });
      setOrderOpen(false);
      setBrandSubTab("order");
      setActiveTab("brand");
      loadOrderDocs();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setOrderSaving(false);
    }
  };

  const deleteOrderDoc = async (doc: OrderDoc) => {
    if (!window.confirm(`ลบ Order "${doc.doc_label}" และรายการทั้งหมด?`)) return;
    try {
      const { error } = await (supabase as any).from("order_doc").delete().eq("id", doc.id);
      if (error) throw error;
      toast({ title: "ลบ Order แล้ว", description: doc.doc_label });
      loadOrderDocs();
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const exportOrderDoc = async (doc: OrderDoc) => {
    try {
      const { data, error } = await (supabase as any)
        .from("order_item")
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
        "Order Qty": it.order_qty ?? "",
        Remark: it.remark || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 4 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 36 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Order");
      const safeName = doc.doc_label.replace(/[\\/:*?"<>|]/g, "_");
      XLSX.writeFile(wb, `${safeName}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // ============================================================
  // SO functions (SCM Control → tab SO)
  // ============================================================
  const loadSoDocs = async () => {
    setSoDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("so_doc")
        .select("id, doc_no, doc_label, brand_name, branch, order_doc_id, order_group, customer, item_count, created_at, updated_at")
        .order("doc_no", { ascending: false });
      if (error) throw error;
      setSoDocs(data || []);
    } catch {
      // ตารางยังไม่ถูกสร้าง / RLS — ปล่อยว่าง ไม่รบกวน
      setSoDocs([]);
    } finally {
      setSoDocsLoading(false);
    }
  };

  // สร้าง SO Doc แยกตาม order_group จากรายการ Order ที่สั่ง (order_qty > 0 + resolve เจอข้อมูล)
  // regenerate: ลบ SO เดิมของ order_doc นี้ก่อนทุกครั้ง → คืนจำนวน SO ที่สร้าง
  const generateSODocs = async (orderDocId: string, brand: { id: string; brand_name: string; branch: string }, ordered: OrderRow[]): Promise<number> => {
    try {
      // เฉพาะมีข้อมูล = resolve เจอ product + มี barcode (พร้อมยิงเข้า Odoo)
      const dataRows = ordered.filter(
        (r) => (r.barcode_unit?.trim() || r.barcode?.trim()) && r.product_name?.trim() && r.product_name !== "ไม่พบข้อมูล" && Number(r.order_qty) > 0,
      );

      // ลบ SO เดิมของ order_doc นี้ (CASCADE ลบ so_item ด้วย)
      await (supabase as any).from("so_doc").delete().eq("order_doc_id", orderDocId);
      if (dataRows.length === 0) return 0;

      // จัดกลุ่มตาม order_group (trim; ว่าง = "")
      const groups = new Map<string, { display: string; rows: OrderRow[] }>();
      for (const r of dataRows) {
        const display = (r.order_group || "").trim();
        const key = display.toLowerCase();
        if (!groups.has(key)) groups.set(key, { display, rows: [] });
        groups.get(key)!.rows.push(r);
      }

      // เลข doc_no เริ่มต้น
      const { data: maxd } = await (supabase as any).from("so_doc").select("doc_no").order("doc_no", { ascending: false }).limit(1);
      let nextDocNo = (maxd?.[0]?.doc_no || 0) + 1;

      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

      let created = 0;
      for (const { display, rows } of groups.values()) {
        const groupLabel = display || "ไม่ระบุกลุ่ม";
        const label = `${stamp} - ${brand.brand_name} - ${groupLabel} (SO)`.trim();
        const { data: ins, error } = await (supabase as any)
          .from("so_doc")
          .insert({
            doc_no: nextDocNo,
            doc_label: label,
            brand_id: brand.id || null,
            brand_name: brand.brand_name,
            branch: brand.branch || "",
            order_doc_id: orderDocId,
            order_group: display,
            customer: SO_DEFAULT_CUSTOMER,
            item_count: rows.length,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .limit(1);
        if (error) throw error;
        const soDocId = ins?.[0]?.id;
        nextDocNo++;

        const itemsPayload = rows.map((r, i) => ({
          doc_id: soDocId,
          sort_order: i,
          sku_code: r.sku_code || null,
          barcode: r.barcode?.trim() || null,
          barcode_unit: r.barcode_unit || null,
          product_name: r.product_name || null,
          uom: r.uom || null,
          order_qty: Number(r.order_qty),
          order_group: display || null,
          picture: r.picture || null,
          remark: r.remark?.trim() || null,
        }));
        const { error: itErr } = await (supabase as any).from("so_item").insert(itemsPayload);
        if (itErr) throw itErr;
        created++;
      }
      loadSoDocs();
      return created;
    } catch (e: any) {
      toast({ title: "สร้าง SO ไม่สำเร็จ", description: e.message, variant: "destructive" });
      return 0;
    }
  };

  const deleteSoDoc = async (doc: SODoc) => {
    if (!window.confirm(`ลบ SO "${doc.doc_label}" และรายการทั้งหมด?`)) return;
    try {
      const { error } = await (supabase as any).from("so_doc").delete().eq("id", doc.id);
      if (error) throw error;
      toast({ title: "ลบ SO แล้ว", description: doc.doc_label });
      setSoSelected((p) => { const n = new Set(p); n.delete(doc.id); return n; });
      loadSoDocs();
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  const openSoView = async (doc: SODoc) => {
    setSoViewDoc(doc);
    setSoViewLoading(true);
    setSoViewItems([]);
    try {
      const { data, error } = await (supabase as any)
        .from("so_item")
        .select("*")
        .eq("doc_id", doc.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setSoViewItems(
        (data || []).map((it: any) => ({
          sku_code: it.sku_code ?? "",
          barcode: it.barcode ?? "",
          barcode_unit: it.barcode_unit ?? "",
          product_name: it.product_name ?? "",
          uom: it.uom ?? "",
          order_qty: it.order_qty != null ? String(it.order_qty) : "",
          order_group: it.order_group ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "เปิดเอกสารไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSoViewLoading(false);
    }
  };

  // สร้างแถว SO (รูปแบบ/คอลัมน์ยืดจาก Order B2B) — main row ที่ idx 0 ใส่ค่า header
  const buildSoExportRows = (items: SOItem[], customer: string): Record<string, any>[] =>
    items.map((r, idx) => ({
      "Order Reference": "",
      "Customer": idx === 0 ? customer : "",
      "Pricelist": idx === 0 ? SO_PRICELIST : "",
      "Order Lines/Barcode": r.barcode_unit || r.barcode,
      "Order Lines/Product": r.barcode_unit || r.barcode,
      "Product Name": r.product_name,
      "UOM": r.uom,
      "Order Lines/Quantity": Number(r.order_qty) || 0,
      "Source Document": idx === 0 ? "" : "",
      "Warehouse": idx === 0 ? SO_WAREHOUSE : "",
      "Company": idx === 0 ? SO_COMPANY : "",
    }));

  const fetchSoItems = async (docId: string): Promise<SOItem[]> => {
    const { data, error } = await (supabase as any)
      .from("so_item")
      .select("*")
      .eq("doc_id", docId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data || []).map((it: any) => ({
      sku_code: it.sku_code ?? "",
      barcode: it.barcode ?? "",
      barcode_unit: it.barcode_unit ?? "",
      product_name: it.product_name ?? "",
      uom: it.uom ?? "",
      order_qty: it.order_qty != null ? String(it.order_qty) : "",
      order_group: it.order_group ?? "",
    }));
  };

  // export หลาย SO Doc พร้อมกัน (รวมเป็นไฟล์เดียว) — แต่ละ Doc = 1 SO group
  const exportSoSelected = async () => {
    const list = filteredSoDocs.filter((d) => soSelected.has(d.id));
    if (list.length === 0) { toast({ title: "กรุณาเลือก SO ก่อน", variant: "destructive" }); return; }
    setSoExporting(true);
    try {
      const all: Record<string, any>[] = [];
      for (const d of list) {
        const items = await fetchSoItems(d.id);
        if (items.length === 0) continue;
        const rows = buildSoExportRows(items, d.customer || SO_DEFAULT_CUSTOMER);
        const mapped = await remapRowsByTemplate("srr_special_so", rows);
        all.push(...mapped);
      }
      if (all.length === 0) { toast({ title: "ไม่มีรายการให้ export", variant: "destructive" }); return; }
      const ws = XLSX.utils.json_to_sheet(all);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "SO");
      const pad = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
      XLSX.writeFile(wb, `${stamp}-SO-Combined.xlsx`);
      toast({ title: "Export SO สำเร็จ", description: `${list.length} SO` });
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSoExporting(false);
    }
  };

  const exportSoSingle = async (doc: SODoc) => {
    try {
      const items = await fetchSoItems(doc.id);
      if (items.length === 0) { toast({ title: "เอกสารว่าง ไม่มีรายการให้ export", variant: "destructive" }); return; }
      const rows = await remapRowsByTemplate("srr_special_so", buildSoExportRows(items, doc.customer || SO_DEFAULT_CUSTOMER));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "SO");
      const safeName = doc.doc_label.replace(/[\\/:*?"<>|]/g, "_");
      XLSX.writeFile(wb, `${safeName}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // ค้นหา item (barcode / id / product name) → เก็บ doc_id ที่ match (ค้น doc_label/brand ทำ client-side)
  useEffect(() => {
    const q = soSearch.trim();
    if (!q) { setSoItemHitIds(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const like = `%${q}%`;
        const { data } = await (supabase as any)
          .from("so_item")
          .select("doc_id")
          .or(`barcode.ilike.${like},barcode_unit.ilike.${like},sku_code.ilike.${like},product_name.ilike.${like}`)
          .limit(5000);
        if (cancelled) return;
        setSoItemHitIds(new Set((data || []).map((r: any) => r.doc_id)));
      } catch {
        if (!cancelled) setSoItemHitIds(new Set());
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [soSearch]);

  const filteredSoDocs = (() => {
    const q = soSearch.trim().toLowerCase();
    if (!q) return soDocs;
    return soDocs.filter(
      (d) =>
        d.doc_label?.toLowerCase().includes(q) ||
        String(d.doc_no).includes(q) ||
        d.brand_name?.toLowerCase().includes(q) ||
        (d.order_group || "").toLowerCase().includes(q) ||
        (soItemHitIds?.has(d.id) ?? false),
    );
  })();

  const toggleSoSel = (id: string) => setSoSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ensure selected brand option appears even if it's not in the live list (deleted brand)
  const mergedBrandOptions =
    selectedBrand && selectedBrand.id && !brandOptions.find((o) => o.id === selectedBrand.id)
      ? [{ id: selectedBrand.id, code: 0, brand_name: selectedBrand.brand_name, branch: selectedBrand.branch }, ...brandOptions]
      : brandOptions;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-3 flex items-end justify-between">
          <TabsList className="h-8">
            <TabsTrigger value="brand" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
              <Tag className="w-3.5 h-3.5" /> Brand control
            </TabsTrigger>
            <TabsTrigger value="scm_control" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
              <Boxes className="w-3.5 h-3.5" /> SCM Control
            </TabsTrigger>
          </TabsList>

          {/* Routeplan — แนบ PDF + เวลาอัปล่าสุด */}
          <div className="flex items-center gap-2 pb-1">
            {routeplan?.pdf_url && (
              <div className="text-[11px] leading-tight text-right">
                <a href={routeplan.pdf_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">ดูไฟล์ล่าสุด</a>
                <div className="text-muted-foreground">
                  {routeplan.uploaded_at ? new Date(routeplan.uploaded_at).toLocaleString("th-TH") : "-"} · {routeplan.upload_count || 0} ครั้ง
                </div>
              </div>
            )}
            <label
              title="แนบไฟล์ PDF Routeplan"
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border-2 border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer text-xs font-medium"
            >
              {routeplanUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
              Routeplan
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={routeplanUploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRouteplanUpload(f); e.target.value = ""; }}
              />
            </label>
          </div>
        </div>

        <TabsContent value="brand" className="flex-1 overflow-hidden mt-0 p-4 bg-background flex-col min-h-0 data-[state=active]:flex">
          <Tabs value={brandSubTab} onValueChange={setBrandSubTab} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList className="h-8">
                <TabsTrigger value="monthly" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                  <BarChart3 className="w-3.5 h-3.5" /> Monthly usage
                </TabsTrigger>
                <TabsTrigger value="order" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                  <ShoppingCart className="w-3.5 h-3.5" /> Order
                </TabsTrigger>
                {orderOpen && (
                  <TabsTrigger value="order_edit" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                    <ShoppingCart className="w-3.5 h-3.5" /> Order (แก้ไข)
                  </TabsTrigger>
                )}
                {muOpen && (
                  <TabsTrigger value="view" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                    <Eye className="w-3.5 h-3.5" /> แสดงข้อมูล
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Toolbar ของ Monthly usage (โผล่เฉพาะหน้า Monthly usage) */}
              {brandSubTab === "monthly" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openDialog}
                    title="List Brand"
                    className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    <Tag className="w-4 h-4" />
                    <span className="text-[10px] leading-none font-medium">List Brand</span>
                  </button>
                  <button
                    onClick={openMuNew}
                    title="Monthly usage (สร้างใหม่)"
                    className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-[10px] leading-none font-medium">Monthly</span>
                  </button>
                  <label
                    title="Import Monthly Excel (หลายแบรนด์ในไฟล์เดียว)"
                    className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                  >
                    {multiImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span className="text-[10px] leading-none font-medium">Import</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      disabled={multiImporting}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMultiImport(f); e.target.value = ""; }}
                    />
                  </label>
                  <button
                    onClick={downloadMultiTemplate}
                    title="ดาวน์โหลด Template (Excel หลายแบรนด์)"
                    className="flex items-center justify-center h-9 w-9 rounded-lg border-2 border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* ปุ่ม Order (โผล่เฉพาะหน้า Order) */}
              {brandSubTab === "order" && (
                <button
                  onClick={openOrderBrandPicker}
                  title="สร้าง Order (เลือกแบรนด์ แล้วคีย์ Order Qty)"
                  className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span className="text-[10px] leading-none font-medium">Order</span>
                </button>
              )}
            </div>

            <TabsContent value="monthly" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex">
          {/* Monthly usage docs */}
          <div className="border rounded-lg flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/50">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">เอกสาร Monthly usage</span>
              {docsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                  <th className="px-3 py-1.5 font-medium">Doc</th>
                  <th className="px-3 py-1.5 font-medium w-28">Logo</th>
                  <th className="px-3 py-1.5 font-medium">Brand</th>
                  <th className="px-3 py-1.5 font-medium w-24 text-right">Total SKU</th>
                  <th className="px-3 py-1.5 font-medium w-28 text-right">SKU No Odoo</th>
                  <th className="px-3 py-1.5 font-medium w-36">แก้ไขล่าสุด</th>
                  <th className="px-3 py-1.5 font-medium w-52">ไฟล์เซ็น (PDF)</th>
                  <th className="px-3 py-1.5 font-medium w-52" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{d.doc_label}</td>
                    <td className="px-3 py-1.5">
                      <label
                        className={cn(
                          "inline-flex items-center justify-center h-12 w-20 border rounded cursor-pointer hover:bg-muted relative overflow-hidden bg-muted/20 shrink-0",
                          d.brand_logo_url && "border-primary",
                        )}
                        title={d.brand_logo_url ? "เปลี่ยนโลโก้แบรนด์" : "อัปโลโก้แบรนด์"}
                      >
                        {brandLogoUploadingId === d.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : d.brand_logo_url ? (
                          <img src={d.brand_logo_url} alt="brand logo" className="w-full h-full object-contain" />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-muted-foreground" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={brandLogoUploadingId === d.id}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBrandLogo(d, f); e.target.value = ""; }}
                        />
                      </label>
                    </td>
                    <td className="px-3 py-1.5">{d.brand_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {(noOdooMap[d.id] || 0) > 0
                        ? <span className="text-destructive font-medium">{noOdooMap[d.id]}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(d.updated_at || d.created_at).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <label
                          className="inline-flex items-center justify-center h-7 w-7 border rounded cursor-pointer hover:bg-muted shrink-0"
                          title="แนบไฟล์ PDF ที่เซ็นแล้ว"
                        >
                          {signedUploadingId === d.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileSignature className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            className="hidden"
                            disabled={signedUploadingId === d.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSignedUpload(d, f); e.target.value = ""; }}
                          />
                        </label>
                        {d.signed_uploaded_at ? (
                          <div className="text-[11px] leading-tight">
                            <a href={d.signed_pdf_url || "#"} target="_blank" rel="noreferrer" className="text-primary hover:underline">ดูไฟล์ล่าสุด</a>
                            <div className="text-muted-foreground">
                              {new Date(d.signed_uploaded_at).toLocaleString("th-TH")} · {d.signed_count || 0} ครั้ง
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">ยังไม่อัป</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openMuView(d)}>
                          <Eye className="w-3.5 h-3.5" /> View
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" title="พิมพ์ฟอร์ม" onClick={() => printDoc(d)} disabled={printingId === d.id}>
                          {printingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                        </Button>
                        <label
                          className={cn(
                            "inline-flex items-center justify-center h-7 w-7 border rounded cursor-pointer hover:bg-muted relative overflow-hidden shrink-0",
                            d.logo_url && "border-primary",
                          )}
                          title={d.logo_url ? "เปลี่ยนโลโก้ (โชว์มุมซ้ายบนของฟอร์ม)" : "เพิ่มโลโก้ (โชว์มุมซ้ายบนของฟอร์ม)"}
                        >
                          {logoUploadingId === d.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : d.logo_url ? (
                            <img src={d.logo_url} alt="logo" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={logoUploadingId === d.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDocLogo(d, f); e.target.value = ""; }}
                          />
                        </label>
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
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      ยังไม่มีเอกสาร — กด "Monthly usage" เพื่อสร้างใหม่
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
            </TabsContent>

            {/* ============ Order — รายการ Order Doc ============ */}
            <TabsContent value="order" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex">
          <div className="border rounded-lg flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/50">
              <ShoppingCart className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">เอกสาร Order</span>
              {orderDocsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                  <th className="px-3 py-1.5 font-medium">Doc</th>
                  <th className="px-3 py-1.5 font-medium">Brand</th>
                  <th className="px-3 py-1.5 font-medium">Branch</th>
                  <th className="px-3 py-1.5 font-medium w-24 text-right">รายการ</th>
                  <th className="px-3 py-1.5 font-medium w-36">แก้ไขล่าสุด</th>
                  <th className="px-3 py-1.5 font-medium w-48" />
                </tr>
              </thead>
              <tbody>
                {orderDocs.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{d.doc_label}</td>
                    <td className="px-3 py-1.5">{d.brand_name}</td>
                    <td className="px-3 py-1.5">{d.branch || "-"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(d.updated_at || d.created_at).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openOrderView(d)}>
                          <Eye className="w-3.5 h-3.5" /> View
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" title="Export Excel" onClick={() => exportOrderDoc(d)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ Order" onClick={() => deleteOrderDoc(d)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {orderDocs.length === 0 && !orderDocsLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      ยังไม่มี Order — กด "สร้าง Order" เพื่อเลือกแบรนด์
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
            </TabsContent>

            {/* ============ Order editor (sub-tab ใต้ Brand control) ============ */}
            <TabsContent value="order_edit" className="mt-0 flex-1 overflow-auto min-h-0 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={closeOrderEditor}>
              <X className="w-4 h-4" /> ปิด
            </Button>
            <div className="text-sm font-semibold">
              {orderEditingDocId ? `Order — ${orderEditingDocLabel || ""}` : `Order — ${orderBrand?.brand_name || ""}`}
              {orderReadOnly && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(โหมดดู)</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {orderReadOnly ? (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setOrderReadOnly(false)}>
                  <Pencil className="w-4 h-4" /> แก้ไข
                </Button>
              ) : (
                <Button size="sm" className="h-8 gap-1.5" onClick={saveOrderDoc} disabled={orderSaving || orderLoading}>
                  {orderSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Order
                </Button>
              )}
            </div>
          </div>

          {orderLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Brand / Branch</Label>
                <div className="h-9 flex items-center px-3 border rounded-md bg-muted/40 text-sm">
                  <span className="font-medium">{orderBrand?.brand_name || "—"}</span>
                  {orderBrand?.branch && <span className="ml-1.5 text-muted-foreground">· {orderBrand.branch}</span>}
                  <span className="ml-2 text-[11px] text-muted-foreground">(อ้างอิงรายการจาก Monthly Usage — แก้ได้แค่ Order Qty)</span>
                </div>
              </div>

              <div className="overflow-x-auto border rounded-md">
                <table className="text-sm border-collapse" style={{ width: ORDER_TOTAL_W, tableLayout: "fixed" }}>
                  <colgroup>
                    {ORDER_COLS.map((c) => (
                      <col key={c.key} style={{ width: c.w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted text-left">
                      {ORDER_COLS.map((c) => (
                        <th key={c.key} className="px-2 py-1.5 font-medium border-r last:border-r-0 select-none whitespace-nowrap">
                          <span className="block truncate">{c.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderRows.map((row, idx) => (
                      <tr key={idx} className="border-t align-middle">
                        <td className="px-2 py-1 text-center text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-2 py-1 text-xs truncate" title={row.barcode}>{row.barcode || "-"}</td>
                        <td className="px-2 py-1 text-xs truncate" title={row.sku_code}>{row.sku_code || "-"}</td>
                        <td className="px-2 py-1 text-xs truncate" title={row.barcode_unit}>{row.barcode_unit || "-"}</td>
                        <td className="px-2 py-1 text-xs truncate" title={row.uom}>{row.uom || "-"}</td>
                        <td className={`px-2 py-1 text-xs truncate ${row.product_name === "ไม่พบข้อมูล" ? "text-destructive" : ""}`} title={row.product_name}>{row.product_name || "-"}</td>
                        <td className="px-2 py-1 text-xs text-right tabular-nums text-muted-foreground">{row.monthly_qty || "-"}</td>
                        <td className="px-1 py-1">
                          <div className="w-12 h-12 border rounded flex items-center justify-center bg-muted/30 overflow-hidden mx-auto">
                            {row.picture
                              ? <img src={row.picture} alt="picture" className="w-full h-full object-cover cursor-zoom-in" onClick={() => window.open(row.picture, "_blank")} />
                              : <span className="text-[9px] text-muted-foreground">-</span>}
                          </div>
                        </td>
                        <td className="px-2 py-1 text-xs truncate" title={row.remark}>{row.remark || "-"}</td>
                        <td className="px-1 py-1">
                          <Input
                            type="number"
                            value={row.order_qty}
                            readOnly={orderReadOnly}
                            onChange={(e) => updateOrderQty(idx, e.target.value)}
                            className={`h-8 w-full ${orderReadOnly ? "bg-muted/50" : ""}`}
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    ))}
                    {orderRows.length === 0 && (
                      <tr>
                        <td colSpan={ORDER_COLS.length} className="px-2 py-6 text-center text-muted-foreground">
                          ไม่มีรายการ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">บันทึกเฉพาะรายการที่ใส่ Order Qty มากกว่า 0</p>
            </div>
          )}
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
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="แทรกแถวใหม่ใต้แถวนี้" onClick={() => insertRowBelow(idx)}>
                            <Plus className="w-4 h-4 text-primary" />
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
                      <td colSpan={SHOW_BRAND_BRANCH ? 4 : 3} className="px-2 py-6 text-center text-muted-foreground">
                        <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
                          <Plus className="w-4 h-4" /> เพิ่มแถวแรก
                        </Button>
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

            {/* ============ แสดงข้อมูล / แก้ไข (sub-tab ใต้ Brand control) ============ */}
            <TabsContent value="view" className="mt-0 flex-1 overflow-auto min-h-0 space-y-3">
          {/* header toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => { setMuOpen(false); setBrandSubTab("monthly"); setActiveTab("brand"); }}>
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
                    <button className="text-[11px] text-primary hover:underline" onClick={() => setVisCols(new Set(MU_TOGGLE_COLS.map((c) => c.key)))}>เลือกทั้งหมด</button>
                  </div>
                  <div className="max-h-72 overflow-auto space-y-0.5">
                    {MU_TOGGLE_COLS.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={visibleMuCols.has(c.key)}
                          onChange={() => { const n = new Set(visibleMuCols); n.has(c.key) ? n.delete(c.key) : n.add(c.key); setVisCols(n); }}
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
                  <Button size="sm" className="h-8 gap-1.5" onClick={openNeedDatePopup} disabled={muSaving || muLoading}>
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
                            {/* แก้ barcode ได้เฉพาะรายการที่ยังไม่พบ SKU (ไม่พบข้อมูล/แถวใหม่) */}
                            <Input
                              data-r={idx}
                              data-c={0}
                              value={row.barcode}
                              readOnly={muReadOnly || !!row.sku_code}
                              onChange={(e) => updateMuField(idx, "barcode", e.target.value)}
                              onBlur={() => handleBarcodeLookup(idx)}
                              onKeyDown={(e) => handleCellKey(e, idx, 0)}
                              className={`h-8 w-full ${muReadOnly || row.sku_code ? "bg-muted/50" : ""}`}
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
                          {isColShown("pname_en") && (() => {
                            const notFound = row.product_name === "ไม่พบข้อมูล";
                            const txt = notFound ? "ไม่พบข้อมูลในระบบ" : (row.product_name_en || "-");
                            return <td className={`px-2 py-1 text-xs truncate ${notFound ? "text-destructive" : ""}`} title={txt}>{txt}</td>;
                          })()}
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
                          {isColShown("order_group") && <td className="px-1 py-1">
                            <Input
                              value={row.order_group}
                              readOnly={muReadOnly}
                              onChange={(e) => updateMuField(idx, "order_group", e.target.value)}
                              className={`h-8 w-full ${muReadOnly ? "bg-muted/50" : ""}`}
                              placeholder="กลุ่ม"
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
                          {/* ===== รายการทดแทน (replacement) ===== */}
                          {isColShown("repl_barcode") && <td className="px-1 py-1">
                            <Input
                              value={row.repl_barcode}
                              readOnly={muReadOnly}
                              onChange={(e) => updateMuField(idx, "repl_barcode", e.target.value)}
                              onBlur={() => handleReplBarcodeLookup(idx)}
                              className={`h-8 w-full ${muReadOnly ? "bg-muted/50" : ""}`}
                              placeholder="คีย์ barcode ทดแทน"
                            />
                          </td>}
                          {isColShown("repl_sku") && <td className="px-1 py-1">
                            <Input value={row.repl_sku_code} readOnly className="h-8 w-full bg-muted/50" placeholder="auto" />
                          </td>}
                          {isColShown("repl_bunit") && <td className="px-1 py-1">
                            <Input value={row.repl_barcode_unit} readOnly className="h-8 w-full bg-muted/50" placeholder="auto" />
                          </td>}
                          {isColShown("repl_pname_en") && (() => {
                            const nf = row.repl_product_name_en === "ไม่พบข้อมูลในระบบ";
                            const txt = row.repl_product_name_en || "-";
                            return <td className={`px-2 py-1 text-xs truncate ${nf ? "text-destructive" : ""}`} title={txt}>{txt}</td>;
                          })()}
                          {isColShown("repl_pic") && <td className="px-1 py-1">
                            {muReadOnly ? (
                              <div className="w-14 h-14 border rounded flex items-center justify-center bg-muted/30 overflow-hidden">
                                {row.repl_picture
                                  ? <img src={row.repl_picture} alt="repl" className="w-full h-full object-cover cursor-zoom-in" onClick={() => window.open(row.repl_picture, "_blank")} />
                                  : <span className="text-[9px] text-muted-foreground">-</span>}
                              </div>
                            ) : (
                            <div className="flex items-center gap-1">
                              <div
                                tabIndex={0}
                                onPaste={(e) => handleRowPaste(idx, e, "repl_picture")}
                                className="relative w-14 h-14 border rounded flex items-center justify-center bg-muted/30 overflow-hidden outline-none focus:ring-2 focus:ring-primary shrink-0"
                                title="คลิกแล้ว Ctrl+V เพื่อวางรูป"
                              >
                                {row.repl_picture ? (
                                  <>
                                    <img src={row.repl_picture} alt="repl" className="w-full h-full object-cover cursor-zoom-in" onClick={() => window.open(row.repl_picture, "_blank")} />
                                    <button type="button" onClick={() => updateMuField(idx, "repl_picture", "")} className="absolute -top-1 -right-1 bg-background rounded-full p-0.5 border hover:bg-muted" title="ลบรูป">
                                      <X className="w-3 h-3 text-destructive" />
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-[9px] text-muted-foreground text-center leading-tight px-0.5">Ctrl+V</span>
                                )}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <label className="inline-flex items-center justify-center h-6 w-6 border rounded cursor-pointer hover:bg-muted" title="นำเข้ารูป">
                                  <Upload className="w-3.5 h-3.5" />
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRowFile(idx, e, "repl_picture")} />
                                </label>
                                <label className="inline-flex items-center justify-center h-6 w-6 border rounded cursor-pointer hover:bg-muted" title="ถ่ายรูป">
                                  <Camera className="w-3.5 h-3.5" />
                                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleRowFile(idx, e, "repl_picture")} />
                                </label>
                              </div>
                            </div>
                            )}
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
        </TabsContent>

        {/* ============ SCM Control ============ */}
        <TabsContent value="scm_control" className="flex-1 overflow-hidden mt-0 p-4 bg-background flex-col min-h-0 data-[state=active]:flex">
          <Tabs value={scmSubTab} onValueChange={setScmSubTab} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList className="h-8">
                <TabsTrigger value="so" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> SO
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="so" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
              {/* Toolbar: ค้นหา + Select All + Export */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={soSearch}
                    onChange={(e) => setSoSearch(e.target.value)}
                    className="h-8 pl-8"
                    placeholder="ค้นหา เลข Doc / Barcode / ID / Product name"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {filteredSoDocs.length} / {soDocs.length} SO
                  {soSelected.size > 0 && <> · เลือก {soSelected.size}</>}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setSoSelected(new Set(filteredSoDocs.map((d) => d.id)))}
                    disabled={filteredSoDocs.length === 0}
                  >
                    <Check className="w-3.5 h-3.5" /> Select All
                  </Button>
                  {soSelected.size > 0 && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setSoSelected(new Set())}>
                      <X className="w-3.5 h-3.5" /> ล้าง
                    </Button>
                  )}
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={exportSoSelected} disabled={soSelected.size === 0 || soExporting}>
                    {soExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Export SO ({soSelected.size})
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/50">
                  <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">เอกสาร SO</span>
                  {soDocsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex-1 overflow-auto min-h-0">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-30">
                      <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                        <th className="px-3 py-1.5 w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={filteredSoDocs.length > 0 && filteredSoDocs.every((d) => soSelected.has(d.id))}
                            onChange={(e) =>
                              setSoSelected(e.target.checked ? new Set(filteredSoDocs.map((d) => d.id)) : new Set())
                            }
                          />
                        </th>
                        <th className="px-3 py-1.5 font-medium">Doc</th>
                        <th className="px-3 py-1.5 font-medium">Brand</th>
                        <th className="px-3 py-1.5 font-medium">Order group</th>
                        <th className="px-3 py-1.5 font-medium">Customer</th>
                        <th className="px-3 py-1.5 font-medium w-24 text-right">รายการ</th>
                        <th className="px-3 py-1.5 font-medium w-36">แก้ไขล่าสุด</th>
                        <th className="px-3 py-1.5 font-medium w-40" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSoDocs.map((d) => (
                        <tr key={d.id} className={cn("border-b last:border-0 hover:bg-muted/40", soSelected.has(d.id) && "bg-primary/5")}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" className="h-4 w-4" checked={soSelected.has(d.id)} onChange={() => toggleSoSel(d.id)} />
                          </td>
                          <td className="px-3 py-1.5 font-medium">{d.doc_label}</td>
                          <td className="px-3 py-1.5">{d.brand_name}</td>
                          <td className="px-3 py-1.5">{d.order_group?.trim() || <span className="text-muted-foreground">ไม่ระบุกลุ่ม</span>}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{d.customer || SO_DEFAULT_CUSTOMER}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{new Date(d.updated_at || d.created_at).toLocaleString("th-TH")}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openSoView(d)}>
                                <Eye className="w-3.5 h-3.5" /> View
                              </Button>
                              <Button variant="outline" size="icon" className="h-7 w-7" title="Export SO (Excel)" onClick={() => exportSoSingle(d)}>
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ SO" onClick={() => deleteSoDoc(d)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredSoDocs.length === 0 && !soDocsLoading && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                            {soDocs.length === 0
                              ? "ยังไม่มี SO — Save Order ที่ Brand control แล้วระบบจะแยกสร้าง SO ตาม Order group ให้อัตโนมัติ"
                              : "ไม่พบ SO ที่ค้นหา"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
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

      {/* ถาม "วันที่คาดว่าจะเบิก" (DATE Need) ก่อนบันทึก → ออกฟอร์ม */}
      <Dialog open={needDateOpen} onOpenChange={(o) => { if (!muSaving) setNeedDateOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>วันที่คาดว่าจะเบิก (DATE Need)</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">เลือกวันที่ที่คาดว่าจะเบิกสินค้า</Label>
            <Input
              type="date"
              value={needDate}
              onChange={(e) => setNeedDate(e.target.value)}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">บันทึกแล้วระบบจะเปิดหน้าฟอร์มให้พิมพ์ / Save as PDF อัตโนมัติ</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeedDateOpen(false)} disabled={muSaving}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (!needDate) { toast({ title: "กรุณาเลือกวันที่คาดว่าจะเบิก", variant: "destructive" }); return; }
                saveMuDoc(needDate);
              }}
              disabled={muSaving}
            >
              {muSaving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              บันทึก & ออกฟอร์ม
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skiplist — แบรนด์ที่ข้ามตอน Import Monthly Excel */}
      <Dialog open={importSkipOpen} onOpenChange={setImportSkipOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>แบรนด์ที่ข้าม (Skiplist) — {importSkips.length} แบรนด์</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">Brand</th>
                  <th className="px-2 py-1.5 font-medium">เหตุผล</th>
                  <th className="px-2 py-1.5 font-medium text-right w-16">รายการ</th>
                </tr>
              </thead>
              <tbody>
                {importSkips.map((s, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-2 py-1.5 font-medium">{s.brand}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{s.reason}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button onClick={() => setImportSkipOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* เลือก Brand (ติกทีละ 1, distinct ตามชื่อ) + เลือก Branch จาก dropdown ก่อนเข้า Order */}
      <Dialog open={orderBrandPickOpen} onOpenChange={(o) => { if (!orderPreparing) setOrderBrandPickOpen(o); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>เลือก Brand เพื่อ Order</DialogTitle>
          </DialogHeader>
          {orderBrandLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (() => {
            // brand distinct ตามชื่อ (ไม่แยกตาม branch) — เรียงตามชื่อ
            const distinctBrands = [...new Set(brandOptions.map((b) => b.brand_name.trim()).filter(Boolean))].sort((a, b) =>
              a.localeCompare(b),
            );
            const oq = orderBrandSearch.trim().toLowerCase();
            const list = distinctBrands.filter((name) => !oq || name.toLowerCase().includes(oq));
            // branch ของแบรนด์ที่ติก (distinct, ไม่ว่าง)
            const branchOpts = orderPickBrandName
              ? [...new Set(brandOptions.filter((b) => b.brand_name.trim() === orderPickBrandName && b.branch.trim()).map((b) => b.branch.trim()))].sort((a, b) =>
                  a.localeCompare(b),
                )
              : [];
            return (
              <div className="relative grid grid-cols-2 gap-4">
                {/* คอลัมน์ซ้าย: ติกเลือก Brand */}
                <div className="space-y-2">
                  <Label className="text-xs">Brand <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={orderBrandSearch}
                      onChange={(e) => setOrderBrandSearch(e.target.value)}
                      className="h-9 pl-8"
                      placeholder="ค้นหา Brand..."
                      disabled={orderPreparing}
                    />
                  </div>
                  <div className="border rounded-md h-[240px] overflow-y-auto p-1">
                    {distinctBrands.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">ยังไม่มี Brand — เพิ่มใน List Brand ก่อน</div>
                    ) : list.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">ไม่พบ Brand</div>
                    ) : (
                      list.map((name) => {
                        const checked = orderPickBrandName === name;
                        return (
                          <label
                            key={name}
                            className={cn(
                              "flex items-center gap-2 px-2 py-2 rounded cursor-pointer text-sm hover:bg-muted",
                              checked && "bg-muted",
                              orderPreparing && "pointer-events-none opacity-60",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0"
                              checked={checked}
                              disabled={orderPreparing}
                              onChange={() => { setOrderPickBrandName(checked ? null : name); setOrderPickBranch(""); }}
                            />
                            {name}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* คอลัมน์ขวา: เลือก Branch ของแบรนด์ที่ติก */}
                <div className="space-y-2">
                  <Label className="text-xs">Branch <span className="text-destructive">*</span></Label>
                  <Select
                    value={orderPickBranch}
                    onValueChange={setOrderPickBranch}
                    disabled={!orderPickBrandName || branchOpts.length === 0 || orderPreparing}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={!orderPickBrandName ? "ติกเลือกแบรนด์ก่อน" : branchOpts.length === 0 ? "แบรนด์นี้ยังไม่มี Branch" : "เลือก Branch"} />
                    </SelectTrigger>
                    <SelectContent>
                      {branchOpts.map((br) => (
                        <SelectItem key={br} value={br}>{br}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {orderPickBrandName && branchOpts.length === 0 && (
                    <p className="text-[11px] text-destructive">แบรนด์ "{orderPickBrandName}" ยังไม่มี Branch — เพิ่ม Branch ใน List Brand ก่อน</p>
                  )}
                  <p className="text-[11px] text-muted-foreground pt-1">แบรนด์ต้องมีเอกสาร Monthly Usage ก่อน จึงจะ Order ได้</p>
                </div>

                {orderPreparing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderBrandPickOpen(false)} disabled={orderPreparing}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => { if (orderPickBrandName) handleOrderBrandPick(orderPickBrandName, orderPickBranch); }}
              disabled={!orderPickBrandName || !orderPickBranch.trim() || orderPreparing}
            >
              {orderPreparing && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              ใส่จำนวน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ดูรายการใน SO Doc (read-only) */}
      <Dialog open={!!soViewDoc} onOpenChange={(o) => { if (!o) { setSoViewDoc(null); setSoViewItems([]); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{soViewDoc?.doc_label || "SO"}</DialogTitle>
          </DialogHeader>
          {soViewLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <div className="text-xs text-muted-foreground mb-2">
                Brand: <b>{soViewDoc?.brand_name}</b> · Order group: <b>{soViewDoc?.order_group?.trim() || "ไม่ระบุกลุ่ม"}</b> · Customer: <b>{soViewDoc?.customer || SO_DEFAULT_CUSTOMER}</b>
              </div>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-10 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Barcode</th>
                    <th className="px-2 py-1.5 font-medium">ID (SKU)</th>
                    <th className="px-2 py-1.5 font-medium">Product name</th>
                    <th className="px-2 py-1.5 font-medium">UOM</th>
                    <th className="px-2 py-1.5 font-medium text-right w-20">Order Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {soViewItems.map((it, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1">{it.barcode_unit || it.barcode || "-"}</td>
                      <td className="px-2 py-1">{it.sku_code || "-"}</td>
                      <td className="px-2 py-1">{it.product_name || "-"}</td>
                      <td className="px-2 py-1">{it.uom || "-"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{it.order_qty || "-"}</td>
                    </tr>
                  ))}
                  {soViewItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">ไม่มีรายการ</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSoViewDoc(null); setSoViewItems([]); }}>ปิด</Button>
            {soViewDoc && (
              <Button onClick={() => exportSoSingle(soViewDoc)} className="gap-1.5">
                <Download className="w-4 h-4" /> Export SO
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
