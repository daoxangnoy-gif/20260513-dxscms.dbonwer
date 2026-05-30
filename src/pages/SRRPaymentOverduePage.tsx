import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import {
  Loader2, Plus, Search, Download, Trash2, Paperclip, FileImage,
  Link as LinkIcon, Truck, Pencil, FileText, DollarSign, Clipboard,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/useAuth";

interface VendorRow {
  vendor_code: string;
  vendor_name_en: string | null;
  vendor_name_la: string | null;
  supplier_currency: string | null;
  vat_percent: number | null;
  purchase_agreement_vat: string | null;
}

interface OverdueRow {
  id: string;
  user_id: string;
  vendor_code: string;
  vendor_name: string | null;
  supplier_currency: string | null;
  vat_percent: number | null;
  amount_overdue: number;
  paid_total: number;
  status: string;
  paid_at: string | null;
  reason: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  document_url: string | null;
  document_name: string | null;
  drive_link: string | null;
  created_at: string;
}

const BUCKET_IMG = "payment-overdue";
const BUCKET_DOC = "payment-overdue-docs";
const SIGNED_TTL = 60 * 60; // 1 hour

/** Extract storage object path from a public-or-signed URL of the given bucket */
function extractObjectPath(url: string | null, bucketId: string): string | null {
  if (!url) return null;
  // try standard supabase storage URL patterns
  const markers = [
    `/storage/v1/object/public/${bucketId}/`,
    `/storage/v1/object/sign/${bucketId}/`,
    `/${bucketId}/`,
  ];
  for (const m of markers) {
    const i = url.indexOf(m);
    if (i >= 0) {
      const rest = url.slice(i + m.length);
      return rest.split("?")[0];
    }
  }
  return null;
}

export default function SRRPaymentOverduePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<OverdueRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"overdue" | "paid">("overdue");
  const [search, setSearch] = useState("");
  const [filterVendors, setFilterVendors] = useState<string[]>([]);
  const [filterCurrency, setFilterCurrency] = useState<string>("__all");
  const [filterAttach, setFilterAttach] = useState<"all" | "with" | "without">("all");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [openConfirm, setOpenConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [vendorCodes, setVendorCodes] = useState<string[]>([]);
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [driveLink, setDriveLink] = useState<string>("");
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openEdit, setOpenEdit] = useState(false);
  const [editVendorCode, setEditVendorCode] = useState<string>("");
  const [editAmount, setEditAmount] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");
  const [editDriveLink, setEditDriveLink] = useState<string>("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editDocFile, setEditDocFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editImgInputRef = useRef<HTMLInputElement>(null);

  // Paid dialog
  const [openPaid, setOpenPaid] = useState(false);
  const [paidRow, setPaidRow] = useState<OverdueRow | null>(null);
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [savingPaid, setSavingPaid] = useState(false);

  const loadVendors = async () => {
    const all: VendorRow[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("vendor_master")
        .select("vendor_code,vendor_name_en,vendor_name_la,supplier_currency,vat_percent,purchase_agreement_vat")
        .range(from, from + 999);
      if (error) break;
      all.push(...((data as VendorRow[]) || []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    const seen = new Set<string>();
    const unique = all.filter(v => {
      if (!v.vendor_code || seen.has(v.vendor_code)) return false;
      seen.add(v.vendor_code);
      return true;
    });
    unique.sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));
    setVendors(unique);
  };

  const loadRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_overdue")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as OverdueRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    loadVendors();
    loadRows();
  }, []);

  // Paste image from clipboard into create dialog
  useEffect(() => {
    if (!openCreate) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const named = new File([f], `clipboard_${Date.now()}.png`, { type: f.type });
            setFile(named);
            toast.success("วางรูปจาก clipboard แล้ว");
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openCreate]);

  // Paste image from clipboard into edit dialog
  useEffect(() => {
    if (!openEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const named = new File([f], `clipboard_${Date.now()}.png`, { type: f.type });
            setEditFile(named);
            toast.success("วางรูปจาก clipboard แล้ว");
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openEdit]);

  const pasteFromClipboard = async (target: "create" | "edit") => {
    try {
      // @ts-ignore
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t: string) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const f = new File([blob], `clipboard_${Date.now()}.png`, { type: imageType });
          if (target === "create") setFile(f);
          else setEditFile(f);
          toast.success("วางรูปจาก clipboard แล้ว");
          return;
        }
      }
      toast.error("ไม่มีรูปใน clipboard");
    } catch {
      toast.error("เบราเซอร์ไม่อนุญาต — ใช้ Ctrl+V ในกล่อง dialog แทนได้");
    }
  };

  const vendorByCode = useMemo(() => {
    const m = new Map<string, VendorRow>();
    vendors.forEach(v => m.set(v.vendor_code, v));
    return m;
  }, [vendors]);

  const vendorOptions = useMemo(() => vendors.map(v => v.vendor_code), [vendors]);
  const renderVendorOption = (code: string) => {
    const v = vendorByCode.get(code);
    if (!v) return code;
    return (
      <span className="text-xs">
        <span className="text-primary font-semibold">{v.supplier_currency || "-"}</span>
        {" | VAT "}{v.vat_percent ?? "-"}%
        {" | "}<span className="font-mono">{v.vendor_code}</span>
        {" - "}{v.vendor_name_en || v.vendor_name_la}
      </span>
    );
  };

  const currencies = useMemo(
    () => Array.from(new Set(vendors.map(v => v.supplier_currency).filter(Boolean))) as string[],
    [vendors]
  );

  const tabRows = useMemo(
    () => rows.filter(r => (tab === "paid" ? r.status === "paid" : r.status !== "paid")),
    [rows, tab]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const vSet = new Set(filterVendors);
    return tabRows.filter(r => {
      if (vSet.size && !vSet.has(r.vendor_code)) return false;
      if (filterCurrency !== "__all" && (r.supplier_currency || "") !== filterCurrency) return false;
      const hasAttach = !!(r.attachment_url || r.drive_link || r.document_url);
      if (filterAttach === "with" && !hasAttach) return false;
      if (filterAttach === "without" && hasAttach) return false;
      if (q) {
        const hay = `${r.vendor_code} ${r.vendor_name || ""} ${r.reason || ""} ${r.supplier_currency || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tabRows, search, filterVendors, filterCurrency, filterAttach]);

  const resetForm = () => {
    setVendorCodes([]);
    setAmount("");
    setReason("");
    setFile(null);
    setDocFile(null);
    setDriveLink("");
  };

  const openSignedUrl = async (url: string | null, bucket: string) => {
    if (!url) return;
    const path = extractObjectPath(url, bucket);
    if (!path) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
    if (error || !data?.signedUrl) { toast.error("เปิดไฟล์ไม่สำเร็จ"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const uploadToBucket = async (bucket: string, f: File, maxMB: number) => {
    if (f.size > maxMB * 1024 * 1024) throw new Error(`ไฟล์ใหญ่เกิน ${maxMB}MB`);
    const ext = f.name.split(".").pop() || "bin";
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
    if (upErr) throw upErr;
    // store the path-style URL (we always signing later anyway)
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    return { url: pub.publicUrl, name: f.name };
  };

  const handleConfirmSave = async () => {
    if (!user) { toast.error("กรุณาเข้าสู่ระบบ"); return; }
    if (!vendorCodes.length) { toast.error("เลือก Vendor"); return; }
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) { toast.error("กรอกจำนวนเงินที่ถูกต้อง"); return; }

    if (driveLink.trim() && !/^https?:\/\//i.test(driveLink.trim())) {
      toast.error("ลิงก์ต้องขึ้นต้นด้วย http(s)://");
      return;
    }

    const existingVendors = new Set(rows.filter(r => r.status !== "paid").map(r => r.vendor_code));
    const dups = vendorCodes.filter(c => existingVendors.has(c));
    if (dups.length) {
      toast.error(`Vendor นี้มีในรายการอยู่แล้ว: ${dups.join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      let attachment_url: string | null = null;
      let attachment_name: string | null = null;
      let document_url: string | null = null;
      let document_name: string | null = null;

      if (file) {
        if (!file.type.startsWith("image/")) { toast.error("รูปภาพต้องเป็นไฟล์รูป"); setSaving(false); return; }
        const r = await uploadToBucket(BUCKET_IMG, file, 10);
        attachment_url = r.url; attachment_name = r.name;
      }
      if (docFile) {
        const r = await uploadToBucket(BUCKET_DOC, docFile, 10);
        document_url = r.url; document_name = r.name;
      }

      const payloads = vendorCodes.map(code => {
        const v = vendorByCode.get(code)!;
        return {
          user_id: user.id,
          vendor_code: v.vendor_code,
          vendor_name: v.vendor_name_en || v.vendor_name_la || "",
          supplier_currency: v.supplier_currency,
          vat_percent: v.vat_percent,
          amount_overdue: amt,
          reason: reason.trim() || null,
          attachment_url,
          attachment_name,
          document_url,
          document_name,
          drive_link: driveLink.trim() || null,
        };
      });
      const { error } = await supabase.from("payment_overdue").insert(payloads);
      if (error) throw error;

      toast.success(`บันทึกสำเร็จ ${payloads.length} รายการ`);
      setOpenConfirm(false);
      setOpenCreate(false);
      resetForm();
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (r: OverdueRow) => {
    setEditingId(r.id);
    setEditVendorCode(r.vendor_code);
    setEditAmount(String(r.amount_overdue ?? ""));
    setEditReason(r.reason || "");
    setEditDriveLink(r.drive_link || "");
    setEditFile(null);
    setEditDocFile(null);
    setOpenEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !user) return;
    if (!editVendorCode) { toast.error("เลือก Vendor"); return; }
    const amt = Number(editAmount);
    if (!isFinite(amt) || amt <= 0) { toast.error("กรอกจำนวนเงินที่ถูกต้อง"); return; }
    if (editDriveLink.trim() && !/^https?:\/\//i.test(editDriveLink.trim())) {
      toast.error("ลิงก์ต้องขึ้นต้นด้วย http(s)://");
      return;
    }
    const dup = rows.find(r => r.id !== editingId && r.vendor_code === editVendorCode && r.status !== "paid");
    if (dup) { toast.error(`Vendor นี้มีในรายการอยู่แล้ว: ${editVendorCode}`); return; }

    setSavingEdit(true);
    try {
      const v = vendorByCode.get(editVendorCode);
      const update: any = {
        vendor_code: editVendorCode,
        vendor_name: v ? (v.vendor_name_en || v.vendor_name_la || "") : undefined,
        supplier_currency: v?.supplier_currency,
        vat_percent: v?.vat_percent,
        amount_overdue: amt,
        reason: editReason.trim() || null,
        drive_link: editDriveLink.trim() || null,
      };
      if (editFile) {
        if (!editFile.type.startsWith("image/")) { toast.error("รูปภาพต้องเป็นไฟล์รูป"); setSavingEdit(false); return; }
        const r = await uploadToBucket(BUCKET_IMG, editFile, 10);
        update.attachment_url = r.url; update.attachment_name = r.name;
      }
      if (editDocFile) {
        const r = await uploadToBucket(BUCKET_DOC, editDocFile, 10);
        update.document_url = r.url; update.document_name = r.name;
      }
      const { error } = await supabase.from("payment_overdue").update(update).eq("id", editingId);
      if (error) throw error;
      toast.success("บันทึกการแก้ไขแล้ว");
      setOpenEdit(false);
      setEditingId(null);
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSavingEdit(false);
    }
  };

  const openPaidDialog = (r: OverdueRow) => {
    setPaidRow(r);
    setPaidAmount("");
    setOpenPaid(true);
  };

  const handleSavePaid = async () => {
    if (!paidRow || !user) return;
    const add = Number(paidAmount);
    if (!isFinite(add) || add <= 0) { toast.error("กรอกจำนวนเงินที่ถูกต้อง"); return; }
    const newPaid = Number(paidRow.paid_total || 0) + add;
    const remaining = Number(paidRow.amount_overdue) - newPaid;
    const update: any = { paid_total: newPaid };
    if (remaining <= 0.0001) {
      update.status = "paid";
      update.paid_at = new Date().toISOString();
    }
    setSavingPaid(true);
    try {
      const { error } = await supabase.from("payment_overdue").update(update).eq("id", paidRow.id);
      if (error) throw error;
      toast.success(remaining <= 0.0001 ? "ชำระครบแล้ว — ย้ายไปแท็บ Paid" : `ชำระบางส่วน คงเหลือ ${remaining.toLocaleString()}`);
      setOpenPaid(false);
      setPaidRow(null);
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSavingPaid(false);
    }
  };

  const handleDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`ลบ ${selected.size} รายการ?`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("payment_overdue").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success("ลบสำเร็จ");
    setSelected(new Set());
    loadRows();
  };

  const handleExport = () => {
    const data = filtered.map(r => ({
      "Vendor Code": r.vendor_code,
      "Vendor Name": r.vendor_name || "",
      Currency: r.supplier_currency || "",
      "VAT %": r.vat_percent ?? "",
      "Amount Overdue": r.amount_overdue,
      "Amount Paid": r.paid_total || 0,
      "Remaining": Number(r.amount_overdue) - Number(r.paid_total || 0),
      Status: r.status,
      Reason: r.reason || "",
      "Attachment": r.attachment_url || "",
      "Document": r.document_url || "",
      "Drive Link": r.drive_link || "",
      "Created At": new Date(r.created_at).toLocaleString(),
      "Paid At": r.paid_at ? new Date(r.paid_at).toLocaleString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payment Overdue");
    XLSX.writeFile(wb, `payment_overdue_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const allChecked = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = () => {
    const s = new Set(selected);
    if (allChecked) filtered.forEach(r => s.delete(r.id));
    else filtered.forEach(r => s.add(r.id));
    setSelected(s);
  };

  // counts for tabs
  const counts = useMemo(() => ({
    overdue: rows.filter(r => r.status !== "paid").length,
    paid: rows.filter(r => r.status === "paid").length,
  }), [rows]);

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Payment Overdue</h1>
          <p className="text-xs text-muted-foreground">บันทึกยอดค้างชำระตาม Vendor</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" /> ลบ ({selected.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> Export
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setOpenCreate(true); }}>
            <Plus className="w-4 h-4" /> Create
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v: any) => { setTab(v); setSelected(new Set()); }}>
        <TabsList>
          <TabsTrigger value="overdue">Overdue ({counts.overdue})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({counts.paid})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center bg-muted/30 p-2 rounded-md">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor / reason..."
            className="pl-7 h-8 w-64"
          />
        </div>
        <MultiSelectFilter
          label="Vendor"
          icon={<Truck className="w-3 h-3" />}
          options={vendorOptions}
          selected={filterVendors}
          onChange={setFilterVendors}
          width="w-96"
          renderOption={renderVendorOption}
        />
        <Select value={filterCurrency} onValueChange={setFilterCurrency}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Currency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All Currency</SelectItem>
            {currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterAttach} onValueChange={(v: any) => setFilterAttach(v)}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Attachments</SelectItem>
            <SelectItem value="with">มี Attachment</SelectItem>
            <SelectItem value="without">ไม่มี Attachment</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} / {tabRows.length} รายการ
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border rounded-md">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="p-2 w-8"><Checkbox checked={allChecked} onCheckedChange={toggleAll} /></th>
                <th className="p-2 text-left">Vendor</th>
                <th className="p-2 text-right">Amount Overdue</th>
                <th className="p-2 text-right">Amount Paid</th>
                {tab === "overdue" && <th className="p-2 text-right">Remaining</th>}
                <th className="p-2 text-left">Reason</th>
                <th className="p-2 text-center">Image</th>
                <th className="p-2 text-center">Document</th>
                <th className="p-2 text-center">Drive</th>
                <th className="p-2 text-left">{tab === "paid" ? "Paid At" : "Created"}</th>
                <th className="p-2 text-center w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const paid = Number(r.paid_total || 0);
                const remaining = Number(r.amount_overdue) - paid;
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 text-center">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => {
                          const s = new Set(selected);
                          s.has(r.id) ? s.delete(r.id) : s.add(r.id);
                          setSelected(s);
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">
                        <span className="text-primary">{r.supplier_currency || "-"}</span>
                        {" - "}<span>VAT {r.vat_percent ?? "-"}%</span>
                        {" - "}<span className="font-mono">{r.vendor_code}</span>
                      </div>
                      <div className="text-muted-foreground">{r.vendor_name}</div>
                    </td>
                    <td className="p-2 text-right font-mono">
                      {r.amount_overdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-right font-mono text-green-700">
                      {paid > 0 ? paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                    </td>
                    {tab === "overdue" && (
                      <td className="p-2 text-right font-mono font-semibold text-destructive">
                        {remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    )}
                    <td className="p-2 max-w-md truncate" title={r.reason || ""}>{r.reason}</td>
                    <td className="p-2 text-center">
                      {r.attachment_url ? (
                        <button onClick={() => openSignedUrl(r.attachment_url, BUCKET_IMG)}
                          className="inline-flex items-center gap-1 text-primary hover:underline">
                          <FileImage className="w-4 h-4" /> ดู
                        </button>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="p-2 text-center">
                      {r.document_url ? (
                        <button onClick={() => openSignedUrl(r.document_url, BUCKET_DOC)}
                          className="inline-flex items-center gap-1 text-primary hover:underline" title={r.document_name || ""}>
                          <FileText className="w-4 h-4" /> ดู
                        </button>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="p-2 text-center">
                      {r.drive_link ? (
                        <a href={r.drive_link} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline">
                          <LinkIcon className="w-4 h-4" /> Drive
                        </a>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {tab === "paid" && r.paid_at
                        ? new Date(r.paid_at).toLocaleDateString()
                        : new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {tab === "overdue" && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-green-700 border-green-600/50 hover:bg-green-50"
                            onClick={() => openPaidDialog(r)}>
                            <DollarSign className="w-3.5 h-3.5" /> Paid
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(r)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={tab === "overdue" ? 11 : 10} className="text-center p-8 text-muted-foreground">ไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>สร้างรายการ Payment Overdue</DialogTitle>
            <DialogDescription>กรอกข้อมูลให้ครบถ้วนก่อนยืนยันบันทึก</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1">Vendor * (เลือกได้หลายราย)</label>
              <MultiSelectFilter
                label="เลือก Vendor"
                icon={<Truck className="w-3 h-3" />}
                options={vendorOptions}
                selected={vendorCodes}
                onChange={setVendorCodes}
                width="w-[28rem]"
                renderOption={renderVendorOption}
              />
              {vendorCodes.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  เลือกแล้ว {vendorCodes.length} ราย — จะสร้าง 1 รายการต่อ Vendor
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">Amount Overdue *</label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium">Reason</label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} />
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <Paperclip className="w-3 h-3" /> แนบรูปภาพ (≤ 10MB) — รองรับ Ctrl+V (paste จาก capture)
              </label>
              <div className="flex gap-2">
                <Input ref={imgInputRef} type="file" accept="image/*"
                  onChange={e => setFile(e.target.files?.[0] || null)} className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={() => pasteFromClipboard("create")}>
                  <Clipboard className="w-3.5 h-3.5" /> Paste
                </Button>
              </div>
              {file && (
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                  <span>{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                  <button onClick={() => { setFile(null); if (imgInputRef.current) imgInputRef.current.value = ""; }}
                    className="text-destructive hover:underline">ลบ</button>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <FileText className="w-3 h-3" /> แนบไฟล์เอกสาร (PDF / Word / Excel / อื่นๆ ≤ 10MB)
              </label>
              <Input type="file" onChange={e => setDocFile(e.target.files?.[0] || null)} />
              {docFile && <div className="text-[11px] text-muted-foreground mt-1">{docFile.name} ({(docFile.size / 1024).toFixed(0)} KB)</div>}
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> Google Drive Link
              </label>
              <Input type="url" value={driveLink} onChange={e => setDriveLink(e.target.value)} placeholder="https://drive.google.com/..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>ยกเลิก</Button>
            <Button
              onClick={() => {
                if (!vendorCodes.length || !amount) { toast.error("กรอก Vendor และ Amount"); return; }
                setOpenConfirm(true);
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={openConfirm} onOpenChange={setOpenConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันบันทึก?</DialogTitle>
            <DialogDescription>ตรวจสอบข้อมูลก่อนบันทึกลงระบบ</DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-1 max-h-60 overflow-auto">
            <div><b>Vendors ({vendorCodes.length}):</b></div>
            <ul className="text-xs list-disc pl-5 max-h-32 overflow-auto">
              {vendorCodes.map(c => {
                const v = vendorByCode.get(c);
                return <li key={c}>{c} - {v?.vendor_name_en || v?.vendor_name_la} ({v?.supplier_currency || "-"})</li>;
              })}
            </ul>
            <div><b>Amount:</b> {Number(amount).toLocaleString()}</div>
            <div><b>Reason:</b> {reason || "-"}</div>
            <div><b>Image:</b> {file ? file.name : "-"}</div>
            <div><b>Document:</b> {docFile ? docFile.name : "-"}</div>
            <div><b>Drive Link:</b> {driveLink || "-"}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenConfirm(false)} disabled={saving}>กลับไปแก้ไข</Button>
            <Button onClick={handleConfirmSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              ยืนยัน Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>แก้ไขรายการ Payment Overdue</DialogTitle>
            <DialogDescription>เปลี่ยน Vendor ได้ (ห้ามซ้ำกับรายการ Overdue อื่น)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1">Vendor *</label>
              <Select value={editVendorCode} onValueChange={setEditVendorCode}>
                <SelectTrigger className="h-9"><SelectValue placeholder="เลือก Vendor" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {vendorOptions.map(c => {
                    const v = vendorByCode.get(c);
                    const taken = rows.some(r => r.id !== editingId && r.vendor_code === c && r.status !== "paid");
                    return (
                      <SelectItem key={c} value={c} disabled={taken}>
                        <span className="text-xs">
                          <span className="text-primary font-semibold">{v?.supplier_currency || "-"}</span>
                          {" | VAT "}{v?.vat_percent ?? "-"}%
                          {" | "}<span className="font-mono">{c}</span>
                          {" - "}{v?.vendor_name_en || v?.vendor_name_la}
                          {taken && " (มีอยู่แล้ว)"}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Amount Overdue *</label>
              <Input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium">Reason</label>
              <Textarea value={editReason} onChange={e => setEditReason(e.target.value)} rows={3} />
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <Paperclip className="w-3 h-3" /> เปลี่ยนรูปภาพ (≤ 10MB) — Ctrl+V ได้
              </label>
              <div className="flex gap-2">
                <Input ref={editImgInputRef} type="file" accept="image/*"
                  onChange={e => setEditFile(e.target.files?.[0] || null)} className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={() => pasteFromClipboard("edit")}>
                  <Clipboard className="w-3.5 h-3.5" /> Paste
                </Button>
              </div>
              {editFile && (
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                  <span>{editFile.name} ({(editFile.size / 1024).toFixed(0)} KB)</span>
                  <button onClick={() => { setEditFile(null); if (editImgInputRef.current) editImgInputRef.current.value = ""; }}
                    className="text-destructive hover:underline">ลบ</button>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <FileText className="w-3 h-3" /> เปลี่ยนเอกสาร (≤ 10MB) — ปล่อยว่างเพื่อใช้ของเดิม
              </label>
              <Input type="file" onChange={e => setEditDocFile(e.target.files?.[0] || null)} />
              {editDocFile && <div className="text-[11px] text-muted-foreground mt-1">{editDocFile.name} ({(editDocFile.size / 1024).toFixed(0)} KB)</div>}
            </div>
            <div>
              <label className="text-xs font-medium flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> Google Drive Link
              </label>
              <Input type="url" value={editDriveLink} onChange={e => setEditDriveLink(e.target.value)} placeholder="https://drive.google.com/..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={savingEdit}>ยกเลิก</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paid dialog */}
      <Dialog open={openPaid} onOpenChange={setOpenPaid}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกการชำระเงิน</DialogTitle>
            <DialogDescription>กรอกจำนวนเงินที่ชำระงวดนี้</DialogDescription>
          </DialogHeader>
          {paidRow && (() => {
            const paid = Number(paidRow.paid_total || 0);
            const remaining = Number(paidRow.amount_overdue) - paid;
            const addN = Number(paidAmount) || 0;
            const afterRemain = remaining - addN;
            return (
              <div className="space-y-3 text-sm">
                <div className="bg-muted/30 p-3 rounded space-y-1 text-xs">
                  <div><b>Vendor:</b> <span className="font-mono">{paidRow.vendor_code}</span> - {paidRow.vendor_name}</div>
                  <div><b>Currency:</b> {paidRow.supplier_currency || "-"}</div>
                  <div className="flex justify-between"><span>Amount Overdue:</span><span className="font-mono">{Number(paidRow.amount_overdue).toLocaleString()}</span></div>
                  <div className="flex justify-between text-green-700"><span>Paid (สะสม):</span><span className="font-mono">{paid.toLocaleString()}</span></div>
                  <div className="flex justify-between font-semibold text-destructive"><span>คงเหลือก่อนชำระ:</span><span className="font-mono">{remaining.toLocaleString()}</span></div>
                </div>
                <div>
                  <label className="text-xs font-medium">จำนวนเงินที่ชำระงวดนี้ *</label>
                  <Input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
                    placeholder="0.00" autoFocus />
                </div>
                {addN > 0 && (
                  <div className={`text-xs p-2 rounded ${afterRemain <= 0.0001 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
                    {afterRemain <= 0.0001
                      ? "✓ ชำระครบ — จะย้ายไปแท็บ Paid"
                      : `คงเหลือหลังชำระ: ${afterRemain.toLocaleString()} — ยังอยู่ที่แท็บ Overdue`}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenPaid(false)} disabled={savingPaid}>ยกเลิก</Button>
            <Button onClick={handleSavePaid} disabled={savingPaid}>
              {savingPaid && <Loader2 className="w-4 h-4 animate-spin" />}
              บันทึกชำระ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
