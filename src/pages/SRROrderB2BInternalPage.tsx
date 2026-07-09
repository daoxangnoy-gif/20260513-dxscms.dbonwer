import { useEffect, useRef, useState, useMemo, Fragment } from "react";
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
import { Tag, Plus, Trash2, Loader2, Search, Copy, BarChart3, Upload, Camera, X, Eye, Download, Pencil, ChevronsUpDown, Check, FileSpreadsheet, Columns3, Image as ImageIcon, Printer, FileSignature, ShoppingCart, Boxes, Route, Save, Filter, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { remapRowsByTemplate } from "@/lib/exportTemplate";
import DCKRControlTab from "@/components/DCKRControlTab";
import ProductSearchDialog from "@/components/ProductSearchDialog";
import POReportDialog from "@/components/POReportDialog";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";

const MU_BUCKET = "monthly-usage-pictures";

// แปลงค่า cell (Excel serial number / Date / string) → Date
function excelCellToDate(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const num = typeof v === "number" ? v : (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
  if (num != null) {
    const o = (XLSX as any).SSF?.parse_date_code?.(num);
    if (o && o.y) return new Date(o.y, o.m - 1, o.d, o.H || 0, o.M || 0, Math.floor(o.S || 0));
    return null;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

// แปลงค่า cell วันที่ → "dd-Mmm-yy" (ถ้าแปลงไม่ได้คืนค่าเดิม)
function excelToDDMMMYY(v: any): string {
  const d = excelCellToDate(v);
  if (!d) return String(v ?? "").trim();
  const MM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${MM[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

// วันที่ Need ขั้นต่ำ = วันนี้ + 7 วัน (yyyy-mm-dd, อิงเวลาท้องถิ่น)
function minNeedDateISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ===== SO export (SCM Control → tab SO) — คอนเซ็ปต์/คอลัมน์ยืดจาก Order B2B (SO) =====
const SO_COMPANY = "Lanexang Green Property Sole Co.,Ltd";
const SO_WAREHOUSE = "DC Thongpong";
const SO_PRICELIST = "WSPRICE 2 (Internal B2B)";
// ตัวเลือก Pricelist สำหรับ Convert SO (dropdown)
const CONVERT_SO_PRICELISTS = ["WSPRICE 2 (Internal B2B)", "WSPRICE 14 (LGP to KR F&B)"];
// ค่า default ของ Order lines/Route + Warehouse ตาม Pricelist ที่เลือก (Convert SO)
const SO_PRICELIST_META: Record<string, { route: string; warehouse: string }> = {
  "WSPRICE 2 (Internal B2B)":   { route: "DC Thongpong: Deliver B2B LGP", warehouse: "DC Thongpong" },
  "WSPRICE 14 (LGP to KR F&B)": { route: "DC Thongpong: Deliver B2B KFC", warehouse: "DC KFC" },
};
const SO_ROUTE_OPTIONS = ["DC Thongpong: Deliver B2B LGP", "DC Thongpong: Deliver B2B KFC"];
const SO_WAREHOUSE_OPTIONS = ["DC Thongpong", "DC KFC"];
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

// อัปรูป (raw bytes) ขึ้น Storage → คืน public URL (ใช้ตอน Import Excel ที่ฝังรูปไว้)
async function uploadImageBytes(data: Uint8Array, ext: string): Promise<string> {
  const mime = /^jpe?g$/.test(ext) ? "image/jpeg" : `image/${ext}`;
  const blob = new Blob([data], { type: mime });
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MU_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw error;
  return supabase.storage.from(MU_BUCKET).getPublicUrl(path).data.publicUrl;
}

// อ่านรูปที่ฝังใน Excel (xlsx) → Map<xdrRow(0-based), {data, ext}>
// xdrRow 0 = header, 1 = data row 1, ... ตรงกับ raw.slice(1)[i] → xdrRow = i+1
async function extractImagesFromXlsx(ab: ArrayBuffer): Promise<Map<number, { data: Uint8Array; ext: string }>> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(ab);
    // ใช้ result ก้อนเดียวรวมทั้ง 2 method (Method 2 เติมแถวที่ Method 1 ยังไม่มี)
    const result = new Map<number, { data: Uint8Array; ext: string }>();

    // --- Method 1: Traditional drawing XML (รูปลอย) — อ่าน "ทุก" drawing part ---
    const drawingFiles = zip.file(/^xl\/drawings\/drawing\d+\.xml$/) || [];
    const drawingRelsByName = new Map<string, any>();
    for (const rf of (zip.file(/^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/) || [])) {
      drawingRelsByName.set(rf.name.replace("/_rels/", "/").replace(/\.rels$/, ""), rf);
    }
    for (const df of drawingFiles) {
      const relsFile = drawingRelsByName.get(df.name);
      if (!relsFile) continue;
      const [drawingXml, drawingRelsXml] = await Promise.all([df.async("string"), relsFile.async("string")]);
      const rIdToPath = new Map<string, string>();
      for (const [, id, target] of drawingRelsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        if (/\.(png|jpe?g|gif|webp|bmp)/i.test(target))
          rIdToPath.set(id, "xl/media/" + target.replace(/^.*\//, ""));
      }
      const anchorRe = /<xdr:(?:two|one)CellAnchor[\s\S]*?<\/xdr:(?:two|one)CellAnchor>/g;
      for (const [anchor] of drawingXml.matchAll(anchorRe)) {
        const rowM = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        const rIdM = anchor.match(/r:embed="([^"]+)"/);
        if (!rowM || !rIdM) continue;
        const row0 = parseInt(rowM[1], 10);
        const imgPath = rIdToPath.get(rIdM[1]);
        if (!imgPath || result.has(row0)) continue;
        const imgFile = zip.file(imgPath);
        if (!imgFile) continue;
        const data = await imgFile.async("uint8array");
        const ext = imgPath.split(".").pop()?.toLowerCase() || "png";
        result.set(row0, { data, ext });
      }
    }

    // --- Method 2: Excel 365 Rich Value / Cell Images (WPS xlsx) ---
    // Chain: sheet <c vm=N> → cellMetadata[N] → futureMetadata[M] → rvb i=P
    //        → richValueRel rel[P] r:id → _rels Target → xl/media/imageX.png
    const rvRelXmlFile = zip.file("xl/richData/richValueRel.xml");
    const rvRelsXmlFile = zip.file("xl/richData/_rels/richValueRel.xml.rels");
    const metadataXmlFile = zip.file("xl/metadata.xml");
    const sheetXmlFile = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)?.[0];
    if (rvRelXmlFile && rvRelsXmlFile && metadataXmlFile && sheetXmlFile) {
      const [rvRelXml, rvRelsXml, metaXml, sheetXml] = await Promise.all([
        rvRelXmlFile.async("string"),
        rvRelsXmlFile.async("string"),
        metadataXmlFile.async("string"),
        sheetXmlFile.async("string"),
      ]);
      // 1. _rels: rId → absolute media path in zip
      const rIdToMedia = new Map<string, string>();
      for (const m of rvRelsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        const [, id, target] = m;
        if (/\.(png|jpe?g|gif|webp|bmp)/i.test(target)) {
          const resolved = target.startsWith("../") ? "xl/" + target.slice(3)
            : target.startsWith("/") ? target.slice(1)
            : "xl/richData/" + target;
          rIdToMedia.set(id, resolved);
        }
      }
      // 2. richValueRel.xml: rich value index = ตำแหน่งของ <rel> (0-based) → rId
      //    WPS ไม่ใส่ attribute i= ใน <rel> จึงต้องนับตำแหน่งเอง
      const rvIdxToRId = new Map<number, string>();
      let relPos = 0;
      for (const m of rvRelXml.matchAll(/<rel\b([^>]*?)\/?>/g)) {
        const rIdM = m[1].match(/(?:r:)?id="([^"]+)"/i);
        if (rIdM) { rvIdxToRId.set(relPos, rIdM[1]); relPos++; }
      }
      // 3. metadata.xml futureMetadata XLRICHVALUE: fmIdx → rv index (rvb/@i)
      const fmIdxToRvIdx = new Map<number, number>();
      const fmSection = metaXml.match(/<futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/)?.[1] ?? "";
      let fmIdx = 0;
      for (const bkM of fmSection.matchAll(/<bk>([\s\S]*?)<\/bk>/g)) {
        const rvbM = bkM[1].match(/rvb[^>]*\bi="(\d+)"/);
        if (rvbM) fmIdxToRvIdx.set(fmIdx, parseInt(rvbM[1]));
        fmIdx++;
      }
      // 4. metadata.xml valueMetadata: vmIdx (0-based) → fmIdx (rc/@v)
      //    cell ใช้ vm="N" (1-based) ชี้มาที่ valueMetadata ไม่ใช่ cellMetadata
      const vmIdxToFmIdx = new Map<number, number>();
      const vmSection = metaXml.match(/<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/)?.[1] ?? "";
      let vmPos = 0;
      for (const bkM of vmSection.matchAll(/<bk>([\s\S]*?)<\/bk>/g)) {
        const rcM = bkM[1].match(/<rc\b[^>]*\bv="(\d+)"/);
        if (rcM) vmIdxToFmIdx.set(vmPos, parseInt(rcM[1]));
        vmPos++;
      }
      // 5. sheet XML: <c r="COLROW" vm="N"> → vmIdx=N-1 → fmIdx → rvIdx → rId → media
      for (const m of sheetXml.matchAll(/<c\b([^>]*)>/g)) {
        const attrs = m[1];
        const rM = attrs.match(/\br="([A-Z]+)(\d+)"/);
        const vmM = attrs.match(/\bvm="(\d+)"/);
        if (!rM || !vmM) continue;
        const xdrRow = parseInt(rM[2]) - 1;
        if (result.has(xdrRow)) continue;
        const fmIdx2 = vmIdxToFmIdx.get(parseInt(vmM[1]) - 1);
        if (fmIdx2 === undefined) continue;
        const rvIdx = fmIdxToRvIdx.get(fmIdx2);
        if (rvIdx === undefined) continue;
        const rId = rvIdxToRId.get(rvIdx);
        if (!rId) continue;
        const mediaPath = rIdToMedia.get(rId);
        if (!mediaPath) continue;
        const imgFile = zip.file(mediaPath);
        if (!imgFile) continue;
        const data = await imgFile.async("uint8array");
        const ext = mediaPath.split(".").pop()?.toLowerCase() || "png";
        result.set(xdrRow, { data, ext });
      }
    }

    return result;
  } catch {
    return new Map();
  }
}

type BrandRow = { id?: string; code: number; brand_name: string; branch: string; brand_group: string };

type MonthlyUsageForm = {
  barcode: string;
  sku_code: string;
  barcode_unit: string;
  product_name: string;     // ชื่อสินค้า LA (ดั้งเดิม — ซ่อน default)
  product_name_en: string;  // ชื่อสินค้า EN
  imported_name: string;    // ชื่อสินค้าดิบที่พิมพ์ตอน import (ไม่ถูก resolve ทับ)
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
  imported_name: "",
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
  { key: "idx", label: "#", def: 64, min: 52 },
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
  { key: "iname", label: "ชื่อสินค้า (import)", def: 220, min: 120 },
  { key: "ibarcode", label: "Barcode (import)", def: 150, min: 90 },
  { key: "pname", label: "Product name (LA)", def: 240, min: 120 },
  { key: "mqty", label: "จำนวน/3เดือน", def: 120, min: 90 },
  { key: "order_group", label: "Order group", def: 130, min: 90 },
  { key: "dqty", label: "จำนวน/เดือน (÷3)", def: 120, min: 90 },
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
const MU_VIS_KEY = "mu_col_visible_v8";
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

// Dropdown เลือกลูกค้า (ค้นหาได้) — ดึงรายชื่อจากตาราง customers
type CustomerOpt = { code: string; name: string };
function CustomerCombo({ value, options, onChange }: { value: string; options: CustomerOpt[]; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? options.filter((o) => o.name.toLowerCase().includes(s) || o.code.toLowerCase().includes(s)) : options;
    return base.slice(0, 50);
  }, [q, options]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-left text-muted-foreground hover:text-foreground truncate max-w-[230px]">
          <span className="truncate">{value || SO_DEFAULT_CUSTOMER}</span>
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ค้นหาลูกค้า / รหัส" value={q} onValueChange={setQ} />
          <CommandList onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}>
            <CommandEmpty>ไม่พบลูกค้า</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o.code} value={o.code} onSelect={() => { onChange(o.name); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o.name ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.name}</span>
                  <span className="ml-auto pl-2 text-[10px] text-muted-foreground shrink-0">{o.code}</span>
                </CommandItem>
              ))}
              {q.trim() === "" && options.length > 50 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">พิมพ์เพื่อค้นหา (แสดง 50 จาก {options.length})</div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Dropdown เลือก Vendor (ค้นหาได้) — ใช้ตอน Convert เมื่อไฟล์ไม่ได้ใส่ Vendor code (ค่าเริ่มต้นทั้งไฟล์)
function VendorPickCombo({ value, options, onChange }: { value: string; options: CustomerOpt[]; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? options.filter((o) => o.name.toLowerCase().includes(s) || o.code.toLowerCase().includes(s)) : options;
    return base.slice(0, 50);
  }, [q, options]);
  const sel = options.find((o) => o.code === value);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 h-8 px-2 border rounded-md text-left text-xs w-64 bg-background hover:bg-muted/50">
          <span className="truncate flex-1">{sel ? `${sel.code} · ${sel.name}` : (value || "— เลือก Vendor เริ่มต้น —")}</span>
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ค้นหา Vendor / รหัส" value={q} onValueChange={setQ} />
          <CommandList onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}>
            <CommandEmpty>ไม่พบ Vendor</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="__clear__" onSelect={() => { onChange(""); setOpen(false); setQ(""); }}>
                  <X className="mr-2 h-3.5 w-3.5 opacity-70" /> <span className="text-muted-foreground">ล้างค่า</span>
                </CommandItem>
              )}
              {filtered.map((o) => (
                <CommandItem key={o.code} value={o.code} onSelect={() => { onChange(o.code); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o.code ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.name}</span>
                  <span className="ml-auto pl-2 text-[10px] text-muted-foreground shrink-0">{o.code}</span>
                </CommandItem>
              ))}
              {q.trim() === "" && options.length > 50 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">พิมพ์เพื่อค้นหา (แสดง 50 จาก {options.length})</div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Dropdown เลือกชื่อสาขา (ค้นหาได้) — ใช้เป็น Warehouse ตอนติ๊ก SO Store (ดึงจาก store_type.store_name)
function StorePickCombo({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? options.filter((o) => o.toLowerCase().includes(s)) : options;
    return base.slice(0, 50);
  }, [q, options]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 h-8 px-2 border rounded-md text-left text-xs w-56 bg-background hover:bg-muted/50">
          <span className="truncate flex-1">{value || "— เลือกสาขา —"}</span>
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ค้นหาสาขา" value={q} onValueChange={setQ} />
          <CommandList onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}>
            <CommandEmpty>ไม่พบสาขา</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o}</span>
                </CommandItem>
              ))}
              {q.trim() === "" && options.length > 50 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">พิมพ์เพื่อค้นหา (แสดง 50 จาก {options.length})</div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ===== Convert (SCM Control → tab PO) — import รหัส+จำนวน แล้ว Convert เป็น PO/SO Excel (ไม่ filter) =====
// แต่ละแถวหลัง enrich: resolve barcode → sku + unit barcode (packing_size_qty=1) + product/vendor/pocost
type ConvertRow = {
  inputCode: string;      // รหัสที่ import เข้ามา (barcode/sku)
  qty: number;
  fileVendor: string;     // Vendor code จากไฟล์ (ถ้ามี)
  found: boolean;         // เจอใน data_master ไหม
  sku: string;
  unitBarcode: string;    // main_barcode ของแถว packing_size_qty=1
  productName: string;    // la > en > th (สำหรับ SO)
  productNameEn: string;  // สำหรับ PO
  uom: string;
  dmVendor: string;       // vendor_code จาก data_master
  costByVendor: Record<string, number>; // PO Cost Unit ของ SKU นี้ แยกตาม vendor code (match ID+Vendor, fallback vendor อื่น)
  fileUnitPrice: number | null;         // Pocost Unit จากไฟล์ import (ถ้ากรอก = override)
  standardPrice: number | null;         // Standard price จาก data_master (packing_size_qty=1) — fallback ตอน LAK ไม่มี
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
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("b2b_active_tab") || "brand");
  const [brandSubTab, setBrandSubTab] = useState(() => localStorage.getItem("b2b_brand_sub_tab") || "monthly"); // sub-tab ใต้ Brand control: monthly | order
  const { toast } = useToast();
  // จำ tab ที่อยู่ไว้ใน localStorage (กันเด้งกลับ tab แรกตอนสลับเมนู)
  useEffect(() => { localStorage.setItem("b2b_active_tab", activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem("b2b_brand_sub_tab", brandSubTab); }, [brandSubTab]);

  // ===== สิทธิ์ (แยกต่อแท็บ: b2b_brand / b2b_scm / b2b_dckr) =====
  const { isAdmin, canViewMenu, canDo } = useAuth();
  const can = (menu: string, action: any) => isAdmin || canDo(menu, action);
  const viewMenu = (menu: string) => isAdmin || canViewMenu(menu);
  const pBrandView = viewMenu("b2b_brand");
  const pScmView = viewMenu("b2b_scm");
  const pDckrView = viewMenu("b2b_dckr");
  // เด้งไปแท็บแรกที่มีสิทธิ์ ถ้าแท็บปัจจุบันดูไม่ได้
  useEffect(() => {
    const ok = (t: string) => (t === "brand" && pBrandView) || (t === "scm_control" && pScmView) || (t === "dckr" && pDckrView);
    if (!ok(activeTab)) {
      const first = pBrandView ? "brand" : pScmView ? "scm_control" : pDckrView ? "dckr" : "brand";
      setActiveTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pBrandView, pScmView, pDckrView]);


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
        .select("id, code, brand_name, branch, brand_group")
        .order("code", { ascending: true });
      if (error) throw error;
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          code: r.code,
          brand_name: r.brand_name ?? "",
          branch: r.branch ?? "",
          brand_group: r.brand_group ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, { code: prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1, brand_name: "", branch: "", brand_group: "" }]);
  };

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  // แทรกแถวใหม่ (ว่าง) ใต้แถวที่กด
  const insertRowBelow = (idx: number) =>
    setRows((prev) => {
      const newCode = prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1;
      const next = [...prev];
      next.splice(idx + 1, 0, { code: newCode, brand_name: "", branch: "", brand_group: "" });
      return next;
    });

  const duplicateRow = (idx: number) =>
    setRows((prev) => {
      const src = prev[idx];
      const newCode = prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1;
      const copy: BrandRow = { code: newCode, brand_name: src.brand_name, branch: src.branch, brand_group: src.brand_group };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });

  const updateRow = (idx: number, field: "brand_name" | "branch" | "brand_group", value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const q = search.trim().toLowerCase();
  const visibleRows = rows
    .map((row, idx) => ({ row, idx }))
    .filter(
      ({ row }) =>
        !q ||
        row.brand_name.toLowerCase().includes(q) ||
        row.branch.toLowerCase().includes(q) ||
        row.brand_group.toLowerCase().includes(q) ||
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
      const payload = rows.map((r) => ({ code: r.code, brand_name: r.brand_name.trim(), branch: r.branch.trim(), brand_group: r.brand_group.trim() }));
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

  // ดาวน์โหลด Template (หัวคอลัมน์ Code / Brand name / Branch / Group)
  const downloadBrandTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Code", "Brand name", "Branch", "Group"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "List Brand");
    XLSX.writeFile(wb, "ListBrand_Template.xlsx");
  };

  // นำเข้า Excel → merge เข้ารายการในจอ (จับหัวคอลัมน์ตาม alias) แล้วให้ผู้ใช้กด Save
  const importBrandFile = async (file: File) => {
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไม่พบข้อมูลในไฟล์", variant: "destructive" }); return; }
      const headers = (raw[0] as any[]).map((h) => String(h ?? "").toLowerCase().trim());
      const findIdx = (aliases: string[]) => headers.findIndex((h) => aliases.some((a) => h.includes(a)));
      const ci = { code: findIdx(["code", "รหัส"]), name: findIdx(["brand name", "brand", "แบรนด์", "ชื่อ"]), branch: findIdx(["branch", "สาขา"]), group: findIdx(["group", "กลุ่ม"]) };
      if (ci.name < 0) { toast({ title: "ไม่พบคอลัมน์ Brand name ในไฟล์", variant: "destructive" }); return; }

      const parsed = raw.slice(1)
        .filter((r) => r.some((v) => String(v ?? "").trim()))
        .map((r) => ({
          code: ci.code >= 0 && String(r[ci.code] ?? "").trim() ? Number(r[ci.code]) : NaN,
          brand_name: ci.name >= 0 ? String(r[ci.name] ?? "").trim() : "",
          branch: ci.branch >= 0 ? String(r[ci.branch] ?? "").trim() : "",
          brand_group: ci.group >= 0 ? String(r[ci.group] ?? "").trim() : "",
        }))
        .filter((r) => r.brand_name);
      if (parsed.length === 0) { toast({ title: "ไม่พบรายการที่นำเข้าได้", variant: "destructive" }); return; }

      setRows((prev) => {
        const next = [...prev];
        let nextCode = next.length ? Math.max(...next.map((r) => r.code)) + 1 : 1;
        for (const p of parsed) {
          // merge: ถ้ามี Code ตรงกัน → อัปเดต, ไม่งั้นเทียบ Brand+Branch ซ้ำ, สุดท้ายเพิ่มใหม่
          let i = !isNaN(p.code) ? next.findIndex((r) => r.code === p.code) : -1;
          if (i < 0) i = next.findIndex((r) => r.brand_name.trim().toLowerCase() === p.brand_name.toLowerCase() && r.branch.trim().toLowerCase() === p.branch.toLowerCase());
          if (i >= 0) next[i] = { ...next[i], brand_name: p.brand_name, branch: p.branch, brand_group: p.brand_group };
          else next.push({ code: !isNaN(p.code) ? p.code : nextCode++, brand_name: p.brand_name, branch: p.branch, brand_group: p.brand_group });
        }
        return next;
      });
      toast({ title: "นำเข้าสำเร็จ", description: `${parsed.length} รายการ — ตรวจสอบแล้วกด Save เพื่อบันทึก` });
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
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
      // ต้อง paginate — ถ้า item รวมทุก doc เกิน 1000 จะติด limit ของ Supabase → doc ใหม่สุด (insert ทีหลัง) ถูกตัด → นับเป็น 0
      const ids = (data || []).map((d: any) => d.id);
      if (ids.length) {
        const m: Record<string, number> = {};
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data: items, error: itErr } = await (supabase as any)
            .from("monthly_usage_item")
            .select("id, doc_id, sku_code")
            .in("doc_id", ids)
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (itErr) break;
          for (const it of (items || []) as any[]) {
            if (!String(it.sku_code ?? "").trim()) m[it.doc_id] = (m[it.doc_id] || 0) + 1;
          }
          if (!items || items.length < PAGE) break;
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
    loadCustomers(); // โหลดรายชื่อลูกค้าไว้ใช้ใน dropdown ของ SO
    loadBrandOptions(); // โหลด brand (รวม brand_group) ไว้ใช้จัดกลุ่มหัวข้อในรายการเอกสาร
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

  // ===== ลบเอกสารที่เลือก (multi) =====
  const deleteSelectedMuDocs = async () => {
    const ids = [...muSelected];
    if (ids.length === 0) return;
    if (!window.confirm(`ลบเอกสารที่เลือก ${ids.length} ฉบับ และรายการทั้งหมด?`)) return;
    try {
      await (supabase as any).from("monthly_usage_item").delete().in("doc_id", ids); // ลบ item ก่อน กัน orphan
      const { error } = await (supabase as any).from("monthly_usage_doc").delete().in("id", ids);
      if (error) throw error;
      toast({ title: `ลบ ${ids.length} เอกสารแล้ว` });
      setMuSelected(new Set());
      loadDocs();
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // ===== Dialog จัดการโลโก้ (หัวฟอร์ม/PDF = logo_url) — import หลายโลโก้ + ติกเลือก Doc ต่อโลโก้ =====
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoItems, setLogoItems] = useState<{ url: string; name: string }[]>([]);
  const [logoDocMap, setLogoDocMap] = useState<Record<string, number>>({}); // docId → logo index (1 doc ได้ 1 logo)
  const [logoBusy, setLogoBusy] = useState(false);
  const openLogoDialog = () => { setLogoItems([]); setLogoDocMap({}); setLogoDialogOpen(true); };
  const addLogoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLogoBusy(true);
    try {
      const added: { url: string; name: string }[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadPicture(await fileToDataUrl(f));
        added.push({ url, name: f.name });
      }
      setLogoItems((prev) => [...prev, ...added]);
    } catch (e: any) {
      toast({ title: "อัปโลโก้ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setLogoBusy(false); }
  };
  const toggleLogoDoc = (docId: string, logoIdx: number) => setLogoDocMap((prev) => {
    const n = { ...prev }; if (n[docId] === logoIdx) delete n[docId]; else n[docId] = logoIdx; return n;
  });
  const saveLogoAssignments = async () => {
    const entries = Object.entries(logoDocMap);
    if (entries.length === 0) { toast({ title: "ยังไม่ได้เลือก Doc ให้โลโก้", variant: "destructive" }); return; }
    setLogoBusy(true);
    try {
      const byLogo = new Map<number, string[]>();
      for (const [docId, idx] of entries) { if (!byLogo.has(idx)) byLogo.set(idx, []); byLogo.get(idx)!.push(docId); }
      let applied = 0;
      for (const [idx, docIds] of byLogo) {
        const url = logoItems[idx]?.url; if (!url) continue;
        const { error } = await (supabase as any).from("monthly_usage_doc").update({ logo_url: url }).in("id", docIds);
        if (error) throw error;
        applied += docIds.length;
      }
      toast({ title: `ใส่โลโก้ให้ ${applied} เอกสารแล้ว` });
      setLogoDialogOpen(false);
      loadDocs();
    } catch (e: any) {
      toast({ title: "บันทึกโลโก้ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally { setLogoBusy(false); }
  };

  // เลือกเอกสาร (multi-select) สำหรับ Export หลายฉบับ
  const [muSelected, setMuSelected] = useState<Set<string>>(new Set());
  const toggleMuSel = (id: string) => setMuSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [muExporting, setMuExporting] = useState(false);
  const [muExportMsg, setMuExportMsg] = useState<{ phase: string; current: number; total: number } | null>(null);

  // เพิ่ม worksheet ของ 1 เอกสารลง workbook (คืน false ถ้าเอกสารว่าง) — ใช้ร่วม single + multi export
  const addMuSheet = async (wb: any, ExcelJS: any, doc: MUDoc, sheetName: string): Promise<boolean> => {
    const { data, error } = await (supabase as any)
      .from("monthly_usage_item")
      .select("*")
      .eq("doc_id", doc.id)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const items = data || [];
    if (items.length === 0) return false;
    // enrich ข้อมูลอ้างอิงจาก data_master ตาม sku_code
    const skus = [...new Set(items.map((it: any) => it.sku_code).filter(Boolean))] as string[];
    const dmMap: Record<string, any> = {};
    if (skus.length) {
      const { data: dm } = await (supabase as any)
        .from("data_master")
        .select("sku_code, division_group, division, department, buying_status, vendor_code, vendor_display_name")
        .eq("packing_size_qty", 1) // 1 sku = 1 row → กันชน 1000-row cap เมื่อ sku มีหลาย packing size
        .in("sku_code", skus);
      for (const d of (dm || []) as any[]) { if (d.sku_code && !dmMap[d.sku_code]) dmMap[d.sku_code] = d; }
    }
    const headers = ["#", "ID (SKU)", "Barcode", "Barcode Unit", "Product name", "UOM",
      "3monthly qty", "Monthly qty", "Remark", "รูป", "รูป (IMAGE)",
      "Division Group", "Division", "Department", "Buying Status", "Vendor Origin", "Product name (import)"];
    const widths = [4, 14, 16, 16, 36, 8, 14, 12, 30, 14, 18, 16, 14, 16, 14, 22, 36];
    const PIC_COL = 10; // 1-based: "รูป"(ลิงก์) · "รูป (IMAGE)" = PIC_COL+1
    const ws = wb.addWorksheet(sheetName);
    ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }));
    ws.getRow(1).font = { bold: true };

    items.forEach((it: any, i: number) => {
      const d = dmMap[it.sku_code] || {};
      const vendorOrigin = (d.vendor_code && vendorOriginMapRef.current[d.vendor_code]) || "";
      const row = ws.addRow([
        i + 1, it.sku_code || "", it.barcode || "", it.barcode_unit || "",
        it.product_name || "", it.uom || "",
        it.monthly_qty ?? "", // 3monthly qty (ค่าเดิม)
        it.monthly_qty != null && it.monthly_qty !== "" ? (Number(it.monthly_qty) / 3).toFixed(2) : "", // Monthly qty = 3monthly / 3
        it.remark || "", "", "", // "รูป"(ลิงก์) + "รูป (IMAGE)"(สูตร) — ใส่ด้านล่าง
        d.division_group || "", d.division || "", d.department || "",
        d.buying_status || "", vendorOrigin,
        it.imported_name || "", // Product name (import) — ชื่อดิบจากไฟล์
      ]);
      const rowIdx = row.number; // 1-based (header = 1, data เริ่ม 2)
      row.height = 36; // ทุกแถวสูงเท่ากัน ~48px (มี/ไม่มีรูปก็เท่ากัน)
      row.alignment = { vertical: "middle" }; // ตัวหนังสือกึ่งกลางแนวตั้ง
      if (it.picture) {
        const linkCell = ws.getCell(rowIdx, PIC_COL);
        linkCell.value = { text: "เปิดรูป", hyperlink: it.picture } as any;
        linkCell.font = { color: { argb: "FF0563C1" }, underline: true };
        // Excel 365: แสดงรูปในเซลล์จาก URL (เวอร์ชันที่ไม่รองรับจะขึ้น #NAME? — ใช้คอลัมน์ลิงก์แทน)
        ws.getCell(rowIdx, PIC_COL + 1).value = { formula: `_xlfn.IMAGE("${it.picture}")` } as any;
      }
    });
    return true;
  };

  const downloadWb = async (wb: any, fileBase: string) => {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${fileBase}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportDoc = async (doc: MUDoc) => {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ok = await addMuSheet(wb, ExcelJS, doc, "Monthly usage");
      if (!ok) { toast({ title: "เอกสารว่าง ไม่มีรายการให้ export", variant: "destructive" }); return; }
      await downloadWb(wb, doc.doc_label.replace(/[\\/:*?"<>|]/g, "_"));
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // Export หลายเอกสารที่เลือก → 1 ไฟล์ Excel · 1 sheet เดียว ต่อกันลงล่าง + คอลัมน์ "แบรนด์"
  const exportSelectedDocs = async () => {
    const selectedDocs = docs.filter((d) => muSelected.has(d.id));
    if (selectedDocs.length === 0) { toast({ title: "ยังไม่ได้เลือกเอกสาร", variant: "destructive" }); return; }
    setMuExporting(true);
    setMuExportMsg({ phase: "เริ่มต้น", current: 0, total: selectedDocs.length });
    try {
      const ExcelJS = (await import("exceljs")).default;
      // รวม items ของทุกเอกสาร (ต่อกันลงล่าง) + แนบชื่อแบรนด์ต่อแถว
      const allRows: { it: any; brand: string }[] = [];
      const allSkus = new Set<string>();
      let di = 0;
      for (const d of selectedDocs) {
        di++;
        setMuExportMsg({ phase: `ดึงรายการ: ${d.brand_name || d.doc_label || ""}`, current: di, total: selectedDocs.length });
        const { data, error } = await (supabase as any)
          .from("monthly_usage_item").select("*").eq("doc_id", d.id).order("sort_order", { ascending: true });
        if (error) throw error;
        for (const it of (data || [])) { allRows.push({ it, brand: d.brand_name || d.doc_label || "" }); if (it.sku_code) allSkus.add(it.sku_code); }
      }
      if (allRows.length === 0) { toast({ title: "เอกสารที่เลือกว่างทั้งหมด", variant: "destructive" }); return; }
      // enrich data_master
      setMuExportMsg({ phase: "เตรียมข้อมูลสินค้า", current: 0, total: 0 });
      const dmMap: Record<string, any> = {};
      const skuArr = [...allSkus];
      for (let i = 0; i < skuArr.length; i += 500) {
        const { data: dm } = await (supabase as any)
          .from("data_master")
          .select("sku_code, division_group, division, department, buying_status, vendor_code, vendor_display_name")
          .eq("packing_size_qty", 1) // 1 sku = 1 row → กันชน 1000-row cap เมื่อ sku มีหลาย packing size
          .in("sku_code", skuArr.slice(i, i + 500));
        for (const d of (dm || []) as any[]) { if (d.sku_code && !dmMap[d.sku_code]) dmMap[d.sku_code] = d; }
      }
      const headers = ["#", "แบรนด์", "ID (SKU)", "Barcode", "Barcode Unit", "Product name", "UOM",
        "3monthly qty", "Monthly qty", "Remark", "รูป", "รูป (IMAGE)",
        "Division Group", "Division", "Department", "Buying Status", "Vendor Origin", "Product name (import)"];
      const widths = [4, 20, 14, 16, 16, 36, 8, 14, 12, 30, 14, 18, 16, 14, 16, 14, 22, 36];
      const PIC_COL = 11; // 1-based: "รูป"(ลิงก์) · "รูป (IMAGE)" = PIC_COL+1
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Monthly usage");
      ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }));
      ws.getRow(1).font = { bold: true };

      setMuExportMsg({ phase: "สร้างไฟล์ Excel", current: 0, total: 0 });
      allRows.forEach(({ it, brand }, i) => {
        const d = dmMap[it.sku_code] || {};
        const vendorOrigin = (d.vendor_code && vendorOriginMapRef.current[d.vendor_code]) || "";
        const row = ws.addRow([
          i + 1, brand, it.sku_code || "", it.barcode || "", it.barcode_unit || "",
          it.product_name || "", it.uom || "",
          it.monthly_qty ?? "", // 3monthly qty (ค่าเดิม)
          it.monthly_qty != null && it.monthly_qty !== "" ? (Number(it.monthly_qty) / 3).toFixed(2) : "", // Monthly qty = 3monthly / 3
          it.remark || "", "", "", // "รูป"(ลิงก์) + "รูป (IMAGE)"(สูตร) — ใส่ด้านล่าง
          d.division_group || "", d.division || "", d.department || "",
          d.buying_status || "", vendorOrigin,
          it.imported_name || "", // Product name (import) — ชื่อดิบจากไฟล์
        ]);
        const rowIdx = row.number;
        row.height = 36; // ทุกแถวสูงเท่ากัน ~48px (มี/ไม่มีรูปก็เท่ากัน)
        row.alignment = { vertical: "middle" }; // ตัวหนังสือกึ่งกลางแนวตั้ง
        if (it.picture) {
          const linkCell = ws.getCell(rowIdx, PIC_COL);
          linkCell.value = { text: "เปิดรูป", hyperlink: it.picture } as any;
          linkCell.font = { color: { argb: "FF0563C1" }, underline: true };
          // Excel 365: แสดงรูปในเซลล์จาก URL (เวอร์ชันที่ไม่รองรับจะขึ้น #NAME? — ใช้คอลัมน์ลิงก์แทน)
          ws.getCell(rowIdx, PIC_COL + 1).value = { formula: `_xlfn.IMAGE("${it.picture}")` } as any;
        }
      });

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await downloadWb(wb, `MonthlyUsage_${selectedDocs.length}brands_${stamp}`);
      toast({ title: `Export ${selectedDocs.length} แบรนด์ · ${allRows.length} แถว` });
    } catch (e: any) {
      toast({ title: "Export ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setMuExporting(false);
      setMuExportMsg(null);
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
  // ป๊อปอัปถามวันที่ Need ตอนกด Print (สำหรับ doc ที่ยังไม่มี need_date เช่นมาจากการ Import)
  const [printNeedOpen, setPrintNeedOpen] = useState(false);
  const [printNeedDate, setPrintNeedDate] = useState(""); // yyyy-mm-dd
  const [pendingPrintDoc, setPendingPrintDoc] = useState<MUDoc | null>(null);
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
  const [scmSubTab, setScmSubTab] = useState(() => localStorage.getItem("b2b_scm_sub_tab") || "so");
  // sub-tab ของ PO (PO / Stock Kr / PO Receive) — ยกขึ้นมาที่ parent เพื่อแสดงปุ่มมุมขวาบนแถว SO/PO
  const [poSubTab, setPoSubTab] = useState(() => localStorage.getItem("b2b_po_sub_tab") || "list");
  useEffect(() => { localStorage.setItem("b2b_scm_sub_tab", scmSubTab); }, [scmSubTab]);
  useEffect(() => { localStorage.setItem("b2b_po_sub_tab", poSubTab); }, [poSubTab]);
  const [soDocs, setSoDocs] = useState<SODoc[]>([]);
  const [soDocsLoading, setSoDocsLoading] = useState(false);
  const [soSearch, setSoSearch] = useState("");
  const [customerOpts, setCustomerOpts] = useState<CustomerOpt[]>([]); // รายชื่อลูกค้า (dropdown)
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
        .select("id, code, brand_name, branch, brand_group")
        .order("code", { ascending: true });
      if (error) throw error;
      const opts = (data || []).map((r: any) => ({
        id: r.id,
        code: r.code,
        brand_name: r.brand_name ?? "",
        branch: r.branch ?? "",
        brand_group: r.brand_group ?? "",
      }));
      setBrandOptions(opts);
      return opts;
    } catch {
      setBrandOptions([]);
      return [];
    }
  };

  // จัดกลุ่มเอกสารตาม Group ของแบรนด์ (สำหรับหัวข้อกลุ่มในรายการ Monthly usage / Order)
  const NO_GROUP_LABEL = "ไม่ระบุกลุ่ม";
  const groupOfBrand = (name: string) => {
    const key = (name || "").trim().toLowerCase();
    const b = brandOptions.find((o) => o.brand_name.trim().toLowerCase() === key);
    return (b?.brand_group || "").trim();
  };
  const groupDocsByBrand = <T extends { brand_name: string }>(list: T[]): { group: string; items: T[] }[] => {
    const map = new Map<string, T[]>();
    for (const d of list) {
      const g = groupOfBrand(d.brand_name) || NO_GROUP_LABEL;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(d);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === NO_GROUP_LABEL ? 1 : b[0] === NO_GROUP_LABEL ? -1 : a[0].localeCompare(b[0])))
      .map(([group, items]) => ({ group, items }));
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
          // ถ้าพบใน master ใช้ EN จาก master, ถ้าไม่พบ fallback เป็นชื่อที่ import มา (เก็บใน it.product_name)
          product_name_en: d.product_name_en ?? (it.product_name ?? ""),
          imported_name: it.imported_name ?? "",
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
      setMuEditSel(new Set());
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

  // เลือกแถว (multi) + ลบที่เลือก — index-based (ล้าง selection เมื่อ index เลื่อน)
  const [muEditSel, setMuEditSel] = useState<Set<number>>(new Set());
  const toggleMuEditSel = (idx: number) => setMuEditSel((prev) => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const deleteMuSelected = () => {
    if (muEditSel.size === 0) return;
    const n = muEditSel.size;
    setMuRows((prev) => prev.filter((_, i) => !muEditSel.has(i)));
    setMuEditSel(new Set());
    toast({ title: `ลบ ${n} แถว`, description: "กด Save เพื่อบันทึกถาวร" });
  };

  const duplicateMuRow = (idx: number) => {
    setMuRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next;
    });
    setMuEditSel(new Set()); // index เลื่อน → ล้าง selection
  };

  const removeMuRow = (idx: number) => { setMuRows((prev) => prev.filter((_, i) => i !== idx)); setMuEditSel(new Set()); };

  // ดาวน์โหลด template สำหรับนำเข้า Monthly usage
  const downloadMuTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Barcode: "8857000000001", "จำนวน/3เดือน": 10, "Order group": "A", หมายเหตุ: "", "Barcode ทดแทน": "", "ชื่อสินค้า (ถ้าไม่พบใน Master)": "", "Picture (ฝังรูปใน cell นี้)": "" },
      { Barcode: "8857000000002", "จำนวน/3เดือน": 5, "Order group": "B", หมายเหตุ: "", "Barcode ทดแทน": "8857000000099", "ชื่อสินค้า (ถ้าไม่พบใน Master)": "", "Picture (ฝังรูปใน cell นี้)": "" },
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 28 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "MonthlyUsage_Template.xlsx");
  };

  // template สำหรับ Import หลายแบรนด์ (ชีตเดียว มีคอลัมน์ Brand)
  const downloadMultiTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Brand: "Bonchon", Barcode: "8851123212021", "จำนวน/3เดือน": 1000, "Order group": "A", หมายเหตุ: "", "ชื่อสินค้า (ถ้าไม่พบใน Master)": "", "Picture (ฝังรูปใน cell นี้)": "" },
      { Brand: "Khiang", Barcode: "8059495230180", "จำนวน/3เดือน": 2, "Order group": "B", หมายเหตุ: "", "ชื่อสินค้า (ถ้าไม่พบใน Master)": "", "Picture (ฝังรูปใน cell นี้)": "" },
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 28 }, { wch: 30 }];
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
      const nIdx = headers.findIndex((h) => h.includes("ชื่อสินค้า") || h.includes("product name") || h.includes("product_name") || h.includes("name"));
      if (bIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }
      // ดึงรูปที่ฝังใน Excel (ถ้ามี) — key = xdrRow(0-based), ค่า xdrRow 1 = data row แรก
      const imagesByRow = await extractImagesFromXlsx(ab);
      // เก็บ original index ไว้ด้วย (สำหรับ map หา xdrRow = origIdx + 1)
      const dataRows = raw.slice(1)
        .map((r, i) => ({ r, xdrRow: i + 1 }))
        .filter(({ r }) => String(r[bIdx] ?? "").trim());
      if (!dataRows.length) { toast({ title: "ไม่พบข้อมูล", variant: "destructive" }); return; }
      const resolved: MonthlyUsageForm[] = await Promise.all(
        dataRows.map(async ({ r, xdrRow }) => {
          const code = String(r[bIdx] ?? "").trim();
          const qty = qIdx >= 0 ? String(r[qIdx] ?? "").trim() : "";
          const remark = rIdx >= 0 ? String(r[rIdx] ?? "").trim() : "";
          const orderGroup = gIdx >= 0 ? String(r[gIdx] ?? "").trim() : "";
          const importedName = nIdx >= 0 ? String(r[nIdx] ?? "").trim() : "";
          const res = await resolveBarcode(code);
          // รายการทดแทน (ถ้ามีคอลัมน์)
          const replCode = replIdx >= 0 ? String(r[replIdx] ?? "").trim() : "";
          const replRes = replCode ? await resolveBarcode(replCode) : ({ found: false } as any);
          // อัปโหลดรูปที่ฝังใน Excel (ถ้ามีรูปที่ row นี้)
          let picture = "";
          const imgData = imagesByRow.get(xdrRow);
          if (imgData) {
            try { picture = await uploadImageBytes(imgData.data, imgData.ext); } catch { /* อัปรูปไม่สำเร็จ — ข้าม */ }
          }
          return {
            barcode: code,
            sku_code: res.found ? res.sku_code : "",
            barcode_unit: res.found ? res.barcode_unit : "",
            uom: res.found ? res.uom : "",
            product_name: res.found ? res.product_name : (importedName || "ไม่พบข้อมูล"),
            product_name_en: res.found ? res.product_name_en : importedName,
            imported_name: importedName, // ชื่อดิบจากไฟล์ import (ไม่ถูก resolve ทับ)
            monthly_qty: qty,
            order_group: orderGroup,
            picture,
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
      setMuEditSel(new Set());
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
          <td>${esc(r.product_name_en || r.product_name)}</td>
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

  // กด Print → ป๊อปอัปถามวันที่ Need ทุกครั้ง (prefill วันที่เดิมถ้าเคยใส่ไว้)
  const printDoc = (doc: MUDoc) => {
    setPendingPrintDoc(doc);
    setPrintNeedDate(doc.need_date || ""); // เคยใส่แล้ว → default เป็นค่าเดิม, แก้ได้
    setPrintNeedOpen(true);
  };

  // พิมพ์ฟอร์มเอกสารเดิมซ้ำ (ดึงรายการ + logo จาก DB โดยไม่ต้องเข้าไปแก้ไข) — ใช้ needDateISO ที่ส่งเข้ามา
  const doPrintDoc = async (doc: MUDoc, needDateISO: string) => {
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
      // ดึงชื่อ EN จาก data_master ตาม sku_code (item เก็บแค่ product_name = ชื่อ LA)
      const skus = [...new Set(items.map((it: any) => it.sku_code).filter(Boolean))] as string[];
      const enMap: Record<string, string> = {};
      if (skus.length) {
        const { data: dm } = await (supabase as any)
          .from("data_master").select("sku_code, product_name_en").in("sku_code", skus);
        for (const d of (dm || []) as any[]) if (d.sku_code && !enMap[d.sku_code]) enMap[d.sku_code] = d.product_name_en || "";
      }
      const formRows: MonthlyUsageForm[] = items.map((it: any) => ({
        ...EMPTY_MU,
        barcode: it.barcode ?? "",
        sku_code: it.sku_code ?? "",
        barcode_unit: it.barcode_unit ?? "",
        product_name: it.product_name ?? "",
        // ชื่อ EN จาก master ก่อน, ถ้าไม่พบ fallback เป็นชื่อที่เก็บใน item (ชื่อ import)
        product_name_en: (it.sku_code && enMap[it.sku_code]) || it.product_name || "",
        imported_name: it.imported_name ?? "",
        uom: it.uom ?? "",
        monthly_qty: it.monthly_qty != null ? String(it.monthly_qty) : "",
        picture: it.picture ?? "",
        remark: it.remark ?? "",
      }));
      openPrintForm(formRows, doc.brand_name, needDateISO || "", doc.logo_url || "");
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
      const nIdx2 = headers.findIndex((h) => h.includes("ชื่อสินค้า") || h.includes("product name") || h.includes("product_name") || h.includes("name"));
      const gIdx2 = headers.findIndex((h) => h.includes("order group") || h.includes("order_group") || h.includes("group") || h.includes("กลุ่ม"));
      if (brIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Brand", variant: "destructive" }); return; }
      if (bIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode", variant: "destructive" }); return; }

      // ดึงรูปที่ฝังใน Excel (ถ้ามี) — key = xdrRow(0-based) = index ใน raw.slice(1) + 1
      const imagesByRow = await extractImagesFromXlsx(ab);

      // จัดกลุ่มแถวตาม Brand (เก็บ rawIdx ไว้ map หารูป)
      const groups = new Map<string, { brand: string; rows: { code: string; qty: string; remark: string; name: string; orderGroup: string; rawIdx: number }[] }>();
      raw.slice(1).forEach((r, i) => {
        const brand = String(r[brIdx] ?? "").trim();
        const code = String(r[bIdx] ?? "").trim();
        if (!brand || !code) return;
        const key = brand.toLowerCase();
        if (!groups.has(key)) groups.set(key, { brand, rows: [] });
        groups.get(key)!.rows.push({
          code,
          qty: qIdx >= 0 ? String(r[qIdx] ?? "").trim() : "",
          remark: rIdx >= 0 ? String(r[rIdx] ?? "").trim() : "",
          name: nIdx2 >= 0 ? String(r[nIdx2] ?? "").trim() : "",
          orderGroup: gIdx2 >= 0 ? String(r[gIdx2] ?? "").trim() : "",
          rawIdx: i + 1,
        });
      });
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

        // resolve barcode → data_master (+ อัปโหลดรูปที่ฝังใน Excel ถ้ามี)
        const resolved = await Promise.all(
          rows.map(async (rr) => {
            const res = await resolveBarcode(rr.code);
            let picture = "";
            const imgData = imagesByRow.get(rr.rawIdx);
            if (imgData) { try { picture = await uploadImageBytes(imgData.data, imgData.ext); } catch { } }
            return {
              barcode: rr.code,
              sku_code: res.found ? res.sku_code : "",
              barcode_unit: res.found ? res.barcode_unit : "",
              uom: res.found ? res.uom : "",
              product_name: res.found ? res.product_name : (rr.name || "ไม่พบข้อมูล"),
              product_name_en: res.found ? (res.product_name_en || "") : rr.name,
              imported_name: rr.name || "", // ชื่อดิบจากไฟล์ import
              monthly_qty: rr.qty,
              order_group: rr.orderGroup,
              remark: rr.remark,
              picture,
            };
          }),
        );
        // ไม่ dedup — เก็บทุกแถวตามไฟล์ (สินค้าตัวเดียวกัน/ไม่มีบาร์โค้ดก็เก็บแยกทุกแถว)
        const items = resolved;
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
          imported_name: (x as any).imported_name?.trim() || null,
          uom: x.uom || null,
          monthly_qty: x.monthly_qty.trim() ? Number(x.monthly_qty) : null,
          daily_qty: x.monthly_qty.trim() ? Number(x.monthly_qty) / 30 : null,
          order_group: (x as any).order_group?.trim() || null,
          picture: (x as any).picture || null,
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
        imported_name: r.imported_name?.trim() || null,
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
      // สร้าง Order ใหม่ได้เสมอ (ไม่จำกัดต่อ Brand+Branch) — ของเดิมยังอยู่ แก้จากปุ่ม View ในลิสต์
      // ต้องมี Monthly Usage Doc ของแบรนด์ก่อน (หาแบบ brand-level — Monthly เก็บ branch ว่าง)
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
      // สร้าง Order ใหม่ได้ไม่จำกัดต่อ Brand+Branch (ไม่บล็อกของซ้ำ)
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
      // ใส่วินาทีด้วย เพราะสร้าง Order ซ้ำแบรนด์เดิมได้ไม่จำกัด — ป้องกันชื่อ Doc ซ้ำกันในนาทีเดียว
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
  // โหลดรายชื่อลูกค้าจากตาราง customers (paginate เผื่อเกิน 1000 แถว)
  const loadCustomers = async () => {
    try {
      const out: CustomerOpt[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("customers")
          .select("customer_code, name")
          .order("name", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) break;
        for (const c of (data || []) as any[]) if (c.name) out.push({ code: c.customer_code || "", name: c.name });
        if (!data || data.length < PAGE) break;
      }
      setCustomerOpts(out);
    } catch { /* โหลดไม่ได้ก็ปล่อยว่าง */ }
  };

  // เปลี่ยนลูกค้าของ SO doc → บันทึกลง DB + อัปเดต state
  const updateSoCustomer = async (doc: SODoc, name: string) => {
    setSoDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, customer: name } : x));
    try {
      const { error } = await (supabase as any).from("so_doc").update({ customer: name }).eq("id", doc.id);
      if (error) throw error;
    } catch (e: any) {
      toast({ title: "บันทึกลูกค้าไม่สำเร็จ", description: e.message, variant: "destructive" });
      loadSoDocs();
    }
  };

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

  // เติมคอลัมน์ แบรน / สาขา (ไทย) ทุกแถว — ใส่หลัง remap เพื่อให้ออกแน่นอนแม้มี export template
  const addBrandBranch = (rows: Record<string, any>[], brand: string, branch: string): Record<string, any>[] =>
    rows.map((r) => ({ ...r, "แบรน": brand || "", "สาขา": branch || "" }));

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
        all.push(...addBrandBranch(mapped, d.brand_name, d.branch));
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
      const mapped = await remapRowsByTemplate("srr_special_so", buildSoExportRows(items, doc.customer || SO_DEFAULT_CUSTOMER));
      const rows = addBrandBranch(mapped, doc.brand_name, doc.branch);
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
            {pBrandView && (
            <TabsTrigger value="brand" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
              <Tag className="w-3.5 h-3.5" /> Brand control
            </TabsTrigger>
            )}
            {pScmView && (
            <TabsTrigger value="scm_control" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
              <Boxes className="w-3.5 h-3.5" /> SCM Control
            </TabsTrigger>
            )}
            {pDckrView && (
            <TabsTrigger value="dckr" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
              <Warehouse className="w-3.5 h-3.5" /> DC(KR) Control
            </TabsTrigger>
            )}
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
            {can("b2b_scm", "edit") && (
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
            )}
          </div>
        </div>

        <TabsContent value="brand" className="flex-1 overflow-hidden mt-0 p-4 bg-background flex-col min-h-0 data-[state=active]:flex">
          <Tabs value={brandSubTab} onValueChange={setBrandSubTab} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList className="h-8">
                <TabsTrigger value="monthly" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                  <BarChart3 className="w-3.5 h-3.5" /> Monthly usage
                </TabsTrigger>
                <TabsTrigger value="order" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                  <ShoppingCart className="w-3.5 h-3.5" /> Order
                </TabsTrigger>
                {orderOpen && (
                  <TabsTrigger value="order_edit" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                    <ShoppingCart className="w-3.5 h-3.5" /> Order (แก้ไข)
                  </TabsTrigger>
                )}
                {muOpen && (
                  <TabsTrigger value="view" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                    <Eye className="w-3.5 h-3.5" /> แสดงข้อมูล
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Toolbar ของ Monthly usage (โผล่เฉพาะหน้า Monthly usage) */}
              {brandSubTab === "monthly" && (
                <div className="flex items-center gap-2">
                  <ProductSearchDialog
                    trigger={
                      <button
                        title="ค้นหาสินค้า (Data Master)"
                        className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <Search className="w-4 h-4" />
                        <span className="text-[10px] leading-none font-medium">ค้นหาสินค้า</span>
                      </button>
                    }
                  />
                  <button
                    onClick={openDialog}
                    title="List Brand"
                    className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    <Tag className="w-4 h-4" />
                    <span className="text-[10px] leading-none font-medium">List Brand</span>
                  </button>
                  {can("b2b_brand", "create") && (
                  <button
                    onClick={openMuNew}
                    title="Monthly usage (สร้างใหม่)"
                    className="flex flex-col items-center justify-center gap-0.5 w-16 py-1 rounded-lg border-2 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-[10px] leading-none font-medium">Monthly</span>
                  </button>
                  )}
                  {can("b2b_brand", "import") && (
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
                  )}
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
              {brandSubTab === "order" && can("b2b_brand", "create") && (
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
              {muExporting ? (
                <div className="ml-auto flex items-center gap-1.5 text-xs text-primary font-medium max-w-[60%] truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">
                    กำลัง Export · {muExportMsg?.phase}
                    {muExportMsg && muExportMsg.total > 0
                      ? ` ${muExportMsg.current}/${muExportMsg.total} (${Math.round((muExportMsg.current / muExportMsg.total) * 100)}%)`
                      : "..."}
                  </span>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  {can("b2b_brand", "edit") && (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={openLogoDialog} title="Import โลโก้แล้วเลือก Doc ที่จะใช้">
                      <ImageIcon className="w-3.5 h-3.5" /> จัดการโลโก้
                    </Button>
                  )}
                  {muSelected.size > 0 && can("b2b_brand", "delete") && (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs text-destructive border-destructive/40" onClick={deleteSelectedMuDocs}>
                      <Trash2 className="w-3.5 h-3.5" /> ลบที่เลือก ({muSelected.size})
                    </Button>
                  )}
                  {muSelected.size > 0 && can("b2b_brand", "export") && (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={exportSelectedDocs}>
                      <Download className="w-3.5 h-3.5" /> Export ที่เลือก ({muSelected.size})
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Dialog จัดการโลโก้ — import โลโก้แล้วติกเลือก Doc ที่จะใช้ (logo_url หัวฟอร์ม/PDF) */}
            <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
              <DialogContent className="max-w-2xl bg-background max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle className="text-base">จัดการโลโก้ (หัวฟอร์ม / PDF)</DialogTitle>
                </DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-md border-2 border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs cursor-pointer", logoBusy && "opacity-60 pointer-events-none")}>
                    {logoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} เพิ่มโลโก้ (เลือกได้หลายไฟล์)
                    <input type="file" accept="image/*" multiple className="hidden" disabled={logoBusy} onChange={(e) => { addLogoFiles(e.target.files); e.target.value = ""; }} />
                  </label>
                  <span className="text-[11px] text-muted-foreground">อัปโลโก้ก่อน แล้วติกเลือก Doc ใต้แต่ละโลโก้ (1 Doc = 1 โลโก้)</span>
                </div>
                <div className="flex-1 overflow-auto min-h-0 space-y-3 pr-1">
                  {logoItems.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">ยังไม่มีโลโก้ — กด "เพิ่มโลโก้"</div>}
                  {logoItems.map((lg, idx) => (
                    <div key={idx} className="border rounded-lg p-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <img src={lg.url} alt={lg.name} className="h-12 w-12 object-contain rounded border bg-muted/20" />
                        <span className="text-xs font-medium">Logo {idx + 1}</span>
                        <span className="text-[11px] text-muted-foreground truncate flex-1" title={lg.name}>{lg.name}</span>
                        <span className="text-[11px] text-primary">{Object.values(logoDocMap).filter((v) => v === idx).length} Doc</span>
                      </div>
                      <div className="max-h-40 overflow-auto border rounded p-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {docs.map((d) => (
                          <label key={d.id} className="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-muted/40 cursor-pointer">
                            <input type="checkbox" className="h-3 w-3" checked={logoDocMap[d.id] === idx} onChange={() => toggleLogoDoc(d.id, idx)} />
                            <span className="truncate" title={d.doc_label}>{d.brand_name || d.doc_label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLogoDialogOpen(false)}>ปิด</Button>
                  <Button onClick={saveLogoAssignments} disabled={logoBusy || Object.keys(logoDocMap).length === 0}>
                    {logoBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null} บันทึกโลโก้ ({Object.keys(logoDocMap).length} Doc)
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                  <th className="px-3 py-1.5 font-medium w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 align-middle"
                      checked={docs.length > 0 && docs.every((d) => muSelected.has(d.id))}
                      ref={(el) => { if (el) el.indeterminate = docs.some((d) => muSelected.has(d.id)) && !docs.every((d) => muSelected.has(d.id)); }}
                      onChange={(e) => setMuSelected(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())}
                    />
                  </th>
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
                {groupDocsByBrand(docs).map(({ group, items }) => (
                  <Fragment key={group}>
                    <tr className="bg-muted/60 border-b">
                      <td colSpan={9} className="px-3 py-1 text-xs font-semibold text-primary/80">{group} · {items.length}</td>
                    </tr>
                    {items.map((d) => (
                  <tr key={d.id} className={cn("border-b last:border-0 hover:bg-muted/40", muSelected.has(d.id) && "bg-primary/5")}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" className="h-4 w-4 align-middle" checked={muSelected.has(d.id)} onChange={() => toggleMuSel(d.id)} />
                    </td>
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
                        {can("b2b_brand", "edit") && (
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
                        )}
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
                        {can("b2b_brand", "export") && (
                        <Button variant="outline" size="icon" className="h-7 w-7" title="พิมพ์ฟอร์ม" onClick={() => printDoc(d)} disabled={printingId === d.id}>
                          {printingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                        </Button>
                        )}
                        {can("b2b_brand", "edit") && <label
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
                        </label>}
                        {can("b2b_brand", "export") && (
                        <Button variant="outline" size="icon" className="h-7 w-7" title="Export Excel" onClick={() => exportDoc(d)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        )}
                        {can("b2b_brand", "delete") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบเอกสาร" onClick={() => deleteDoc(d)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                    ))}
                  </Fragment>
                ))}
                {docs.length === 0 && !docsLoading && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
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
                {groupDocsByBrand(orderDocs).map(({ group, items }) => (
                  <Fragment key={group}>
                    <tr className="bg-muted/60 border-b">
                      <td colSpan={6} className="px-3 py-1 text-xs font-semibold text-primary/80">{group} · {items.length}</td>
                    </tr>
                    {items.map((d) => (
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
                        {can("b2b_brand", "export") && (
                        <Button variant="outline" size="icon" className="h-7 w-7" title="Export Excel" onClick={() => exportOrderDoc(d)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        )}
                        {can("b2b_brand", "delete") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ Order" onClick={() => deleteOrderDoc(d)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                    ))}
                  </Fragment>
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
                can("b2b_brand", "edit") && (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setOrderReadOnly(false)}>
                  <Pencil className="w-4 h-4" /> แก้ไข
                </Button>
                )
              ) : can("b2b_brand", "create") ? (
                <Button size="sm" className="h-8 gap-1.5" onClick={saveOrderDoc} disabled={orderSaving || orderLoading}>
                  {orderSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Order
                </Button>
              ) : null}
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
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-8"
                    placeholder="ค้นหา Code / Brand name / Branch / Group"
                  />
                </div>
                {can("b2b_brand", "import") && (
                <label className="flex items-center gap-1.5 h-8 px-3 rounded-md border bg-background hover:bg-muted transition-colors cursor-pointer text-xs font-medium shrink-0">
                  <Upload className="w-3.5 h-3.5" /> Import
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importBrandFile(f); e.target.value = ""; }} />
                </label>
                )}
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={downloadBrandTemplate}>
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Template
                </Button>
              </div>

              {/* รายชื่อ Group ที่มีอยู่แล้ว — ช่วยพิมพ์ซ้ำให้ตรงกัน */}
              <datalist id="brand-group-options">
                {[...new Set(rows.map((r) => r.brand_group.trim()).filter(Boolean))].map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>

              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-20 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Brand name</th>
                    {SHOW_BRAND_BRANCH && <th className="px-2 py-1.5 font-medium">Branch</th>}
                    <th className="px-2 py-1.5 font-medium">Group</th>
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
                          onChange={(e) => can("b2b_brand", "edit") && updateRow(idx, "brand_name", e.target.value)}
                          readOnly={!can("b2b_brand", "edit")}
                          className="h-8"
                          placeholder="Brand name"
                        />
                      </td>
                      {SHOW_BRAND_BRANCH && (
                        <td className="px-2 py-1">
                          <Input
                            value={row.branch}
                            onChange={(e) => can("b2b_brand", "edit") && updateRow(idx, "branch", e.target.value)}
                            readOnly={!can("b2b_brand", "edit")}
                            className="h-8"
                            placeholder="Branch"
                          />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <Input
                          value={row.brand_group}
                          onChange={(e) => can("b2b_brand", "edit") && updateRow(idx, "brand_group", e.target.value)}
                          readOnly={!can("b2b_brand", "edit")}
                          className="h-8"
                          placeholder="Group"
                          list="brand-group-options"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5">
                          {SHOW_BRAND_DUPLICATE && can("b2b_brand", "create") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateRow(idx)}>
                              <Copy className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                          {can("b2b_brand", "create") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="แทรกแถวใหม่ใต้แถวนี้" onClick={() => insertRowBelow(idx)}>
                            <Plus className="w-4 h-4 text-primary" />
                          </Button>
                          )}
                          {can("b2b_brand", "delete") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeRow(idx)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={SHOW_BRAND_BRANCH ? 5 : 4} className="px-2 py-6 text-center text-muted-foreground">
                        {can("b2b_brand", "create") && (
                        <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
                          <Plus className="w-4 h-4" /> เพิ่มแถวแรก
                        </Button>
                        )}
                      </td>
                    </tr>
                  )}
                  {rows.length > 0 && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={SHOW_BRAND_BRANCH ? 5 : 4} className="px-2 py-6 text-center text-muted-foreground">
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
            {(can("b2b_brand", "create") || can("b2b_brand", "edit")) && (
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Save
            </Button>
            )}
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
                (can("b2b_brand", "edit") || can("b2b_brand", "create")) && (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setMuReadOnly(false)}>
                  <Pencil className="w-4 h-4" /> แก้ไข
                </Button>
                )
              ) : (
                <>
                  {editingDocId && (
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setMuReadOnly(true)} disabled={muSaving}>
                      ยกเลิก
                    </Button>
                  )}
                  {(can("b2b_brand", editingDocId ? "edit" : "create")) && (
                  <Button size="sm" className="h-8 gap-1.5" onClick={openNeedDatePopup} disabled={muSaving || muLoading}>
                    {muSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save
                  </Button>
                  )}
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
                  {can("b2b_brand", "import") && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => muImportRef.current?.click()} disabled={muImporting}>
                    {muImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} นำเข้า Excel
                  </Button>
                  )}
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
                          {c.key === "idx" ? (
                            <div className="flex items-center justify-center gap-1.5">
                              {!muReadOnly && (
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  checked={muRows.length > 0 && muRows.every((_, i) => muEditSel.has(i))}
                                  ref={(el) => { if (el) el.indeterminate = muEditSel.size > 0 && muEditSel.size < muRows.length; }}
                                  onChange={(e) => setMuEditSel(e.target.checked ? new Set(muRows.map((_, i) => i)) : new Set())}
                                />
                              )}
                              <span>#</span>
                            </div>
                          ) : (
                            <span className="block truncate">{c.label}</span>
                          )}
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
                        row.monthly_qty.trim() && !isNaN(Number(row.monthly_qty)) ? (Number(row.monthly_qty) / 3).toFixed(2) : "";
                      const notFound = row.product_name === "ไม่พบข้อมูล";
                      return (
                        <tr key={idx} className={cn("border-t align-middle", muEditSel.has(idx) && "bg-primary/5")}>
                          <td className="px-2 py-1 text-center text-muted-foreground tabular-nums">
                            <div className="flex items-center justify-center gap-1.5">
                              {!muReadOnly && (
                                <input type="checkbox" className="h-3.5 w-3.5" checked={muEditSel.has(idx)} onChange={() => toggleMuEditSel(idx)} />
                              )}
                              <span>{idx + 1}</span>
                            </div>
                          </td>
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
                                value={notFound ? "ไม่พบข้อมูลในระบบ" : row.sku_code}
                                readOnly
                                title={notFound ? "ไม่พบข้อมูลในระบบ" : row.sku_code}
                                onKeyDown={(e) => handleCellKey(e, idx, 1)}
                                className={`h-8 w-full bg-muted/50 pr-6 ${notFound ? "text-destructive" : ""}`}
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
                          {isColShown("pname_en") && (
                            notFound
                              ? <td className="px-1 py-1">
                                  <Input
                                    value={row.product_name_en}
                                    onChange={(e) => updateMuField(idx, "product_name_en", e.target.value)}
                                    title={row.product_name_en}
                                    className="h-8 w-full"
                                    placeholder="คีย์ชื่อสินค้า"
                                  />
                                </td>
                              : <td className="px-2 py-1 text-xs truncate" title={row.product_name_en || "-"}>{row.product_name_en || "-"}</td>
                          )}
                          {isColShown("iname") && <td className="px-2 py-1 text-xs truncate text-muted-foreground" title={row.imported_name || "-"}>{row.imported_name || "-"}</td>}
                          {isColShown("ibarcode") && <td className="px-2 py-1 text-xs truncate text-muted-foreground" title={row.barcode || "-"}>{row.barcode || "-"}</td>}
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
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={addMuRow} className="gap-1.5">
                    <Plus className="w-4 h-4" /> เพิ่มรายการ
                  </Button>
                  {muEditSel.size > 0 && can("b2b_brand", "delete") && (
                    <Button variant="outline" size="sm" onClick={deleteMuSelected} className="gap-1.5 text-destructive border-destructive/40">
                      <Trash2 className="w-4 h-4" /> ลบที่เลือก ({muEditSel.size})
                    </Button>
                  )}
                </div>
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
                <TabsTrigger value="so" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> SO
                </TabsTrigger>
                <TabsTrigger value="po" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                  <FileSignature className="w-3.5 h-3.5" /> PO
                </TabsTrigger>
              </TabsList>

              {/* sub-tab ของ PO ย้ายมาไว้มุมขวา (โชว์เฉพาะตอนอยู่ที่ tab PO) */}
              {scmSubTab === "po" && (
                <Tabs value={poSubTab} onValueChange={setPoSubTab}>
                  <TabsList className="h-8 w-fit">
                    <TabsTrigger value="list" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                      <FileSignature className="w-3.5 h-3.5" /> PO
                    </TabsTrigger>
                    <TabsTrigger value="stock_kr" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                      <Boxes className="w-3.5 h-3.5" /> Stock Kr
                    </TabsTrigger>
                    <TabsTrigger value="po_receive" className="text-xs gap-1.5 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
                      <Download className="w-3.5 h-3.5" /> PO Receive
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
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
                  {can("b2b_scm", "export") && (
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={exportSoSelected} disabled={soSelected.size === 0 || soExporting}>
                    {soExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Export SO ({soSelected.size})
                  </Button>
                  )}
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
                          <td className="px-3 py-1.5">
                            <CustomerCombo value={d.customer || ""} options={customerOpts} onChange={(name) => updateSoCustomer(d, name)} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.item_count}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{new Date(d.updated_at || d.created_at).toLocaleString("th-TH")}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openSoView(d)}>
                                <Eye className="w-3.5 h-3.5" /> View
                              </Button>
                              {can("b2b_scm", "export") && (
                              <Button variant="outline" size="icon" className="h-7 w-7" title="Export SO (Excel)" onClick={() => exportSoSingle(d)}>
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                              )}
                              {can("b2b_scm", "delete") && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ SO" onClick={() => deleteSoDoc(d)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                              )}
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

            {/* ============ PO (รวมจาก Monthly usage ทุกแบรนด์ + 2 sub-tab Import) ============ */}
            <TabsContent value="po" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex">
              <SCMPOTab vendorOriginMap={vendorOriginMapRef} poSubTab={poSubTab} setPoSubTab={setPoSubTab} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ============ DC(KR) Control ============ */}
        <TabsContent value="dckr" className="flex-1 overflow-hidden mt-0 bg-background flex-col min-h-0 data-[state=active]:flex">
          <DCKRControlTab />
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

      {/* ป๊อปอัปถามวันที่ Need ตอนกด Print (doc ที่ยังไม่มี need_date เช่นมาจาก Import) */}
      <Dialog open={printNeedOpen} onOpenChange={(o) => { if (printingId === null) setPrintNeedOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>วันที่คาดว่าจะเบิก (DATE Need)</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">เลือกวันที่ก่อนพิมพ์ (ต้องไม่น้อยกว่า 7 วันจากวันนี้)</Label>
            <Input
              type="date"
              value={printNeedDate}
              min={minNeedDateISO()}
              onChange={(e) => setPrintNeedDate(e.target.value)}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">เลือกได้ตั้งแต่ {fmtDMY(minNeedDateISO())} เป็นต้นไป</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintNeedOpen(false)}>ยกเลิก</Button>
            <Button
              onClick={async () => {
                const min = minNeedDateISO();
                if (!printNeedDate) { toast({ title: "กรุณาเลือกวันที่คาดว่าจะเบิก", variant: "destructive" }); return; }
                if (printNeedDate < min) { toast({ title: "วันที่ Need ต้องไม่น้อยกว่า 7 วันจากวันนี้", description: `เลือกตั้งแต่ ${fmtDMY(min)} เป็นต้นไป`, variant: "destructive" }); return; }
                const doc = pendingPrintDoc;
                setPrintNeedOpen(false);
                if (!doc) return;
                // บันทึกลง doc เพื่อครั้งถัดไป default เป็นค่านี้
                try {
                  await (supabase as any).from("monthly_usage_doc").update({ need_date: printNeedDate }).eq("id", doc.id);
                  setDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, need_date: printNeedDate } : x));
                } catch { /* บันทึกไม่ได้ก็ยังพิมพ์ต่อ */ }
                doPrintDoc({ ...doc, need_date: printNeedDate }, printNeedDate);
              }}
            >
              ออกฟอร์ม
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

// ============================================================
// SCM Control → tab PO
// รวมรายการจาก Monthly usage ทุกแบรนด์ (sum monthly_qty group by SKU) + pivot ต่อแบรนด์
// คอลัมน์ที่ชัดเจนดึงจาก data_master / vendor_master / stock; PO tracking ว่างไว้ก่อน
// 2 sub-tab Import: Stock Kr / PO Receive (อัปโหลด Excel → แสดงผล)
// ============================================================
type POAgg = {
  sku: string;
  barcode: string;
  product_name: string;
  total: number;
  byBrand: Map<string, number>;
  picByBrand: Map<string, string>; // brand → picture URL (เก็บ URL แรกที่เจอต่อแบรนด์)
  orderGroups: Set<string>; // Order group ที่พบใน SKU นี้ (อาจมีหลายกลุ่มจากหลายแบรนด์)
};
type PORow = {
  division: string;
  department: string;
  sku: string;
  inDM: boolean;         // พบใน data_master หรือไม่ (ใช้คำนวณ Remark/Action)
  vendor_code: string;
  vendor_name: string;
  vendor_currency: string;
  vendor_origin: string;
  order_group: string;
  id: string;
  barcode: string;
  product_name_en: string;
  stock_dc: number | null;
  stock_dc_kr: number | null;
  // จาก PO Receive (เอา line วันที่ PO ล่าสุดของ ID นั้น)
  po_number: string;
  po_date: string;
  po_status: string;
  po_qty: string;
  rec_po: string;
  // จาก PO Cost (moq/po_cost match ด้วย id) — po_cost_unit เก็บแยกตาม vendor (match ID+Vendor ตอน Export)
  moq_1x: number | null;
  pocost: number | null;
  costByVendor: Record<string, { unit: number; ccy: string }>; // vendor code → { PO Cost Unit, สกุลเงิน } ของ SKU นี้
  byBrand: Map<string, number>;
  total: number;
  pictures: Array<{ url: string; brand: string }>; // รูปสินค้า (URL แรกต่อแบรนด์)
};

// คอลัมน์ของ 2 sub-tab Import (key + label + alias สำหรับจับหัวคอลัมน์ Excel)
const STOCK_KR_COLS = [
  { key: "id", label: "ID", aliases: ["id", "sku", "รหัส"] },
  { key: "barcode", label: "Barcode", aliases: ["barcode"] },
  { key: "description", label: "Description", aliases: ["description", "desc", "ชื่อ", "product"] },
  { key: "uom", label: "Unit of Measure", aliases: ["unit of measure", "uom", "หน่วย"] },
  { key: "qty", label: "Qty", aliases: ["qty", "quantity", "จำนวน"] },
  { key: "remark", label: "Remark", aliases: ["remark", "หมายเหตุ", "note"] },
] as const;
const PO_RECEIVE_COLS = [
  { key: "id", label: "ID", aliases: ["id"] },
  { key: "created_date", label: "Order Lines/Purchase Created Date", aliases: ["purchase created date", "created date"], date: true },
  { key: "order_ref", label: "Order Lines/Order Reference", aliases: ["order reference", "reference"] },
  { key: "partner", label: "Order Lines/Partner", aliases: ["partner"] },
  { key: "barcode", label: "Order Lines/Barcode", aliases: ["barcode"] },
  { key: "product", label: "Order Lines/Product", aliases: ["product"] },
  { key: "received_qty", label: "Order Lines/Received Qty", aliases: ["received"] },
  { key: "quantity", label: "Order Lines/Quantity", aliases: ["quantity"] },
  { key: "status", label: "Status", aliases: ["status"] },
] as const;

// cache ข้อมูล PO ไว้ข้ามการสลับ tab/หน้า (ไม่ต้องกดโหลดใหม่ทุกครั้ง)
let poDataCache: { rows: PORow[]; brands: string[] } | null = null;

// เรทแปลงค่าเงิน → LAK (ตั้งไว้ที่ Data Control, เก็บใน localStorage) — ใช้ตอนติ๊ก Pocost Unit Lak
function readFxRates(): { rThb: number | null; rUsd: number | null } {
  const p = (k: string) => { const n = parseFloat(localStorage.getItem(k) || ""); return Number.isFinite(n) && n > 0 ? n : null; };
  return { rThb: p("po_cost_rate_thb"), rUsd: p("po_cost_rate_usd") };
}
// แปลงต้นทุน (สกุลเงิน vendor) → LAK — LAK/ว่างใช้ค่าเดิม, THB/USD คูณเรท, สกุลอื่นคืนค่าเดิม, ถ้าไม่มีเรทคืน null
function costToLak(cost: number | null | undefined, currency: string, rThb: number | null, rUsd: number | null): number | null {
  if (cost == null || !Number.isFinite(cost)) return null;
  const cur = (currency || "").toUpperCase();
  if (cur === "LAK" || cur === "") return cost;
  if (cur === "THB") return rThb ? cost * rThb : null;
  if (cur === "USD") return rUsd ? cost * rUsd : null;
  return cost;
}

// meta คอลัมน์ตาราง PO (def = แสดงค่าเริ่มต้นตามไฟล์ template) — brands แทรกก่อน Total qty (def hidden)
type POColMeta = { key: string; label: string; def: boolean; w: number; thCls?: string; tdCls?: string };
const PO_FIXED_COLS: POColMeta[] = [
  { key: "division", label: "Division", def: true, w: 110, tdCls: "text-muted-foreground" },
  { key: "department", label: "Department", def: true, w: 140, tdCls: "text-muted-foreground" },
  { key: "remark", label: "Remark", def: true, w: 230, tdCls: "text-muted-foreground" },
  { key: "action", label: "Action", def: true, w: 300, tdCls: "text-muted-foreground" },
  { key: "action2", label: "Action2", def: true, w: 200 },
  { key: "order_group", label: "Order group", def: true, w: 150 },
  { key: "sku", label: "SKU", def: false, w: 120 },
  { key: "vendor_code", label: "Vendor code", def: true, w: 120 },
  { key: "vendor_name", label: "Vendor name", def: true, w: 220 },
  { key: "vendor_currency", label: "Currency", def: true, w: 80 },
  { key: "vendor_origin", label: "Vendor origin", def: true, w: 110, tdCls: "text-muted-foreground" },
  { key: "po_number", label: "PO NUMBER", def: false, w: 120, thCls: "text-muted-foreground/70", tdCls: "text-muted-foreground/80" },
  { key: "po_date", label: "PO DATE", def: false, w: 110, thCls: "text-muted-foreground/70", tdCls: "text-muted-foreground/80" },
  { key: "po_status", label: "PO Status", def: false, w: 100, thCls: "text-muted-foreground/70", tdCls: "text-muted-foreground/80" },
  { key: "po_qty", label: "PO QTY", def: false, w: 80, thCls: "text-right text-muted-foreground/70", tdCls: "text-right tabular-nums text-muted-foreground/80" },
  { key: "rec_po", label: "REC PO", def: false, w: 80, thCls: "text-right text-muted-foreground/70", tdCls: "text-right tabular-nums text-muted-foreground/80" },
  { key: "moq_1x", label: "1x", def: false, w: 70, thCls: "text-right", tdCls: "text-right tabular-nums" },
  { key: "pocost", label: "Pocost", def: false, w: 90, thCls: "text-right", tdCls: "text-right tabular-nums" },
  { key: "id", label: "ID", def: true, w: 120, tdCls: "font-medium" },
  { key: "barcode", label: "Barcode", def: true, w: 130 },
  { key: "product_name_en", label: "Product name EN", def: true, w: 240 },
  { key: "picture", label: "Picture", def: true, w: 90 },
  { key: "stock_dc", label: "Stock DC", def: true, w: 90, thCls: "text-right", tdCls: "text-right tabular-nums" },
  { key: "stock_dc_kr", label: "Stock DC (KR)", def: true, w: 110, thCls: "text-right", tdCls: "text-right tabular-nums" },
  { key: "brand_names", label: "Brand", def: true, w: 180, tdCls: "text-muted-foreground" },
  { key: "total", label: "Total qty", def: true, w: 90, thCls: "text-right bg-emerald-50", tdCls: "text-right tabular-nums font-semibold bg-emerald-50/40" },
  { key: "diff", label: "DIFF", def: true, w: 80, thCls: "text-right", tdCls: "text-right tabular-nums" },
];
const PO_BRAND_W = 90; // ความกว้างเริ่มต้นของคอลัมน์แบรนด์
const PO_VIS_LS = "po_vis_cols_v6"; // bump version → ล้างค่าเก่าใน localStorage ให้ default ใหม่ทำงาน (v6: +คอลัมน์ Brand)
const PO_VIS_MIGRATED = "po_vis_migrated_v6"; // ล้างค่าคอลัมน์เก่าทิ้งครั้งเดียว → กลับไป default ที่กำหนด
const PO_W_LS = "po_col_widths";
const PO_VENDOR_OV_LS = "po_vendor_overrides_v2"; // override vendor code ที่ผู้ใช้คีย์ไว้ (key = sku)

// vendor code ที่ถือว่า "ผู้สนองในระบบผิด" (ผูกผิดคน)
const PO_WRONG_VENDOR_CODES = new Set(["DC0288", "DC0504", "DC0426", "DC0287", "DC0290", "DC0188", "DC0505", "DC0506", "DM0001", "DM0002", "DM0003"]);
// vendor code ที่ถือว่า "ไม่ได้ผูกผู้สนอง"
const PO_EMPTY_VENDOR_VALUES = new Set(["", "0", "0-0", "-"]);

// Picking Type / Database ID สำหรับ Export PO — 2540 = DC (default), 7193 = DC (ทางเลือก)
const PO_PICKING_DC = "2540";
const PO_PICKING_DC_7193 = "7193";
const PO_PICKING_STORE = "131010001-Phonsinuan: Received PO";
const PO_PICKING_OPTIONS = [PO_PICKING_DC, PO_PICKING_DC_7193, PO_PICKING_STORE];
// รหัสที่ถือเป็น DC (Inter Transfer = "") — ที่เหลือถือเป็น store (Inter Transfer = "true")
const PO_PICKING_DC_IDS = new Set([PO_PICKING_DC, PO_PICKING_DC_7193]);
// Type Store ที่เอาสาขามาเป็นตัวเลือก Picking Type (ค่า = store_type.ship_to ตรงตามที่ Odoo ใช้)
const PO_STORE_PICK_GROUPS = ["Jmart", "Kokkok"];
// Action2 ที่อนุญาตให้ Export
const PO_EXPORT_ACTION2 = new Set(["เร่งเปิด PO และ ตามของ", "รอทำ Po Cost"]);

// คำนวณ Remark + Action ตามเงื่อนไข (priority: ไม่พบ DM > ผู้สนองผิด > ไม่ผูก > อิมพอด > ครบถ้วน)
function getPoRemarkAction(r: PORow): { remark: string; action: string } {
  if (!r.inDM) return {
    remark: "รหัสสินค้าไม่มีข้อมูลในระบบ",
    action: "ร้านอาหารหาบา หรือ รูปสินค้าให้ (ถ้าเป็นรหัสสินค้าจริงแล้ว แปลว่าไม่มีในระบบ ให้ประสารกับทีมจัดชื้อ หาแหล่งชื้อก่อน)",
  };
  const vc = r.vendor_code.trim();
  if (PO_WRONG_VENDOR_CODES.has(vc)) return {
    remark: "ผู้สนองในระบบ ผิด",
    action: "จัดชื้อใส่ผู้สนอง และ ผูกในระบบ",
  };
  if (PO_EMPTY_VENDOR_VALUES.has(vc)) return {
    remark: "รายการสินค้าในระบบ ไม่ได้ผูกผู้สนอง",
    action: "จัดชื้อใส่ผู้สนอง และ ผูกในระบบ",
  };
  const origin = r.vendor_origin.trim().toLowerCase();
  if (origin !== "laos" && origin !== "thailand") return {
    remark: "สินค้าอิมพอด",
    action: "เบิกจากดีชี หากไม่มี ขอชื้อในลาวก่อน",
  };
  return {
    remark: "ข้อมูลครบถ้วน",
    action: "Spc สั่งสินค้า และ ติดตาม",
  };
}

// คำนวณ Action2 (ลำดับเงื่อนไขตามสูตร IF ซ้อน — บนสุดชนะ)
function getPoAction2(r: PORow): string {
  // 1. ไม่พบใน data_master
  if (!r.inDM) return "รหัสสินค้าไม่มีข้อมูลในระบบ จัดชื้อประสารแบรนใส่บารที่มีในระบบ";
  // 2. Diff (Total - Stock KR) <= 0 → เบิกไป KR ครบแล้ว (Stock KR ว่าง = 0)
  if ((r.total - (r.stock_dc_kr ?? 0)) <= 0) return "เบิกไปสาง KR แล้ว";
  // 3-4. มีเลข PO
  const hasPo = r.po_number.trim() !== "" && r.po_number.trim() !== "-";
  const recQty = parseFloat(r.rec_po) || 0;
  if (hasPo && recQty === 0) return "เปิด Po แล้ว เร่งติดตามของเข้า";
  if (hasPo && recQty > 0) return "ของเข้าแล้ว เปิด SO ให้ DC Pick";
  // 5. สินค้าอิมพอด (อิงจาก Remark ที่คำนวณได้)
  if (getPoRemarkAction(r).remark === "สินค้าอิมพอด") return "สินค้าอิมพอด-เบิกจากดีชี หากไม่มี ขอชื้อในลาวก่อน";
  // 6. ยังไม่มี Po Cost (0 หรือไม่มีข้อมูล)
  if (r.pocost == null || r.pocost === 0) return "รอทำ Po Cost";
  // 7. ที่เหลือ
  return "เร่งเปิด PO และ ตามของ";
}
const poDefaultVis = () => new Set(PO_FIXED_COLS.filter((c) => c.def).map((c) => c.key));

// คอลัมน์ที่มี dropdown filter + วิธีดึงค่าของแต่ละแถว
const PO_FILTER_KEYS = ["remark", "action", "action2", "vendor_name"] as const;
type PoFilterKey = typeof PO_FILTER_KEYS[number];
const poFilterVal: Record<PoFilterKey, (r: PORow) => string> = {
  remark: (r) => getPoRemarkAction(r).remark,
  action: (r) => getPoRemarkAction(r).action,
  action2: (r) => getPoAction2(r),
  vendor_name: (r) => r.vendor_name || "",
};

// Dropdown filter หลายค่า (multi-select) + ค้นหา + เลือกทั้งหมด/ล้าง
// selected === null = ไม่กรอง (ทุกค่าผ่าน), Set ว่าง = ไม่เลือกอะไรเลย (ไม่มีแถวผ่าน)
function ColFilterPopover({ options, selected, onChange }: { options: string[]; selected: Set<string> | null; onChange: (s: Set<string> | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = selected !== null;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.toLowerCase().includes(s)) : options;
  }, [q, options]);
  const isChecked = (o: string) => selected === null || selected.has(o);
  const toggle = (o: string) => {
    const base = selected === null ? new Set(options) : new Set(selected);
    if (base.has(o)) base.delete(o); else base.add(o);
    onChange(base.size === options.length ? null : base); // ครบทุกค่า → null (ไม่กรอง)
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn("ml-1 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted shrink-0", active && "text-primary bg-primary/10")}
          title="กรอง"
        >
          <Filter className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onChange(null)}>เลือกทั้งหมด</Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onChange(new Set())}>ล้าง</Button>
        </div>
        <Command shouldFilter={false}>
          <CommandInput placeholder="ค้นหา..." value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>ไม่พบ</CommandEmpty>
            <CommandGroup>
              {shown.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => toggle(o)}>
                  <input type="checkbox" readOnly checked={isChecked(o)} className="mr-2 h-3.5 w-3.5 pointer-events-none" />
                  <span className="truncate">{o || "(ว่าง)"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ค่าที่จะแสดงในแต่ละ cell ตาม key
const poCellValue = (key: string, r: PORow): React.ReactNode => {
  switch (key) {
    case "division": return r.division || "-";
    case "department": return r.department || "-";
    case "remark": return <span className="block truncate" title={getPoRemarkAction(r).remark}>{getPoRemarkAction(r).remark}</span>;
    case "action": return <span className="block truncate" title={getPoRemarkAction(r).action}>{getPoRemarkAction(r).action}</span>;
    case "action2": return <span className="block truncate" title={getPoAction2(r)}>{getPoAction2(r)}</span>;
    case "sku": return r.sku || "-";
    case "vendor_code": return r.vendor_code || "-";
    case "vendor_name": return r.vendor_name || "-";
    case "vendor_currency": return r.vendor_currency || "-";
    case "vendor_origin": return r.vendor_origin || "-";
    case "order_group": return <span className="block truncate" title={r.order_group}>{r.order_group || "-"}</span>;
    case "brand_names": {
      const names = [...r.byBrand.entries()].filter(([, q]) => (Number(q) || 0) > 0).map(([b]) => b).sort((a, b) => a.localeCompare(b)).join(" / ");
      return <span className="block truncate" title={names}>{names || "-"}</span>;
    }
    case "po_number": return r.po_number || "-";
    case "po_date": return r.po_date || "-";
    case "po_status": return r.po_status || "-";
    case "po_qty": return r.po_qty || "-";
    case "rec_po": return r.rec_po || "-";
    case "moq_1x": return r.moq_1x ?? "-";
    case "pocost": return r.pocost ?? "-";
    case "id": return r.id || "-";
    case "barcode": return r.barcode || "-";
    case "product_name_en": return <span className="block truncate" title={r.product_name_en}>{r.product_name_en || "-"}</span>;
    case "picture": {
      if (!r.pictures || r.pictures.length === 0) return <span className="text-muted-foreground">-</span>;
      const first = r.pictures[0];
      const multi = r.pictures.length > 1;
      return (
        <a href={first.url} target="_blank" rel="noopener noreferrer" title={`${first.brand}${multi ? ` +${r.pictures.length - 1}` : ""}`} className="flex flex-col items-center gap-0 group w-fit">
          <img src={first.url} alt={first.brand} className="w-10 h-10 object-contain rounded border border-border group-hover:opacity-80 transition-opacity" />
          <span className="text-[9px] text-muted-foreground leading-none text-center max-w-[72px] truncate">{first.brand}{multi ? ` +${r.pictures.length - 1}` : ""}</span>
        </a>
      );
    }
    case "stock_dc": return r.stock_dc ?? "-";
    case "stock_dc_kr": return r.stock_dc_kr ?? "-";
    case "total": return r.total;
    case "diff": {
      // Stock KR ว่าง = 0 → DIFF = Total - Stock KR
      const diff = r.total - (r.stock_dc_kr ?? 0);
      return <span className={diff > 0 ? "text-red-500 font-semibold" : "text-emerald-600"}>{diff}</span>;
    }
    default: return "";
  }
};

function SCMPOTab({ vendorOriginMap, poSubTab, setPoSubTab }: {
  vendorOriginMap: React.MutableRefObject<Record<string, string>>;
  poSubTab: string;
  setPoSubTab: (v: string) => void;
}) {
  const { toast } = useToast();
  const { isAdmin, canDo } = useAuth();
  const can = (action: any) => isAdmin || canDo("b2b_scm", action);

  // ---- PO list (aggregation) ----
  const [poRows, setPoRows] = useState<PORow[]>([]);
  const [poBrands, setPoBrands] = useState<string[]>([]);
  const [poSelBrands, setPoSelBrands] = useState<Set<string>>(new Set()); // แบรนด์ที่ติ๊กรวมใน Total qty (ว่าง = ยังไม่ init)
  // dropdown filter 4 คอลัมน์ (null = ไม่กรอง) ทำงานร่วมกันแบบ AND + cascading
  const [colFilters, setColFilters] = useState<Record<PoFilterKey, Set<string> | null>>({ remark: null, action: null, action2: null, vendor_name: null });
  // Export PO dialog
  const [poExportOpen, setPoExportOpen] = useState(false);
  const [poExportAll, setPoExportAll] = useState(true);          // true = ทุก vendor
  const [poExportAll7193, setPoExportAll7193] = useState(false); // ทุก vendor: ติกเพื่อใช้ 7193 แทน 2540
  const [poExportSel, setPoExportSel] = useState<Set<string>>(new Set());     // vendor ที่ติ๊ก
  const [poExportPick, setPoExportPick] = useState<Record<string, string>>({}); // vendor_code → picking type
  const [poExportUnitLak, setPoExportUnitLak] = useState(false); // ติ๊ก = Unit Price ใช้ PO Cost Unit แปลงเป็น LAK
  const [poExportSearch, setPoExportSearch] = useState("");
  // ---- Convert dialog (import รหัส+จำนวน → Convert เป็น PO/SO Excel, ไม่ filter) ----
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertRows, setConvertRows] = useState<ConvertRow[]>([]);       // รายการสำหรับ Convert PO (โหลดเต็ม)
  const [convertSoRows, setConvertSoRows] = useState<ConvertRow[]>([]);   // รายการสำหรับ Convert SO (โหลดเบา ไม่มี vendor/cost)
  const [convertNameMap, setConvertNameMap] = useState<Record<string, string>>({}); // vendor_code → name
  const [convertImporting, setConvertImporting] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);   // 0-100 ตอน import Convert
  const [convertStatus, setConvertStatus] = useState("");      // ข้อความสถานะ + นับรายการ
  const [convertExporting, setConvertExporting] = useState(false);
  const [convertItemPerPo, setConvertItemPerPo] = useState(25);        // จำนวน SKU ต่อ 1 Group PO/SO
  const [convertPicking, setConvertPicking] = useState(PO_PICKING_DC); // Picking Type สำหรับ Convert PO
  const [convertUnitLak, setConvertUnitLak] = useState(false); // ติ๊ก = Unit Price แปลงเป็น LAK (Convert PO)
  const [convertUseMasterCost, setConvertUseMasterCost] = useState(false); // (คู่กับ LAK) ติ๊ก = LAK ที่ไม่มี → ดึง Standard price จาก Master
  // เรทแปลง LAK (ค้างใน localStorage คีย์เดียวกับ Data Control → ใช้ร่วมกันทั้งระบบ)
  const [convertRateThb, setConvertRateThb] = useState(() => localStorage.getItem("po_cost_rate_thb") || "");
  const [convertRateUsd, setConvertRateUsd] = useState(() => localStorage.getItem("po_cost_rate_usd") || "");
  const saveRate = (key: string, v: string, setter: (s: string) => void) => { setter(v); try { localStorage.setItem(key, v); } catch { /* localStorage เต็ม/ปิด */ } };
  const [convertVendorDefault, setConvertVendorDefault] = useState(""); // vendor เริ่มต้น (ถ้าไฟล์ไม่ได้ใส่)
  const [convertCustomer, setConvertCustomer] = useState(SO_DEFAULT_CUSTOMER); // ลูกค้าสำหรับ Convert SO
  const [convertPricelist, setConvertPricelist] = useState(SO_PRICELIST);       // Pricelist สำหรับ Convert SO
  const [convertSoRoute, setConvertSoRoute] = useState(SO_PRICELIST_META[SO_PRICELIST]?.route || "");        // Order lines/Route (default ตาม Pricelist)
  const [convertSoWarehouse, setConvertSoWarehouse] = useState(SO_PRICELIST_META[SO_PRICELIST]?.warehouse || SO_WAREHOUSE); // Warehouse (default ตาม Pricelist)
  const [convertSoStore, setConvertSoStore] = useState(false);          // ติ๊ก = SO Store (ไม่มีคอลัมน์ Route · Warehouse = ชื่อสาขา)
  const [convertSoStoreWh, setConvertSoStoreWh] = useState("");         // Warehouse = ชื่อสาขา (ตอนติ๊ก SO Store)
  const [convertSoStoreOpts, setConvertSoStoreOpts] = useState<string[]>([]); // รายชื่อสาขา (store_type.store_name)
  const [convertVendorOpts, setConvertVendorOpts] = useState<CustomerOpt[]>([]); // dropdown vendor
  const [convertCustomerOpts, setConvertCustomerOpts] = useState<CustomerOpt[]>([]); // dropdown ลูกค้า
  const [convertCurrencyByVendor, setConvertCurrencyByVendor] = useState<Record<string, string>>({}); // vendor code → สกุลเงิน (สำหรับแปลง LAK)
  // ตัวเลือก Picking Type เพิ่มเติม = สาขาของ Type Jmart/Kokkok (ค่า = ship_to จาก store_type ตรงตามที่ Odoo ใช้)
  const [pickStoreOpts, setPickStoreOpts] = useState<{ value: string; label: string }[]>([]);
  const [poReportOpen, setPoReportOpen] = useState(false);
  const [poLoading, setPoLoading] = useState(false);
  const [poLoaded, setPoLoaded] = useState(false);
  const [poProgress, setPoProgress] = useState(0);   // 0-100
  const [poStatus, setPoStatus] = useState("");       // ข้อความสถานะการโหลด
  const [poSearch, setPoSearch] = useState("");

  // เมื่อรายชื่อแบรนด์เปลี่ยน (โหลด/โหลดใหม่) → ติ๊กครบทุกแบรนด์เป็นค่าเริ่มต้น
  useEffect(() => { setPoSelBrands(new Set(poBrands)); }, [poBrands]);

  // ---- Vendor override (คีย์ Vendor code ใหม่ได้ → ดึง name/currency มาอัตโนมัติ + จำไว้ข้ามโหลด) ----
  const vendorOvRef = useRef<Record<string, { code: string; name: string; currency: string; origin: string }>>(
    (() => {
      try { const raw = localStorage.getItem(PO_VENDOR_OV_LS); if (raw) return JSON.parse(raw); } catch {}
      return {};
    })(),
  );
  const [vendorLookupSkus, setVendorLookupSkus] = useState<Set<string>>(new Set());

  // โหลด vendor override จาก DB (source of truth) → ถ้าตารางยังไม่ถูกสร้างใช้ค่าจาก localStorage เดิม
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await (supabase as any).from("po_vendor_override").select("*");
        if (error) throw error;
        const map: Record<string, { code: string; name: string; currency: string; origin: string }> = {};
        for (const r of (data || []) as any[]) map[r.sku] = { code: r.vendor_code || "", name: r.vendor_name || "", currency: r.vendor_currency || "", origin: r.vendor_origin || "" };
        vendorOvRef.current = map;
        try { localStorage.setItem(PO_VENDOR_OV_LS, JSON.stringify(map)); } catch {}
        // ถ้า PO โหลดอยู่แล้ว → apply override ใหม่ทับ
        setPoRows((prev) => prev.length ? prev.map((r) => { const ov = map[r.sku]; return ov ? { ...r, vendor_code: ov.code, vendor_name: ov.name, vendor_currency: ov.currency, vendor_origin: ov.origin || r.vendor_origin } : r; }) : prev);
      } catch { /* ตารางยังไม่ถูกสร้าง — ใช้ localStorage เดิม */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVendorCodeChange = async (sku: string, newCode: string) => {
    const trimmed = newCode.trim();
    let vendorName = "";
    let vendorCurrency = "";
    let vendorOrigin = "";
    if (trimmed) {
      setVendorLookupSkus((prev) => new Set([...prev, sku]));
      try {
        // vendor_master: currency + origin (ไม่มี vendor_display_name ในตารางนี้)
        // data_master: vendor_display_name (เก็บ denormalized ไว้ที่นี่)
        const [vmRes, dmRes] = await Promise.all([
          (supabase as any)
            .from("vendor_master")
            .select("supplier_currency, vendor_origin")
            .eq("vendor_code", trimmed)
            .limit(1),
          (supabase as any)
            .from("data_master")
            .select("vendor_display_name")
            .eq("vendor_code", trimmed)
            .not("vendor_display_name", "is", null)
            .limit(1),
        ]);
        vendorCurrency = vmRes.data?.[0]?.supplier_currency || "";
        vendorOrigin = vmRes.data?.[0]?.vendor_origin || "";
        vendorName = dmRes.data?.[0]?.vendor_display_name || "";
      } catch { /* ไม่เจอก็ใช้ค่าว่าง */ }
      setVendorLookupSkus((prev) => { const n = new Set(prev); n.delete(sku); return n; });
    }
    // บันทึก override (ถ้า code ว่าง = ลบ override)
    const ov = { ...vendorOvRef.current };
    if (trimmed) ov[sku] = { code: trimmed, name: vendorName, currency: vendorCurrency, origin: vendorOrigin };
    else delete ov[sku];
    vendorOvRef.current = ov;
    try { localStorage.setItem(PO_VENDOR_OV_LS, JSON.stringify(ov)); } catch {}
    // DB (source of truth) — upsert ถ้ามี code, ลบถ้าว่าง
    try {
      if (trimmed) await (supabase as any).from("po_vendor_override").upsert({ sku, vendor_code: trimmed, vendor_name: vendorName, vendor_currency: vendorCurrency, vendor_origin: vendorOrigin, updated_at: new Date().toISOString() });
      else await (supabase as any).from("po_vendor_override").delete().eq("sku", sku);
    } catch { /* ตารางยังไม่ถูกสร้าง — มี localStorage สำรอง */ }
    // อัปแถวใน state + cache (vendor_origin ด้วย → Remark/Action อัปเดตทันที)
    setPoRows((prev) => {
      const updated = prev.map((r) =>
        r.sku === sku ? { ...r, vendor_code: trimmed, vendor_name: vendorName, vendor_currency: vendorCurrency, vendor_origin: trimmed ? vendorOrigin : r.vendor_origin } : r,
      );
      if (poDataCache) poDataCache = { ...poDataCache, rows: updated };
      return updated;
    });
  };

  // Import Excel 2 คอลัมน์ (ID + Vendor code) → อัปเดต Vendor code ของ SKU ที่ตรงกันแบบ bulk
  // เซลล์ Vendor code ที่ว่าง = ไม่เปลี่ยน (ข้าม)
  const [vendorImporting, setVendorImporting] = useState(false);
  const handleVendorImport = async (file: File) => {
    setVendorImporting(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (raw[0] as string[]).map((h) => String(h ?? "").toLowerCase().trim());
      const idIdx = headers.findIndex((h) => h === "id" || h === "item_id" || h.includes("sku") || h.includes("รหัส"));
      const vcIdx = headers.findIndex((h) => h.includes("vendor code") || h.includes("vendor_code") || h.includes("ผู้สนอง") || h === "vendor");
      if (idIdx < 0) { toast({ title: "ไม่พบคอลัมน์ ID", variant: "destructive" }); return; }
      if (vcIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Vendor code", variant: "destructive" }); return; }
      // sku → vendor code (เอาแถวหลังสุดถ้าซ้ำ, ข้ามแถวที่ไม่ได้กรอก vendor code)
      const pairs = new Map<string, string>();
      for (const r of raw.slice(1)) {
        const sku = String(r[idIdx] ?? "").trim();
        const vc = String(r[vcIdx] ?? "").trim();
        if (!sku || !vc) continue;
        pairs.set(sku, vc);
      }
      if (pairs.size === 0) { toast({ title: "ไม่พบข้อมูล (ต้องมีทั้ง ID และ Vendor code)", variant: "destructive" }); return; }
      // batch lookup: vendor_master (currency, origin) + data_master (display name) ของ vendor code ที่ไม่ซ้ำ
      const codes = [...new Set([...pairs.values()])];
      const vmMap = new Map<string, { currency: string; origin: string }>();
      const nameMap = new Map<string, string>();
      try {
        const [vmRes, dmRes] = await Promise.all([
          (supabase as any).from("vendor_master").select("vendor_code, supplier_currency, vendor_origin").in("vendor_code", codes),
          (supabase as any).from("data_master").select("vendor_code, vendor_display_name").in("vendor_code", codes).not("vendor_display_name", "is", null),
        ]);
        for (const v of (vmRes.data || [])) if (v.vendor_code && !vmMap.has(v.vendor_code)) vmMap.set(v.vendor_code, { currency: v.supplier_currency || "", origin: v.vendor_origin || "" });
        for (const d of (dmRes.data || [])) if (d.vendor_code && !nameMap.has(d.vendor_code)) nameMap.set(d.vendor_code, d.vendor_display_name || "");
      } catch { /* lookup พลาด → ใช้ค่าว่าง */ }
      // อัปเดต override เฉพาะ SKU ที่อยู่ในตาราง PO
      const skuSet = new Set(poRows.map((r) => r.sku));
      const ov = { ...vendorOvRef.current };
      const dbPayload: any[] = [];
      let updated = 0, notFound = 0;
      for (const [sku, vc] of pairs) {
        if (!skuSet.has(sku)) { notFound++; continue; }
        const entry = { code: vc, name: nameMap.get(vc) || "", currency: vmMap.get(vc)?.currency || "", origin: vmMap.get(vc)?.origin || "" };
        ov[sku] = entry;
        dbPayload.push({ sku, vendor_code: entry.code, vendor_name: entry.name, vendor_currency: entry.currency, vendor_origin: entry.origin, updated_at: new Date().toISOString() });
        updated++;
      }
      vendorOvRef.current = ov;
      try { localStorage.setItem(PO_VENDOR_OV_LS, JSON.stringify(ov)); } catch {}
      // DB (source of truth) — upsert ทั้งชุด
      try { if (dbPayload.length) await (supabase as any).from("po_vendor_override").upsert(dbPayload); } catch { /* ตารางยังไม่ถูกสร้าง — มี localStorage สำรอง */ }
      // อัปแถวใน state + cache ทีเดียว
      setPoRows((prev) => {
        const next = prev.map((r) => {
          const vc = pairs.get(r.sku);
          if (!vc) return r;
          return { ...r, vendor_code: vc, vendor_name: nameMap.get(vc) || "", vendor_currency: vmMap.get(vc)?.currency || "", vendor_origin: vmMap.get(vc)?.origin || r.vendor_origin };
        });
        if (poDataCache) poDataCache = { ...poDataCache, rows: next };
        return next;
      });
      toast({ title: "อัปเดต Vendor เสร็จ", description: `อัปเดต ${updated} รายการ${notFound ? ` · ไม่พบใน PO ${notFound}` : ""}` });
    } catch (e: any) {
      toast({ title: "Import ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setVendorImporting(false);
    }
  };

  // ---- คอลัมน์ที่แสดง (Show/Hide) — จำค่าไว้ใน localStorage ----
  const [visCols, setVisCols] = useState<Set<string>>(() => {
    try {
      // one-time migration: ล้างค่าคอลัมน์เก่าที่ค้างอยู่ทิ้ง 1 ครั้ง → บังคับใช้ default ตาม template
      if (!localStorage.getItem(PO_VIS_MIGRATED)) {
        localStorage.removeItem(PO_VIS_LS);
        localStorage.setItem(PO_VIS_MIGRATED, "1");
        return poDefaultVis();
      }
      const raw = localStorage.getItem(PO_VIS_LS); if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return poDefaultVis();
  });
  // ไม่ auto-save แล้ว — บันทึกเมื่อกดปุ่ม "Save View" เท่านั้น (ดู saveView ด้านล่าง)
  const toggleCol = (key: string) => setVisCols((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ---- ความกว้างคอลัมน์ (ลากยืด/หดหัวคอลัมน์ได้) — จำค่าใน localStorage ----
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { const raw = localStorage.getItem(PO_W_LS); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  });
  // บันทึก View (เฉพาะเครื่องนี้): คอลัมน์ที่แสดง/ซ่อน + ความกว้าง
  const saveView = () => {
    try {
      localStorage.setItem(PO_VIS_LS, JSON.stringify([...visCols]));
      localStorage.setItem(PO_W_LS, JSON.stringify(colWidths));
      toast({ title: "บันทึก View แล้ว", description: "คอลัมน์ที่แสดง + ความกว้าง (เฉพาะเครื่องนี้)" });
    } catch { toast({ title: "บันทึก View ไม่สำเร็จ", variant: "destructive" }); }
  };
  const defaultW = (key: string) => (key.startsWith("brand:") ? PO_BRAND_W : (PO_FIXED_COLS.find((c) => c.key === key)?.w ?? 110));
  const widthOf = (key: string) => colWidths[key] ?? defaultW(key);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW: widthOf(key) };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current; if (!r) return;
      const w = Math.max(50, r.startW + (ev.clientX - r.startX));
      setColWidths((prev) => ({ ...prev, [r.key]: w }));
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };

  // กู้ข้อมูล PO จาก cache ตอน mount (ข้ามการสลับ tab/หน้า)
  useEffect(() => {
    if (poDataCache && poRows.length === 0) {
      setPoRows(poDataCache.rows);
      setPoBrands(poDataCache.brands);
      setPoLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Import sub-tabs ----
  const [stockKrRows, setStockKrRows] = useState<Record<string, string>[]>([]);
  const [poReceiveRows, setPoReceiveRows] = useState<Record<string, string>[]>([]);
  const [importingKr, setImportingKr] = useState(false);
  const [importingRec, setImportingRec] = useState(false);
  const [savingKr, setSavingKr] = useState(false);
  const [savingRec, setSavingRec] = useState(false);

  // โหลดข้อมูลที่ Save ไว้ใน Supabase กลับมาแสดง (ทุก user เห็นชุดเดียวกัน)
  useEffect(() => {
    (async () => {
      try {
        const [kr, rec] = await Promise.all([
          (supabase as any).from("scm_stock_kr").select("*").order("created_at", { ascending: true }),
          (supabase as any).from("scm_po_receive").select("*").order("created_at", { ascending: true }),
        ]);
        if (kr?.data) setStockKrRows(kr.data.map((r: any) => pickCols(r, STOCK_KR_COLS)));
        if (rec?.data) setPoReceiveRows(rec.data.map((r: any) => pickCols(r, PO_RECEIVE_COLS)));
      } catch { /* ตารางอาจยังไม่ถูกสร้าง — เงียบไว้ */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // เก็บเฉพาะคอลัมน์ตาม config (string) จาก record ของ Supabase
  const pickCols = (r: any, cols: readonly { key: string }[]): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const c of cols) o[c.key] = r[c.key] == null ? "" : String(r[c.key]);
    return o;
  };

  // Save = แทนที่ข้อมูลทั้งตารางด้วยรายการปัจจุบัน (replace all)
  const saveImport = async (
    table: string,
    cols: readonly { key: string }[],
    rows: Record<string, string>[],
    setSaving: (b: boolean) => void,
    label: string,
  ) => {
    setSaving(true);
    try {
      // ลบของเดิมทั้งหมด (row_id เป็น PK ไม่เคย null → match ทุกแถว)
      const del = await (supabase as any).from(table).delete().not("row_id", "is", null);
      if (del.error) throw del.error;
      // insert ชุดใหม่ทีละ 500 แถว
      const payload = rows.map((r) => { const o: Record<string, any> = {}; for (const c of cols) o[c.key] = r[c.key] ?? ""; return o; });
      for (let i = 0; i < payload.length; i += 500) {
        const ins = await (supabase as any).from(table).insert(payload.slice(i, i + 500));
        if (ins.error) throw ins.error;
      }
      toast({ title: `บันทึก ${label} แล้ว`, description: `${rows.length} รายการ` });
    } catch (e: any) {
      toast({ title: `บันทึกไม่สำเร็จ`, description: e.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const fetchInChunks = async (table: string, select: string, col: string, ids: string[], orderCol?: string): Promise<any[]> => {
    const CH = 200;
    const PAGE = 1000;
    const ord = orderCol || col;
    // แบ่ง chunk แล้วยิงขนานกัน (browser จำกัด ~6 connection เองอยู่แล้ว) — เร็วกว่ายิงทีละ chunk
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CH) { const p = ids.slice(i, i + CH); if (p.length) chunks.push(p); }
    const results = await Promise.all(chunks.map(async (part) => {
      const acc: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from(table).select(select).in(col, part)
          .order(ord, { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        acc.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return acc;
    }));
    return results.flat();
  };

  // โหลด + คำนวณตาราง PO จาก Monthly usage ทุกแบรนด์
  const buildPO = async () => {
    setPoLoading(true);
    setPoProgress(5);
    setPoStatus("ดึง Monthly usage...");
    try {
      // 1) ดึง item ทั้งหมด (paginate) + map doc → brand
      const items: any[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("monthly_usage_item")
          .select("sku_code, barcode, product_name, monthly_qty, doc_id, picture, order_group")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        items.push(...data);
        setPoProgress((p) => Math.min(p + 5, 25));
        if (data.length < PAGE) break;
      }
      const { data: docs } = await (supabase as any).from("monthly_usage_doc").select("id, brand_name");
      const brandByDoc = new Map<string, string>();
      for (const d of (docs || []) as any[]) brandByDoc.set(d.id, d.brand_name || "");

      // 2) รวม qty group by SKU (ถ้าไม่มี SKU ใช้ barcode) + per brand
      const map = new Map<string, POAgg>();
      const brandSet = new Set<string>();
      for (const it of items) {
        const sku = String(it.sku_code ?? "").trim();
        const nm = String(it.product_name ?? "").trim();
        // ไม่มี SKU → ใช้ชื่อสินค้าที่ import เป็นตัวจับกลุ่มแทน (fallback: barcode ถ้าไม่มีชื่อ)
        const key = sku
          ? sku
          : nm ? `name:${nm}`
          : String(it.barcode ?? "").trim() ? `bc:${String(it.barcode).trim()}`
          : "";
        if (!key) continue;
        const brand = brandByDoc.get(it.doc_id) || "";
        if (brand) brandSet.add(brand);
        const qty = Number(it.monthly_qty) || 0;
        if (!map.has(key)) map.set(key, { sku, barcode: it.barcode || "", product_name: it.product_name || "", total: 0, byBrand: new Map(), picByBrand: new Map(), orderGroups: new Set() });
        const a = map.get(key)!;
        a.total += qty;
        const og = String(it.order_group ?? "").trim();
        if (og) a.orderGroups.add(og);
        if (brand) a.byBrand.set(brand, (a.byBrand.get(brand) || 0) + qty);
        if (brand && it.picture && !a.picByBrand.has(brand)) a.picByBrand.set(brand, it.picture);
        if (!a.barcode && it.barcode) a.barcode = it.barcode;
        if (!a.product_name && it.product_name) a.product_name = it.product_name;
      }

      // 3) enrich — ยิงขนานกัน (data_master / stock / po_cost / scm_stock_kr / scm_po_receive)
      const skus = [...map.keys()].filter((k) => !k.startsWith("bc:") && !k.startsWith("name:"));
      setPoStatus("ดึงข้อมูลสินค้า / สต็อก / PO...");
      setPoProgress(35);
      const fetchPoReceiveAll = async () => {
        const rec: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await (supabase as any)
            .from("scm_po_receive")
            .select("id, order_ref, created_date, status, quantity, received_qty, barcode, product")
            .range(from, from + 999);
          if (error) throw error;
          rec.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return rec;
      };
      const [dm, stock, pc, krRows, recRows] = await Promise.all([
        skus.length ? fetchInChunks("data_master", "sku_code, division, department, product_name_en, vendor_code, vendor_display_name, main_barcode, packing_size_qty", "sku_code", skus) : Promise.resolve([] as any[]),
        skus.length ? fetchInChunks("stock", "id, item_id, type_store, quantity", "item_id", skus, "id") : Promise.resolve([] as any[]),
        (skus.length ? fetchInChunks("po_cost", "item_id, moq, po_cost, po_cost_unit, vendor", "item_id", skus) : Promise.resolve([] as any[])).catch(() => [] as any[]),
        (skus.length ? fetchInChunks("scm_stock_kr", "id, qty", "id", skus) : Promise.resolve([] as any[])).catch(() => [] as any[]),
        fetchPoReceiveAll().catch(() => [] as any[]),
      ]);
      setPoProgress(78);

      // data_master maps
      const dmMap = new Map<string, any>();
      for (const d of dm) if (d.sku_code && !dmMap.has(d.sku_code)) dmMap.set(d.sku_code, d);
      // Barcode = main_barcode จากแถวที่ packing_size_qty = 1 (หน่วยฐาน) เท่านั้น
      const barcodeMap = new Map<string, string>();
      for (const d of dm) {
        if (d.sku_code && Number(d.packing_size_qty) === 1 && d.main_barcode && !barcodeMap.has(d.sku_code)) {
          barcodeMap.set(d.sku_code, String(d.main_barcode));
        }
      }
      // vendor_master — รวม vendor จาก data_master + vendor เจ้าของ po_cost (ต้องใช้สกุลเงินตอนแปลง LAK)
      setPoStatus("ดึงข้อมูลผู้สนอง...");
      const costVendorCodes = new Set<string>();
      for (const p of pc) { const v = String(p.vendor ?? "").trim(); if (v) costVendorCodes.add(v); }
      const vendorCodes = [...new Set([...dm.map((d: any) => d.vendor_code).filter(Boolean), ...costVendorCodes])] as string[];
      const vm = vendorCodes.length
        ? await fetchInChunks("vendor_master", "vendor_code, supplier_currency, vendor_origin", "vendor_code", vendorCodes)
        : [];
      const vmMap = new Map<string, any>();
      for (const v of vm) if (v.vendor_code && !vmMap.has(v.vendor_code)) vmMap.set(v.vendor_code, v);
      const ccyOf = (vc: string) => String(vmMap.get(vc)?.supplier_currency ?? "").toUpperCase();
      setPoProgress(88);
      setPoStatus("คำนวณ...");
      // stock DC
      const stockDcMap = new Map<string, number>();
      for (const s of stock) {
        if (String(s.type_store) === "DC") stockDcMap.set(s.item_id, (stockDcMap.get(s.item_id) || 0) + (Number(s.quantity) || 0));
      }
      // PO Cost — 1x = moq, Pocost = po_cost (match ด้วย item_id) · po_cost_unit เก็บแยกตาม vendor (match ID+Vendor)
      const pcMap = new Map<string, { moq: number | null; po_cost: number | null }>();
      const costByItem = new Map<string, Record<string, { unit: number; ccy: string }>>(); // item_id → { vendor: {unit, ccy} }
      for (const p of pc) {
        const id = String(p.item_id ?? "");
        if (!id) continue;
        if (!pcMap.has(id)) pcMap.set(id, { moq: p.moq == null ? null : Number(p.moq), po_cost: p.po_cost == null ? null : Number(p.po_cost) });
        const unit = p.po_cost_unit == null ? null : Number(p.po_cost_unit);
        if (unit == null || !Number.isFinite(unit)) continue;
        const vc = String(p.vendor ?? "").trim(); // "" = po_cost ที่ไม่ผูก vendor
        if (!costByItem.has(id)) costByItem.set(id, {});
        const m = costByItem.get(id)!;
        if (m[vc] == null) m[vc] = { unit, ccy: ccyOf(vc) };
      }
      // Stock DC (KR) — SUMIF qty
      const krMap = new Map<string, number>();
      for (const k of krRows) { const id = String(k.id ?? ""); if (id) krMap.set(id, (krMap.get(id) || 0) + (Number(k.qty) || 0)); }
      // PO Receive — index ด้วย barcode/sku เลือก line วันที่ PO ล่าสุด
      const recByBc = new Map<string, any>();
      const recBySku = new Map<string, any>();
      {
        const ts = (v: any) => { const d = excelCellToDate(v); return d ? d.getTime() : -Infinity; };
        const pick = (m: Map<string, any>, key: string, r: any) => { if (!key) return; const cur = m.get(key); if (!cur || ts(r.created_date) >= ts(cur.created_date)) m.set(key, r); };
        for (const r of recRows) {
          const bc = String(r.barcode ?? "").trim();
          const id = String(r.id ?? "").trim();
          const skuFromProduct = String(r.product ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim() ?? "";
          pick(recByBc, bc, r);
          pick(recBySku, id || skuFromProduct, r);
        }
      }

      const brands = [...brandSet].sort((a, b) => a.localeCompare(b));
      const rows: PORow[] = [...map.values()].map((a) => {
        const d = dmMap.get(a.sku) || {};
        const v = vmMap.get(d.vendor_code) || {};
        // ใช้ vendor_origin จาก vendor_master (fresh) ก่อน แล้ว fallback ไป parent ref
        const origin = v.vendor_origin || (d.vendor_code && vendorOriginMap.current[d.vendor_code]) || "";
        const pc = pcMap.get(a.sku) || {};
        const rowBarcode = barcodeMap.get(a.sku) || d.main_barcode || a.barcode || "";
        // match PO receive: sku ก่อน แล้วลอง barcode หลายแบบ (main / unit / ของ item)
        const rec = recBySku.get(a.sku)
          || recByBc.get(rowBarcode)
          || recByBc.get(d.main_barcode || "")
          || recByBc.get(a.barcode || "")
          || {};
        const str = (x: any) => (x == null || x === "" ? "" : String(x));
        const inDM = a.sku !== "" && dmMap.has(a.sku);
        return {
          division: d.division || "",
          department: d.department || "",
          sku: a.sku,
          inDM,
          vendor_code: d.vendor_code || "",
          vendor_name: d.vendor_display_name || "",
          vendor_currency: v.supplier_currency || "",
          vendor_origin: origin,
          order_group: [...a.orderGroups].sort((x, y) => x.localeCompare(y)).join(" / "),
          id: a.sku,
          barcode: rowBarcode,
          product_name_en: d.product_name_en || a.product_name || "",
          stock_dc: stockDcMap.has(a.sku) ? (stockDcMap.get(a.sku) as number) : null,
          stock_dc_kr: krMap.has(a.sku) ? (krMap.get(a.sku) as number) : null,
          po_number: str(rec.order_ref),
          po_date: excelToDDMMMYY(rec.created_date), // ค่าเก็บเป็น serial → แปลงเป็น dd-Mmm-yy ตอนแสดง

          po_status: str(rec.status),
          po_qty: str(rec.quantity),
          rec_po: str(rec.received_qty),
          moq_1x: (pc as any).moq ?? null,
          pocost: (pc as any).po_cost ?? null,
          costByVendor: costByItem.get(a.sku) || {},
          byBrand: a.byBrand,
          total: a.total,
          pictures: [...a.picByBrand.entries()].map(([brand, url]) => ({ url, brand })),
        };
      });
      // Sort: Order group → Vendor name → Product name EN
      rows.sort((x, y) => {
        const og = (x.order_group || "").localeCompare(y.order_group || "", undefined, { sensitivity: "base" });
        if (og !== 0) return og;
        const vn = (x.vendor_name || "").localeCompare(y.vendor_name || "", undefined, { sensitivity: "base" });
        if (vn !== 0) return vn;
        return (x.product_name_en || x.id).localeCompare(y.product_name_en || y.id, undefined, { sensitivity: "base" });
      });

      // apply vendor overrides ที่ผู้ใช้คีย์ไว้ก่อนหน้า (รวม origin → Remark/Action ถูกต้อง)
      for (const r of rows) {
        const ov = vendorOvRef.current[r.sku];
        if (ov) { r.vendor_code = ov.code; r.vendor_name = ov.name; r.vendor_currency = ov.currency; if (ov.origin !== undefined) r.vendor_origin = ov.origin; }
      }

      setPoProgress(100);
      setPoStatus("เสร็จสิ้น");
      setPoBrands(brands);
      setPoRows(rows);
      setPoLoaded(true);
      poDataCache = { rows, brands }; // เก็บ cache ไว้ข้ามการสลับ tab/หน้า
      toast({ title: "โหลด PO สำเร็จ", description: `${rows.length} SKU · ${brands.length} แบรนด์` });
    } catch (e: any) {
      toast({ title: "โหลด PO ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setPoLoading(false);
    }
  };

  const allBrandsSelected = poBrands.length > 0 && poBrands.every((b) => poSelBrands.has(b));
  // 1) กรองแบรนด์ (คำนวณ Total ใหม่ ตัดแถว 0) → 2) กรองข้อความค้นหา
  const searchedPoRows = (() => {
    let rows = poRows;
    if (!allBrandsSelected) {
      rows = rows
        .map((r) => {
          let t = 0;
          for (const b of poSelBrands) t += r.byBrand.get(b) ?? 0;
          return { ...r, total: t };
        })
        .filter((r) => r.total !== 0);
    }
    const q = poSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.barcode.toLowerCase().includes(q) ||
        r.product_name_en.toLowerCase().includes(q) ||
        r.vendor_code.toLowerCase().includes(q) ||
        r.vendor_name.toLowerCase().includes(q),
    );
  })();
  // ผ่าน dropdown filter ทั้ง 4 (ยกเว้นคอลัมน์ที่ระบุใน except — ใช้คำนวณ option แบบ cascading)
  const poPassesCols = (r: PORow, except?: PoFilterKey) => {
    for (const key of PO_FILTER_KEYS) {
      if (key === except) continue;
      const sel = colFilters[key];
      if (sel === null) continue;
      if (!sel.has(poFilterVal[key](r))) return false;
    }
    return true;
  };
  // ตัวเลือกของแต่ละ dropdown = ค่าที่มีอยู่ในแถวที่ผ่านฟิลเตอร์อื่น (cascading)
  const poColOptions = (key: PoFilterKey): string[] => {
    const s = new Set<string>();
    for (const r of searchedPoRows) if (poPassesCols(r, key)) { const v = poFilterVal[key](r); if (v) s.add(v); }
    return [...s].sort((a, b) => a.localeCompare(b));
  };
  const filteredPoRows = searchedPoRows.filter((r) => poPassesCols(r));

  // Report — นับ distinct SKU group by Remark / Action2 (จากข้อมูลที่โหลดทั้งหมด, 1 แถว = 1 SKU)
  const poReportCurrent = (() => {
    const remark = new Map<string, number>();
    const action2 = new Map<string, number>();
    for (const r of poRows) {
      const rm = getPoRemarkAction(r).remark;
      const a2 = getPoAction2(r);
      remark.set(rm, (remark.get(rm) || 0) + 1);
      action2.set(a2, (action2.get(a2) || 0) + 1);
    }
    const toArr = (m: Map<string, number>) => [...m.entries()].map(([category, count]) => ({ category, count }));
    return { remark: toArr(remark), action2: toArr(action2) };
  })();

  // ===== Export PO (รูปแบบ import เข้า Odoo แบบ SRR DC) =====
  // แถวที่ export ได้: Action2 ∈ {เร่งเปิด PO และ ตามของ, รอทำ Po Cost} และ DIFF > 0 (คิด Stock KR ว่าง = 0)
  const poExportEligible = (() => {
    let rows = poRows;
    if (!allBrandsSelected) {
      rows = rows.map((r) => { let t = 0; for (const b of poSelBrands) t += r.byBrand.get(b) ?? 0; return { ...r, total: t }; });
    }
    return rows.filter((r) => PO_EXPORT_ACTION2.has(getPoAction2(r)) && (r.total - (r.stock_dc_kr ?? 0)) > 0);
  })();
  const poExportVendors = (() => {
    const m = new Map<string, string>();
    for (const r of poExportEligible) if (r.vendor_code && !m.has(r.vendor_code)) m.set(r.vendor_code, r.vendor_name || r.vendor_code);
    return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  })();

  const doExportPO = () => {
    let rows = poExportEligible;
    if (!poExportAll) rows = rows.filter((r) => poExportSel.has(r.vendor_code));
    if (rows.length === 0) { toast({ title: "ไม่มีรายการให้ export", description: "ตรวจเงื่อนไข Action2 / DIFF / Vendor ที่เลือก", variant: "destructive" }); return; }
    // Unit Price = PO Cost Unit match ID+Vendor (r.vendor_code = vendor ตัวที่ export/override) → ไม่เจอ fallback vendor อื่นของ SKU เดียวกัน
    // ติ๊ก Pocost Unit Lak → แปลงเป็น LAK ด้วยเรทตามสกุลเงินของ vendor เจ้าของ cost ที่หยิบมาจริง
    const { rThb, rUsd } = readFxRates();
    let lakMissing = 0;
    // เลือก cost ตาม vendor ปัจจุบันของแถว (rวมกรณี override) → ไม่เจอ fallback ราคา vendor อื่นของ SKU เดียวกัน
    const pickCost = (r: PORow): { unit: number; ccy: string } | null => {
      const cbv = r.costByVendor || {};
      if (cbv[r.vendor_code]) return cbv[r.vendor_code];
      const keys = Object.keys(cbv);
      return keys.length ? cbv[keys[0]] : null;
    };
    const unitPrice = (r: PORow): number | string => {
      const c = pickCost(r);
      if (!c) return "";
      if (!poExportUnitLak) return c.unit;
      const lak = costToLak(c.unit, c.ccy, rThb, rUsd);
      if (lak == null) { lakMissing++; return ""; } // ไม่มีเรทสำหรับสกุลนี้
      return lak;
    };
    // group ตาม vendor
    const byVendor = new Map<string, PORow[]>();
    for (const r of rows) { const vc = r.vendor_code || ""; if (!byVendor.has(vc)) byVendor.set(vc, []); byVendor.get(vc)!.push(r); }
    const out: Record<string, any>[] = [];
    for (const [vc, vRows] of byVendor) {
      const pick = poExportAll
        ? (poExportAll7193 ? PO_PICKING_DC_7193 : PO_PICKING_DC)
        : (poExportPick[vc] || PO_PICKING_DC);
      const interTransfer = PO_PICKING_DC_IDS.has(pick) ? "" : "true";
      vRows.forEach((r, idx) => {
        const diff = r.total - (r.stock_dc_kr ?? 0);
        out.push({
          "partner_id": idx === 0 ? vc : "",
          "Picking Type / Database ID": idx === 0 ? pick : "",
          "Inter Transfer": idx === 0 ? interTransfer : "",
          "PO Group": idx === 0 ? vc : "",
          "Vendor name": r.vendor_name || "",
          "Brand": [...r.byBrand.entries()]
            .filter(([b, q]) => (q ?? 0) > 0 && (allBrandsSelected || poSelBrands.has(b)))
            .map(([b]) => b)
            .join(" / "),
          "Products to Purchase/barcode": r.barcode,
          "Products to Purchase/Product": r.barcode,
          "Product name": r.product_name_en,
          "Products to Purchase/UoM": "Unit",
          "Products to Purchase/Exclude In Package": "True",
          "Products to Purchase/Quantity": diff,
          "Products to Purchase/Unit Price": unitPrice(r),
          "assigned_to": idx === 0 ? "SPC manager01" : "",
          "description": "",
        });
      });
    }
    if (poExportUnitLak && lakMissing > 0) {
      toast({ title: "เตือน: ขาดเรทแปลง LAK", description: `${lakMissing} รายการที่เป็น THB/USD ยังไม่ได้ตั้งเรท (ตั้งที่ Data Control) → Unit Price ว่าง`, variant: "destructive" });
    }
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PO");
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
    XLSX.writeFile(wb, `${stamp}-PO-Import.xlsx`);
    setPoExportOpen(false);
    toast({ title: "Export PO สำเร็จ", description: `${out.length} แถว · ${byVendor.size} vendor` });
  };

  // ===== Convert: import รหัส+จำนวน → Convert เป็น PO/SO Excel (ไม่ filter รายการออก) =====
  // Vendor เรียงลำดับ: จากไฟล์ > Vendor เริ่มต้นที่เลือก (override Master) > จาก data_master
  const convertFinalVendor = (r: ConvertRow) => r.fileVendor || convertVendorDefault || r.dmVendor || "";

  // โหลดสาขา Type Jmart/Kokkok มาเป็นตัวเลือก Picking Type — ค่า = ship_to (ตรงตามที่ Odoo ต้องการ) → export ถูกต้อง
  const loadPickStoreOpts = async () => {
    if (pickStoreOpts.length > 0) return;
    try {
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any).from("store_type").select("code, store_name, type_store, ship_to").in("type_store", PO_STORE_PICK_GROUPS).order("code").range(from, from + 999);
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const seen = new Set<string>();
      const opts: { value: string; label: string }[] = [];
      for (const r of rows) {
        const val = String(r.ship_to ?? "").trim(); // ship_to = ค่า Picking Type จริงที่ Odoo ใช้
        if (!val || seen.has(val)) continue;
        seen.add(val);
        opts.push({ value: val, label: `${String(r.store_name ?? "").trim() || val} · ${r.type_store}` });
      }
      setPickStoreOpts(opts);
    } catch { /* โหลดไม่ได้ = ใช้แค่ 2540/7193 + สาขา default */ }
  };

  // โหลดชื่อสาขา (store_type.store_name ที่ไม่ใช่ DC) → ใช้เป็น Warehouse ตอนติ๊ก SO Store
  const loadSoStoreOpts = async () => {
    if (convertSoStoreOpts.length > 0) return;
    try {
      const seen = new Set<string>();
      const out: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any).from("store_type").select("store_name, type_store").neq("type_store", "DC").order("store_name").range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const s of data as any[]) { const n = String(s.store_name ?? "").trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } }
        if (data.length < 1000) break;
      }
      setConvertSoStoreOpts(out);
    } catch { /* โหลดไม่ได้ก็ปล่อยว่าง */ }
  };

  // ตัวเลือก Picking Type สำหรับ dropdown (DC 2 ตัว + สาขา Jmart/Kokkok) — ถ้ายังไม่โหลด fallback สาขา default เดิม
  const pickingSelectOpts: { value: string; label: string }[] = [
    { value: PO_PICKING_DC, label: PO_PICKING_DC },
    { value: PO_PICKING_DC_7193, label: PO_PICKING_DC_7193 },
    ...(pickStoreOpts.length ? pickStoreOpts : [{ value: PO_PICKING_STORE, label: PO_PICKING_STORE }]),
  ];

  // โหลด dropdown vendor (vendor_master) + ลูกค้า (customers) ตอนเปิด dialog
  const loadConvertOpts = async () => {
    try {
      const out: CustomerOpt[] = [];
      const seen = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any).from("vendor_master").select("vendor_code, vendor_name_en, vendor_name_la").range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const v of data as any[]) if (v.vendor_code && !seen.has(v.vendor_code)) { seen.add(v.vendor_code); out.push({ code: v.vendor_code, name: v.vendor_name_en || v.vendor_name_la || v.vendor_code }); }
        if (data.length < 1000) break;
      }
      setConvertVendorOpts(out.sort((a, b) => a.code.localeCompare(b.code)));
    } catch { /* โหลดไม่ได้ก็ปล่อยว่าง */ }
    try {
      const out: CustomerOpt[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any).from("customers").select("customer_code, name").range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const c of data as any[]) if (c.name) out.push({ code: c.customer_code || "", name: c.name });
        if (data.length < 1000) break;
      }
      setConvertCustomerOpts(out);
    } catch { /* โหลดไม่ได้ก็ปล่อยว่าง */ }
  };

  // Download template (Barcode + Quantity + Vendor code + Pocost Unit)
  const downloadConvertTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Barcode", "Quantity", "Vendor code", "Pocost Unit"]]);
    ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Convert_Template.xlsx");
  };

  // enrich: resolve barcode → sku + unit barcode + product (+ vendor/pocost ถ้าไม่ใช่ SO) (batch)
  // forSO = true → ข้ามการโหลด po_cost + ชื่อ/สกุลเงิน vendor (SO ไม่ใช้ → เร็วกว่า)
  const enrichConvert = async (inputs: { barcode: string; qty: number; fileVendor: string; fileUnitPrice: number | null }[], forSO = false): Promise<{ rows: ConvertRow[]; nameMap: Record<string, string>; currencyByVendor: Record<string, string> }> => {
    const codes = [...new Set(inputs.map((i) => i.barcode).filter(Boolean))];
    setConvertStatus(`ค้นหารหัสสินค้า ${codes.length} รหัส...`); setConvertProgress(15);
    // 1) code → sku (ลองทีละคอลัมน์ main_barcode / sku_code / barcode)
    const [byMain, bySku, byBc] = await Promise.all([
      fetchInChunks("data_master", "sku_code, main_barcode", "main_barcode", codes).catch(() => [] as any[]),
      fetchInChunks("data_master", "sku_code", "sku_code", codes).catch(() => [] as any[]),
      fetchInChunks("data_master", "sku_code, barcode", "barcode", codes).catch(() => [] as any[]),
    ]);
    const codeToSku = new Map<string, string>();
    for (const d of byMain) if (d.main_barcode && d.sku_code && !codeToSku.has(String(d.main_barcode))) codeToSku.set(String(d.main_barcode), String(d.sku_code));
    for (const d of bySku) if (d.sku_code && !codeToSku.has(String(d.sku_code))) codeToSku.set(String(d.sku_code), String(d.sku_code));
    for (const d of byBc) if (d.barcode && d.sku_code && !codeToSku.has(String(d.barcode))) codeToSku.set(String(d.barcode), String(d.sku_code));
    // 2) sku → ข้อมูลสินค้า (เลือกแถว packing_size_qty=1 ก่อน)
    const skus = [...new Set([...codeToSku.values()])];
    setConvertStatus(`ดึงข้อมูลสินค้า ${skus.length} รายการ...`); setConvertProgress(45);
    const dmRows = skus.length
      ? await fetchInChunks("data_master", "sku_code, main_barcode, packing_size_qty, product_name_en, product_name_la, product_name_th, unit_of_measure, vendor_code, vendor_display_name, standard_price", "sku_code", skus)
      : [];
    const infoBySku = new Map<string, any>();
    for (const d of dmRows) {
      const isUnit = Number(d.packing_size_qty) === 1;
      const cur = infoBySku.get(d.sku_code);
      const rec = {
        isUnit,
        unitBarcode: d.main_barcode || cur?.unitBarcode || "",
        productNameEn: d.product_name_en || cur?.productNameEn || "",
        productName: d.product_name_la || d.product_name_en || d.product_name_th || cur?.productName || "",
        uom: d.unit_of_measure || cur?.uom || "",
        vendorCode: d.vendor_code || cur?.vendorCode || "",
        vendorName: d.vendor_display_name || cur?.vendorName || "",
        standardPrice: d.standard_price == null ? (cur?.standardPrice ?? null) : Number(d.standard_price),
      };
      if (!cur || (isUnit && !cur.isUnit)) infoBySku.set(d.sku_code, rec);
    }
    // 3) PO Cost Unit by (sku, vendor) — เก็บทุก vendor ของ SKU เพื่อ match ID+Vendor ตอน Convert (fallback vendor อื่น)
    const costByItem = new Map<string, Record<string, number>>(); // item_id → { vendor: po_cost_unit }
    const nameMap: Record<string, string> = {};
    const currencyByVendor: Record<string, string> = {}; // vendor_code → supplier_currency (สำหรับแปลง LAK)
    if (!forSO) {
      setConvertStatus(`ดึงราคา PO Cost ${skus.length} รายการ...`); setConvertProgress(70);
      const pc = skus.length ? await fetchInChunks("po_cost", "item_id, vendor, po_cost_unit", "item_id", skus).catch(() => [] as any[]) : [];
      const costVendorCodes = new Set<string>();
      for (const p of pc) {
        const id = String(p.item_id ?? "");
        const unit = p.po_cost_unit == null ? null : Number(p.po_cost_unit);
        if (!id || unit == null || !Number.isFinite(unit)) continue;
        const vc = String(p.vendor ?? "").trim(); // "" = po_cost ที่ไม่ผูก vendor
        if (!costByItem.has(id)) costByItem.set(id, {});
        const m = costByItem.get(id)!;
        if (m[vc] == null) m[vc] = unit;
        if (vc) costVendorCodes.add(vc);
      }
      // 4) vendor name + สกุลเงิน (ไฟล์ + data_master + vendor เจ้าของ cost) — data_master.vendor_display_name ชนะ vendor_master
      const vendorCodes = [...new Set([...inputs.map((i) => i.fileVendor).filter(Boolean), ...dmRows.map((d: any) => d.vendor_code).filter(Boolean), ...costVendorCodes])] as string[];
      setConvertStatus(`ดึงข้อมูลผู้สนอง ${vendorCodes.length} ราย...`); setConvertProgress(88);
      if (vendorCodes.length) {
        const [dmN, vmN] = await Promise.all([
          fetchInChunks("data_master", "vendor_code, vendor_display_name", "vendor_code", vendorCodes).catch(() => [] as any[]),
          fetchInChunks("vendor_master", "vendor_code, vendor_name_en, vendor_name_la, supplier_currency", "vendor_code", vendorCodes).catch(() => [] as any[]),
        ]);
        for (const v of vmN) {
          if (v.vendor_code && !nameMap[v.vendor_code]) nameMap[v.vendor_code] = v.vendor_name_en || v.vendor_name_la || "";
          if (v.vendor_code && v.supplier_currency && !currencyByVendor[v.vendor_code]) currencyByVendor[v.vendor_code] = String(v.supplier_currency).toUpperCase();
        }
        for (const d of dmN) if (d.vendor_code && d.vendor_display_name) nameMap[d.vendor_code] = d.vendor_display_name;
      }
    }
    const rows: ConvertRow[] = inputs.map((inp) => {
      const sku = codeToSku.get(inp.barcode) || "";
      const info = sku ? infoBySku.get(sku) : null;
      const dmVendor = info?.vendorCode || "";
      return {
        inputCode: inp.barcode,
        qty: inp.qty,
        fileVendor: inp.fileVendor,
        found: !!info,
        sku,
        unitBarcode: info?.unitBarcode || inp.barcode,
        productName: info?.productName || "",
        productNameEn: info?.productNameEn || "",
        uom: info?.uom || "Unit",
        dmVendor,
        costByVendor: (sku && costByItem.get(sku)) || {},
        fileUnitPrice: inp.fileUnitPrice,
        standardPrice: info?.standardPrice ?? null,
      };
    });
    return { rows, nameMap, currencyByVendor };
  };

  const handleConvertImport = async (file: File) => {
    setConvertImporting(true);
    setConvertProgress(5); setConvertStatus("อ่านไฟล์...");
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (raw[0] as any[]).map((h) => String(h ?? "").toLowerCase().trim());
      const bcIdx = headers.findIndex((h) => h.includes("barcode") || h === "code" || h.includes("รหัส") || h.includes("sku"));
      const qtyIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      const vcIdx = headers.findIndex((h) => h.includes("vendor") || h.includes("ผู้สนอง"));
      // Pocost Unit (override Unit Price) — จับ "pocost", "po cost unit", "unit price", "ต้นทุน"
      const puIdx = headers.findIndex((h) => h.includes("pocost") || (h.includes("cost") && h.includes("unit")) || h.includes("unit price") || h.includes("ต้นทุน"));
      if (bcIdx < 0 || qtyIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode / Quantity", variant: "destructive" }); return; }
      const parsePrice = (v: any): number | null => { const s = String(v ?? "").trim(); if (s === "") return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
      const inputs = raw.slice(1)
        .map((r) => ({ barcode: String(r[bcIdx] ?? "").trim(), qty: Number(r[qtyIdx]) || 0, fileVendor: vcIdx >= 0 ? String(r[vcIdx] ?? "").trim() : "", fileUnitPrice: puIdx >= 0 ? parsePrice(r[puIdx]) : null }))
        .filter((i) => i.barcode);
      if (inputs.length === 0) { toast({ title: "ไม่พบข้อมูล (ต้องมี Barcode)", variant: "destructive" }); return; }
      const { rows, nameMap, currencyByVendor } = await enrichConvert(inputs);
      setConvertRows(rows);
      setConvertNameMap(nameMap);
      setConvertCurrencyByVendor(currencyByVendor);
      const notFound = rows.filter((r) => !r.found).length;
      setConvertProgress(100); setConvertStatus(`เสร็จสิ้น · ${rows.length} รายการ`);
      toast({ title: "นำเข้าสำเร็จ", description: `${rows.length} รายการ${notFound ? ` · ไม่พบข้อมูล ${notFound}` : ""}` });
    } catch (e: any) {
      setConvertStatus("");
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setConvertImporting(false);
    }
  };

  // Download template SO (Barcode + Quantity — SO ไม่ต้องใช้ Vendor/Pocost)
  const downloadConvertTemplateSO = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Barcode", "Quantity"]]);
    ws["!cols"] = [{ wch: 18 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Convert_Template_SO.xlsx");
  };

  // Import สำหรับ SO เท่านั้น — โหลดเบา (ไม่ดึง vendor/cost) จึงเร็วกว่า Import PO
  const handleConvertImportSO = async (file: File) => {
    setConvertImporting(true);
    setConvertProgress(5); setConvertStatus("อ่านไฟล์...");
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (raw.length < 2) { toast({ title: "ไฟล์ว่าง", variant: "destructive" }); return; }
      const headers = (raw[0] as any[]).map((h) => String(h ?? "").toLowerCase().trim());
      const bcIdx = headers.findIndex((h) => h.includes("barcode") || h === "code" || h.includes("รหัส") || h.includes("sku"));
      const qtyIdx = headers.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("จำนวน"));
      if (bcIdx < 0 || qtyIdx < 0) { toast({ title: "ไม่พบคอลัมน์ Barcode / Quantity", variant: "destructive" }); return; }
      const inputs = raw.slice(1)
        .map((r) => ({ barcode: String(r[bcIdx] ?? "").trim(), qty: Number(r[qtyIdx]) || 0, fileVendor: "", fileUnitPrice: null }))
        .filter((i) => i.barcode);
      if (inputs.length === 0) { toast({ title: "ไม่พบข้อมูล (ต้องมี Barcode)", variant: "destructive" }); return; }
      const { rows } = await enrichConvert(inputs, true); // forSO = ข้ามการโหลด vendor/cost
      setConvertSoRows(rows);
      const notFound = rows.filter((r) => !r.found).length;
      setConvertProgress(100); setConvertStatus(`เสร็จสิ้น · ${rows.length} รายการ`);
      toast({ title: "นำเข้า SO สำเร็จ", description: `${rows.length} รายการ${notFound ? ` · ไม่พบข้อมูล ${notFound}` : ""}` });
    } catch (e: any) {
      setConvertStatus("");
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setConvertImporting(false);
    }
  };

  // วาง (paste) 2 คอลัมน์: Barcode + Qty → resolve เหมือน import ไฟล์ (isSO = ข้าม vendor/cost)
  const handleConvertPaste = async (isSO: boolean) => {
    let text = "";
    try { text = await navigator.clipboard.readText(); }
    catch { toast({ title: "อ่าน Clipboard ไม่ได้", description: "คัดลอกข้อมูล 2 คอลัมน์ (Barcode, Qty) ก่อน แล้วกดวาง", variant: "destructive" }); return; }
    const inputs = (text || "").split(/\r?\n/).map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(/[,;]| {2,}/);
      const barcode = String(cells[0] ?? "").trim();
      const qty = cells.length > 1 ? (Number(String(cells[1]).replace(/,/g, "")) || 0) : 0;
      return { barcode, qty, fileVendor: "", fileUnitPrice: null as number | null };
    }).filter((i) => i.barcode && !/^(barcode|รหัส|sku|code)$/i.test(i.barcode)); // ข้าม header ถ้ามี
    if (inputs.length === 0) { toast({ title: "ไม่พบข้อมูลที่วาง", description: "รูปแบบ: Barcode [Tab] Qty ต่อบรรทัด", variant: "destructive" }); return; }
    setConvertImporting(true);
    setConvertProgress(5); setConvertStatus("ประมวลผลข้อมูลที่วาง...");
    try {
      if (isSO) {
        const { rows } = await enrichConvert(inputs, true);
        setConvertSoRows(rows);
        const nf = rows.filter((r) => !r.found).length;
        setConvertProgress(100); setConvertStatus(`เสร็จสิ้น · ${rows.length} รายการ`);
        toast({ title: "วางข้อมูล SO สำเร็จ", description: `${rows.length} รายการ${nf ? ` · ไม่พบข้อมูล ${nf}` : ""}` });
      } else {
        const { rows, nameMap, currencyByVendor } = await enrichConvert(inputs);
        setConvertRows(rows); setConvertNameMap(nameMap); setConvertCurrencyByVendor(currencyByVendor);
        const nf = rows.filter((r) => !r.found).length;
        setConvertProgress(100); setConvertStatus(`เสร็จสิ้น · ${rows.length} รายการ`);
        toast({ title: "วางข้อมูล PO สำเร็จ", description: `${rows.length} รายการ${nf ? ` · ไม่พบข้อมูล ${nf}` : ""}` });
      }
    } catch (e: any) {
      setConvertStatus("");
      toast({ title: "วางข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setConvertImporting(false);
    }
  };

  // ดาวน์โหลด Skiplist — รายการที่ resolve ไม่พบใน Master (PO/SO)
  const downloadConvertSkiplist = (isSO: boolean) => {
    const rows = (isSO ? convertSoRows : convertRows).filter((r) => !r.found);
    if (rows.length === 0) { toast({ title: "ไม่มีรายการที่ไม่พบ", variant: "destructive" }); return; }
    const out = rows.map((r, i) => ({
      "#": i + 1,
      Barcode: r.inputCode || r.unitBarcode || "",
      Quantity: r.qty,
      "เหตุผล": "ไม่พบใน Master (data_master)",
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    ws["!cols"] = [{ wch: 5 }, { wch: 22 }, { wch: 10 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Skiplist");
    XLSX.writeFile(wb, `${stampNow()}-${isSO ? "SO" : "PO"}-Skiplist.xlsx`);
  };

  // group by vendor → chunk ทีละ N (Item Per PO) — ใช้ convertRows (PO)
  const chunkConvertByVendor = (): { vc: string; chunks: ConvertRow[][] }[] => {
    const N = Math.max(1, Number(convertItemPerPo) || 25);
    const byVendor = new Map<string, ConvertRow[]>();
    for (const r of convertRows) { const vc = convertFinalVendor(r); if (!byVendor.has(vc)) byVendor.set(vc, []); byVendor.get(vc)!.push(r); }
    const out: { vc: string; chunks: ConvertRow[][] }[] = [];
    for (const [vc, vRows] of byVendor) {
      const chunks: ConvertRow[][] = [];
      for (let i = 0; i < vRows.length; i += N) chunks.push(vRows.slice(i, i + N));
      out.push({ vc, chunks });
    }
    return out;
  };

  const stampNow = () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  // Convert → PO (คอลัมน์/หัวตารางเดียวกับ Export PO สีฟ้า)
  const doConvertExportPO = async () => {
    if (convertRows.length === 0) { toast({ title: "ยังไม่มีข้อมูล — กด Import ก่อน", variant: "destructive" }); return; }
    setConvertExporting(true);
    try {
      const pick = convertPicking;
      const interTransfer = PO_PICKING_DC_IDS.has(pick) ? "" : "true";
      // Unit Price: Pocost Unit จากไฟล์ก่อน → ไม่มี ดึง PO Cost Unit match ID+Vendor (vendor ตัวสุดท้าย) → ไม่เจอ fallback vendor อื่นของ SKU เดียวกัน
      // ติ๊ก LAK → แปลงด้วยเรทตามสกุลเงินของ vendor เจ้าของ cost
      const { rThb, rUsd } = readFxRates();
      let lakMissing = 0;
      const currencyOf = (vc: string) => convertCurrencyByVendor[vc] || "";
      // คืน { cost, cur } — เลือกตามลำดับ: ไฟล์ > cost ของ finalVendor > cost ของ vendor อื่น (SKU เดียวกัน)
      const pickCost = (r: ConvertRow, finalVendor: string): { cost: number | null; cur: string } => {
        if (r.fileUnitPrice != null) return { cost: r.fileUnitPrice, cur: currencyOf(finalVendor) };
        const cbv = r.costByVendor || {};
        if (cbv[finalVendor] != null) return { cost: cbv[finalVendor], cur: currencyOf(finalVendor) };
        const keys = Object.keys(cbv);
        if (keys.length) { const k = keys[0]; return { cost: cbv[k], cur: currencyOf(k) }; } // fallback vendor อื่น
        return { cost: null, cur: "" };
      };
      // คืน { value, fromMaster } — fromMaster = ใช้ Standard price จาก Master (สำหรับไฮไลต์สีเหลืองอ่อน)
      const unitPrice = (r: ConvertRow, finalVendor: string): { value: number | string; fromMaster: boolean } => {
        const { cost, cur } = pickCost(r, finalVendor);
        if (!convertUnitLak) return { value: cost == null ? "" : cost, fromMaster: false }; // โหมดปกติ (ไม่แปลง LAK)
        // โหมด LAK: แปลง cost → LAK
        if (cost != null) {
          const lak = costToLak(cost, cur, rThb, rUsd);
          if (lak != null) return { value: lak, fromMaster: false };
        }
        // LAK ไม่มี (ไม่มี cost หรือแปลงไม่ได้) → ถ้าติ๊ก "ดึง Cost จาก Master" ใช้ Standard price (packing_size_qty=1)
        if (convertUseMasterCost && r.standardPrice != null) return { value: r.standardPrice, fromMaster: true };
        lakMissing++;
        return { value: "", fromMaster: false };
      };
      const groups = chunkConvertByVendor();
      const out: Record<string, any>[] = [];
      const masterRowIdx = new Set<number>(); // index แถวที่ Unit Price มาจาก Master (ไฮไลต์เหลือง)
      let groupCount = 0;
      for (const { vc, chunks } of groups) {
        const vName = convertNameMap[vc] || convertVendorOpts.find((o) => o.code === vc)?.name || "";
        chunks.forEach((chunk, ci) => {
          groupCount++;
          const groupId = chunks.length > 1 ? `${vc || "NOVENDOR"}-${ci + 1}` : (vc || "NOVENDOR");
          chunk.forEach((r, idx) => {
            const up = unitPrice(r, vc);
            if (up.fromMaster) masterRowIdx.add(out.length);
            out.push({
              "partner_id": idx === 0 ? vc : "",
              "Picking Type / Database ID": idx === 0 ? pick : "",
              "Inter Transfer": idx === 0 ? interTransfer : "",
              "PO Group": idx === 0 ? groupId : "",
              "Vendor name": vName,
              "Brand": "",
              "Products to Purchase/barcode": r.unitBarcode || r.inputCode,
              "Products to Purchase/Product": r.unitBarcode || r.inputCode,
              "Product name": r.productNameEn || r.productName,
              "Products to Purchase/UoM": "Unit",
              "Products to Purchase/Exclude In Package": "True",
              "Products to Purchase/Quantity": r.qty,
              "Products to Purchase/Unit Price": up.value,
              "assigned_to": idx === 0 ? "SPC manager01" : "",
              "description": "",
            });
          });
        });
      }
      if (convertUnitLak && lakMissing > 0) {
        toast({ title: "เตือน: ขาดเรทแปลง LAK", description: `${lakMissing} รายการที่เป็น THB/USD ยังไม่ได้ตั้งเรท (ตั้งที่ Data Control) → Unit Price ว่าง`, variant: "destructive" });
      }
      // ชื่อไฟล์ใส่ชื่อ vendor (เจ้าเดียว = ชื่อ vendor, หลายเจ้า = Multi Vendor)
      const sanitizeName = (s: string) => (s || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
      const vCodes = [...new Set(groups.map((g) => g.vc).filter(Boolean))];
      const vLabel = vCodes.length === 0 ? "NoVendor"
        : vCodes.length === 1 ? sanitizeName(convertNameMap[vCodes[0]] || convertVendorOpts.find((o) => o.code === vCodes[0])?.name || vCodes[0])
        : "Multi Vendor";
      const fname = `${stampNow()}-PO-${vLabel}.xlsx`;
      if (convertUseMasterCost && masterRowIdx.size > 0 && out.length > 0) {
        // มีแถวที่ดึง Cost จาก Master → ใช้ ExcelJS ไฮไลต์เหลืองอ่อนเฉพาะแถวนั้น
        const headers = Object.keys(out[0]);
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("PO");
        ws.columns = headers.map((h) => ({ header: h, key: h }));
        out.forEach((rowObj, i) => {
          const row = ws.addRow(rowObj);
          if (masterRowIdx.has(i)) {
            for (let c = 1; c <= headers.length; c++) {
              row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } }; // เหลืองอ่อน
            }
          }
        });
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const dl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dl; a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(dl);
        toast({ title: "Convert PO สำเร็จ", description: `${out.length} แถว · ${groupCount} PO Group · ไฮไลต์ Master ${masterRowIdx.size} แถว` });
      } else {
        const ws = XLSX.utils.json_to_sheet(out);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "PO");
        XLSX.writeFile(wb, fname);
        toast({ title: "Convert PO สำเร็จ", description: `${out.length} แถว · ${groupCount} PO Group` });
      }
    } catch (e: any) {
      toast({ title: "Convert PO ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setConvertExporting(false);
    }
  };

  // Convert → SO (ใช้ template srr_special_so เหมือนหน้า SO Order B2B) — ใช้ convertSoRows (โหลดเบา)
  const doConvertExportSO = async () => {
    if (convertSoRows.length === 0) { toast({ title: "ยังไม่มีข้อมูล — กด Import SO ก่อน", variant: "destructive" }); return; }
    setConvertExporting(true);
    try {
      const customer = convertCustomer || SO_DEFAULT_CUSTOMER;
      const pricelist = convertPricelist || SO_PRICELIST;
      // SO = ลูกค้าเดียว → ตัดกลุ่มตาม Item Per SO อย่างเดียว (ไม่แยกตาม vendor) · หัวกลุ่มขึ้นแถวแรกของแต่ละกลุ่ม
      const N = Math.max(1, Number(convertItemPerPo) || 25);
      // ไม่ export รายการที่ resolve ไม่พบ (ดาวน์โหลดดูได้ที่ปุ่ม Skiplist)
      const soRows = convertSoRows.filter((r) => r.found);
      if (soRows.length === 0) { toast({ title: "ไม่มีรายการที่พบข้อมูล", description: "ทุกรายการ resolve ไม่พบ — ตรวจ Barcode/SKU", variant: "destructive" }); return; }
      const chunks: ConvertRow[][] = [];
      for (let i = 0; i < soRows.length; i += N) chunks.push(soRows.slice(i, i + N));
      // SO Store: ไม่มีคอลัมน์ Order lines/Route · Warehouse = ชื่อสาขาที่เลือก
      const warehouseVal = convertSoStore ? convertSoStoreWh : convertSoWarehouse;
      const base: Record<string, any>[] = [];
      let groupCount = 0;
      for (const chunk of chunks) {
        groupCount++;
        chunk.forEach((r, idx) => {
          const row: Record<string, any> = {
            "Order Reference": "",
            "Customer": idx === 0 ? customer : "",
            "Pricelist": idx === 0 ? pricelist : "",
            "Order Lines/Barcode": r.unitBarcode || r.inputCode,
            "Order Lines/Product": r.unitBarcode || r.inputCode,
            "Product Name": r.productName || r.productNameEn,
            "UOM": r.uom,
            "Order Lines/Quantity": r.qty,
          };
          if (!convertSoStore) row["Order lines/Route"] = convertSoRoute; // ค่าเต็มทุก row (ขวาของ Quantity) — ตัดออกถ้า SO Store
          row["Source Document"] = "";
          row["Warehouse"] = idx === 0 ? warehouseVal : "";
          row["Company"] = idx === 0 ? (convertSoStore ? warehouseVal : SO_COMPANY) : ""; // SO Store → Company = Warehouse (ชื่อสาขา)
          base.push(row);
        });
      }
      const mapped = await remapRowsByTemplate("srr_special_so", base);
      const ws = XLSX.utils.json_to_sheet(mapped);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "SO");
      // ชื่อไฟล์ใส่ชื่อ customer (SO = ลูกค้าเดียว)
      const cLabel = (customer || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "Customer";
      XLSX.writeFile(wb, `${stampNow()}-SO-${cLabel}.xlsx`);
      toast({ title: "Convert SO สำเร็จ", description: `${base.length} แถว · ${groupCount} SO Group` });
    } catch (e: any) {
      toast({ title: "Convert SO ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setConvertExporting(false);
    }
  };

  // export ตาราง PO เป็น Excel (รวมคอลัมน์ pivot + tracking ว่าง)
  const exportPO = async () => {
    if (filteredPoRows.length === 0) { toast({ title: "ไม่มีข้อมูลให้ export", variant: "destructive" }); return; }
    const out = filteredPoRows.map((r, i) => {
      const { remark, action } = getPoRemarkAction(r);
      // ชื่อแบรนด์ที่มีจำนวน (qty > 0) ในแถวนั้น ต่อกันด้วย " / "
      const brandNames = [...r.byBrand.entries()].filter(([, q]) => (Number(q) || 0) > 0).map(([b]) => b).sort((a, b) => a.localeCompare(b)).join(" / ");
      const base: Record<string, any> = {
        "#": i + 1,
        Division: r.division,
        Department: r.department,
        Remark: remark,
        Action: action,
        Action2: getPoAction2(r),
        "Order group": r.order_group,
        SKU: r.sku, // ซ่อนคอลัมน์ไว้ก่อน (ตั้ง hidden ด้านล่าง)
        "Vendor code": r.vendor_code,
        "Vendor name": r.vendor_name,
        "Currency": r.vendor_currency,
        "Vendor origin": r.vendor_origin,
        "PO NUMBER": r.po_number,
        "PO DATE": r.po_date,
        "PO Status": r.po_status,
        "PO QTY": r.po_qty,
        "REC PO": r.rec_po,
        "1x": r.moq_1x ?? "",
        Pocost: r.pocost ?? "",
        ID: r.id,
        Barcode: r.barcode,
        "Product name EN": r.product_name_en,
        "Picture": "", // ใส่สูตร =IMAGE ด้านล่าง
        "Picture From": r.pictures.length
          ? r.pictures[0].brand + (r.pictures.length > 1 ? ` +${r.pictures.length - 1}` : "")
          : "",
        "Stock DC": r.stock_dc ?? "",
        "Stock DC (KR)": r.stock_dc_kr ?? "",
        "Brand": brandNames,
        "Brand Apply": [...r.byBrand.values()].filter((q) => (Number(q) || 0) > 0).length,
      };
      for (const b of poBrands) base[b] = r.byBrand.get(b) ?? "";
      base["Total qty"] = r.total;
      base["DIFF"] = r.total - (r.stock_dc_kr ?? 0);
      return base;
    });
    const headers = Object.keys(out[0]);
    const wCol = (h: string) => h === "Product name EN" ? 34 : h === "Vendor name" ? 24
      : (h === "Remark" || h === "Action" || h === "Action2") ? 22 : (h === "Brand" || h === "Order group") ? 20 : h === "Picture From" ? 14 : h === "Picture" ? 12 : 12;

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PO");
    ws.columns = headers.map((h) => ({ header: h, width: wCol(h) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle" };
    const picIdx = headers.indexOf("Picture"); // 0-based
    out.forEach((rowObj, i) => {
      const row = ws.addRow(headers.map((h) => rowObj[h]));
      row.height = 36; // ~48px ทุกแถวที่มีข้อมูล
      row.alignment = { vertical: "middle" }; // จัดกึ่งกลางแนวตั้ง
      const url = filteredPoRows[i].pictures[0]?.url;
      if (url && picIdx >= 0) {
        ws.getCell(row.number, picIdx + 1).value = { formula: `_xlfn.IMAGE("${url}")` } as any;
      }
    });
    const skuIdx = headers.indexOf("SKU");
    if (skuIdx >= 0) ws.getColumn(skuIdx + 1).hidden = true; // ซ่อน SKU

    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const dl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dl; a.download = `${stamp}-PO.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(dl);
  };

  // parse Excel ตาม column config → array of row objects (key = col.key)
  const parseImport = async (file: File, cols: readonly { key: string; aliases: readonly string[] }[]): Promise<Record<string, string>[]> => {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab);
    const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    if (raw.length < 2) return [];
    const headers = (raw[0] as any[]).map((h) => String(h ?? "").toLowerCase().trim());
    const idxOf: Record<string, number> = {};
    for (const c of cols) idxOf[c.key] = headers.findIndex((h) => c.aliases.some((a) => h.includes(a)));
    return raw
      .slice(1)
      .filter((r) => r.some((v) => String(v ?? "").trim()))
      .map((r) => {
        const o: Record<string, string> = {};
        // เก็บค่าดิบ (เช่น Excel serial ของวันที่) เพื่อให้ save ได้ทุกชนิดคอลัมน์ — แปลงเป็น dd-Mmm-yy ตอนแสดงผลแทน
        for (const c of cols) o[c.key] = idxOf[c.key] >= 0 ? String(r[idxOf[c.key]] ?? "").trim() : "";
        return o;
      });
  };

  const handleKrImport = async (file: File) => {
    setImportingKr(true);
    try {
      const rows = await parseImport(file, STOCK_KR_COLS);
      if (rows.length === 0) { toast({ title: "ไม่พบข้อมูลในไฟล์", variant: "destructive" }); return; }
      setStockKrRows(rows);
      toast({ title: "นำเข้า Stock Kr สำเร็จ", description: `${rows.length} รายการ` });
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setImportingKr(false);
    }
  };
  const handleRecImport = async (file: File) => {
    setImportingRec(true);
    try {
      const rows = await parseImport(file, PO_RECEIVE_COLS);
      if (rows.length === 0) { toast({ title: "ไม่พบข้อมูลในไฟล์", variant: "destructive" }); return; }
      setPoReceiveRows(rows);
      toast({ title: "นำเข้า PO Receive สำเร็จ", description: `${rows.length} รายการ` });
    } catch (e: any) {
      toast({ title: "นำเข้าไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setImportingRec(false);
    }
  };

  const downloadImportTemplate = (cols: readonly { label: string }[], name: string) => {
    const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c.label)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `${name}.xlsx`);
  };

  // ลำดับคอลัมน์ทั้งหมด (brands แทรกก่อน Total qty) + ชุดที่กำลังแสดง
  const orderedCols = (() => {
    const list: { key: string; label: string; thCls: string; tdCls: string; brand?: string }[] = [];
    for (const c of PO_FIXED_COLS) {
      if (c.key === "total") for (const b of poBrands) list.push({ key: `brand:${b}`, label: b, thCls: "text-right bg-amber-50", tdCls: "text-right tabular-nums bg-amber-50/40", brand: b });
      list.push({ key: c.key, label: c.label, thCls: c.thCls || "", tdCls: c.tdCls || "" });
    }
    return list;
  })();
  const visibleCols = orderedCols.filter((c) => visCols.has(c.key));

  return (
    <Tabs value={poSubTab} onValueChange={setPoSubTab} className="flex-1 flex flex-col overflow-hidden min-h-0 gap-3">
      {/* ===== PO list ===== */}
      <TabsContent value="list" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={buildPO} disabled={poLoading}>
            {poLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            {poLoaded ? "โหลดใหม่" : "โหลด / คำนวณ"}
          </Button>
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={poSearch} onChange={(e) => setPoSearch(e.target.value)} className="h-8 pl-8" placeholder="ค้นหา ID / Barcode / Product / Vendor" />
          </div>
          <span className="text-xs text-muted-foreground">{filteredPoRows.length} / {poRows.length} SKU</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className={cn("h-8 gap-1.5 text-xs ml-auto", !allBrandsSelected && "border-primary text-primary")}>
                <Tag className="w-3.5 h-3.5" /> แบรนด์ ({poSelBrands.size}/{poBrands.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-0">
              <div className="px-3 py-2 border-b">
                <span className="text-xs font-medium">รวม Total qty เฉพาะแบรนด์ที่ติ๊ก</span>
              </div>
              <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPoSelBrands(new Set(poBrands))}>เลือกทั้งหมด</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPoSelBrands(new Set())}>ล้าง</Button>
              </div>
              <div className="max-h-72 overflow-auto py-1">
                {poBrands.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">ยังไม่มีแบรนด์ (กดโหลดก่อน)</div>}
                {poBrands.map((b) => (
                  <label key={b} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={poSelBrands.has(b)}
                      onChange={() => setPoSelBrands((prev) => { const n = new Set(prev); if (n.has(b)) n.delete(b); else n.add(b); return n; })}
                    />
                    <span className="truncate">{b}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Columns3 className="w-3.5 h-3.5" /> คอลัมน์ ({visibleCols.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-medium">แสดง/ซ่อน คอลัมน์</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setVisCols(poDefaultVis())}>ค่าเริ่มต้น</Button>
              </div>
              <div className="max-h-72 overflow-auto py-1">
                {(() => {
                  const allKeys = orderedCols.map((c) => c.key);
                  const allChecked = allKeys.length > 0 && allKeys.every((k) => visCols.has(k));
                  const someChecked = allKeys.some((k) => visCols.has(k));
                  return (
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border-b hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                        onChange={() => setVisCols(allChecked ? new Set() : new Set(allKeys))}
                      />
                      <span>เลือกทั้งหมด ({visibleCols.length}/{allKeys.length})</span>
                    </label>
                  );
                })()}
                {orderedCols.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={visCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={saveView} title="บันทึกคอลัมน์ที่แสดง + ความกว้าง (เฉพาะเครื่องนี้)">
            <Save className="w-3.5 h-3.5" /> Save View
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              const ws = XLSX.utils.json_to_sheet([{ ID: "0527049969", "Vendor code": "DC0193" }]);
              ws["!cols"] = [{ wch: 16 }, { wch: 16 }];
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Template");
              XLSX.writeFile(wb, "UpdateVendor_Template.xlsx");
            }}
            title="ดาวน์โหลด Template (ID + Vendor code)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Template
          </Button>
          {can("import") && (
          <label className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs cursor-pointer hover:bg-muted/50", vendorImporting && "opacity-60 pointer-events-none")} title="Import Excel 2 คอลัมน์ (ID + Vendor code) เพื่ออัปเดต Vendor">
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={vendorImporting} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVendorImport(f); e.target.value = ""; }} />
            {vendorImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import Vendor
          </label>
          )}
          {can("export") && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportPO} disabled={filteredPoRows.length === 0}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          )}
          {can("export") && (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => { loadPickStoreOpts(); setPoExportPick({}); setPoExportSel(new Set()); setPoExportAll(true); setPoExportSearch(""); setPoExportOpen(true); }}
            disabled={poExportEligible.length === 0}
            title="Export PO (Excel) สำหรับ import เข้า Odoo"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Export PO
          </Button>
          )}
          {(can("import") || can("export")) && (
          <Button
            size="sm" variant="outline"
            className="h-8 gap-1.5 text-xs border-primary/60 text-primary"
            onClick={() => { if (convertVendorOpts.length === 0 || convertCustomerOpts.length === 0) loadConvertOpts(); loadPickStoreOpts(); setConvertOpen(true); }}
            title="Convert: import รหัส+จำนวน → PO/SO Excel (ไม่ filter รายการ)"
          >
            <Route className="w-3.5 h-3.5" /> Convert
          </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setPoReportOpen(true)} disabled={poRows.length === 0} title="รายงานสรุปจำนวน SKU (Remark / Action2) + เก็บ snapshot">
            <BarChart3 className="w-3.5 h-3.5" /> Report
          </Button>
        </div>

        <POReportDialog open={poReportOpen} onOpenChange={setPoReportOpen} current={poReportCurrent} />

        {/* แถบสถานะ + % progress ตอนโหลด */}
        {poLoading && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${poProgress}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{poStatus} {poProgress}%</span>
          </div>
        )}

        {/* ===== Export PO Dialog ===== */}
        <Dialog open={poExportOpen} onOpenChange={setPoExportOpen}>
          <DialogContent className="w-[640px] max-w-[92vw] bg-background overflow-hidden">
            <DialogHeader>
              <DialogTitle>Export PO (เข้า Odoo)</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground -mt-1">
              ส่งออกเฉพาะแถวที่ Action2 = "เร่งเปิด PO และ ตามของ" หรือ "รอทำ Po Cost" และ DIFF &gt; 0 · Quantity = DIFF · {poExportEligible.length} รายการที่เข้าเงื่อนไข
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={poExportAll} onChange={() => setPoExportAll(true)} /> ทุก Vendor
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={!poExportAll} onChange={() => setPoExportAll(false)} /> เลือกบาง Vendor
                </label>
                {poExportAll && (
                  <div className="flex items-center gap-3 ml-auto">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input type="checkbox" className="h-3.5 w-3.5" checked={poExportAll7193} onChange={(e) => setPoExportAll7193(e.target.checked)} />
                      <span>ใช้ 7193 (แทน 2540)</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">Picking Type = {poExportAll7193 ? PO_PICKING_DC_7193 : PO_PICKING_DC} ทุกตัว</span>
                  </div>
                )}
              </div>
              {/* Unit Price = PO Cost Unit — ติ๊กเพื่อแปลงเป็น LAK ด้วยเรท (แทนการใช้ตามสกุลเงิน vendor) */}
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none border rounded-lg px-3 py-2">
                <input type="checkbox" className="h-3.5 w-3.5" checked={poExportUnitLak} onChange={(e) => setPoExportUnitLak(e.target.checked)} />
                <span>Pocost Unit Lak — Unit Price ใช้ PO Cost Unit แปลงเป็น LAK</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {poExportUnitLak
                    ? (() => { const { rThb, rUsd } = readFxRates(); return `เรท THB=${rThb ?? "-"} · USD=${rUsd ?? "-"}`; })()
                    : "ไม่ติ๊ก = ใช้ PO Cost Unit ตามสกุลเงิน vendor"}
                </span>
              </label>
              {!poExportAll && (
                <div className="border rounded-lg">
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPoExportSel(new Set(poExportVendors.map((v) => v.code)))}>เลือกทั้งหมด</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPoExportSel(new Set())}>ล้าง</Button>
                    <span className="text-[11px] text-muted-foreground ml-auto">เลือก {poExportSel.size}/{poExportVendors.length}</span>
                  </div>
                  <div className="px-2 py-1.5 border-b">
                    <Input value={poExportSearch} onChange={(e) => setPoExportSearch(e.target.value)} className="h-7 text-xs" placeholder="ค้นหา Vendor..." />
                  </div>
                  <div className="max-h-64 overflow-auto py-1">
                    {poExportVendors
                      .filter((v) => { const q = poExportSearch.trim().toLowerCase(); return !q || v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q); })
                      .map((v) => (
                        <div key={v.code} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-xs hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={poExportSel.has(v.code)}
                            onChange={() => setPoExportSel((prev) => { const n = new Set(prev); if (n.has(v.code)) n.delete(v.code); else n.add(v.code); return n; })}
                          />
                          <span className="truncate" title={v.name}>{v.name}</span>
                          {poExportSel.has(v.code) ? (
                            <select
                              className="h-6 text-[11px] border rounded px-1 bg-background w-40"
                              value={poExportPick[v.code] || PO_PICKING_DC}
                              onChange={(e) => setPoExportPick((prev) => ({ ...prev, [v.code]: e.target.value }))}
                            >
                              {pickingSelectOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : <span />}
                        </div>
                      ))}
                    {poExportVendors.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">ไม่มี Vendor ที่เข้าเงื่อนไข</div>}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPoExportOpen(false)}>ยกเลิก</Button>
              <Button onClick={doExportPO} disabled={!poExportAll && poExportSel.size === 0}>
                <Download className="w-4 h-4 mr-1.5" /> Export Excel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Convert Dialog (import รหัส+จำนวน → PO/SO Excel, ไม่ filter) ===== */}
        <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
          <DialogContent
            className="w-[720px] max-w-[94vw] bg-background overflow-hidden"
            onInteractOutside={(e) => e.preventDefault()}  // คลิกนอกกล่อง/สลับโปรแกรมแล้วกลับมา ไม่ปิดเอง
            onEscapeKeyDown={(e) => e.preventDefault()}     // กัน Esc ปิดโดยไม่ตั้งใจ — ปิดได้จากปุ่ม X / ปิด เท่านั้น
          >
            <DialogHeader>
              <DialogTitle>Convert เป็น PO / SO</DialogTitle>
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Import ไฟล์ (Barcode + Quantity + Vendor code + Pocost Unit) → Convert เป็น Excel · ใส่รหัส/จำนวนมาเท่าไหร่ Convert เท่านั้น (ไม่ filter รายการออก) · คอลัมน์/หัวตารางเดียวกับ Export PO / SO
            </p>

            <div className="space-y-3">
              {/* แถวเครื่องมือ PO: template + import + สถานะ */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={downloadConvertTemplate}>
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Template PO
                </Button>
                <label className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-red-700 bg-red-600 text-white text-xs cursor-pointer hover:bg-red-700 transition-colors", convertImporting && "opacity-60 pointer-events-none")}>
                  <input type="file" accept=".xlsx,.xls" className="hidden" disabled={convertImporting} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleConvertImport(f); e.target.value = ""; }} />
                  {convertImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import PO
                </label>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => handleConvertPaste(false)} disabled={convertImporting} title="วางข้อมูล 2 คอลัมน์: Barcode [Tab] Qty (คัดลอกจาก Excel แล้วกด)">
                  <Copy className="w-3.5 h-3.5" /> วาง
                </Button>
                {!convertImporting && convertRows.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    PO: {convertRows.length} รายการ · รวม {convertRows.reduce((s, r) => s + (r.qty || 0), 0)} · ไม่พบข้อมูล {convertRows.filter((r) => !r.found).length}
                  </span>
                )}
                {!convertImporting && convertRows.some((r) => !r.found) && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-destructive border-destructive/40" onClick={() => downloadConvertSkiplist(false)} title="ดาวน์โหลดรายการที่ไม่พบใน Master">
                    <Download className="w-3 h-3" /> Skiplist ({convertRows.filter((r) => !r.found).length})
                  </Button>
                )}
              </div>

              {/* แถบ % ตอน import Convert + นับรายการ */}
              {convertImporting && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${convertProgress}%` }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{convertStatus} {convertProgress}/100%</span>
                </div>
              )}

              {/* Item Per PO */}
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Item Per PO/SO (SKU ต่อ 1 Group)</Label>
                <Input type="number" min={1} value={convertItemPerPo} onChange={(e) => setConvertItemPerPo(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-24 text-xs" />
                <span className="text-[11px] text-muted-foreground">จัดกลุ่มตาม Vendor ก่อน แล้วตัดทีละ {Math.max(1, Number(convertItemPerPo) || 25)}</span>
              </div>

              {/* Convert PO */}
              <div className="border border-red-300 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium w-24">Convert PO</span>
                  <select
                    className="h-8 text-xs border rounded px-2 bg-background max-w-[280px]"
                    value={convertPicking}
                    onChange={(e) => setConvertPicking(e.target.value)}
                    title="Picking Type / Database ID"
                  >
                    {pickingSelectOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <VendorPickCombo value={convertVendorDefault} options={convertVendorOpts} onChange={setConvertVendorDefault} />
                  <Button size="sm" className="h-8 gap-1.5 text-xs ml-auto" onClick={doConvertExportPO} disabled={convertRows.length === 0 || convertExporting}>
                    {convertExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />} Convert Excel PO
                  </Button>
                </div>
                {/* เรทแปลง LAK — ใส่แล้วค้างใน localStorage (ใช้ร่วมกับ Data Control) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">เรทแปลง LAK:</span>
                  <Label className="text-xs">THB→LAK</Label>
                  <Input type="number" value={convertRateThb} onChange={(e) => saveRate("po_cost_rate_thb", e.target.value, setConvertRateThb)} className="h-8 w-24 text-xs" placeholder="เช่น 689" />
                  <Label className="text-xs">USD→LAK</Label>
                  <Input type="number" value={convertRateUsd} onChange={(e) => saveRate("po_cost_rate_usd", e.target.value, setConvertRateUsd)} className="h-8 w-28 text-xs" placeholder="เช่น 22250" />
                  <span className="text-[11px] text-muted-foreground">บันทึกอัตโนมัติ · ใช้ตอนติ๊ก Pocost Unit Lak</span>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={convertUnitLak} onChange={(e) => { const c = e.target.checked; setConvertUnitLak(c); if (!c) setConvertUseMasterCost(false); }} />
                  <span>Pocost Unit Lak — Unit Price แปลงเป็น LAK ด้วยเรท</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {convertUnitLak
                      ? (() => { const { rThb, rUsd } = readFxRates(); return `เรท THB=${rThb ?? "-"} · USD=${rUsd ?? "-"}`; })()
                      : "ไม่ติ๊ก = ตามสกุลเงิน vendor"}
                  </span>
                </label>
                {convertUnitLak && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none pl-5">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={convertUseMasterCost} onChange={(e) => setConvertUseMasterCost(e.target.checked)} />
                    <span>ดึง Cost จาก Master แทน Pocost Unit Lak ที่ไม่มี</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">ใช้ Standard price (data_master · packing_size=1)</span>
                  </label>
                )}
                <p className="text-[10px] text-muted-foreground">Vendor: ใช้จากไฟล์ก่อน → มี Vendor เริ่มต้นที่เลือกใช้แทน Master → ไม่มีทั้งคู่ใช้จากฐานข้อมูล · Unit Price: Pocost Unit จากไฟล์ก่อน → ว่างดึง PO Cost Unit match ID+Vendor (ไม่เจอ fallback vendor อื่นของ SKU เดียวกัน) · Picking Type = {convertPicking}</p>
              </div>

              {/* Convert SO */}
              <div className="border border-amber-300 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 rounded-lg p-3 space-y-2">
                {/* Import แยกสำหรับ SO — โหลดเบา (ไม่ดึง vendor/cost) เร็วกว่า Import PO */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium w-24">Import SO</span>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={downloadConvertTemplateSO}>
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Template SO
                  </Button>
                  <label className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-amber-600 bg-amber-500 text-white text-xs cursor-pointer hover:bg-amber-600 transition-colors", convertImporting && "opacity-60 pointer-events-none")}>
                    <input type="file" accept=".xlsx,.xls" className="hidden" disabled={convertImporting} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleConvertImportSO(f); e.target.value = ""; }} />
                    {convertImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import SO
                  </label>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => handleConvertPaste(true)} disabled={convertImporting} title="วางข้อมูล 2 คอลัมน์: Barcode [Tab] Qty (คัดลอกจาก Excel แล้วกด)">
                    <Copy className="w-3.5 h-3.5" /> วาง
                  </Button>
                  {!convertImporting && convertSoRows.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      SO: {convertSoRows.length} รายการ · รวม {convertSoRows.reduce((s, r) => s + (r.qty || 0), 0)} · ไม่พบข้อมูล {convertSoRows.filter((r) => !r.found).length}
                    </span>
                  )}
                  {!convertImporting && convertSoRows.some((r) => !r.found) && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-destructive border-destructive/40" onClick={() => downloadConvertSkiplist(true)} title="ดาวน์โหลดรายการที่ไม่พบใน Master">
                      <Download className="w-3 h-3" /> Skiplist ({convertSoRows.filter((r) => !r.found).length})
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium w-24">Convert SO</span>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Customer</Label>
                    <div className="h-8 px-2 border rounded-md flex items-center">
                      <CustomerCombo value={convertCustomer} options={convertCustomerOpts} onChange={setConvertCustomer} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Pricelist</Label>
                    <select
                      className="h-8 text-xs border rounded px-2 bg-background max-w-[220px]"
                      value={convertPricelist}
                      onChange={(e) => { const v = e.target.value; setConvertPricelist(v); const m = SO_PRICELIST_META[v]; if (m) { setConvertSoRoute(m.route); setConvertSoWarehouse(m.warehouse); } }}
                      title="Pricelist (คอลัมน์ใน Excel SO) — เปลี่ยนแล้วตั้ง Route/Warehouse ให้อัตโนมัติ"
                    >
                      {CONVERT_SO_PRICELISTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <Button size="sm" className="h-8 gap-1.5 text-xs ml-auto" onClick={doConvertExportSO} disabled={convertSoRows.length === 0 || convertExporting}>
                    {convertExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />} Convert Excel SO
                  </Button>
                </div>
                {/* SO Store — ตัดคอลัมน์ Route + Warehouse เป็นชื่อสาขา */}
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={convertSoStore} onChange={(e) => { const c = e.target.checked; setConvertSoStore(c); if (c) loadSoStoreOpts(); }} />
                  <span>SO Store — ไม่มีคอลัมน์ Order lines/Route · Warehouse = ชื่อสาขา</span>
                </label>
                {/* Route (ทุก row) + Warehouse (header) — default ตาม Pricelist เปลี่ยนเองได้ */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium w-24">Route / WH</span>
                  {!convertSoStore && (
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">Order lines/Route</Label>
                      <select className="h-8 text-xs border rounded px-2 bg-background max-w-[260px]" value={convertSoRoute} onChange={(e) => setConvertSoRoute(e.target.value)} title="Order lines/Route (คอลัมน์ Excel · ทุก row)">
                        {SO_ROUTE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Warehouse</Label>
                    {convertSoStore ? (
                      <StorePickCombo value={convertSoStoreWh} options={convertSoStoreOpts} onChange={setConvertSoStoreWh} />
                    ) : (
                      <select className="h-8 text-xs border rounded px-2 bg-background max-w-[160px]" value={convertSoWarehouse} onChange={(e) => setConvertSoWarehouse(e.target.value)} title="Warehouse (คอลัมน์ Excel)">
                        {SO_WAREHOUSE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ใช้ template SO เดียวกับหน้า SO Order B2B (srr_special_so) · SO ลูกค้าเดียว ตัดกลุ่มตาม Item Per SO (ไม่แยก vendor) หัวกลุ่มขึ้นแถวแรก · Pricelist = {convertPricelist}
                  {convertSoStore ? ` · SO Store: ไม่มี Route · WH(สาขา) = ${convertSoStoreWh || "ยังไม่เลือก"}` : ` · Route = ${convertSoRoute} · WH = ${convertSoWarehouse}`}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setConvertOpen(false)}>ปิด</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="border rounded-lg flex-1 overflow-auto min-h-0">
          <table className="text-sm border-collapse whitespace-nowrap table-fixed" style={{ width: 48 + visibleCols.reduce((s, c) => s + widthOf(c.key), 0) }}>
            <colgroup>
              <col style={{ width: 48 }} />
              {visibleCols.map((c) => (
                <col key={c.key} style={{ width: widthOf(c.key) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-30">
              <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
                <th>#</th>
                {visibleCols.map((c) => (
                  <th key={c.key} className={cn("relative overflow-hidden", c.thCls)}>
                    <div className="flex items-center pr-1.5">
                      <span className="block truncate">{c.label}</span>
                      {(PO_FILTER_KEYS as readonly string[]).includes(c.key) && (
                        <ColFilterPopover
                          options={poColOptions(c.key as PoFilterKey)}
                          selected={colFilters[c.key as PoFilterKey]}
                          onChange={(s) => setColFilters((p) => ({ ...p, [c.key]: s }))}
                        />
                      )}
                    </div>
                    <span
                      onMouseDown={(e) => startResize(e, c.key)}
                      title="ลากเพื่อปรับความกว้าง"
                      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/50"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPoRows.map((r, i) => (
                <tr key={r.id || i} className="h-16 border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle [&_td]:overflow-hidden [&_td]:text-ellipsis">
                  <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                  {visibleCols.map((c) =>
                    c.key === "vendor_code" ? (
                      <td key="vendor_code" className={c.tdCls}>
                        <div className="flex items-center gap-1">
                          <input
                            key={r.sku + "|" + r.vendor_code}
                            defaultValue={r.vendor_code}
                            readOnly={!can("edit")}
                            className="flex-1 min-w-0 bg-transparent text-sm border-b border-transparent focus:border-primary/60 focus:outline-none transition-colors read-only:cursor-default"
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            onBlur={(e) => { if (!can("edit")) return; const v = e.target.value.trim(); if (v !== r.vendor_code) handleVendorCodeChange(r.sku, v); }}
                          />
                          {vendorLookupSkus.has(r.sku) && <Loader2 className="w-3 h-3 animate-spin shrink-0 text-muted-foreground" />}
                        </div>
                      </td>
                    ) : (
                      <td key={c.key} className={c.tdCls}>{c.brand ? (r.byBrand.get(c.brand) ?? "") : poCellValue(c.key, r)}</td>
                    )
                  )}
                </tr>
              ))}
              {filteredPoRows.length === 0 && (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                    {!poLoaded ? "กด \"โหลด / คำนวณ\" เพื่อดึงรายการจาก Monthly usage ทุกแบรนด์" : poRows.length === 0 ? "ไม่มีข้อมูล" : "ไม่พบรายการที่ค้นหา"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          PO NUMBER/DATE/Status/QTY/REC PO ดึงจาก PO Receive (line วันที่ล่าสุดของ ID) · 1x/Pocost จาก PO Cost (match ID) · Stock DC (KR) รวมจาก Stock Kr · DIFF = Total qty − Stock DC (KR) (KR ว่าง = 0)
        </p>
      </TabsContent>

      {/* ===== Stock Kr (Import) ===== */}
      <TabsContent value="stock_kr" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
        <POImportPanel
          title="Stock Kr"
          cols={STOCK_KR_COLS as any}
          rows={stockKrRows}
          setRows={setStockKrRows}
          importing={importingKr}
          onImport={handleKrImport}
          onClear={() => setStockKrRows([])}
          onTemplate={() => downloadImportTemplate(STOCK_KR_COLS as any, "StockKr_Template")}
          saving={savingKr}
          onSave={() => saveImport("scm_stock_kr", STOCK_KR_COLS as any, stockKrRows, setSavingKr, "Stock Kr")}
        />
      </TabsContent>

      {/* ===== PO Receive (Import) ===== */}
      <TabsContent value="po_receive" className="mt-0 flex-1 flex-col overflow-hidden min-h-0 data-[state=active]:flex gap-2">
        <POImportPanel
          title="PO Receive"
          cols={PO_RECEIVE_COLS as any}
          rows={poReceiveRows}
          setRows={setPoReceiveRows}
          importing={importingRec}
          onImport={handleRecImport}
          onClear={() => setPoReceiveRows([])}
          onTemplate={() => downloadImportTemplate(PO_RECEIVE_COLS as any, "POReceive_Template")}
          saving={savingRec}
          onSave={() => saveImport("scm_po_receive", PO_RECEIVE_COLS as any, poReceiveRows, setSavingRec, "PO Receive")}
        />
      </TabsContent>
    </Tabs>
  );
}

// แผง Import ทั่วไป (อัปโหลด Excel → แสดงตาราง + ค้นหา + เลือกหลายแถวเพื่อลบ + Save ลง Supabase)
function POImportPanel({
  title, cols, rows, setRows, importing, onImport, onClear, onTemplate, saving, onSave,
}: {
  title: string;
  cols: { key: string; label: string }[];
  rows: Record<string, string>[];
  setRows: React.Dispatch<React.SetStateAction<Record<string, string>[]>>;
  importing: boolean;
  onImport: (f: File) => void;
  onClear: () => void;
  onTemplate: () => void;
  saving: boolean;
  onSave: () => void;
}) {
  const { toast } = useToast();
  const { isAdmin, canDo } = useAuth();
  const can = (a: any) => isAdmin || canDo("b2b_scm", a);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // รายการที่ผ่านการค้นหา (คงดัชนีเดิมไว้เพื่อใช้กับ checkbox)
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    const indexed = rows.map((r, idx) => ({ r, idx }));
    if (!q) return indexed;
    return indexed.filter(({ r }) => cols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)));
  })();

  const allFilteredChecked = filtered.length > 0 && filtered.every(({ idx }) => selected.has(idx));
  const toggleOne = (idx: number) => setSelected((prev) => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const toggleAll = (check: boolean) => setSelected(check ? new Set(filtered.map(({ idx }) => idx)) : new Set());

  const deleteSelected = () => {
    if (selected.size === 0) return;
    const n = selected.size;
    setRows((prev) => prev.filter((_, idx) => !selected.has(idx)));
    setSelected(new Set());
    toast({ title: `ลบ ${n} แถว`, description: `กด Save เพื่อบันทึกถาวร` });
  };

  // Export ตารางปัจจุบัน (ตามที่ค้นหา/กรองอยู่) เป็น Excel
  const exportExcel = () => {
    if (rows.length === 0) { toast({ title: "ไม่มีข้อมูลให้ export", variant: "destructive" }); return; }
    const data = filtered.map(({ r }) => {
      const o: Record<string, any> = {};
      for (const c of cols) o[c.label] = r[c.key] ?? "";
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: cols.map((c) => c.label) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `${title.replace(/\s+/g, "_")}_${stamp}.xlsx`);
    toast({ title: `Export ${data.length} แถว` });
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {can("import") && (
        <label className="flex items-center gap-1.5 h-8 px-3 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer text-xs font-medium">
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Import {title}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
        </label>
        )}
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onTemplate}>
          <FileSpreadsheet className="w-3.5 h-3.5" /> Template
        </Button>
        {can("export") && (
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportExcel} disabled={rows.length === 0}>
          <Download className="w-3.5 h-3.5" /> Export
        </Button>
        )}
        {can("create") && (
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </Button>
        )}
        {selected.size > 0 && can("delete") && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive border-destructive/40" onClick={deleteSelected}>
            <Trash2 className="w-3.5 h-3.5" /> ลบที่เลือก ({selected.size})
          </Button>
        )}
        {rows.length > 0 && can("delete") && (
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-destructive" onClick={() => { onClear(); setSelected(new Set()); }}>
            <Trash2 className="w-3.5 h-3.5" /> ล้างทั้งหมด
          </Button>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8" placeholder="ค้นหา ID / Barcode / Description ..." />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {rows.length} รายการ</span>
      </div>
      <div className="border rounded-lg flex-1 overflow-auto min-h-0">
        <table className="text-sm border-collapse whitespace-nowrap w-full">
          <thead className="sticky top-0 z-30">
            <tr className="text-left text-muted-foreground [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-medium">
              <th className="w-10">
                <input type="checkbox" className="h-4 w-4 align-middle" checked={allFilteredChecked} onChange={(e) => toggleAll(e.target.checked)} />
              </th>
              <th>#</th>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ r, idx }, i) => (
              <tr key={idx} className={cn("border-b last:border-0 hover:bg-muted/40 [&_td]:px-3 [&_td]:py-1.5", selected.has(idx) && "bg-primary/5")}>
                <td>
                  <input type="checkbox" className="h-4 w-4 align-middle" checked={selected.has(idx)} onChange={() => toggleOne(idx)} />
                </td>
                <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c.key}>{(c as any).date ? (excelToDDMMMYY(r[c.key]) || "-") : (r[c.key] || "-")}</td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-3 py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? `ยังไม่มีข้อมูล — กด "Import ${title}" เพื่ออัปโหลด Excel` : "ไม่พบรายการที่ค้นหา"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
