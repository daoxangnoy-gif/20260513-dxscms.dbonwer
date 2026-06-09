import { useEffect, useRef, useState, Fragment as FragmentRow } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ScanLine, Camera, Plus, Save, Trash2, X, CheckCircle2, AlertCircle, Download, Truck, Pencil,
  ChevronDown, ChevronRight, Printer, Database, MapPin, FileSpreadsheet, ArrowUp, ArrowDown,
  Maximize2, Minimize2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import appLogo from "@/assets/dx-scm-logo.png";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const SCROLL_CONTAINER_ID = "send-docs-scroll-container";

// Searchable combobox: typing is free, dropdown filters locations
function LocationCombobox({
  value, onChange, options, placeholder, disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { name: string; description?: string | null }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => setOpen(disabled ? false : next)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal h-8 text-xs"
        >
          <span className={value ? "" : "text-muted-foreground"}>{value || placeholder || "เลือกจุด..."}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72 z-[70000]" align="start">
        <Command>
          <CommandInput placeholder="ค้นหาจุด..." />
          <div
            style={{ maxHeight: "240px", overflowY: "auto" }}
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandList>
              <CommandEmpty>ไม่พบจุด</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.name} value={o.name} onSelect={() => { onChange(o.name); setOpen(false); }}>
                    <div>
                      <div>{o.name}</div>
                      {o.description && <div className="text-xs text-muted-foreground">{o.description}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface DocLocation {
  id: string;
  name: string;
  description: string | null;
}

interface Shipment {
  id: string;
  user_id: string;
  doc_name: string;
  depositor_name: string | null;
  receiver_name: string | null;
  origin_location: string | null;
  destination_location: string | null;
  origin_codes: string[];
  destination_codes: string[];
  status: string;
  compared_at: string | null;
  created_at: string;
  origin_scanned_at: string | null;
  destination_scanned_at: string | null;
}

interface Movement {
  id: string;
  shipment_id: string;
  location_name: string;
  action: string;
  notes: string | null;
  codes: string[];
  depositor_name: string | null;
  receiver_name: string | null;
  attachment_url: string | null;
  attachment_uploaded_by: string | null;
  user_id?: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  origin_save: "เริ่มฝาก",
  arrived: "รับตรวจ",
  forward: "ฝากต่อ",
  closed: "จบ",
  adjust: "Adjust",
};

interface PoInfo {
  order_reference: string;
  partner: string | null;
  source: string | null;
  document: string | null;
  status: string | null;
  total: number | null;
  currency_name: string | null;
  delivery_to1: string | null;
  delivery_to2: string | null;
}

function nowDocName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `DOC-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function fetchPoInfo(codes: string[]): Promise<Record<string, PoInfo>> {
  const map: Record<string, PoInfo> = {};
  if (codes.length === 0) return map;
  const chunkSize = 500;
  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const { data } = await supabase
      .from("list_po")
      .select("order_reference, partner, source, document, status, total, currency_name, delivery_to1, delivery_to2")
      .in("order_reference", chunk);
    (data || []).forEach((r: any) => { map[r.order_reference] = r; });
  }
  return map;
}

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function logoToDataUrl(): Promise<string> {
  try {
    const res = await fetch(appLogo);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch { return ""; }
}

async function openPrintWindow(s: Shipment, poMap: Record<string, PoInfo>) {
  const logoDataUrl = await logoToDataUrl();
  const fmt = (d: string | null) => d ? new Date(d).toLocaleString("th-TH") : "-";
  const rows = (s.origin_codes || []).map((code, idx) => {
    const p = poMap[code];
    return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="mono">${escapeHtml(code)}</td>
        <td class="partner">${escapeHtml(p?.partner || "-")}</td>
        <td>${escapeHtml(p?.status || "-")}</td>
        <td class="r">${p?.total != null ? Number(p.total).toLocaleString() : "-"}</td>
        <td>${escapeHtml(p?.currency_name || "-")}</td>
      </tr>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(s.doc_name)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: "IBM Plex Sans Thai","IBM Plex Sans",Arial,sans-serif; font-size: 11px; color:#111; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .meta { display:grid; grid-template-columns:repeat(2,1fr); gap:4px 16px; margin:8px 0 12px; padding:8px; border:1px solid #ccc; border-radius:4px; }
    .meta b { display:inline-block; min-width:110px; color:#555; }
    table { width:100%; border-collapse:collapse; }
    th,td { border:1px solid #999; padding:4px 6px; vertical-align:top; }
    th { background:#f0f0f0; text-align:left; font-size:10px; }
    td.c { text-align:center; } td.r { text-align:right; }
    td.mono { font-family:"IBM Plex Mono",monospace; }
    td.partner { width:45%; }
    td.sig { width:80px; height:30px; }
    .sign { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:30px; }
    .sign .box { text-align:center; }
    .sign .line { border-top:1px solid #000; margin:36px 20px 4px; }
    .sign .date { font-size:10px; color:#555; margin-top:4px; }
    @media print { .noprint { display:none; } }
  </style></head><body>
    <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:8px">
      <img src="${logoDataUrl}" alt="logo" style="height:42px;width:auto" onerror="this.style.display='none'"/>
      <h1 style="margin:0">ใบส่งเอกสาร / Document Shipment</h1>
    </div>
    <div class="meta">
      <div><b>เลขที่เอกสาร:</b> ${escapeHtml(s.doc_name)}</div>
      <div><b>วันที่พิมพ์:</b> ${new Date().toLocaleString("th-TH")}</div>
      <div><b>ผู้ฝาก:</b> ${escapeHtml(s.depositor_name || "-")}</div>
      <div><b>ผู้รับปลายทาง:</b> ${escapeHtml(s.receiver_name || "-")}</div>
      <div><b>สะแกนฝาก:</b> ${fmt(s.origin_scanned_at)}</div>
      <div><b>สะแกนรับ:</b> ${fmt(s.destination_scanned_at)}</div>
      <div><b>จำนวนเอกสาร:</b> ${(s.origin_codes || []).length} ชุด</div>
      <div><b>สถานะ:</b> ${escapeHtml(s.status)}</div>
    </div>
    <table>
      <thead><tr>
        <th>#</th><th>Order Reference</th><th style="width:45%">Partner</th>
        <th>Status</th><th>Total</th><th>Currency/Name</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="c">ไม่มีรายการ</td></tr>`}</tbody>
    </table>
    <div class="sign">
      <div class="box"><div class="line"></div><div>ผู้ฝากเอกสาร (${escapeHtml(s.depositor_name || "")})</div><div class="date">วันที่ ........./........./.........</div></div>
      <div class="box"><div class="line"></div><div>ผู้รับเอกสาร (${escapeHtml(s.receiver_name || "")})</div><div class="date">วันที่ ........./........./.........</div></div>
    </div>
    <div class="noprint" style="margin-top:16px;text-align:center"><button onclick="window.print()">พิมพ์</button></div>
    <script>setTimeout(()=>window.print(),300);</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) { alert("กรุณาอนุญาต popup"); return; }
  w.document.write(html); w.document.close();
}
interface ConflictInfo { code: string; docName: string; location: string; }

function ScannerPanel({
  codes, setCodes, otherList = [], onCheckConflict,
}: {
  codes: string[];
  setCodes: (next: string[]) => void;
  otherList?: string[];
  onCheckConflict?: (code: string) => ConflictInfo | null;
}) {
  const { toast } = useToast();
  const [manual, setManual] = useState("");
  const [camOn, setCamOn] = useState(false);
  const camRef = useRef<Html5Qrcode | null>(null);
  const containerId = useRef(`qr-${Math.random().toString(36).slice(2)}`).current;
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [conflictPending, setConflictPending] = useState<{
    nonConflict: string[];
    conflicts: ConflictInfo[];
  } | null>(null);

  const addCode = (raw: string) => {
    // Allow multiple codes separated by comma / newline / tab / semicolon / spaces
    const parts = String(raw || "")
      .split(/[\s,;\t\r\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return false;
    const existing = new Set(codes);
    const fresh: string[] = [];
    const dup: string[] = [];
    for (const p of parts) {
      if (existing.has(p) || fresh.includes(p)) dup.push(p);
      else fresh.push(p);
    }
    if (dup.length > 0) {
      toast({ title: "พบรายการซ้ำ", description: `ข้าม ${dup.length} รายการ: ${dup.slice(0, 3).join(", ")}${dup.length > 3 ? "..." : ""}`, variant: "destructive" });
    }
    if (fresh.length === 0) return false;
    // Check conflicts: codes already in another shipment
    if (onCheckConflict) {
      const conflicts: ConflictInfo[] = [];
      const nonConflict: string[] = [];
      for (const c of fresh) {
        const hit = onCheckConflict(c);
        if (hit) conflicts.push(hit);
        else nonConflict.push(c);
      }
      if (conflicts.length > 0) {
        setConflictPending({ nonConflict, conflicts });
        return true;
      }
    }
    setCodes([...codes, ...fresh]);
    return true;
  };

  const handleManualKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (addCode(manual)) setManual("");
    }
  };

  useEffect(() => {
    if (!camOn) return;
    let active = true;
    const start = async () => {
      try {
        const html5 = new Html5Qrcode(containerId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
          ],
          useBarCodeDetectorIfSupported: true,
        });
        camRef.current = html5;
        await html5.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            const now = Date.now();
            if (decoded === lastScanRef.current.code && now - lastScanRef.current.at < 1500) return;
            lastScanRef.current = { code: decoded, at: now };
            addCode(decoded);
          },
          () => {},
        );
        if (!active) await html5.stop().catch(() => {});
      } catch (e: any) {
        toast({ title: "เปิดกล้องไม่ได้", description: e?.message || "Permission denied", variant: "destructive" });
        setCamOn(false);
      }
    };
    start();
    return () => {
      active = false;
      const c = camRef.current;
      if (c) {
        c.stop().catch(() => {}).finally(() => { c.clear?.(); camRef.current = null; });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  const otherSet = new Set(otherList);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={handleManualKey}
          placeholder="สะแกน หรือ พิมพ์เลขที่ PO แล้วกด Enter"
          autoFocus
        />
        <Button type="button" variant="outline" onClick={() => { if (addCode(manual)) setManual(""); }}>
          <Plus className="w-4 h-4 mr-1" />เพิ่ม
        </Button>
        <Button type="button" variant={camOn ? "destructive" : "secondary"} onClick={() => setCamOn(!camOn)}>
          <Camera className="w-4 h-4 mr-1" />{camOn ? "ปิดกล้อง" : "เปิดกล้อง"}
        </Button>
      </div>
      {camOn && <div id={containerId} className="w-full max-w-sm mx-auto rounded border" />}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">รายการที่สะแกน: <Badge variant="secondary">{codes.length}</Badge></span>
        {codes.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            if (!window.confirm(`ยืนยันล้างรายการทั้งหมด ${codes.length} รายการ?`)) return;
            setCodes([]);
          }}>
            <X className="w-3.5 h-3.5 mr-1" />ล้างทั้งหมด
          </Button>
        )}
      </div>
      <ScrollArea className="h-64 border rounded">
        {codes.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการสะแกน</div>
        ) : (
          <ul className="divide-y">
            {codes.map((c, i) => {
              const matched = otherSet.has(c);
              return (
                <li key={c} className={`flex items-center justify-between px-3 py-1.5 text-sm ${otherList.length > 0 ? (matched ? "bg-emerald-50" : "bg-amber-50") : ""}`}>
                  <span className="font-mono">{i + 1}. {c}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCodes(codes.filter((x) => x !== c))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      {/* Conflict warning dialog */}
      <Dialog open={!!conflictPending} onOpenChange={open => { if (!open) setConflictPending(null); }}>
        <DialogContent className="max-w-lg z-[60000]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-5 h-5" />
              พบเอกสารซ้ำในระบบ
            </DialogTitle>
            <DialogDescription>
              รายการ PO ต่อไปนี้มีอยู่แล้วในเอกสารอื่น กรุณาเลือกว่าจะดำเนินการอย่างไร
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-auto">
            {conflictPending?.conflicts.map(cf => (
              <div key={cf.code} className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <div className="font-mono font-semibold">{cf.code}</div>
                  <div className="text-xs text-muted-foreground">มีอยู่แล้วในเอกสาร <b>{cf.docName}</b> ที่จุด <b>{cf.location}</b></div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              // ข้ามรายการซ้ำ — เพิ่มเฉพาะที่ไม่ conflict
              if (conflictPending && conflictPending.nonConflict.length > 0) {
                setCodes([...codes, ...conflictPending.nonConflict]);
              }
              setConflictPending(null);
            }}>
              ข้ามรายการนี้ — สะแกนต่อ
            </Button>
            <Button onClick={() => {
              // ยืนยันฝาก — เพิ่มทั้งหมดรวม conflict
              if (conflictPending) {
                const allNew = [...conflictPending.nonConflict, ...conflictPending.conflicts.map(c => c.code)];
                setCodes([...codes, ...allNew]);
              }
              setConflictPending(null);
            }}>
              ยืนยันฝาก — ย้ายมาจุดใหม่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== Attachment Panel (per movement / point) ==============
// One JPG/PNG per movement, uploaded to public "movement-attachments" bucket.
// Supports clipboard paste and file picker. Viewable by everyone.
function AttachmentPanel({ movementId, url, uploadedBy, onChange }: {
  movementId: string | null;
  url: string | null;
  uploadedBy?: string | null;
  onChange: (newUrl: string | null, newUploader?: string | null) => void;
}) {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canDelete = !!url && (isAdmin || (!!user && !!uploadedBy && uploadedBy === user.id));

  const uploadFile = async (file: File) => {
    if (!movementId) {
      toast({ title: "บันทึกจุดนี้ก่อนค่อยแนบรูป", variant: "destructive" });
      return;
    }
    if (!user) return;
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
      toast({ title: "รองรับเฉพาะ JPG / PNG", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "ไฟล์เกิน 5MB", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${movementId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("movement-attachments")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("movement-attachments").getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      const { error: updErr } = await supabase
        .from("document_movements" as any)
        .update({ attachment_url: publicUrl, attachment_uploaded_by: user.id })
        .eq("id", movementId);
      if (updErr) throw updErr;
      onChange(publicUrl, user.id);
      toast({ title: "แนบรูปเรียบร้อย" });
    } catch (e: any) {
      toast({ title: "อัปโหลดไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); await uploadFile(f); break; }
      }
    }
  };

  const removeImage = async () => {
    if (!movementId) return;
    if (!canDelete) {
      toast({ title: "ลบไม่ได้", description: "ลบได้เฉพาะรูปที่คุณอัปโหลดเองเท่านั้น", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await supabase.from("document_movements" as any).update({ attachment_url: null, attachment_uploaded_by: null }).eq("id", movementId);
      onChange(null, null);
    } finally { setBusy(false); }
  };

  return (
    <div className="px-2 py-1.5 border-t bg-muted/20" onPaste={onPaste} tabIndex={0}>
      <div className="text-[10px] text-muted-foreground mb-1">แนบรูป (JPG/PNG, วาง Ctrl+V ได้)</div>
      {url ? (
        <div className="space-y-1">
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt="แนบ" className="max-h-28 w-full object-contain border rounded bg-white" />
          </a>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1" onClick={() => fileRef.current?.click()} disabled={busy || !canDelete} title={!canDelete ? "เปลี่ยนได้เฉพาะรูปที่คุณอัปโหลดเอง" : ""}>
              เปลี่ยน
            </Button>
            <Button size="sm" variant="destructive" className="h-6 text-[10px]" onClick={removeImage} disabled={busy || !canDelete} title={!canDelete ? "ลบได้เฉพาะรูปที่คุณอัปโหลดเอง" : ""}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
          {!canDelete && (
            <div className="text-[9px] text-muted-foreground italic">รูปนี้อัปโหลดโดยผู้อื่น — ลบ/เปลี่ยนไม่ได้</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => fileRef.current?.click()} disabled={busy || !movementId}>
            {busy ? "กำลังอัปโหลด..." : "เลือกรูป / วางจากคลิปบอร์ด"}
          </Button>
          {!movementId && <div className="text-[10px] text-muted-foreground italic">บันทึกจุดนี้ก่อนแนบรูป</div>}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
      />
    </div>
  );
}



// ============== Report Tab ==============
function ReportTab({ items, movements, poInfoMap, ensurePoInfo, canExport, finalizedIds, toggleFinalize }: {
  items: Shipment[];
  movements: Movement[];
  poInfoMap: Record<string, PoInfo>;
  ensurePoInfo: () => Promise<void>;
  canExport: boolean;
  finalizedIds: Set<string>;
  toggleFinalize: (docId: string, docName: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [partnerDocSearch, setPartnerDocSearch] = useState<Record<string, string>>({});
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { await ensurePoInfo(); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Build movements lookup
  const movementsByShipment: Record<string, Movement[]> = {};
  movements.forEach(m => {
    if (!movementsByShipment[m.shipment_id]) movementsByShipment[m.shipment_id] = [];
    movementsByShipment[m.shipment_id].push(m);
  });


  // ===== Global latest location + owner shipment per PO code (across ALL shipments) =====
  // PO ที่ถูกสะแกนใน Doc ใหม่กว่า ให้นับอยู่ใน Doc นั้น — ไม่นับซ้ำใน Doc เดิม
  // Sort ASC so last write wins (most recent scan)
  const allMovesAsc = movements.slice().sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const latestScanByCode: Record<string, { shipmentId: string; location: string }> = {};
  for (const m of allMovesAsc) {
    // origin_save included: ถ้า origin_save ใหม่กว่า arrived เก่า แสดงว่า PO ถูกรับเข้า doc ใหม่แล้ว
    if (m.action !== "adjust" && m.action !== "arrived" && m.action !== "origin_save") continue;
    for (const c of (m.codes || [])) {
      latestScanByCode[c] = { shipmentId: m.shipment_id, location: m.location_name };
    }
  }

  // For codes never in any movement: owner = most recently created shipment having that code in origin_codes
  const codeToShipsMap: Record<string, Shipment[]> = {};
  items.forEach(s => {
    (s.origin_codes || []).forEach(c => {
      if (!codeToShipsMap[c]) codeToShipsMap[c] = [];
      codeToShipsMap[c].push(s);
    });
  });
  const unscannedOwner: Record<string, { shipmentId: string; location: string }> = {};
  Object.entries(codeToShipsMap).forEach(([c, ships]) => {
    if (latestScanByCode[c]) return;
    const latest = ships.reduce((best, s) => {
      const t = new Date(s.origin_scanned_at || s.created_at).getTime();
      const bt = new Date(best.origin_scanned_at || best.created_at).getTime();
      return t > bt ? s : best;
    });
    unscannedOwner[c] = { shipmentId: latest.id, location: latest.origin_location || "(ไม่ระบุจุด)" };
  });

  // Helper: which shipment "owns" a code and where it currently is
  const getCodeOwner = (code: string): { shipmentId: string; location: string } =>
    latestScanByCode[code] ?? unscannedOwner[code] ?? { shipmentId: "", location: "(ไม่ระบุจุด)" };

  // Build latestLocByCode for export sections (statusByShipmentCode etc.) — unchanged
  const latestLocByCode: Record<string, string> = {};
  for (const [c, info] of Object.entries(latestScanByCode)) { latestLocByCode[c] = info.location; }

  // Per-PO location map per shipment — used only for locationsUsed + export sheet4
  const locByShipmentCode: Record<string, Record<string, string>> = {};
  items.forEach(s => {
    const origin = s.origin_location || "(ไม่ระบุจุด)";
    const codes = s.origin_codes || [];
    const map: Record<string, string> = {};
    codes.forEach(c => { map[c] = latestLocByCode[c] || origin; });
    locByShipmentCode[s.id] = map;
  });

  // Collect all locations actually used
  const locSet = new Set<string>();
  Object.values(locByShipmentCode).forEach(m => Object.values(m).forEach(l => locSet.add(l)));
  items.forEach(s => { if (s.origin_location) locSet.add(s.origin_location); });
  const locationsUsed = Array.from(locSet).sort();

  // Per-PO ขาด/เกิน/ตรง สำหรับ export
  // ตรง = origin code ที่ถูกสะแกน arrived/adjust ที่ไหนสักที่
  // ขาด = origin code ที่ไม่เคยถูกสะแกน arrived/adjust เลย
  // เกิน = code ที่ถูกสะแกน arrived/adjust แต่ไม่อยู่ใน origin_codes
  const statusByShipmentCode: Record<string, Record<string, "ตรง" | "ขาด" | "เกิน">> = {};
  const extraCodesByShipment: Record<string, { code: string; loc: string }[]> = {};
  items.forEach(s => {
    const originSet = new Set(s.origin_codes || []);
    const scannedSet = new Set<string>();
    const scannedLoc: Record<string, string> = {};
    (movementsByShipment[s.id] || []).forEach(m => {
      if (m.action !== "adjust" && m.action !== "arrived") return;
      (m.codes || []).forEach(c => {
        scannedSet.add(c);
        if (!(c in scannedLoc)) scannedLoc[c] = m.location_name;
      });
    });
    const map: Record<string, "ตรง" | "ขาด" | "เกิน"> = {};
    originSet.forEach(c => { map[c] = scannedSet.has(c) ? "ตรง" : "ขาด"; });
    const extras: { code: string; loc: string }[] = [];
    scannedSet.forEach(c => {
      if (!originSet.has(c)) { map[c] = "เกิน"; extras.push({ code: c, loc: scannedLoc[c] || "" }); }
    });
    statusByShipmentCode[s.id] = map;
    extraCodesByShipment[s.id] = extras;
  });


  // Search query (matches doc name, depositor, receiver, PO codes, or partner name)
  const q = search.trim().toLowerCase();

  // Group rows: partner -> docs. Row carries per-location PO counts for this partner in this doc.
  type Row = { doc: Shipment; partner: string; count: number; locCounts: Record<string, number> };
  const rows: Row[] = [];
  items.forEach(s => {
    const isFinalized = finalizedIds.has(s.id);


    const codes = s.origin_codes || [];
    const codesByPartner: Record<string, string[]> = {};
    codes.forEach(c => {
      const p = poInfoMap[c]?.partner || "(ไม่พบ Partner)";
      if (!codesByPartner[p]) codesByPartner[p] = [];
      codesByPartner[p].push(c);
    });
    if (Object.keys(codesByPartner).length === 0) codesByPartner["(ไม่พบ Partner)"] = [];

    Object.entries(codesByPartner).forEach(([p, partnerCodes]) => {
      if (q) {
        const partnerHit = p.toLowerCase().includes(q);
        const docHit =
          (s.doc_name || "").toLowerCase().includes(q) ||
          (s.depositor_name || "").toLowerCase().includes(q) ||
          (s.receiver_name || "").toLowerCase().includes(q);
        const codeHit = partnerCodes.some(c => c.toLowerCase().includes(q));
        if (!(partnerHit || docHit || codeHit)) return;
      }
      const locCounts: Record<string, number> = {};
      let ownedCount = 0;
      if (!isFinalized) {
        partnerCodes.forEach(c => {
          const owner = getCodeOwner(c);
          if (owner.shipmentId !== s.id) return; // PO นี้ถูกนับใน Doc ล่าสุดแทน
          locCounts[owner.location] = (locCounts[owner.location] || 0) + 1;
          ownedCount++;
        });
      }
      rows.push({ doc: s, partner: p, count: isFinalized ? 0 : ownedCount, locCounts });
    });
  });


  const grouped: Record<string, Row[]> = {};
  rows.forEach(r => {
    if (!grouped[r.partner]) grouped[r.partner] = [];
    grouped[r.partner].push(r);
  });

  const partnerListAll = Object.keys(grouped).sort();
  const partnerList = partnerListAll; // already filtered above when q present

  // Pivot: partner x location => count of POs at that location
  const pivot: Record<string, Record<string, number>> = {};
  const totalPoByPartner: Record<string, number> = {};
  partnerList.forEach(p => {
    pivot[p] = {};
    locationsUsed.forEach(l => { pivot[p][l] = 0; });
    let total = 0;
    grouped[p].forEach(r => {
      Object.entries(r.locCounts).forEach(([l, c]) => {
        pivot[p][l] = (pivot[p][l] || 0) + c;
      });
      total += r.count;
    });
    totalPoByPartner[p] = total;
  });

  // กรองเฉพาะจุดที่มี PO อยู่จริง (มีค่า > 0 ในอย่างน้อย 1 partner)
  const activeLocations = locationsUsed.filter(l =>
    partnerList.some(p => (pivot[p]?.[l] || 0) > 0)
  );

  const exportExcel = () => {
    const sheet1: any[] = [];
    partnerList.forEach(p => {
      const row: any = { Partner: p, "Total PO": totalPoByPartner[p] || 0 };
      locationsUsed.forEach(l => { row[l] = pivot[p][l] || ""; });
      sheet1.push(row);
    });

    const sheet2: any[] = [];
    partnerList.forEach(p => {
      grouped[p].forEach(r => {
        sheet2.push({
          Partner: p,
          Doc: r.doc.doc_name,
          "ผู้ฝาก": r.doc.depositor_name || "",
          "ผู้รับ": r.doc.receiver_name || "",
          "จุดปัจจุบัน": Object.entries(r.locCounts).map(([l, c]) => `${l}: ${c}`).join(" | "),
          "PO Count (Partner)": r.count,
          "Status": r.doc.status,
          "Created": r.doc.created_at ? new Date(r.doc.created_at).toLocaleString("th-TH") : "",
        });
      });
    });

    const sheet3: any[] = [];
    items.forEach(s => {
      (movementsByShipment[s.id] || []).slice().reverse().forEach((m, idx) => {
        sheet3.push({
          Doc: s.doc_name,
          ลำดับ: idx + 1,
          จุด: m.location_name,
          Action: ACTION_LABELS[m.action] || m.action,
          วันที่: new Date(m.created_at).toLocaleString("th-TH"),
          จำนวนสะแกน: (m.codes || []).length,
          หมายเหตุ: m.notes || "",
        });
      });
    });

    // Sheet 4: Detail PO — one row per PO across all docs (origin + extras)
    const sheet4: any[] = [];
    items.forEach(s => {
      const stMap = statusByShipmentCode[s.id] || {};
      const isFinalized = finalizedIds.has(s.id);
      (s.origin_codes || []).forEach(code => {
        const info = poInfoMap[code];
        sheet4.push({
          Doc: s.doc_name,
          "ผู้ฝาก": s.depositor_name || "",
          "ผู้รับ": s.receiver_name || "",
          "จุดปัจจุบัน": isFinalized ? "(สิ้นสุดแล้ว)" : (locByShipmentCode[s.id]?.[code] || s.origin_location || ""),
          "PO": code,
          "Partner": info?.partner || "",
          "Source": info?.source || "",
          "Document": info?.document || "",
          "Status": info?.status || "",
          "สถานะ PO": stMap[code] || "ขาด",
          "Total": info?.total ?? "",
          "Currency": info?.currency_name || "",
          "Delivery To 1": info?.delivery_to1 || "",
          "Delivery To 2": info?.delivery_to2 || "",
        });
      });
      // include extras (เกิน) — not in origin_codes
      (extraCodesByShipment[s.id] || []).forEach(({ code, loc }) => {
        const info = poInfoMap[code];
        sheet4.push({
          Doc: s.doc_name,
          "ผู้ฝาก": s.depositor_name || "",
          "ผู้รับ": s.receiver_name || "",
          "จุดปัจจุบัน": loc,
          "PO": code,
          "Partner": info?.partner || "",
          "Source": info?.source || "",
          "Document": info?.document || "",
          "Status": info?.status || "",
          "สถานะ PO": "เกิน",
          "Total": info?.total ?? "",
          "Currency": info?.currency_name || "",
          "Delivery To 1": info?.delivery_to1 || "",
          "Delivery To 2": info?.delivery_to2 || "",
        });
      });
    });


    const wb = XLSX.utils.book_new();
    // Pivot — explicit headers ensure all location columns appear
    const pivotHeaders = ["Partner", "Total PO", ...locationsUsed];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1, { header: pivotHeaders }), "Pivot");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), "Details");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet3), "Movements");
    // Detail PO — explicit headers (includes สถานะ PO and covers origin + extras)
    const detailHeaders = ["Doc", "ผู้ฝาก", "ผู้รับ", "จุดปัจจุบัน", "PO", "Partner", "Source", "Document", "Status", "สถานะ PO", "Total", "Currency", "Delivery To 1", "Delivery To 2"];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet4, { header: detailHeaders }), "Detail PO");

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `report-send-docs-${ts}.xlsx`);
    toast({ title: "Export สำเร็จ" });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {loading ? "กำลังโหลดข้อมูล PO..." : `${partnerList.length}${q ? `/${partnerListAll.length}` : ""} partner, ${items.length} doc, ${activeLocations.length} จุด`}
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา Doc / ผู้ฝาก / ผู้รับ / PO / Partner"
            className="h-9 text-sm"
          />
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>ล้าง</Button>
          )}
        </div>
        {canExport && (
          <Button onClick={exportExcel} disabled={partnerListAll.length === 0}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />Export Excel
          </Button>
        )}
      </div>
      <div className="border rounded overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="w-6 p-2"></th>
              <th className="text-left p-2">Partner</th>
              <th className="text-center p-2">Total PO</th>
              {activeLocations.map(l => (
                <th key={l} className="text-center p-2 whitespace-nowrap">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partnerList.length === 0 ? (
              <tr><td colSpan={3 + activeLocations.length} className="text-center p-6 text-muted-foreground">ไม่มีข้อมูล — กด "ดึงข้อมูล PO" ในแท็บฝากเอกสารก่อน</td></tr>
            ) : partnerList.map(p => {
              const isOpen = !!expanded[p];
              return (
                <FragmentRow key={p}>
                  <tr className="border-t hover:bg-muted/40">
                    <td className="p-2 text-center">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(e => ({ ...e, [p]: !isOpen }))}>
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                    </td>
                    <td className="p-2 font-medium">{p}</td>
                    <td className="p-2 text-center"><Badge variant="secondary">{totalPoByPartner[p] || 0}</Badge></td>
                    {activeLocations.map(l => (
                      <td key={l} className="p-2 text-center">
                        {pivot[p][l] > 0 ? <Badge>{pivot[p][l]}</Badge> : <span className="text-muted-foreground">-</span>}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={3 + activeLocations.length} className="p-3">
                        {/* ช่องค้นหาภายใน partner */}
                        <div className="mb-2 flex items-center gap-2">
                          <Input
                            value={partnerDocSearch[p] || ""}
                            onChange={e => setPartnerDocSearch(prev => ({ ...prev, [p]: e.target.value }))}
                            placeholder="ค้นหา Doc / ผู้ฝาก / ผู้รับ / PO..."
                            className="h-7 text-xs max-w-sm"
                          />
                          {partnerDocSearch[p] && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPartnerDocSearch(prev => ({ ...prev, [p]: "" }))}>ล้าง</Button>
                          )}
                        </div>
                        <div className="overflow-auto">
                        <table className="w-full text-xs border">
                          <thead className="bg-muted sticky top-0">
                            <tr>
                              <th className="p-1.5 border text-center">#</th>
                              <th className="p-1.5 border text-left">Doc</th>
                              <th className="p-1.5 border text-left">ผู้ฝาก</th>
                              <th className="p-1.5 border text-left">ผู้รับ</th>
                              <th className="p-1.5 border text-left">จุดปัจจุบัน</th>
                              <th className="p-1.5 border text-left">PO / Order Ref</th>
                              <th className="p-1.5 border text-left">Source</th>
                              <th className="p-1.5 border text-left">Document</th>
                              <th className="p-1.5 border text-left">Status</th>
                              <th className="p-1.5 border text-right">Total</th>
                              <th className="p-1.5 border text-left">Currency</th>
                              <th className="p-1.5 border text-left">Delivery To1</th>
                              <th className="p-1.5 border text-left">Delivery To2</th>
                              <th className="p-1.5 border text-center">จัดการ</th>
                              <th className="p-1.5 border text-left">ประวัติ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const sq = (partnerDocSearch[p] || "").toLowerCase();
                              const filteredRows = grouped[p].filter(r => {
                                if (!sq) return true;
                                return (
                                  r.doc.doc_name.toLowerCase().includes(sq) ||
                                  (r.doc.depositor_name || "").toLowerCase().includes(sq) ||
                                  (r.doc.receiver_name || "").toLowerCase().includes(sq) ||
                                  (r.doc.origin_codes || []).some(c => c.toLowerCase().includes(sq))
                                );
                              });
                              let rowIdx = 0;
                              return filteredRows.map((r) => {
                                const hist = (movementsByShipment[r.doc.id] || []).slice().reverse();
                                const isFin = finalizedIds.has(r.doc.id);
                                const partnerCodes = (r.doc.origin_codes || []).filter(c => (poInfoMap[c]?.partner || "(ไม่พบ Partner)") === p);
                                const rowSpan = Math.max(partnerCodes.length, 1);
                                const rowBg = isFin ? "bg-muted/60" : "";
                                if (partnerCodes.length === 0) {
                                  rowIdx++;
                                  return (
                                    <tr key={r.doc.id} className={rowBg}>
                                      <td className="p-1.5 border text-center text-muted-foreground">{rowIdx}</td>
                                      <td className="p-1.5 border font-mono whitespace-nowrap">
                                        {r.doc.doc_name}
                                        {isFin && <Badge className="ml-1 bg-slate-500">สิ้นสุดแล้ว</Badge>}
                                      </td>
                                      <td className="p-1.5 border">{r.doc.depositor_name || "-"}</td>
                                      <td className="p-1.5 border">{r.doc.receiver_name || "-"}</td>
                                      <td className="p-1.5 border">
                                        {isFin ? <span className="text-muted-foreground italic">(ตัดออกจากการนับ)</span> : (
                                          <div className="flex flex-wrap gap-1">
                                            {Object.entries(r.locCounts).map(([l, c]) => (
                                              <Badge key={l} variant="outline">{l}: {c}</Badge>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                      <td className="p-1.5 border text-muted-foreground italic" colSpan={8}>ไม่พบรายการ PO — กด "ดึงข้อมูล PO" ก่อน</td>
                                      <td className="p-1.5 border text-center">
                                        <Button size="sm" variant={isFin ? "outline" : "destructive"} className="h-6 text-[11px] px-2" onClick={() => toggleFinalize(r.doc.id, r.doc.doc_name)}>
                                          {isFin ? "ยกเลิกสิ้นสุด" : "สิ้นสุด"}
                                        </Button>
                                      </td>
                                      <td className="p-1.5 border text-[10px]">
                                        {hist.length === 0 ? "-" : hist.map((m, mi) => (
                                          <div key={m.id}>{mi + 1}. {ACTION_LABELS[m.action] || m.action} → <b>{m.location_name}</b> <span className="text-muted-foreground">({new Date(m.created_at).toLocaleString("th-TH")})</span></div>
                                        ))}
                                      </td>
                                    </tr>
                                  );
                                }
                                return partnerCodes.map((code, ci) => {
                                  const info = poInfoMap[code];
                                  const isFirst = ci === 0;
                                  rowIdx++;
                                  return (
                                    <tr key={r.doc.id + "_" + code} className={`${rowBg} ${!info ? "bg-amber-50" : ""}`}>
                                      {isFirst && (
                                        <>
                                          <td className="p-1.5 border text-center align-top text-muted-foreground" rowSpan={rowSpan}>{rowIdx}</td>
                                          <td className="p-1.5 border font-mono align-top whitespace-nowrap" rowSpan={rowSpan}>
                                            {r.doc.doc_name}
                                            {isFin && <Badge className="ml-1 bg-slate-500">สิ้นสุดแล้ว</Badge>}
                                          </td>
                                          <td className="p-1.5 border align-top" rowSpan={rowSpan}>{r.doc.depositor_name || "-"}</td>
                                          <td className="p-1.5 border align-top" rowSpan={rowSpan}>{r.doc.receiver_name || "-"}</td>
                                          <td className="p-1.5 border align-top" rowSpan={rowSpan}>
                                            {isFin ? <span className="text-muted-foreground italic">(ตัดออกจากการนับ)</span> : (
                                              <div className="flex flex-wrap gap-1">
                                                {Object.entries(r.locCounts).map(([l, c]) => (
                                                  <Badge key={l} variant="outline">{l}: {c}</Badge>
                                                ))}
                                              </div>
                                            )}
                                          </td>
                                        </>
                                      )}
                                      <td className="p-1.5 border font-mono">{code}</td>
                                      <td className="p-1.5 border">{info?.source || "-"}</td>
                                      <td className="p-1.5 border">{info?.document || "-"}</td>
                                      <td className="p-1.5 border">{info?.status || "-"}</td>
                                      <td className="p-1.5 border text-right">{info?.total != null ? Number(info.total).toLocaleString() : "-"}</td>
                                      <td className="p-1.5 border">{info?.currency_name || "-"}</td>
                                      <td className="p-1.5 border">{info?.delivery_to1 || "-"}</td>
                                      <td className="p-1.5 border">{info?.delivery_to2 || "-"}</td>
                                      {isFirst && (
                                        <>
                                          <td className="p-1.5 border text-center align-top" rowSpan={rowSpan}>
                                            <Button size="sm" variant={isFin ? "outline" : "destructive"} className="h-6 text-[11px] px-2" onClick={() => toggleFinalize(r.doc.id, r.doc.doc_name)}>
                                              {isFin ? "ยกเลิกสิ้นสุด" : "สิ้นสุด"}
                                            </Button>
                                          </td>
                                          <td className="p-1.5 border text-[10px] align-top" rowSpan={rowSpan}>
                                            {hist.length === 0 ? "-" : hist.map((m, mi) => (
                                              <div key={m.id}>{mi + 1}. {ACTION_LABELS[m.action] || m.action} → <b>{m.location_name}</b> <span className="text-muted-foreground">({new Date(m.created_at).toLocaleString("th-TH")})</span></div>
                                            ))}
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                });
                              });
                            })()}
                          </tbody>
                        </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============== Main Page ==============
export default function SRRSendDocsPage() {
  const { user, isAdmin, canDo } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  // ===== Finalized docs — derived from Supabase status field (shared across all users) =====
  const finalizedIds = new Set(items.filter(i => i.status === "finalized").map(i => i.id));
  const toggleFinalize = async (docId: string, docName: string) => {
    if (finalizedIds.has(docId)) {
      if (!window.confirm(`ยกเลิกสถานะ "สิ้นสุด" ของเอกสาร ${docName}?`)) return;
      const { error } = await supabase.from("document_shipments").update({ status: "pending" }).eq("id", docId);
      if (error) { toast({ title: "ยกเลิกไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
      toast({ title: "ยกเลิกสถานะสิ้นสุดแล้ว" });
    } else {
      if (!window.confirm(`ยืนยันสิ้นสุดการเดินเอกสาร ${docName}?\nจำนวน PO ที่จุดปัจจุบันของเอกสารนี้จะถูกตัดออกจากการนับ Report`)) return;
      const { error } = await supabase.from("document_shipments").update({ status: "finalized" }).eq("id", docId);
      if (error) { toast({ title: "บันทึกไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
      toast({ title: "สิ้นสุดการเดินเอกสารแล้ว" });
    }
    await load();
  };

  // create / edit dialog state
  const SCAN_DRAFT_KEY = "send_docs_scan_draft";
  const DEST_DRAFT_KEY = "send_docs_dest_draft";
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [depositorName, setDepositorName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [destinationLocation, setDestinationLocation] = useState("");
  const [originCodes, setOriginCodes] = useState<string[]>([]);

  // Draft: auto-save to localStorage whenever scan dialog state changes (only for new scans, not edits)
  useEffect(() => {
    if (!createOpen || editingId) return; // ไม่ draft ตอนแก้ไขของเดิม
    const draft = { depositorName, receiverName, originLocation, destinationLocation, originCodes };
    if (originCodes.length > 0 || depositorName || receiverName || originLocation || destinationLocation) {
      localStorage.setItem(SCAN_DRAFT_KEY, JSON.stringify(draft));
    }
  }, [depositorName, receiverName, originLocation, destinationLocation, originCodes, createOpen, editingId]);

  // Load draft on mount
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCAN_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if ((d.originCodes?.length ?? 0) > 0 || d.depositorName || d.originLocation) setHasDraft(true);
      }
    } catch { /* ignore */ }
  }, []);

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(SCAN_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      setEditingId(null);
      setDepositorName(d.depositorName || "");
      setReceiverName(d.receiverName || "");
      setOriginLocation(d.originLocation || "");
      setDestinationLocation(d.destinationLocation || "");
      setOriginCodes(d.originCodes || []);
      setCreateOpen(true);
      setHasDraft(false);
    } catch { /* ignore */ }
  };

  const clearDraft = () => {
    localStorage.removeItem(SCAN_DRAFT_KEY);
    setHasDraft(false);
  };

  // destination dialog state
  const [destOpen, setDestOpen] = useState(false);
  // Main tab in this page: "deposit" (list) | "scan" (สะแกนตรวจ — destination) | "report"
  const [mainTab, setMainTab] = useState<string>("deposit");
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  const [destCodes, setDestCodes] = useState<string[]>([]);
  const [destAction, setDestAction] = useState<string>("arrived");
  const [destLocation, setDestLocation] = useState<string>("");
  const [destNotes, setDestNotes] = useState<string>("");
  const [destDepositor, setDestDepositor] = useState<string>("");
  const [destReceiver, setDestReceiver] = useState<string>("");
  const [selectedDestTab, setSelectedDestTab] = useState(999);
  const [scanFullscreen, setScanFullscreen] = useState(false);
  // Post-arrival popup: appears after user saves "รับตรวจ" — ask ฝากต่อ or จบ
  const [arrivedPopupOpen, setArrivedPopupOpen] = useState(false);
  const [popupStep, setPopupStep] = useState<"choose" | "form">("choose");
  const [popupDepositor, setPopupDepositor] = useState("");
  const [popupReceiver, setPopupReceiver] = useState("");
  const [popupDestination, setPopupDestination] = useState("");
  const [isSavingHop, setIsSavingHop] = useState(false);
  // Per-column widths (px) for destination dialog — keyed by column index
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  // Per-column search filter
  const [colSearch, setColSearch] = useState<Record<number, string>>({});
  const [compareResult, setCompareResult] = useState<{
    matched: number; missing: string[]; extra: string[];
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ===== Dest scan draft: persist destCodes + state to localStorage =====
  const [hasDestDraft, setHasDestDraft] = useState(false);

  // Auto-save dest draft whenever user scans in the scan tab
  useEffect(() => {
    if (!activeShipment || mainTab !== "scan") return;
    if (destCodes.length === 0 && !destLocation && !destDepositor) return;
    const draft = {
      shipmentId: activeShipment.id,
      destCodes,
      destLocation,
      destDepositor,
      destReceiver,
      destNotes,
      destAction,
    };
    localStorage.setItem(DEST_DRAFT_KEY, JSON.stringify(draft));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destCodes, destLocation, destDepositor, destReceiver, destNotes, destAction, mainTab]);

  // Check for existing dest draft after items load
  useEffect(() => {
    if (loading) return;
    try {
      const raw = localStorage.getItem(DEST_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if ((d.destCodes?.length ?? 0) > 0 && d.shipmentId) {
        const shipExists = items.some(s => s.id === d.shipmentId);
        setHasDestDraft(shipExists);
      }
    } catch { /* ignore */ }
  }, [loading, items]);

  const restoreDestDraft = async () => {
    try {
      const raw = localStorage.getItem(DEST_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      const ship = items.find(s => s.id === d.shipmentId);
      if (!ship) {
        toast({ title: "ไม่พบเอกสารที่ค้างอยู่", description: "เอกสารอาจถูกลบหรือย้ายไปแล้ว", variant: "destructive" });
        clearDestDraft();
        return;
      }
      // Preload PO info only (same async part as openDestination, but without overwriting dest state)
      const allCodes = new Set<string>(ship.origin_codes || []);
      movements.filter(m => m.shipment_id === ship.id).forEach(m => (m.codes || []).forEach(c => allCodes.add(c)));
      const missingPo = Array.from(allCodes).filter(c => !poInfoMap[c]);
      if (missingPo.length > 0) {
        const map = await fetchPoInfo(missingPo);
        setPoInfoMap(prev => ({ ...prev, ...map }));
      }
      // Set all state from draft in one batch — do NOT call openDestination() which would overwrite destCodes
      setActiveShipment(ship);
      setDestCodes(d.destCodes || []);
      setDestLocation(d.destLocation || "");
      setDestDepositor(d.destDepositor || "");
      setDestReceiver(d.destReceiver || "");
      setDestNotes(d.destNotes || "");
      setDestAction(d.destAction || "arrived");
      setCompareResult(null);
      setDestOpen(true);
      setMainTab("scan");
      setHasDestDraft(false);
    } catch { /* ignore */ }
  };

  const clearDestDraft = () => {
    localStorage.removeItem(DEST_DRAFT_KEY);
    setHasDestDraft(false);
  };

  // ปิด Draft + จบล็อต: อ่าน shipmentId จาก draft → หาตำแหน่ง arrived ล่าสุด → update status matched/mismatch + insert closed
  const dismissDestDraft = async () => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(DEST_DRAFT_KEY);
      if (!raw) { clearDestDraft(); return; }
      const d = JSON.parse(raw);
      const ship = items.find(s => s.id === d.shipmentId);
      if (!ship) { clearDestDraft(); return; }

      const hist = movements
        .filter(m => m.shipment_id === ship.id)
        .slice()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const lastArrived = [...hist].reverse().find(m => m.action === "arrived");

      if (lastArrived) {
        const lastArrivedTime = new Date(lastArrived.created_at).getTime();
        const lastForward = hist
          .filter(m => m.action === "forward" && new Date(m.created_at).getTime() < lastArrivedTime)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        const incomingCodes = lastForward?.codes || ship.origin_codes || [];
        const arrivedSet = new Set(lastArrived.codes || []);
        const missVsIncoming = incomingCodes.filter(c => !arrivedSet.has(c)).length;
        const extraVsIncoming = (lastArrived.codes || []).filter(c => !new Set(incomingCodes).has(c)).length;
        await supabase.from("document_shipments").update({
          status: missVsIncoming === 0 && extraVsIncoming === 0 ? "matched" : "mismatch",
          compared_at: new Date().toISOString(),
        }).eq("id", ship.id);
        await supabase.from("document_movements" as any).insert({
          shipment_id: ship.id,
          location_name: lastArrived.location_name,
          action: "closed",
          codes: lastArrived.codes || [],
          user_id: user.id,
        });
        await load();
      }
      clearDestDraft();
    } catch { clearDestDraft(); }
  };

  // Adjust doc dialog state (เคลียร์เอกสารส่วนต่างจากจุด arrived ใดๆ ไปยังจุดอื่น)
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSource, setAdjustSource] = useState<{
    id: string; locationName: string; missing: string[]; extra: string[];
  } | null>(null);
  const [adjustSelected, setAdjustSelected] = useState<Set<string>>(new Set());
  const [adjustSearch, setAdjustSearch] = useState("");
  const [adjustTarget, setAdjustTarget] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Movements
  const [movements, setMovements] = useState<Movement[]>([]);

  // PO info enrichment (cache keyed by order_reference)
  const [poInfoMap, setPoInfoMap] = useState<Record<string, PoInfo>>({});
  const [fetchingPo, setFetchingPo] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Locations master
  const [locations, setLocations] = useState<DocLocation[]>([]);
  const [depositSearch, setDepositSearch] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocDesc, setNewLocDesc] = useState("");

  const loadLocations = async () => {
    const { data } = await supabase.from("document_locations" as any).select("*").order("name");
    setLocations((data as any) || []);
  };

  const addLocation = async () => {
    const name = newLocName.trim();
    if (!name) return;
    if (locations.some(l => l.name === name)) {
      toast({ title: "ชื่อซ้ำ", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("document_locations" as any).insert({
      name, description: newLocDesc.trim() || null, created_by: user?.id || null,
    });
    if (error) { toast({ title: "เพิ่มไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
    setNewLocName(""); setNewLocDesc("");
    loadLocations();
  };

  const deleteLocation = async (id: string) => {
    if (!confirm("ลบจุดนี้?")) return;
    const { error } = await supabase.from("document_locations" as any).delete().eq("id", id);
    if (error) { toast({ title: "ลบไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
    loadLocations();
  };

  const handleFetchPoForShipment = async (s: Shipment) => {
    setFetchingPo(true);
    try {
      const missing = (s.origin_codes || []).filter((c) => !poInfoMap[c]);
      if (missing.length > 0) {
        const map = await fetchPoInfo(missing);
        setPoInfoMap((prev) => ({ ...prev, ...map }));
        const found = Object.keys(map).length;
        toast({ title: "ดึงข้อมูล PO สำเร็จ", description: `พบ ${found}/${missing.length} รายการใน List PO` });
      }
      setExpandedId(s.id);
    } finally {
      setFetchingPo(false);
    }
  };

  const handlePrint = async (s: Shipment) => {
    // ensure data fetched
    const missing = (s.origin_codes || []).filter((c) => !poInfoMap[c]);
    let map = poInfoMap;
    if (missing.length > 0) {
      const fresh = await fetchPoInfo(missing);
      map = { ...poInfoMap, ...fresh };
      setPoInfoMap(map);
    }
    openPrintWindow(s, map);
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: mvData }] = await Promise.all([
      supabase.from("document_shipments").select("*").order("created_at", { ascending: false }),
      supabase.from("document_movements" as any).select("*").order("created_at", { ascending: false }),
    ]);
    if (error) toast({ title: "โหลดไม่สำเร็จ", description: error.message, variant: "destructive" });
    setItems((data as any) || []);
    setMovements((mvData as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); loadLocations(); }, []);

  // Auto-open scan tab if URL has ?send_docs_dest=<id> (opened in new tab from list)
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("send_docs_dest");
    if (!id) return;
    const s = items.find(x => x.id === id);
    if (!s) return;
    autoOpenedRef.current = true;
    openDestination(s);
    setMainTab("scan");
    const url = new URL(window.location.href);
    url.searchParams.delete("send_docs_dest");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items]);

  const resetCreate = () => {
    setEditingId(null);
    setDepositorName(""); setReceiverName(""); setOriginLocation(""); setDestinationLocation(""); setOriginCodes([]);
  };

  // ปิด dialog พร้อม confirm ถ้ายังมีรายการสแกนค้างอยู่
  const handleCloseCreate = () => {
    if (originCodes.length > 0 && !window.confirm(`มีรายการสแกนค้างอยู่ ${originCodes.length} รายการ\nต้องการออกโดยไม่บันทึกใช่ไหม?`)) return;
    clearDraft(); resetCreate(); setCreateOpen(false);
  };

  const openEdit = (s: Shipment) => {
    setEditingId(s.id);
    setDepositorName(s.depositor_name || "");
    setReceiverName(s.receiver_name || "");
    // Load originLocation from existing origin_save movement
    const origMv = movements.find(m => m.shipment_id === s.id && m.action === "origin_save");
    setOriginLocation(s.origin_location || origMv?.location_name || "");
    setDestinationLocation(s.destination_location || "");
    setOriginCodes(s.origin_codes || []);
    setCreateOpen(true);
  };

  const handleSaveDoc = async () => {
    if (!user) return;
    if (originCodes.length === 0) {
      toast({ title: "ยังไม่มีเอกสารที่สะแกน", variant: "destructive" });
      return;
    }
    if (!depositorName.trim() || !receiverName.trim() || !originLocation.trim() || !destinationLocation.trim()) {
      toast({ title: "กรุณากรอกข้อมูลให้ครบ", description: "ชื่อผู้ฝาก, ชื่อผู้รับ, จุดต้นทาง, จุดปลายทาง", variant: "destructive" });
      return;
    }
    if (editingId) {
      const { error } = await supabase.from("document_shipments").update({
        depositor_name: depositorName || null,
        receiver_name: receiverName || null,
        origin_location: originLocation.trim(),
        destination_location: destinationLocation.trim(),
        origin_codes: originCodes,
      }).eq("id", editingId);
      if (error) {
        toast({ title: "แก้ไขไม่สำเร็จ", description: error.message, variant: "destructive" });
        return;
      }
      // Upsert origin_save movement location
      const origMv = movements.find(m => m.shipment_id === editingId && m.action === "origin_save");
      if (origMv) {
        await supabase.from("document_movements" as any)
          .update({ location_name: originLocation.trim(), codes: originCodes })
          .eq("id", origMv.id);
      } else {
        await supabase.from("document_movements" as any).insert({
          shipment_id: editingId,
          location_name: originLocation.trim(),
          action: "origin_save",
          codes: originCodes,
          user_id: user.id,
        });
      }
      toast({ title: "แก้ไขเรียบร้อย" });
    } else {
      const { data: ins, error } = await supabase.from("document_shipments").insert({
        user_id: user.id,
        doc_name: nowDocName(),
        depositor_name: depositorName || null,
        receiver_name: receiverName || null,
        origin_location: originLocation.trim(),
        destination_location: destinationLocation.trim(),
        origin_codes: originCodes,
        status: "pending",
        origin_scanned_at: new Date().toISOString(),
      }).select("id").single();
      if (error) {
        toast({ title: "บันทึกไม่สำเร็จ", description: error.message, variant: "destructive" });
        return;
      }
      // Insert initial movement at chosen origin location
      if (ins?.id) {
        await supabase.from("document_movements" as any).insert({
          shipment_id: ins.id,
          location_name: originLocation.trim(),
          action: "origin_save",
          codes: originCodes,
          user_id: user.id,
        });
      }
      toast({ title: "บันทึกเรียบร้อย", description: `${originCodes.length} เอกสาร` });
    }
    clearDraft(); setCreateOpen(false); resetCreate(); load();
  };

  const openDestination = async (s: Shipment) => {
    const hist = movements
      .filter(m => m.shipment_id === s.id)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const hops = hist.filter(m => m.action !== "origin_save");
    const lastHop = hops[hops.length - 1];
    setActiveShipment(s);
    setDestCodes(lastHop?.action === "forward" ? [] : (s.destination_codes || []));
    setDestAction("arrived");
    setDestLocation(lastHop?.action === "forward" ? (lastHop.location_name || "") : (s.destination_location || lastHop?.location_name || ""));
    setDestNotes("");
    setDestDepositor(lastHop?.receiver_name || s.depositor_name || "");
    setDestReceiver(s.receiver_name || "");
    setCompareResult(null);
    setDestOpen(true);
    // Preload PO info for partner search in columns
    const allCodes = new Set<string>(s.origin_codes || []);
    movements.filter(m => m.shipment_id === s.id).forEach(m => (m.codes || []).forEach(c => allCodes.add(c)));
    const missing = Array.from(allCodes).filter(c => !poInfoMap[c]);
    if (missing.length > 0) {
      const map = await fetchPoInfo(missing);
      setPoInfoMap(prev => ({ ...prev, ...map }));
    }
  };

  const saveHop = async (action: string) => {
    if (!activeShipment || !user) return;
    if (isSavingHop) return;
    if (destCodes.length === 0) {
      toast({ title: "กรุณาสะแกนเอกสารก่อน", variant: "destructive" });
      return;
    }
    if (!destDepositor.trim() || !destReceiver.trim() || !destLocation.trim()) {
      toast({ title: "กรุณากรอกข้อมูลให้ครบ", description: "ชื่อผู้ฝาก, ชื่อผู้รับ, จุดปลายทาง", variant: "destructive" });
      return;
    }
    const originSet = new Set(activeShipment.origin_codes);
    const destSet = new Set(destCodes);
    const missing = [...originSet].filter((c) => !destSet.has(c));
    const extra = [...destSet].filter((c) => !originSet.has(c));
    const matched = activeShipment.origin_codes.length - missing.length;
    setCompareResult({ matched, missing, extra });

    const isClosed = action === "closed";
    // Doc status should mirror the per-hop "ครบ" badge in the scan tab,
    // which compares arrived codes against the *incoming* set (previous forward,
    // or origin if no forward yet) — not raw origin. This avoids the case where
    // every hop shows "ครบ" but the doc still reads "ไม่ครบ" due to extras/missing
    // propagated forward from earlier hops.
    const lastForward = movements
      .filter(m => m.shipment_id === activeShipment.id && m.action === "forward")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    const incomingCodes = lastForward?.codes || activeShipment.origin_codes || [];
    const incomingSet = new Set(incomingCodes);
    const missVsIncoming = incomingCodes.filter(c => !destSet.has(c)).length;
    const extraVsIncoming = destCodes.filter(c => !incomingSet.has(c)).length;

    setIsSavingHop(true);
    try {
      await supabase.from("document_shipments").update({
        destination_codes: destCodes,
        destination_location: destLocation.trim(),
        status: isClosed ? (missVsIncoming === 0 && extraVsIncoming === 0 ? "matched" : "mismatch") : "in_transit",
        compared_at: new Date().toISOString(),
        destination_scanned_at: new Date().toISOString(),
      }).eq("id", activeShipment.id);

      await supabase.from("document_movements" as any).insert({
        shipment_id: activeShipment.id,
        location_name: destLocation.trim(),
        action,
        codes: destCodes,
        notes: destNotes.trim() || null,
        depositor_name: destDepositor.trim(),
        receiver_name: destReceiver.trim(),
        user_id: user.id,
      });

      toast({ title: `บันทึก ${ACTION_LABELS[action] || action} แล้ว`, description: `จุด: ${destLocation}` });
      await load();

      if (isClosed) {
        clearDestDraft(); setDestOpen(false); setMainTab("deposit");
      } else {
        // After "arrived" save — show popup asking ฝากต่อ / จบ
        setPopupStep("choose");
        setPopupDepositor("");
        setPopupReceiver("");
        setPopupDestination("");
        setArrivedPopupOpen(true);
      }
    } finally {
      setIsSavingHop(false);
    }
  };

  // Called when user clicks "บันทึก" inside the popup form (after choosing ฝากต่อ).
  // Inserts forward movement carrying popup values; next column pre-fills them read-only.
  const forwardAfterArrived = async () => {
    if (!activeShipment || !user) return;
    if (isSavingHop) return;
    if (!popupDepositor.trim() || !popupReceiver.trim() || !popupDestination.trim()) {
      toast({ title: "กรุณากรอกข้อมูลให้ครบ", description: "ชื่อผู้ฝาก, ชื่อผู้รับ, จุดปลายทาง", variant: "destructive" });
      return;
    }
    const hist = movements
      .filter(m => m.shipment_id === activeShipment.id)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const hops = hist.filter(m => m.action !== "origin_save");
    const lastArrived = [...hops].reverse().find(m => m.action === "arrived");
    if (!lastArrived) return;
    // Forward set = เฉพาะ PO ที่สะแกนได้จริงที่จุดนี้ (ตรง + เกิน)
    // PO ที่ขาดไม่ต้องส่งต่อ — จุดถัดไปรับเฉพาะของที่มีอยู่จริงเท่านั้น
    const forwardCodes = [...(lastArrived.codes || [])];
    setIsSavingHop(true);
    try {
      await supabase.from("document_movements" as any).insert({
        shipment_id: activeShipment.id,
        location_name: popupDestination.trim(),
        action: "forward",
        codes: forwardCodes,
        depositor_name: popupDepositor.trim(),
        receiver_name: popupReceiver.trim(),
        user_id: user.id,
      });
      // Pre-fill the next active column with popup values (will render read-only)
      setDestCodes([]);
      setDestLocation(popupDestination.trim());
      setDestNotes("");
      setDestDepositor(popupDepositor.trim());
      setDestReceiver(popupReceiver.trim());
      setArrivedPopupOpen(false);
      await load();
    } finally {
      setIsSavingHop(false);
    }
  };

  const closeAfterArrived = async () => {
    if (!activeShipment || !user) return;
    const hist = movements
      .filter(m => m.shipment_id === activeShipment.id)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const hops = hist.filter(m => m.action !== "origin_save");
    const lastArrived = [...hops].reverse().find(m => m.action === "arrived");
    if (!lastArrived) return;
    const originSet = new Set(activeShipment.origin_codes);
    const codes = lastArrived.codes || [];
    const destSet = new Set(codes);
    const missing = [...originSet].filter((c) => !destSet.has(c));
    const extra = [...destSet].filter((c) => !originSet.has(c));
    // Mirror the per-hop "ครบ" badge: compare against incoming (last forward before
    // this arrived, or origin if none) instead of raw origin.
    const lastArrivedTime = new Date(lastArrived.created_at).getTime();
    const lastForward = hist
      .filter(m => m.action === "forward" && new Date(m.created_at).getTime() < lastArrivedTime)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    const incomingCodes = lastForward?.codes || activeShipment.origin_codes || [];
    const incomingSet = new Set(incomingCodes);
    const missVsIncoming = incomingCodes.filter(c => !destSet.has(c)).length;
    const extraVsIncoming = codes.filter(c => !incomingSet.has(c)).length;
    await supabase.from("document_shipments").update({
      status: missVsIncoming === 0 && extraVsIncoming === 0 ? "matched" : "mismatch",
      compared_at: new Date().toISOString(),
    }).eq("id", activeShipment.id);
    await supabase.from("document_movements" as any).insert({
      shipment_id: activeShipment.id,
      location_name: lastArrived.location_name,
      action: "closed",
      codes,
      user_id: user.id,
    });
    setArrivedPopupOpen(false);
    clearDestDraft(); setDestOpen(false); setMainTab("deposit");
    await load();
  };

  // Re-open scanner for the latest arrived hop — deletes that arrived movement
  // and pre-fills the active column with its values so user can rescan/edit.
  const rescanLastArrived = async () => {
    if (!activeShipment || !user) return;
    const hist = movements
      .filter(m => m.shipment_id === activeShipment.id)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const hops = hist.filter(m => m.action !== "origin_save");
    const lastArrived = [...hops].reverse().find(m => m.action === "arrived");
    if (!lastArrived) return;
    await supabase.from("document_movements" as any).delete().eq("id", lastArrived.id);
    setDestCodes(lastArrived.codes || []);
    setDestLocation(lastArrived.location_name || "");
    setDestDepositor(lastArrived.depositor_name || "");
    setDestReceiver(lastArrived.receiver_name || "");
    setDestNotes(lastArrived.notes || "");
    setArrivedPopupOpen(false);
    setCompareResult(null);
    toast({ title: "เปิดสะแกนตรวจอีกครั้ง", description: "แก้ไข/เพิ่มรายการแล้วกดบันทึกอีกครั้ง" });
    await load();
  };

  // Open Adjust doc dialog for a specific arrived hop
  const openAdjust = (hopId: string, hopLocationName: string, missing: string[], extra: string[]) => {
    setAdjustSource({ id: hopId, locationName: hopLocationName, missing, extra });
    setAdjustSelected(new Set());
    setAdjustSearch("");
    setAdjustTarget("");
    setAdjustOpen(true);
  };

  // Confirm adjust: write a "adjust" movement record. notes stores {from, from_id}
  const confirmAdjust = async () => {
    if (!activeShipment || !user || !adjustSource) return;
    if (!adjustTarget) { toast({ title: "เลือกจุดปลายทาง", variant: "destructive" }); return; }
    if (adjustSelected.size === 0) { toast({ title: "ติกเลือกเอกสารอย่างน้อย 1 ชุด", variant: "destructive" }); return; }
    // หมายเหตุ: อนุญาตให้เลือกจุดปัจจุบันได้ (กรณีลืมสะแกนแล้วเผลอจบล็อต)

    setAdjustSaving(true);
    const { error } = await supabase.from("document_movements" as any).insert({
      shipment_id: activeShipment.id,
      location_name: adjustTarget,
      action: "adjust",
      codes: Array.from(adjustSelected),
      notes: JSON.stringify({ type: "adjust", from: adjustSource.locationName, from_id: adjustSource.id }),
      user_id: user.id,
    });
    setAdjustSaving(false);
    if (error) { toast({ title: "บันทึกไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Adjust สำเร็จ", description: `ย้าย ${adjustSelected.size} ชุด → ${adjustTarget}` });
    setAdjustOpen(false);
    await load();
  };

  const downloadDiff = () => {
    if (!activeShipment) return;
    const missingSet = new Set(compareResult?.missing || []);
    const extraSet = new Set(compareResult?.extra || []);
    const origin = activeShipment.origin_codes || [];
    const rows: any[] = origin.map((code, idx) => {
      const p = poInfoMap[code];
      const status = missingSet.has(code) ? "MISSING (ฝากแต่ไม่ถึง)" : "OK";
      return {
        "#": idx + 1,
        "Order Reference": code,
        "Partner": p?.partner ?? "",
        "Source": p?.source ?? "",
        "Document": p?.document ?? "",
        "Status": p?.status ?? "",
        "Total": p?.total ?? "",
        "Currency/Name": p?.currency_name ?? "",
        "Delivery to1": p?.delivery_to1 ?? "",
        "Delivery to2": p?.delivery_to2 ?? "",
        "Diff Status": status,
      };
    });
    // Append extras (scanned but not in origin)
    let n = origin.length;
    extraSet.forEach((code) => {
      n += 1;
      const p = poInfoMap[code];
      rows.push({
        "#": n,
        "Order Reference": code,
        "Partner": p?.partner ?? "",
        "Source": p?.source ?? "",
        "Document": p?.document ?? "",
        "Status": p?.status ?? "",
        "Total": p?.total ?? "",
        "Currency/Name": p?.currency_name ?? "",
        "Delivery to1": p?.delivery_to1 ?? "",
        "Delivery to2": p?.delivery_to2 ?? "",
        "Diff Status": "EXTRA (เกิน/ไม่อยู่ในฝาก)",
      });
    });
    // Header-only fallback if no rows at all
    if (rows.length === 0) {
      rows.push({
        "#": "", "Order Reference": "", "Partner": "", "Source": "", "Document": "",
        "Status": "", "Total": "", "Currency/Name": "", "Delivery to1": "", "Delivery to2": "",
        "Diff Status": "",
      });
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PO Diff");
    XLSX.writeFile(wb, `${activeShipment.doc_name}_diff.xlsx`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("ลบเอกสารนี้?")) return;
    const { error } = await supabase.from("document_shipments").delete().eq("id", id);
    if (error) { toast({ title: "ลบไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    load();
  };

  const handleDeleteSelected = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!confirm(`ลบ ${ids.length} เอกสารที่เลือก?`)) return;
    const { error } = await supabase.from("document_shipments").delete().in("id", ids);
    if (error) { toast({ title: "ลบไม่สำเร็จ", description: error.message, variant: "destructive" }); return; }
    setSelectedIds(new Set());
    load();
  };

  // Export PO list (Ponumber / Partner / ยอดรวม) for a checkpoint column
  const exportColumnExcel = (codes: string[], colLabel: string, docName: string, statusMap?: Record<string, string>) => {
    if (!codes.length) { toast({ title: "ไม่มีรายการสำหรับ Export", variant: "destructive" }); return; }
    const rows: any[] = codes.map((c, i) => {
      const p = poInfoMap[c];
      const row: any = {
        "#": i + 1,
        "PO Number": c,
        "Partner": p?.partner || "",
        "ยอดรวม": p?.total != null ? Number(p.total) : 0,
        "Currency": p?.currency_name || "",
      };
      if (statusMap) row["สถานะสะแกน"] = statusMap[c] || "";
      return row;
    });
    const total = rows.reduce((s, r) => s + (Number(r["ยอดรวม"]) || 0), 0);
    const footer: any = { "#": "", "PO Number": "", "Partner": "รวมทั้งหมด", "ยอดรวม": total, "Currency": "" };
    if (statusMap) footer["สถานะสะแกน"] = "";
    rows.push(footer);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "POs");
    const safe = `${docName}_${colLabel}`.replace(/[\\/:*?"<>|]/g, "_");
    XLSX.writeFile(wb, `${safe}.xlsx`);
  };

  const getScrollEl = () => document.getElementById(SCROLL_CONTAINER_ID);
  const scrollToTop = () => { const el = getScrollEl(); if (el) el.scrollTo({ top: 0, behavior: "smooth" }); };
  const scrollToBottom = () => { const el = getScrollEl(); if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); };


  return (
    <div id={SCROLL_CONTAINER_ID} className="p-6 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ส่งเอกสาร</h1>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="deposit">ฝากเอกสาร</TabsTrigger>
          <TabsTrigger value="scan">สะแกนตรวจ</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-3 mt-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Button onClick={() => { resetCreate(); setCreateOpen(true); }}>
              <ScanLine className="w-4 h-4 mr-2" />Scan เอกสาร
            </Button>
            {hasDraft && (() => {
              try {
                const d = JSON.parse(localStorage.getItem(SCAN_DRAFT_KEY) || "{}");
                const count = d.originCodes?.length ?? 0;
                return (
                  <Button variant="outline" className="border-orange-400 text-orange-600 hover:bg-orange-50" onClick={restoreDraft}>
                    <ScanLine className="w-4 h-4 mr-2" />สแกนต่อ ({count} รายการค้างอยู่)
                  </Button>
                );
              } catch { return null; }
            })()}
            {hasDestDraft && (() => {
              try {
                const d = JSON.parse(localStorage.getItem(DEST_DRAFT_KEY) || "{}");
                const count = d.destCodes?.length ?? 0;
                const shipName = items.find(s => s.id === d.shipmentId)?.doc_name || "";
                return (
                  <div className="flex items-center border border-blue-400 rounded-md overflow-hidden">
                    <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors" onClick={restoreDestDraft}>
                      <Truck className="w-4 h-4" />สะแกนตรวจรับต่อ — {shipName} ({count} รายการ)
                    </button>
                    <button
                      className="px-2 py-1.5 text-blue-400 hover:text-red-500 hover:bg-red-50 border-l border-blue-400 transition-colors"
                      title="ปิด Draft (จบล็อต)"
                      onClick={async () => {
                        if (!window.confirm(`ปิด Draft และจบล็อต ${shipName}?\nระบบจะบันทึกสถานะ matched/mismatch จากการสะแกนล่าสุด`)) return;
                        await dismissDestDraft();
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              } catch { return null; }
            })()}
            <Button variant="outline" onClick={() => setLocOpen(true)}>
              <MapPin className="w-4 h-4 mr-2" />จุดรับส่งเอกสาร
            </Button>
            <div className="flex-1 min-w-[260px]">
              <Input
                value={depositSearch}
                onChange={(e) => setDepositSearch(e.target.value)}
                placeholder="ค้นหา Doc / ผู้ฝาก / ผู้รับ / เลข PO / Partner / จุดต้น-ปลายทาง-ปัจจุบัน"
                className="h-9"
              />
            </div>
            {depositSearch && (
              <Button variant="ghost" size="sm" onClick={() => setDepositSearch("")}>
                <X className="w-3.5 h-3.5 mr-1" />ล้าง
              </Button>
            )}
          </div>

          {isAdmin && selectedIds.size > 0 && (
            <div className="flex items-center gap-2 px-1 py-1.5">
              <span className="text-sm text-muted-foreground">เลือก {selectedIds.size} รายการ</span>
              <Button size="sm" variant="destructive" onClick={() => handleDeleteSelected([...selectedIds])}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />ลบที่เลือก ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>ยกเลิก</Button>
            </div>
          )}
          <div className="border rounded overflow-auto max-h-[calc(100vh-260px)]">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                {(() => {
                  const q = depositSearch.trim().toLowerCase();
                  const visibleIds = (!q ? items : items.filter((s) => {
                    if ((s.doc_name || "").toLowerCase().includes(q)) return true;
                    if ((s.depositor_name || "").toLowerCase().includes(q)) return true;
                    if ((s.receiver_name || "").toLowerCase().includes(q)) return true;
                    const codes = s.origin_codes || [];
                    if (codes.some(c => (c || "").toLowerCase().includes(q))) return true;
                    if (codes.some(c => (poInfoMap[c]?.partner || "").toLowerCase().includes(q))) return true;
                    // จุดต้นทาง / จุดปลายทาง
                    if ((s.origin_location || "").toLowerCase().includes(q)) return true;
                    if ((s.destination_location || "").toLowerCase().includes(q)) return true;
                    const mvs = movements.filter(m => m.shipment_id === s.id);
                    if (mvs.some(m => (m.depositor_name || "").toLowerCase().includes(q) || (m.receiver_name || "").toLowerCase().includes(q))) return true;
                    // ทุกจุดในเส้นทาง (รวมจุดปัจจุบัน)
                    if (mvs.some(m => (m.location_name || "").toLowerCase().includes(q))) return true;
                    return false;
                  })).map(s => s.id);
                  const allChecked = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
                  const someChecked = visibleIds.some(id => selectedIds.has(id));
                  return (
                    <tr>
                      <th className="w-8 p-2 text-center">
                        {isAdmin && (
                          <Checkbox
                            checked={allChecked}
                            ref={(el) => { if (el) (el as any).indeterminate = someChecked && !allChecked; }}
                            onCheckedChange={(checked) => {
                              setSelectedIds(prev => {
                                const s = new Set(prev);
                                if (checked) visibleIds.forEach(id => s.add(id));
                                else visibleIds.forEach(id => s.delete(id));
                                return s;
                              });
                            }}
                          />
                        )}
                      </th>
                      <th className="w-6 p-2"></th>
                      <th className="text-left p-2">Doc</th>
                      <th className="text-left p-2">ผู้ฝาก</th>
                      <th className="text-left p-2">ผู้รับปลายทาง</th>
                      <th className="text-center p-2">จำนวนฝาก</th>
                      <th className="text-center p-2">จำนวนถึง</th>
                      <th className="text-center p-2">สถานะ</th>
                      <th className="text-left p-2">วันที่เวลา สะแกนฝาก</th>
                      <th className="text-left p-2">วันที่เวลา สะแกนรับ</th>
                      <th className="text-right p-2">การจัดการ</th>
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  const q = depositSearch.trim().toLowerCase();
                  const filteredItems = !q ? items : items.filter((s) => {
                    if ((s.doc_name || "").toLowerCase().includes(q)) return true;
                    if ((s.depositor_name || "").toLowerCase().includes(q)) return true;
                    if ((s.receiver_name || "").toLowerCase().includes(q)) return true;
                    const codes = s.origin_codes || [];
                    if (codes.some(c => (c || "").toLowerCase().includes(q))) return true;
                    if (codes.some(c => (poInfoMap[c]?.partner || "").toLowerCase().includes(q))) return true;
                    // จุดต้นทาง / จุดปลายทาง
                    if ((s.origin_location || "").toLowerCase().includes(q)) return true;
                    if ((s.destination_location || "").toLowerCase().includes(q)) return true;
                    // also movements depositor/receiver
                    const mvs = movements.filter(m => m.shipment_id === s.id);
                    if (mvs.some(m => (m.depositor_name || "").toLowerCase().includes(q) || (m.receiver_name || "").toLowerCase().includes(q))) return true;
                    // ทุกจุดในเส้นทาง (รวมจุดปัจจุบัน)
                    if (mvs.some(m => (m.location_name || "").toLowerCase().includes(q))) return true;
                    return false;
                  });
                  if (loading) return <tr><td colSpan={11} className="text-center p-6 text-muted-foreground">กำลังโหลด...</td></tr>;
                  if (filteredItems.length === 0) return <tr><td colSpan={11} className="text-center p-6 text-muted-foreground">{q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีเอกสาร"}</td></tr>;
                  return filteredItems.map((s) => {
                  const originN = s.origin_codes?.length || 0;
                  const destN = s.destination_codes?.length || 0;
                  const status = s.status;
                  const fmt = (d: string | null) => d ? new Date(d).toLocaleString("th-TH") : "-";
                  const expanded = expandedId === s.id;
                  const docMvs = movements
                    .filter(m => m.shipment_id === s.id)
                    .slice()
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  const isClosed = docMvs.some(m => m.action === "closed");
                  // Recompute "ครบ" สำหรับสถานะ จบ — เทียบ scanned vs incoming ของ hop ปิดล็อตล่าสุด
                  // โดยหัก codes ที่ adjust ออกไปแล้ว (จุดเคลียร์เอกสาร) ออกจากทั้ง miss/extra
                  const adjustMvsForShipment = docMvs.filter(m => m.action === "adjust");
                  const hasAdjustments = adjustMvsForShipment.length > 0;
                  // ตรวจว่า origin PO ทุกรายการถูกจัดการแล้วหรือยัง
                  // (สะแกนในขั้นตอนใดก็ได้ ไม่ว่าจะเป็น arrived, closed, หรือ adjust)
                  const allHandledCodes = new Set<string>();
                  docMvs.forEach(m => {
                    if (m.action === "arrived" || m.action === "closed" || m.action === "adjust") {
                      (m.codes || []).forEach(c => allHandledCodes.add(c));
                    }
                  });
                  const allOriginAccountedFor = (s.origin_codes || []).every(c => allHandledCodes.has(c));
                  const lastMv = docMvs[docMvs.length - 1];
                  const currentLoc = lastMv?.location_name || s.depositor_name || "(ไม่ระบุ)";
                  const lastAction = lastMv?.action;
                  let statusText = "";
                  if (isClosed) {
                    statusText = `จบล็อตที่ ${currentLoc}`;
                  } else if (lastAction === "origin_save") {
                    statusText = `เริ่มฝากที่ ${currentLoc} — กำลังเดินทาง...`;
                  } else if (lastAction === "arrived") {
                    statusText = `ตรวจรับแล้วที่ ${currentLoc} — รอดำเนินการ`;
                  } else if (lastAction === "forward") {
                    statusText = `ฝากต่อจาก ${currentLoc} — กำลังเดินทางไปจุดถัดไป`;
                  } else {
                    statusText = `ที่ ${currentLoc}`;
                  }
                  const breadcrumb = [
                    docMvs.find(m => m.action === "origin_save")?.location_name || s.depositor_name || "?",
                    ...docMvs.filter(m => m.action !== "origin_save").map(m => m.location_name),
                  ];
                  const isSelected = selectedIds.has(s.id);
                  return (
                    <FragmentRow key={s.id}>
                    <tr
                      className={`border-t hover:bg-muted/40 cursor-pointer ${isSelected ? "bg-blue-50" : ""}`}
                      onClick={(e) => {
                        if (!isAdmin) return;
                        const tag = (e.target as HTMLElement).closest("button,a,input,label");
                        if (tag) return;
                        setSelectedIds(prev => {
                          const s2 = new Set(prev);
                          if (s2.has(s.id)) s2.delete(s.id); else s2.add(s.id);
                          return s2;
                        });
                      }}
                    >
                      <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                        {isAdmin && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => setSelectedIds(prev => {
                              const s2 = new Set(prev);
                              if (s2.has(s.id)) s2.delete(s.id); else s2.add(s.id);
                              return s2;
                            })}
                          />
                        )}
                      </td>
                      <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={() => setExpandedId(expanded ? null : s.id)}>
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                      </td>
                      <td className="p-2 font-mono">
                        <div>{s.doc_name}</div>
                        <div className="text-[10px] text-muted-foreground font-sans mt-0.5 flex flex-wrap items-center gap-1">
                          {breadcrumb.map((loc, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <ChevronRight className="w-3 h-3" />}
                              <span className={i === breadcrumb.length - 1 ? "font-semibold text-primary" : ""}>{loc}</span>
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-sans mt-0.5 italic">{statusText}</div>
                      </td>
                      <td className="p-2">{s.depositor_name || "-"}</td>
                      <td className="p-2">{s.receiver_name || "-"}</td>
                      <td className="p-2 text-center"><Badge variant="secondary">{originN}</Badge></td>
                      <td className="p-2 text-center">{destN > 0 ? <Badge variant="outline">{destN}</Badge> : "-"}</td>
                      <td className="p-2 text-center">
                        {isClosed
                          ? (allOriginAccountedFor
                              ? (hasAdjustments
                                  ? <Badge className="bg-violet-600 hover:bg-violet-600">จบ-เคลียร์แล้ว</Badge>
                                  : <Badge className="bg-emerald-600 hover:bg-emerald-600">จบ-ครบ</Badge>)
                              : (hasAdjustments
                                  ? <Badge className="bg-orange-600 hover:bg-orange-600">จบ-มีส่วนต่าง</Badge>
                                  : <Badge variant="destructive">จบ-ไม่ครบ</Badge>))
                          : lastAction === "forward"
                            ? <Badge className="bg-blue-600">กำลังเดินทาง</Badge>
                            : lastAction === "arrived"
                              ? <Badge className="bg-amber-500">รอดำเนินการ</Badge>
                              : <Badge variant="secondary">เริ่มฝาก</Badge>
                        }
                      </td>
                      <td className="p-2 whitespace-nowrap">{fmt(s.origin_scanned_at)}</td>
                      <td className="p-2 whitespace-nowrap">{fmt(s.destination_scanned_at)}</td>
                      <td className="p-2 text-right space-x-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={fetchingPo}
                              onClick={() => handleFetchPoForShipment(s)}>
                              <Database className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>ดึงข้อมูล PO</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handlePrint(s)}>
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>ปริ้นฟอร์ม</TooltipContent>
                        </Tooltip>
                        <Button size="sm" variant={isClosed ? "secondary" : "outline"} onClick={() => {
                          openDestination(s);
                          setMainTab("scan");
                        }}>
                          {isClosed
                            ? <><ChevronRight className="w-3.5 h-3.5 mr-1" />View</>
                            : <><Truck className="w-3.5 h-3.5 mr-1" />ถึงปลายทาง</>
                          }
                        </Button>
                        {(() => {
                          const isFin = finalizedIds.has(s.id);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant={isFin ? "outline" : "destructive"}
                                  onClick={() => toggleFinalize(s.id, s.doc_name)}
                                >
                                  {isFin ? "ยกเลิกสิ้นสุด" : "สิ้นสุด"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isFin ? "คืนสถานะให้นับ PO ตามปกติ" : "ตัด PO ของเอกสารนี้ออกจากการนับ Report"}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                        {isAdmin && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(s.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>ลบ (Admin)</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-muted/30">
                        <td colSpan={11} className="p-3">
                          <div className="text-xs font-semibold mb-2">รายละเอียด PO ({originN} รายการ) — กด "ดึงข้อมูล PO" เพื่อ Match ข้อมูลจาก List PO</div>
                          <div className="overflow-auto max-h-[60vh] border rounded">
                            <table className="w-full text-xs border">
                              <thead className="bg-muted sticky top-0 z-10">
                                <tr>
                                  <th className="p-1.5 border text-left">#</th>
                                  <th className="p-1.5 border text-left">Order Reference</th>
                                  <th className="p-1.5 border text-left">Partner</th>
                                  <th className="p-1.5 border text-left">Source</th>
                                  <th className="p-1.5 border text-left">Document</th>
                                  <th className="p-1.5 border text-left">Status</th>
                                  <th className="p-1.5 border text-right">Total</th>
                                  <th className="p-1.5 border text-left">Currency/Name</th>
                                  <th className="p-1.5 border text-left">Delivery to1</th>
                                  <th className="p-1.5 border text-left">Delivery to2</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(s.origin_codes || []).map((c, i) => {
                                  const p = poInfoMap[c];
                                  const noMatch = !p;
                                  return (
                                    <tr key={c} className={noMatch ? "bg-amber-50" : ""}>
                                      <td className="p-1.5 border">{i + 1}</td>
                                      <td className="p-1.5 border font-mono">{c}</td>
                                      <td className="p-1.5 border">{p?.partner || (noMatch ? <span className="text-amber-700">ไม่พบใน List PO</span> : "-")}</td>
                                      <td className="p-1.5 border">{p?.source || "-"}</td>
                                      <td className="p-1.5 border">{p?.document || "-"}</td>
                                      <td className="p-1.5 border">{p?.status || "-"}</td>
                                      <td className="p-1.5 border text-right">{p?.total != null ? Number(p.total).toLocaleString() : "-"}</td>
                                      <td className="p-1.5 border">{p?.currency_name || "-"}</td>
                                      <td className="p-1.5 border">{p?.delivery_to1 || "-"}</td>
                                      <td className="p-1.5 border">{p?.delivery_to2 || "-"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                    </FragmentRow>
                  );
                });
                })()}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="scan" className="mt-3">
          {!activeShipment && (
            <div className="space-y-3">
              {hasDestDraft && (() => {
                try {
                  const d = JSON.parse(localStorage.getItem(DEST_DRAFT_KEY) || "{}");
                  const count = d.destCodes?.length ?? 0;
                  const shipName = items.find(s => s.id === d.shipmentId)?.doc_name || d.shipmentId;
                  return (
                    <div className="p-4 border border-orange-300 rounded-lg bg-orange-50 flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <div className="font-semibold text-orange-700">มีรายการสะแกนตรวจรับค้างอยู่</div>
                        <div className="text-orange-600 text-xs mt-0.5">เอกสาร: <b>{shipName}</b> — สะแกนไปแล้ว <b>{count}</b> รายการ</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="outline" className="border-orange-400 text-orange-600 hover:bg-orange-100 h-8 text-sm" onClick={restoreDestDraft}>
                          <ScanLine className="w-4 h-4 mr-1" />สะแกนต่อ
                        </Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground h-8" onClick={() => { if (window.confirm(`ยืนยันล้างรายการสะแกนค้างอยู่ ${count} รายการ?`)) clearDestDraft(); }}>
                          ล้าง
                        </Button>
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
              <div className="text-sm text-muted-foreground p-6 border rounded-lg bg-card text-center">
                ยังไม่ได้เลือก shipment — กลับไปแท็บ <b>ฝากเอกสาร</b> แล้วกดปุ่ม <b>"ถึงปลายทาง"</b> ที่รายการที่ต้องการ
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="report" className="mt-3">
          <ReportTab canExport={canDo("srr_send_docs", "export")} items={items} movements={movements} poInfoMap={poInfoMap} finalizedIds={finalizedIds} toggleFinalize={toggleFinalize} ensurePoInfo={async () => {
            const allCodes = Array.from(new Set(items.flatMap(i => i.origin_codes || [])));
            const missing = allCodes.filter(c => !poInfoMap[c]);
            if (missing.length > 0) {
              const map = await fetchPoInfo(missing);
              setPoInfoMap(prev => ({ ...prev, ...map }));
            }
          }} />
        </TabsContent>
      </Tabs>

      {/* Locations Dialog */}
      <Dialog open={locOpen} onOpenChange={setLocOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>จุดรับส่งเอกสาร</DialogTitle>
            <DialogDescription>เพิ่ม/ลบ จุดที่ใช้เป็น dropdown ตอน Scan เอกสาร</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input placeholder="ชื่อจุด (เช่น สาขา A)" value={newLocName} onChange={(e) => setNewLocName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addLocation(); }} />
              <Input placeholder="รายละเอียด (optional)" value={newLocDesc} onChange={(e) => setNewLocDesc(e.target.value)} />
              <Button onClick={addLocation}><Plus className="w-4 h-4" /></Button>
            </div>
            <ScrollArea className="h-72 border rounded">
              {locations.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">ยังไม่มีจุด</div>
              ) : (
                <ul className="divide-y">
                  {locations.map(l => (
                    <li key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">{l.name}</div>
                        {l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}
                      </div>
                      {isAdmin && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteLocation(l.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (open) setCreateOpen(true); else handleCloseCreate(); }}>
        <DialogContent
          className="max-w-2xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editingId ? "แก้ไขเอกสารฝาก" : "Scan เอกสารฝาก"}</DialogTitle>
            <DialogDescription>สะแกน QR Code เลขที่ PO — ตรวจสอบเลขซ้ำอัตโนมัติ</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>ชื่อผู้ฝาก <span className="text-destructive">*</span></Label>
              <Input value={depositorName} onChange={(e) => setDepositorName(e.target.value)} placeholder="พิมพ์ชื่อผู้ฝาก" />
            </div>
            <div>
              <Label>ชื่อผู้รับ <span className="text-destructive">*</span></Label>
              <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="พิมพ์ชื่อผู้รับ" />
            </div>
            <div>
              <Label>จุดต้นทาง <span className="text-destructive">*</span></Label>
              <LocationCombobox value={originLocation} onChange={setOriginLocation} options={locations} placeholder="เลือกจุดต้นทาง..." />
            </div>
            <div>
              <Label>จุดปลายทาง <span className="text-destructive">*</span></Label>
              <LocationCombobox value={destinationLocation} onChange={setDestinationLocation} options={locations} placeholder="เลือกจุดปลายทาง..." />
            </div>
          </div>
          <ScannerPanel codes={originCodes} setCodes={setOriginCodes} onCheckConflict={(code) => {
            for (const s of items) {
              if (s.id === editingId) continue;
              if (s.status === "finalized") continue;
              if ((s.origin_codes || []).includes(code)) {
                const mvs = movements.filter(m => m.shipment_id === s.id)
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                const location = mvs[0]?.location_name || s.origin_location || "(ไม่ระบุจุด)";
                return { code, docName: s.doc_name, location };
              }
            }
            return null;
          }} />
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseCreate}>ยกเลิก</Button>
            <Button onClick={handleSaveDoc}><Save className="w-4 h-4 mr-1" />{editingId ? "บันทึกการแก้ไข" : `Save เป็น Doc (${originCodes.length})`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-arrival popup — after user saves "รับตรวจ", ask whether to forward or end */}
      <Dialog open={arrivedPopupOpen} onOpenChange={setArrivedPopupOpen}>
        <DialogContent className="max-w-md" style={{ zIndex: 60000 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              บันทึกรับตรวจเรียบร้อย
            </DialogTitle>
            <DialogDescription>
              {popupStep === "choose"
                ? "เลือกการดำเนินการถัดไปสำหรับล็อตเอกสารนี้"
                : "กรอกข้อมูลผู้ฝากต่อและจุดปลายทางถัดไป"}
            </DialogDescription>
          </DialogHeader>

          {/* Diff summary + download (always available after arrived) */}
          {compareResult && (
            <div className={`p-2 rounded border text-xs ${compareResult.missing.length === 0 && compareResult.extra.length === 0 ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {compareResult.missing.length === 0 && compareResult.extra.length === 0
                    ? "ครบทุกชุด"
                    : `ขาด ${compareResult.missing.length}${compareResult.extra.length > 0 ? `, เกิน ${compareResult.extra.length}` : ""}`}
                </span>
                {isAdmin && (
                  <Button size="sm" variant="outline" className="h-7" onClick={downloadDiff}>
                    <Download className="w-3.5 h-3.5 mr-1" />ดาวน์โหลด list ส่วนต่าง
                  </Button>
                )}
              </div>
            </div>
          )}

          {popupStep === "choose" ? (
            <div className="flex flex-col gap-2 py-2">
              <Button onClick={() => {
                // Pre-fill defaults: depositor = receiver of just-arrived (handoff), origin auto
                const hist = movements.filter(m => m.shipment_id === activeShipment?.id)
                  .slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                const lastArrived = [...hist].reverse().find(m => m.action === "arrived");
                setPopupDepositor(lastArrived?.receiver_name || "");
                setPopupReceiver("");
                setPopupDestination("");
                setPopupStep("form");
              }}>
                <Truck className="w-4 h-4 mr-1" />ฝากต่อ (เลือกจุดปลายทางถัดไป)
              </Button>
              <Button variant="destructive" onClick={() => { if (window.confirm("ยืนยันการจบล็อตเอกสารนี้?")) closeAfterArrived(); }}>
                <Save className="w-4 h-4 mr-1" />จบล็อตนี้
              </Button>
            </div>
          ) : (
            <div className="space-y-2 py-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">ชื่อผู้ฝาก <span className="text-destructive">*</span></Label>
                  <Input className="h-8 text-xs" value={popupDepositor} onChange={(e) => setPopupDepositor(e.target.value)} placeholder="พิมพ์ชื่อผู้ฝาก" />
                </div>
                <div>
                  <Label className="text-xs">ชื่อผู้รับ <span className="text-destructive">*</span></Label>
                  <Input className="h-8 text-xs" value={popupReceiver} onChange={(e) => setPopupReceiver(e.target.value)} placeholder="พิมพ์ชื่อผู้รับ" />
                </div>
                <div>
                  <Label className="text-xs">จุดต้นทาง</Label>
                  <Input
                    className="h-8 text-xs bg-muted"
                    readOnly
                    value={(() => {
                      const hist = movements.filter(m => m.shipment_id === activeShipment?.id)
                        .slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                      const lastArrived = [...hist].reverse().find(m => m.action === "arrived");
                      return lastArrived?.location_name || activeShipment?.origin_location || "";
                    })()}
                  />
                </div>
                <div>
                  <Label className="text-xs">จุดปลายทาง <span className="text-destructive">*</span></Label>
                  <LocationCombobox value={popupDestination} onChange={setPopupDestination} options={locations} placeholder="เลือกจุด..." />
                </div>
              </div>
              <DialogFooter className="gap-1 pt-1">
                <Button variant="outline" size="sm" onClick={() => setPopupStep("choose")}>ย้อนกลับ</Button>
                <Button size="sm" onClick={forwardAfterArrived} disabled={isSavingHop}>
                  <Save className="w-4 h-4 mr-1" />{isSavingHop ? "กำลังบันทึก..." : "Save"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* สะแกนตรวจ — 2-panel redesign */}
      {mainTab === "scan" && activeShipment && (() => {
        // hist sorted ASC (oldest first)
        const hist = movements
          .filter(m => m.shipment_id === activeShipment.id)
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const originMv = hist.find(m => m.action === "origin_save");
        const adjustMvs = hist.filter(m => m.action === "adjust");
        const allHops = hist.filter(m => m.action !== "origin_save" && m.action !== "adjust");
        const visibleHops = allHops.filter(m => m.action === "arrived");
        const isClosed = allHops.some(m => m.action === "closed");
        const lastHop = allHops[allHops.length - 1];

        const adjustedOutFrom = (hopId: string): Set<string> => {
          const out = new Set<string>();
          for (const a of adjustMvs) {
            try {
              const meta = a.notes ? JSON.parse(a.notes) : null;
              if (meta?.from_id === hopId) (a.codes || []).forEach(c => out.add(c));
            } catch {}
          }
          return out;
        };

        const showActiveDest = !isClosed && (lastHop?.action !== "arrived");
        const canEditNextDestination = !lastHop || lastHop.action === "forward";
        const expectedAtThisHop = lastHop?.action === "forward" ? (lastHop.codes || []) : (activeShipment.origin_codes || []);

        // Tab layout: [0=ต้นทาง, 1=ปลายทาง 1, ..., N=active]
        const totalTabs = 1 + visibleHops.length + (showActiveDest ? 1 : 0);
        const currentTab = Math.min(Math.max(0, selectedDestTab), Math.max(0, totalTabs - 1));
        const isOriginTab = currentTab === 0;
        const isActiveTab = showActiveDest && currentTab === totalTabs - 1;
        const hopIdx = currentTab - 1;
        const selectedHop = (!isOriginTab && !isActiveTab && hopIdx >= 0 && hopIdx < visibleHops.length) ? visibleHops[hopIdx] : null;

        type S = "ตรง" | "ขาด" | "เกิน";
        const statusBadgeCls = (s: S) =>
          s === "ตรง" ? "bg-emerald-600 hover:bg-emerald-600 text-white" :
          s === "ขาด" ? "bg-red-600 hover:bg-red-600 text-white" :
                        "bg-orange-500 hover:bg-orange-500 text-white";

        const buildStatusMap = (expected: string[], scanned: string[]): Record<string, S> => {
          const scannedSet = new Set(scanned);
          const expectedSet = new Set(expected);
          const map: Record<string, S> = {};
          expected.forEach(c => { map[c] = scannedSet.has(c) ? "ตรง" : "ขาด"; });
          scanned.filter(c => !expectedSet.has(c)).forEach(c => { map[c] = "เกิน"; });
          return map;
        };

        type PORow = { code: string; status: S };
        const getLeftPOs = (): PORow[] => {
          if (isOriginTab) {
            // Compare each origin PO against union of all scanned codes across every arrived destination
            const allScannedCodes = new Set(visibleHops.flatMap(h => h.codes || []));
            return (activeShipment.origin_codes || []).map(c => ({
              code: c,
              status: (allScannedCodes.has(c) ? "ตรง" : "ขาด") as S,
            }));
          }
          if (isActiveTab) {
            const scannedSet = new Set(destCodes);
            const expectedSet = new Set(expectedAtThisHop);
            const extras = destCodes.filter(c => !expectedSet.has(c));
            return [
              ...expectedAtThisHop.map(c => ({ code: c, status: (scannedSet.has(c) ? "ตรง" : "ขาด") as S })),
              ...extras.map(c => ({ code: c, status: "เกิน" as S })),
            ];
          }
          if (selectedHop) {
            const myIdx = allHops.findIndex(h => h.id === selectedHop.id);
            let incoming: string[] = activeShipment.origin_codes || [];
            for (let k = myIdx - 1; k >= 0; k--) {
              if (allHops[k].action === "forward") { incoming = allHops[k].codes || []; break; }
            }
            const incomingSet = new Set(incoming);
            const arrivedSet = new Set(selectedHop.codes || []);
            const adjustedOut = adjustedOutFrom(selectedHop.id);
            const extras = (selectedHop.codes || []).filter(c => !incomingSet.has(c) && !adjustedOut.has(c));
            return [
              ...incoming.filter(c => !adjustedOut.has(c)).map(c => ({ code: c, status: (arrivedSet.has(c) ? "ตรง" : "ขาด") as S })),
              ...extras.map(c => ({ code: c, status: "เกิน" as S })),
            ];
          }
          return [];
        };
        const leftPOs = getLeftPOs();
        const leftTrong = leftPOs.filter(x => x.status === "ตรง").length;
        const leftKhad = leftPOs.filter(x => x.status === "ขาด").length;
        const leftGern = leftPOs.filter(x => x.status === "เกิน").length;
        // Show status badges only when there's at least 1 scan for the current tab
        const leftShowBadges =
          isOriginTab ? visibleHops.some(h => (h.codes || []).length > 0)
          : isActiveTab ? destCodes.length > 0
          : (selectedHop?.codes || []).length > 0;

        const afterForward = lastHop?.action === "forward";
        const activeDepositor = afterForward ? (lastHop?.depositor_name || destDepositor) : destDepositor;
        const activeReceiver = afterForward ? (lastHop?.receiver_name || destReceiver) : destReceiver;
        const activeDestLocation = afterForward ? (lastHop?.location_name || destLocation) : destLocation;
        const activeOriginLoc = (() => {
          const prevArrived = [...allHops].reverse().find(h => h.action === "arrived");
          return prevArrived?.location_name || activeShipment.origin_location || originMv?.location_name || "";
        })();

        // Tab location names helper
        const getTabLocName = (i: number): string => {
          if (i === 0) return activeShipment.origin_location || originMv?.location_name || "";
          if (showActiveDest && i === totalTabs - 1) return activeDestLocation || destLocation || "";
          return visibleHops[i - 1]?.location_name || "";
        };

        const scanContent = (
          <div
            className={scanFullscreen ? "flex flex-col overflow-hidden p-3 gap-3 bg-background" : "mt-3 border rounded-lg bg-card p-3"}
            style={scanFullscreen ? { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 50000 } : undefined}
          >
            <div className={`flex items-center justify-between gap-3 ${scanFullscreen ? "shrink-0" : "mb-3"}`}>
              <div>
                <h2 className="text-base font-semibold">บันทึกจุดเอกสาร — {activeShipment.doc_name}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">เลือก tab เพื่อดูสถานะแต่ละจุด — แท็บขวาสุดคือจุดปัจจุบัน (active)</p>
              </div>
              <div className="flex items-center gap-2">
                {/* ปุ่มสแกนเพิ่ม: ใช้ได้เฉพาะตอนที่ต้นทางบันทึกแล้ว แต่ยังไม่มี arrived movement */}
                {(() => {
                  const hasArrived = movements.some(m => m.shipment_id === activeShipment.id && m.action === "arrived");
                  const isFinalized = activeShipment.status === "finalized";
                  const canAddMore = !hasArrived && !isFinalized;
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className={canAddMore ? "border-blue-400 text-blue-600 hover:bg-blue-50" : ""}
                      disabled={!canAddMore}
                      title={!canAddMore ? "ปลายทางสแกนรับแล้ว ไม่สามารถเพิ่มได้" : "เพิ่มรายการสแกนเข้าเอกสารนี้"}
                      onClick={() => openEdit(activeShipment)}
                    >
                      <ScanLine className="w-4 h-4 mr-1" />สแกนเพิ่ม
                    </Button>
                  );
                })()}
                <Button variant="outline" size="sm" onClick={() => setScanFullscreen(f => !f)}>
                  {scanFullscreen ? <><Minimize2 className="w-4 h-4 mr-1" />ย่อคืน</> : <><Maximize2 className="w-4 h-4 mr-1" />Expand</>}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMainTab("deposit")}>กลับไปรายการ</Button>
              </div>
            </div>

            <div className={`flex gap-3 ${scanFullscreen ? "flex-1 min-h-0" : ""}`} style={!scanFullscreen ? { minHeight: 560 } : undefined}>

              {/* ===== LEFT: PO Status List ===== */}
              <div className={`w-[200px] shrink-0 border rounded-lg flex flex-col ${scanFullscreen ? "min-h-0 overflow-hidden" : ""}`}>
                <div className="p-2 bg-muted border-b rounded-t-lg shrink-0">
                  <div className="text-xs font-semibold">
                    {isOriginTab ? "ต้นทาง" : isActiveTab ? `ปลายทาง ${currentTab} (active)` : `ปลายทาง ${currentTab}`}
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-[10px] mt-0.5">
                    <span className="text-muted-foreground">{leftPOs.length} รายการ</span>
                    {leftShowBadges && leftTrong > 0 && <span className="text-emerald-700 font-medium">{leftTrong} ตรง</span>}
                    {leftShowBadges && leftKhad > 0 && <span className="text-red-700 font-medium">{leftKhad} ขาด</span>}
                    {leftShowBadges && leftGern > 0 && <span className="text-orange-700 font-medium">{leftGern} เกิน</span>}
                  </div>
                </div>
                <ScrollArea className="flex-1" style={!scanFullscreen ? { maxHeight: 500 } : undefined}>
                  {leftPOs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">ยังไม่มีรายการ</div>
                  ) : (
                    <ul className="divide-y text-[11px]">
                      {leftPOs.map(({ code, status }, i) => (
                        <li key={code + i} className="px-2 py-1 flex items-center gap-1">
                          <span className="font-mono text-[10px] truncate flex-1 min-w-0">{i + 1}. {code}</span>
                          {leftShowBadges && <Badge className={`${statusBadgeCls(status)} text-[9px] px-1 py-0 shrink-0`}>{status}</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </div>

              {/* ===== RIGHT: Tab bar + Content ===== */}
              <div className={`flex-1 flex flex-col min-w-0 ${scanFullscreen ? "min-h-0" : ""}`}>

                {/* Tab bar */}
                <div className="flex gap-1 flex-wrap border-b pb-2 mb-3 shrink-0">
                  {Array.from({ length: totalTabs }, (_, i) => {
                    const isOrigin = i === 0;
                    const isScanTab = showActiveDest && i === totalTabs - 1;
                    const baseLabel = isOrigin ? "ต้นทาง" : `ปลายทาง ${i}`;
                    const locName = getTabLocName(i);
                    return (
                      <Button key={i} size="sm" variant={currentTab === i ? "default" : "outline"} className="h-auto py-1 text-xs gap-1 max-w-[180px]" onClick={() => setSelectedDestTab(i)}>
                        <span className="flex flex-col items-start leading-tight min-w-0">
                          <span className="truncate w-full">{baseLabel}{locName ? `: ${locName}` : ""}</span>
                        </span>
                        {!isOrigin && !isScanTab && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
                        {isScanTab && <span className="text-[9px] opacity-70 shrink-0">active</span>}
                      </Button>
                    );
                  })}
                </div>

                {/* Tab content */}
                <div className={`overflow-y-auto space-y-3 pr-1 ${scanFullscreen ? "flex-1 min-h-0" : "flex-1"}`}>

                  {/* ── ต้นทาง tab ── */}
                  {isOriginTab && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">ผู้ฝาก</Label>
                          <Input className="h-8 text-xs bg-muted" value={activeShipment.depositor_name || "-"} readOnly />
                        </div>
                        <div>
                          <Label className="text-xs">ผู้รับปลายทาง</Label>
                          <Input className="h-8 text-xs bg-muted" value={activeShipment.receiver_name || "-"} readOnly />
                        </div>
                        <div>
                          <Label className="text-xs">จุดต้นทาง</Label>
                          <Input className="h-8 text-xs bg-muted" value={activeShipment.origin_location || originMv?.location_name || "-"} readOnly />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>เอกสารทั้งหมด {activeShipment.origin_codes.length} ชุด</span>
                        {originMv && <span>{new Date(originMv.created_at).toLocaleString("th-TH")}</span>}
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 ml-auto" onClick={() => {
                          const sMap = buildStatusMap(activeShipment.origin_codes || [], visibleHops[0]?.codes || []);
                          exportColumnExcel(activeShipment.origin_codes || [], `ต้นทาง_${activeShipment.origin_location || ""}`, activeShipment.doc_name, sMap);
                        }}>
                          <FileSpreadsheet className="w-3 h-3 mr-1" />Export Excel
                        </Button>
                      </div>
                      <div className="border rounded">
                        <div className="px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground border-b">{activeShipment.origin_codes.length} ชุด</div>
                        <ScrollArea className="h-72">
                          <ul className="divide-y text-xs">
                            {activeShipment.origin_codes.map((c, i) => {
                              const s = leftPOs[i]?.status ?? "ขาด";
                              return (
                                <li key={c} className="px-2 py-1.5 font-mono">
                                  <div className="flex items-center justify-between gap-1">
                                    <span>{i + 1}. {c}</span>
                                    <Badge className={`${statusBadgeCls(s)} text-[9px] px-1 py-0`}>{s}</Badge>
                                  </div>
                                  {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                                </li>
                              );
                            })}
                          </ul>
                        </ScrollArea>
                      </div>
                      <AttachmentPanel
                        movementId={originMv?.id || null}
                        url={originMv?.attachment_url || null}
                        uploadedBy={originMv?.attachment_uploaded_by || null}
                        onChange={(newUrl, newUploader) => {
                          if (!originMv) return;
                          setMovements(prev => prev.map(x => x.id === originMv.id ? { ...x, attachment_url: newUrl, attachment_uploaded_by: newUploader ?? null } : x));
                        }}
                      />
                    </>
                  )}

                  {/* ── Completed hop tab ── */}
                  {selectedHop && (() => {
                    const hop = selectedHop;
                    const myIdx = allHops.findIndex(h => h.id === hop.id);
                    let incoming: string[] = activeShipment.origin_codes || [];
                    for (let k = myIdx - 1; k >= 0; k--) {
                      if (allHops[k].action === "forward") { incoming = allHops[k].codes || []; break; }
                    }
                    const incomingSet = new Set(incoming);
                    const arrivedSet = new Set(hop.codes || []);
                    const adjustedOut = adjustedOutFrom(hop.id);
                    const missingArrAll = incoming.filter(c => !arrivedSet.has(c) && !adjustedOut.has(c));
                    const extraArrAll = (hop.codes || []).filter(c => !incomingSet.has(c) && !adjustedOut.has(c));
                    const isFull = missingArrAll.length === 0 && extraArrAll.length === 0;
                    const isLastCompletedHop = hop.id === lastHop?.id && lastHop?.action === "arrived" && !isClosed;
                    const allDisplayCodes = [...incoming.filter(c => !adjustedOut.has(c)), ...extraArrAll];
                    const sMap = buildStatusMap(incoming.filter(c => !adjustedOut.has(c)), (hop.codes || []).filter(c => !adjustedOut.has(c)));
                    const myAllIdx = allHops.findIndex(h => h.id === hop.id);
                    const nextForward = allHops.slice(myAllIdx + 1).find(h => h.action === "forward");
                    const nextVisible = visibleHops[hopIdx + 1];
                    const nextLoc = nextForward?.location_name || nextVisible?.location_name;
                    return (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">ชื่อผู้ฝาก</Label>
                            <Input className="h-8 text-xs bg-muted" value={hop.depositor_name || "-"} readOnly />
                          </div>
                          <div>
                            <Label className="text-xs">ชื่อผู้รับ</Label>
                            <Input className="h-8 text-xs bg-muted" value={hop.receiver_name || "-"} readOnly />
                          </div>
                          <div>
                            <Label className="text-xs">จุดปลายทาง</Label>
                            <Input className="h-8 text-xs bg-muted" value={hop.location_name} readOnly />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-muted-foreground">{new Date(hop.created_at).toLocaleString("th-TH")}</span>
                          <Badge variant="outline" className={isFull ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "border-amber-400 text-amber-700 bg-amber-50"}>
                            {isFull ? "ครบ" : `diff ${missingArrAll.length + extraArrAll.length}${missingArrAll.length ? ` (ขาด ${missingArrAll.length})` : ""}${extraArrAll.length ? ` (เกิน ${extraArrAll.length})` : ""}`}
                          </Badge>
                          {isClosed && hop.id === lastHop?.id && <Badge className="bg-rose-600 text-white">จบล็อต</Badge>}
                          {nextLoc && <span className="text-primary text-[11px]">→ ฝากต่อ <b>{nextLoc}</b></span>}
                          <div className="ml-auto flex gap-1">
                            {!isFull && (
                              <Button size="sm" variant="default" className="h-6 text-[10px] px-2" onClick={() => openAdjust(hop.id, hop.location_name, missingArrAll, extraArrAll)}>Adjust doc</Button>
                            )}
                            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => exportColumnExcel(hop.codes || [], `ปลายทาง${currentTab}_${hop.location_name}`, activeShipment.doc_name, sMap)}>
                              <FileSpreadsheet className="w-3 h-3 mr-1" />Export Excel
                            </Button>
                          </div>
                        </div>
                        {hop.notes && <div className="text-xs italic text-muted-foreground">{hop.notes}</div>}
                        <div className="border rounded">
                          <div className="px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground border-b">{allDisplayCodes.length} ชุด</div>
                          <ScrollArea className="h-64">
                            <ul className="divide-y text-xs">
                              {allDisplayCodes.map((c, i) => {
                                const s = (sMap[c] ?? "เกิน") as S;
                                const cls = s === "ตรง" ? "bg-emerald-50" : s === "ขาด" ? "bg-amber-200" : "bg-amber-50";
                                return (
                                  <li key={c + i} className={`px-2 py-1.5 font-mono ${cls}`}>
                                    <div className="flex items-center justify-between gap-1">
                                      <span>{i + 1}. {c}</span>
                                      <Badge className={`${statusBadgeCls(s)} text-[9px] px-1 py-0`}>{s}</Badge>
                                    </div>
                                    {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                                  </li>
                                );
                              })}
                            </ul>
                          </ScrollArea>
                        </div>
                        <AttachmentPanel
                          movementId={hop.id}
                          url={hop.attachment_url || null}
                          uploadedBy={hop.attachment_uploaded_by || null}
                          onChange={(newUrl, newUploader) => setMovements(prev => prev.map(x => x.id === hop.id ? { ...x, attachment_url: newUrl, attachment_uploaded_by: newUploader ?? null } : x))}
                        />
                        {isLastCompletedHop && (
                          <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={rescanLastArrived}>สะแกนตรวจอีกครั้ง</Button>
                            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => { setPopupStep("choose"); setPopupDepositor(""); setPopupReceiver(""); setPopupDestination(""); setArrivedPopupOpen(true); }}>ฝากต่อ</Button>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { if (window.confirm("ยืนยันการจบล็อตเอกสารนี้?")) closeAfterArrived(); }}>จบล็อตนี้</Button>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* ── Active scan tab ── */}
                  {isActiveTab && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">ชื่อผู้ฝาก <span className="text-destructive">*</span></Label>
                          <Input className={`h-8 text-xs ${afterForward ? "bg-muted" : ""}`} placeholder="พิมพ์ชื่อผู้ฝาก" value={activeDepositor} onChange={(e) => setDestDepositor(e.target.value)} readOnly={afterForward} disabled={!canEditNextDestination && !afterForward} />
                        </div>
                        <div>
                          <Label className="text-xs">ชื่อผู้รับ <span className="text-destructive">*</span></Label>
                          <Input className={`h-8 text-xs ${afterForward ? "bg-muted" : ""}`} placeholder="พิมพ์ชื่อผู้รับ" value={activeReceiver} onChange={(e) => setDestReceiver(e.target.value)} readOnly={afterForward} disabled={!canEditNextDestination && !afterForward} />
                        </div>
                        <div>
                          <Label className="text-xs">จุดปลายทาง <span className="text-destructive">*</span></Label>
                          {afterForward ? (
                            <Input className="h-8 text-xs bg-muted" value={activeDestLocation} readOnly />
                          ) : (
                            <LocationCombobox value={destLocation} onChange={setDestLocation} options={locations} placeholder="พิมพ์ หรือเลือกจุด..." disabled={!canEditNextDestination} />
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">จุดต้นทาง</Label>
                          <Input className="h-8 text-xs bg-muted" value={activeOriginLoc} readOnly />
                        </div>
                        <div>
                          <Label className="text-xs">หมายเหตุ</Label>
                          <Input className="h-8 text-xs" placeholder="หมายเหตุ (optional)" value={destNotes} onChange={(e) => setDestNotes(e.target.value)} />
                        </div>
                      </div>
                      {expectedAtThisHop.length > 0 && (() => {
                        const prevArrived = [...allHops].reverse().find(h => h.action === "arrived");
                        const prevArrivedSet = new Set(prevArrived?.codes || []);
                        const scannedSet = new Set(destCodes);
                        const isFirst = !prevArrived;
                        return (
                          <div className="border rounded">
                            <div className="px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground flex items-center justify-between border-b">
                              <span>คาดว่ารับ {expectedAtThisHop.length} ชุด</span>
                              <span className="text-amber-700">เหลือง = ส่วนต่างจากจุดก่อน</span>
                            </div>
                            <ScrollArea className="h-40">
                              <ul className="divide-y text-xs">
                                {expectedAtThisHop.map((c, idx) => {
                                  const isDiff = !isFirst && !prevArrivedSet.has(c);
                                  const isScanned = scannedSet.has(c);
                                  const cls = isScanned ? "bg-emerald-50" : isDiff ? "bg-amber-100" : "";
                                  return (
                                    <li key={c} className={`px-2 py-1 font-mono ${cls}`}>
                                      <div className="flex items-center justify-between gap-1">
                                        <span>{idx + 1}. {c}</span>
                                        {isDiff && !isScanned && <span className="text-[10px] text-amber-800 font-bold">diff</span>}
                                        {isScanned && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                                      </div>
                                      {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                                    </li>
                                  );
                                })}
                              </ul>
                            </ScrollArea>
                          </div>
                        );
                      })()}
                      <ScannerPanel codes={destCodes} setCodes={setDestCodes} otherList={expectedAtThisHop} />
                      <AttachmentPanel movementId={null} url={null} onChange={() => {}} />
                      <div className="flex items-center justify-between gap-2 pt-1 border-t flex-wrap">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                          const expectedSet = new Set(expectedAtThisHop);
                          const sMap = buildStatusMap(expectedAtThisHop, destCodes);
                          exportColumnExcel([...expectedAtThisHop, ...destCodes.filter(c => !expectedSet.has(c))], `ปลายทาง${currentTab}_active`, activeShipment.doc_name, sMap);
                        }}>
                          <FileSpreadsheet className="w-3 h-3 mr-1" />Export Excel
                        </Button>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => saveHop("arrived")} disabled={isSavingHop}>
                            <CheckCircle2 className="w-4 h-4 mr-1" />{isSavingHop ? "กำลังบันทึก..." : "บันทึกตรวจ (รับตรวจ)"}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => { if (window.confirm("ยืนยันการจบล็อตเอกสารนี้?")) saveHop("closed"); }} disabled={isSavingHop}>
                            <Save className="w-4 h-4 mr-1" />จบล็อตนี้
                          </Button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Compare result */}
                  {compareResult && isActiveTab && (
                    <div className={`p-3 rounded border ${compareResult.missing.length === 0 && compareResult.extra.length === 0 ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
                      <div className="flex items-center gap-2 font-medium text-sm">
                        {compareResult.missing.length === 0 && compareResult.extra.length === 0
                          ? <><CheckCircle2 className="w-5 h-5 text-emerald-600" />เอกสารฝาก {activeShipment.origin_codes.length} / เทียบ {destCodes.length} — ครบ</>
                          : <><AlertCircle className="w-5 h-5 text-amber-600" />ขาด {compareResult.missing.length}{compareResult.extra.length > 0 ? `, เกิน ${compareResult.extra.length}` : ""}</>}
                      </div>
                      {isAdmin && (
                        <Button size="sm" variant="outline" className="mt-2" onClick={downloadDiff}>
                          <Download className="w-4 h-4 mr-1" />ดาวน์โหลด list ส่วนต่าง
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Adjust section */}
                  {adjustMvs.length > 0 && (() => {
                    const byTarget: Record<string, Movement[]> = {};
                    const order: string[] = [];
                    adjustMvs.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .forEach(a => {
                        if (!byTarget[a.location_name]) { byTarget[a.location_name] = []; order.push(a.location_name); }
                        byTarget[a.location_name].push(a);
                      });
                    const total = adjustMvs.reduce((s, a) => s + (a.codes || []).length, 0);
                    return (
                      <div className="border-2 border-dashed border-amber-400 rounded bg-amber-50/40 p-2">
                        <div className="flex items-center gap-1 text-xs text-amber-900 font-semibold mb-2">
                          <MapPin className="w-3.5 h-3.5" />จุดเคลียร์เอกสาร — {total} ชุด • {order.length} จุดปลายทาง
                        </div>
                        <div className="divide-y text-xs">
                          {order.map(loc => {
                            const recs = byTarget[loc];
                            const codes = recs.flatMap(r => r.codes || []);
                            return (
                              <div key={loc} className="py-1.5">
                                <div className="text-[11px] font-semibold text-amber-900 mb-1">→ {loc} <span className="font-normal text-amber-700">({codes.length} ชุด)</span></div>
                                <ul className="space-y-0.5">
                                  {codes.map((c, idx) => {
                                    const fromRec = recs.find(r => (r.codes || []).includes(c));
                                    let fromName = "";
                                    try { fromName = fromRec?.notes ? (JSON.parse(fromRec.notes)?.from || "") : ""; } catch {}
                                    return (
                                      <li key={c + idx} className="px-1.5 py-0.5 font-mono bg-white/70 rounded border border-amber-200 text-[10px] flex items-center justify-between gap-1">
                                        <span>{idx + 1}. {c}</span>
                                        {fromName && <span className="text-[9px] text-amber-700 shrink-0">จาก: {fromName}</span>}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>
            </div>
          </div>
        );
        return scanFullscreen ? createPortal(scanContent, document.body) : scanContent;
      })()}

      {/* Adjust doc dialog — เคลียร์เอกสารส่วนต่างจากจุด arrived ไปยังจุดอื่น */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adjust doc — เคลียร์เอกสารส่วนต่าง</DialogTitle>
            <DialogDescription>
              {adjustSource && (
                <>จาก <b>{adjustSource.locationName}</b> — เลือกเอกสารขาด/เกินที่ต้องการย้ายไปจุดอื่น</>
              )}
            </DialogDescription>
          </DialogHeader>
          {adjustSource && (() => {
            const allDiff = [...adjustSource.missing.map(c => ({ c, kind: "missing" as const })), ...adjustSource.extra.map(c => ({ c, kind: "extra" as const }))];
            const q = adjustSearch.trim().toLowerCase();
            const filtered = allDiff.filter(({ c }) => {
              if (!q) return true;
              return c.toLowerCase().includes(q) || (poInfoMap[c]?.partner || "").toLowerCase().includes(q);
            });
            // Target options = origin + every arrived location in this shipment, excluding the source
            const hist = movements
              .filter(m => m.shipment_id === activeShipment?.id)
              .slice()
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const targetOpts: string[] = [];
            if (activeShipment?.origin_location) targetOpts.push(activeShipment.origin_location);
            hist.filter(m => m.action === "arrived").forEach(m => {
              if (!targetOpts.includes(m.location_name)) targetOpts.push(m.location_name);
            });
            // Allow current source location too (กรณีลืมสะแกนแล้วเผลอจบล็อต — เอกสารยังอยู่จุดเดิมจริงๆ)
            const finalTargets = targetOpts;
            const toggleAll = (checked: boolean) => {
              if (checked) setAdjustSelected(new Set(filtered.map(x => x.c)));
              else setAdjustSelected(new Set());
            };
            const allChecked = filtered.length > 0 && filtered.every(x => adjustSelected.has(x.c));
            return (
              <div className="space-y-3">
                <Input
                  placeholder="ค้นหา PO / Partner..."
                  value={adjustSearch}
                  onChange={(e) => setAdjustSearch(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="border rounded">
                  <div className="flex items-center gap-2 p-2 border-b bg-muted text-xs">
                    <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
                    <span className="font-medium">เลือกทั้งหมด ({filtered.length})</span>
                    <span className="ml-auto text-muted-foreground">เลือกแล้ว {adjustSelected.size}</span>
                  </div>
                  <ScrollArea className="h-64">
                    <ul className="divide-y text-xs">
                      {filtered.map(({ c, kind }) => {
                        const checked = adjustSelected.has(c);
                        return (
                          <li key={c} className="px-2 py-1.5 flex items-center gap-2 hover:bg-accent/50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setAdjustSelected(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(c); else next.delete(c);
                                  return next;
                                });
                              }}
                            />
                            <span className="font-mono">{c}</span>
                            <Badge variant="outline" className={kind === "missing" ? "border-amber-400 text-amber-700 bg-amber-50" : "border-orange-400 text-orange-700 bg-orange-50"}>
                              {kind === "missing" ? "ขาด" : "เกิน"}
                            </Badge>
                            {poInfoMap[c]?.partner && <span className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</span>}
                          </li>
                        );
                      })}
                      {filtered.length === 0 && <li className="px-2 py-4 text-center text-muted-foreground">ไม่มีเอกสารส่วนต่าง</li>}
                    </ul>
                  </ScrollArea>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">ส่งไปจุด:</Label>
                  <Select value={adjustTarget} onValueChange={setAdjustTarget}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="เลือกจุดปลายทาง..." />
                    </SelectTrigger>
                    <SelectContent>
                      {finalTargets.map(t => (
                        <SelectItem key={t} value={t} className="text-xs">
                          {t}{t === adjustSource.locationName ? " (จุดปัจจุบัน)" : ""}
                        </SelectItem>
                      ))}
                      {finalTargets.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">ไม่มีจุดปลายทางอื่น</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustSaving}>ยกเลิก</Button>
            <Button onClick={confirmAdjust} disabled={adjustSaving || adjustSelected.size === 0 || !adjustTarget}>
              <Save className="w-4 h-4 mr-1" />ยืนยัน Adjust ({adjustSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
