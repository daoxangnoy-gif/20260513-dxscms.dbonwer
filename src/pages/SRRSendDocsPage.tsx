import { useEffect, useRef, useState, Fragment as FragmentRow } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import * as XLSX from "xlsx";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import appLogo from "@/assets/dx-scm-logo.png";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Floating custom vertical scrollbar: drag thumb or use mouse wheel to scroll the page
function FloatingScrollSlider() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [thumbPct, setThumbPct] = useState(10);
  const draggingRef = useRef<{ startY: number; startScroll: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = (doc.scrollHeight - window.innerHeight) || 1;
      setPct(Math.min(100, Math.max(0, (window.scrollY / max) * 100)));
      setThumbPct(Math.min(100, Math.max(8, (window.innerHeight / doc.scrollHeight) * 100)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollToPct = (p: number) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, Math.min(max, (p / 100) * max)), behavior: "auto" });
  };

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const p = ((e.clientY - rect.top) / rect.height) * 100;
    scrollToPct(p);
  };

  const onThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = { startY: e.clientY, startScroll: window.scrollY };
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const dy = ev.clientY - draggingRef.current.startY;
      const ratio = dy / rect.height;
      window.scrollTo({ top: draggingRef.current.startScroll + ratio * max, behavior: "auto" });
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onWheel = (e: React.WheelEvent) => {
    window.scrollBy({ top: e.deltaY, behavior: "auto" });
  };

  const thumbTop = ((100 - thumbPct) * pct) / 100;

  return (
    <div
      ref={trackRef}
      onClick={onTrackClick}
      onWheel={onWheel}
      className="fixed right-3 top-1/2 -translate-y-1/2 z-50 h-[60vh] w-3 rounded-full bg-muted/70 border shadow-lg cursor-pointer"
      title="เลื่อนหน้าจอ"
    >
      <div
        onMouseDown={onThumbMouseDown}
        className="absolute left-0 right-0 mx-auto w-2.5 rounded-full bg-primary/80 hover:bg-primary cursor-grab active:cursor-grabbing"
        style={{ top: `${thumbTop}%`, height: `${thumbPct}%` }}
      />
    </div>
  );
}

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
      <PopoverContent className="p-0 w-72" align="start">
        <Command>
          <CommandInput placeholder="ค้นหาจุด..." />
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
function ScannerPanel({
  codes, setCodes, otherList = [],
}: {
  codes: string[];
  setCodes: (next: string[]) => void;
  otherList?: string[];
}) {
  const { toast } = useToast();
  const [manual, setManual] = useState("");
  const [camOn, setCamOn] = useState(false);
  const camRef = useRef<Html5Qrcode | null>(null);
  const containerId = useRef(`qr-${Math.random().toString(36).slice(2)}`).current;
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

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
    if (fresh.length > 0) setCodes([...codes, ...fresh]);
    if (dup.length > 0) {
      toast({ title: "พบรายการซ้ำ", description: `ข้าม ${dup.length} รายการ: ${dup.slice(0, 3).join(", ")}${dup.length > 3 ? "..." : ""}`, variant: "destructive" });
    }
    return fresh.length > 0;
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
          <Button type="button" variant="ghost" size="sm" onClick={() => setCodes([])}>
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
  toggleFinalize: (docId: string, docName: string) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

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


  // ===== Global latest location per PO code (across ALL shipments) =====
  // ถ้า PO เดิมถูกสะแกนใหม่ในเอกสารใหม่ จุดปัจจุบันต้องย้ายไปตามการสะแกนล่าสุด
  // รวบรวม movement ทุก shipment เรียงเวลา desc แล้วหา hit ล่าสุดของแต่ละโค้ด
  const allMovesDesc = movements.slice().sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const latestLocByCode: Record<string, string> = {};
  for (const m of allMovesDesc) {
    if (m.action !== "adjust" && m.action !== "arrived") continue;
    const codes = Array.isArray(m.codes) ? m.codes : [];
    for (const c of codes) {
      if (!(c in latestLocByCode)) latestLocByCode[c] = m.location_name;
    }
  }

  // Per-PO location (per shipment row) — ใช้ "global latest" เป็นหลัก
  // ถ้าโค้ดไม่เคยถูกสะแกน arrived/adjust ที่ไหน ให้คงอยู่จุดต้นทางของ shipment นั้น
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
  // Always include origin locations even if empty doc
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
      if (!isFinalized) {
        partnerCodes.forEach(c => {
          const loc = locByShipmentCode[s.id]?.[c] || (s.origin_location || "(ไม่ระบุจุด)");
          locCounts[loc] = (locCounts[loc] || 0) + 1;
        });
      }
      rows.push({ doc: s, partner: p, count: isFinalized ? 0 : partnerCodes.length, locCounts });
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
          {loading ? "กำลังโหลดข้อมูล PO..." : `${partnerList.length}${q ? `/${partnerListAll.length}` : ""} partner, ${items.length} doc, ${locationsUsed.length} จุด`}
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
              {locationsUsed.map(l => (
                <th key={l} className="text-center p-2 whitespace-nowrap">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partnerList.length === 0 ? (
              <tr><td colSpan={3 + locationsUsed.length} className="text-center p-6 text-muted-foreground">ไม่มีข้อมูล — กด "ดึงข้อมูล PO" ในแท็บฝากเอกสารก่อน</td></tr>
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
                    {locationsUsed.map(l => (
                      <td key={l} className="p-2 text-center">
                        {pivot[p][l] > 0 ? <Badge>{pivot[p][l]}</Badge> : <span className="text-muted-foreground">-</span>}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={3 + locationsUsed.length} className="p-3">
                        <table className="w-full text-xs border">
                          <thead className="bg-muted">
                            <tr>
                              <th className="p-1.5 border text-left">Doc</th>
                              <th className="p-1.5 border text-left">ผู้ฝาก</th>
                              <th className="p-1.5 border text-left">ผู้รับ</th>
                              <th className="p-1.5 border text-left">จุดปัจจุบัน</th>
                              <th className="p-1.5 border text-center">PO Partner นี้</th>
                              <th className="p-1.5 border text-center">PO ทั้งหมด</th>
                              <th className="p-1.5 border text-left">สถานะ</th>
                              <th className="p-1.5 border text-center">จัดการ</th>
                              <th className="p-1.5 border text-left">ประวัติ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grouped[p].map((r, i) => {
                              const hist = (movementsByShipment[r.doc.id] || []).slice().reverse();
                              const isFin = finalizedIds.has(r.doc.id);
                              return (
                                <tr key={r.doc.id + "_" + i} className={isFin ? "bg-muted/60" : ""}>
                                  <td className="p-1.5 border font-mono">
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
                                  <td className="p-1.5 border text-center">{r.count}</td>
                                  <td className="p-1.5 border text-center">{(r.doc.origin_codes || []).length}</td>
                                  <td className="p-1.5 border">{r.doc.status}</td>
                                  <td className="p-1.5 border text-center">
                                    <Button
                                      size="sm"
                                      variant={isFin ? "outline" : "destructive"}
                                      className="h-6 text-[11px] px-2"
                                      onClick={() => toggleFinalize(r.doc.id, r.doc.doc_name)}
                                    >
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
                            })}
                          </tbody>
                        </table>

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

  // ===== Finalized docs (shared with ReportTab via props, persisted in localStorage) =====
  const FINALIZED_KEY = "srr_send_docs_finalized_v1";
  const [finalizedIds, setFinalizedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(FINALIZED_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const toggleFinalize = (docId: string, docName: string) => {
    if (finalizedIds.has(docId)) {
      if (!window.confirm(`ยกเลิกสถานะ "สิ้นสุด" ของเอกสาร ${docName}?`)) return;
      const next = new Set(finalizedIds); next.delete(docId);
      setFinalizedIds(next);
      try { localStorage.setItem(FINALIZED_KEY, JSON.stringify(Array.from(next))); } catch {}
      toast({ title: "ยกเลิกสถานะสิ้นสุดแล้ว" });
    } else {
      if (!window.confirm(`ยืนยันสิ้นสุดการเดินเอกสาร ${docName}?\nจำนวน PO ที่จุดปัจจุบันของเอกสารนี้จะถูกตัดออกจากการนับ Report`)) return;
      const next = new Set(finalizedIds); next.add(docId);
      setFinalizedIds(next);
      try { localStorage.setItem(FINALIZED_KEY, JSON.stringify(Array.from(next))); } catch {}
      toast({ title: "สิ้นสุดการเดินเอกสารแล้ว" });
    }
  };

  // create / edit dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [depositorName, setDepositorName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [destinationLocation, setDestinationLocation] = useState("");
  const [originCodes, setOriginCodes] = useState<string[]>([]);

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
  // Post-arrival popup: appears after user saves "รับตรวจ" — ask ฝากต่อ or จบ
  const [arrivedPopupOpen, setArrivedPopupOpen] = useState(false);
  const [popupStep, setPopupStep] = useState<"choose" | "form">("choose");
  const [popupDepositor, setPopupDepositor] = useState("");
  const [popupReceiver, setPopupReceiver] = useState("");
  const [popupDestination, setPopupDestination] = useState("");
  // Per-column widths (px) for destination dialog — keyed by column index
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  // Per-column search filter
  const [colSearch, setColSearch] = useState<Record<number, string>>({});
  const [compareResult, setCompareResult] = useState<{
    matched: number; missing: string[]; extra: string[];
  } | null>(null);

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
    setCreateOpen(false); resetCreate(); load();
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
      setDestOpen(false); setMainTab("deposit");
    } else {
      // After "arrived" save — show popup asking ฝากต่อ / จบ
      setPopupStep("choose");
      setPopupDepositor("");
      setPopupReceiver("");
      setPopupDestination("");
      setArrivedPopupOpen(true);
    }
  };

  // Called when user clicks "บันทึก" inside the popup form (after choosing ฝากต่อ).
  // Inserts forward movement carrying popup values; next column pre-fills them read-only.
  const forwardAfterArrived = async () => {
    if (!activeShipment || !user) return;
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
    // Forward set = union(scanned at this point, items missing from origin at this point)
    // so the diff POs propagate forward and can be verified at next point (highlighted yellow).
    const arrivedSet = new Set(lastArrived.codes || []);
    const missingFromOrigin = (activeShipment.origin_codes || []).filter(c => !arrivedSet.has(c));
    const forwardCodes = [...(lastArrived.codes || []), ...missingFromOrigin];
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
    setDestOpen(false); setMainTab("deposit");
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
    load();
  };

  // Export PO list (Ponumber / Partner / ยอดรวม) for a checkpoint column
  const exportColumnExcel = (codes: string[], colLabel: string, docName: string) => {
    if (!codes.length) { toast({ title: "ไม่มีรายการสำหรับ Export", variant: "destructive" }); return; }
    const rows: any[] = codes.map((c, i) => {
      const p = poInfoMap[c];
      return {
        "#": i + 1,
        "PO Number": c,
        "Partner": p?.partner || "",
        "ยอดรวม": p?.total != null ? Number(p.total) : 0,
        "Currency": p?.currency_name || "",
      };
    });
    const total = rows.reduce((s, r) => s + (Number(r["ยอดรวม"]) || 0), 0);
    rows.push({ "#": "", "PO Number": "", "Partner": "รวมทั้งหมด", "ยอดรวม": total, "Currency": "" });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "POs");
    const safe = `${docName}_${colLabel}`.replace(/[\\/:*?"<>|]/g, "_");
    XLSX.writeFile(wb, `${safe}.xlsx`);
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });


  return (
    <div className="p-6 space-y-4">
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
            <Button variant="outline" onClick={() => setLocOpen(true)}>
              <MapPin className="w-4 h-4 mr-2" />จุดรับส่งเอกสาร
            </Button>
            <div className="flex-1 min-w-[260px]">
              <Input
                value={depositSearch}
                onChange={(e) => setDepositSearch(e.target.value)}
                placeholder="ค้นหา Doc / ผู้ฝาก / ผู้รับ / เลข PO / Partner"
                className="h-9"
              />
            </div>
            {depositSearch && (
              <Button variant="ghost" size="sm" onClick={() => setDepositSearch("")}>
                <X className="w-3.5 h-3.5 mr-1" />ล้าง
              </Button>
            )}
          </div>

          <div className="border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
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
                    // also movements depositor/receiver
                    const mvs = movements.filter(m => m.shipment_id === s.id);
                    if (mvs.some(m => (m.depositor_name || "").toLowerCase().includes(q) || (m.receiver_name || "").toLowerCase().includes(q))) return true;
                    return false;
                  });
                  if (loading) return <tr><td colSpan={10} className="text-center p-6 text-muted-foreground">กำลังโหลด...</td></tr>;
                  if (filteredItems.length === 0) return <tr><td colSpan={10} className="text-center p-6 text-muted-foreground">{q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีเอกสาร"}</td></tr>;
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
                  let recomputedFull = s.status === "matched";
                  if (isClosed) {
                    const hopsArr = docMvs.filter(m => m.action !== "origin_save" && m.action !== "adjust");
                    const lastClosingHop = [...hopsArr].reverse().find(m => m.action === "closed" || m.action === "arrived");
                    if (lastClosingHop) {
                      const myIdx = hopsArr.findIndex(h => h.id === lastClosingHop.id);
                      let incoming: string[] = s.origin_codes || [];
                      for (let k = myIdx - 1; k >= 0; k--) {
                        if (hopsArr[k].action === "forward") { incoming = hopsArr[k].codes || []; break; }
                      }
                      const arrivedSet = new Set(lastClosingHop.codes || []);
                      const incomingSet = new Set(incoming);
                      const adjustedOut = new Set<string>();
                      for (const a of adjustMvsForShipment) {
                        try {
                          const n = a.notes ? JSON.parse(a.notes) : null;
                          if (n?.from_id === lastClosingHop.id || n?.from === lastClosingHop.location_name) {
                            (a.codes || []).forEach(c => adjustedOut.add(c));
                          }
                        } catch {}
                      }
                      const missCnt = incoming.filter(c => !arrivedSet.has(c) && !adjustedOut.has(c)).length;
                      const extraCnt = (lastClosingHop.codes || []).filter(c => !incomingSet.has(c) && !adjustedOut.has(c)).length;
                      recomputedFull = missCnt === 0 && extraCnt === 0;
                    }
                  }
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
                  return (
                    <FragmentRow key={s.id}>
                    <tr className="border-t hover:bg-muted/40">
                      <td className="p-2 text-center">
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
                          ? (hasAdjustments
                              ? <Badge className="bg-sky-500 hover:bg-sky-500">จบ-เคลียร์แล้ว</Badge>
                              : recomputedFull
                                ? <Badge className="bg-emerald-600">จบ-ครบ</Badge>
                                : <Badge variant="destructive">จบ-ไม่ครบ</Badge>)
                          : lastAction === "forward"
                            ? <Badge className="bg-blue-600">กำลังเดินทาง</Badge>
                            : lastAction === "arrived"
                              ? <Badge className="bg-amber-500">รอดำเนินการ</Badge>
                              : <Badge variant="secondary">เริ่มฝาก</Badge>
                        }
                      </td>
                      <td className="p-2 whitespace-nowrap">{fmt(s.origin_scanned_at)}</td>
                      <td className="p-2 whitespace-nowrap">{fmt(s.destination_scanned_at)}</td>
                      <td className="p-2 text-right space-x-1 whitespace-nowrap">
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
                        <td colSpan={10} className="p-3">
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
            <div className="text-sm text-muted-foreground p-6 border rounded-lg bg-card text-center">
              ยังไม่ได้เลือก shipment — กลับไปแท็บ <b>ฝากเอกสาร</b> แล้วกดปุ่ม <b>"ถึงปลายทาง"</b> ที่รายการที่ต้องการ
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
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
          <ScannerPanel codes={originCodes} setCodes={setOriginCodes} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSaveDoc}><Save className="w-4 h-4 mr-1" />{editingId ? "บันทึกการแก้ไข" : `Save เป็น Doc (${originCodes.length})`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-arrival popup — after user saves "รับตรวจ", ask whether to forward or end */}
      <Dialog open={arrivedPopupOpen} onOpenChange={setArrivedPopupOpen}>
        <DialogContent className="max-w-md">
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
                <Button size="sm" onClick={forwardAfterArrived}>
                  <Save className="w-4 h-4 mr-1" />Save
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* สะแกนตรวจ (Destination) — rendered inline when scan tab active */}
      {mainTab === "scan" && activeShipment && (
        <div className="mt-3 border rounded-lg bg-card p-4 max-h-[calc(100vh-220px)] overflow-y-auto overflow-x-auto">

          <div className="mb-3">
            <h2 className="text-lg font-semibold">บันทึกจุดเอกสาร — {activeShipment?.doc_name}</h2>
            <p className="text-sm text-muted-foreground">
              ต้นทาง → ปลายทางตามลำดับ — คอลัมน์ขวาสุดเป็นจุดปัจจุบันที่ active (สะแกน + บันทึก)
            </p>
          </div>


          {activeShipment && (() => {
            // hist sorted ASC (oldest first)
            const hist = movements
              .filter(m => m.shipment_id === activeShipment.id)
              .slice()
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const originMv = hist.find(m => m.action === "origin_save");
            // Only "arrived" hops are shown as completed columns; "forward" is an internal
            // state transition (triggered from the post-arrival popup) and not rendered.
            // "adjust" records are side actions (เคลียร์ส่วนต่าง) and are NOT part of
            // the main timeline; they're rendered in a separate "จุดเคลียร์เอกสาร" column.
            const adjustMvs = hist.filter(m => m.action === "adjust");
            const allHops = hist.filter(m => m.action !== "origin_save" && m.action !== "adjust");
            // Only "arrived" hops are shown as columns. "closed" status is reflected
            // as a "จบ" badge on the LAST arrived column (not a separate column).
            const visibleHops = allHops.filter(m => m.action === "arrived");
            const isClosed = allHops.some(m => m.action === "closed");
            const lastHop = allHops[allHops.length - 1];
            // Helper: codes that have been adjusted away from a given hop id
            const adjustedOutFrom = (hopId: string): Set<string> => {
              const out = new Set<string>();
              for (const a of adjustMvs) {
                try {
                  const meta = a.notes ? JSON.parse(a.notes) : null;
                  if (meta?.from_id === hopId) (a.codes || []).forEach(c => out.add(c));
                } catch { /* ignore non-JSON notes */ }
              }
              return out;
            };
            const showActiveDest = !isClosed && (lastHop?.action !== "arrived");
            const activeStepIdx = visibleHops.length + 1; // next ปลายทาง number
            // Editable when no previous hop yet (first destination) or after forward
            const canEditNextDestination = !lastHop || lastHop.action === "forward";
            const canSaveScan = destCodes.length > 0;
            // Expected list at the current point = codes received at previous hop (or origin)
            const expectedAtThisHop = (lastHop?.action === "forward" ? (lastHop.codes || []) : (activeShipment.origin_codes || []));
            

            // Helper: resize handle — free drag, allow any width (even very small / overlap)
            const startResize = (idx: number, startX: number, startW: number, side: "left" | "right" = "right") => {
              const onMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startX;
                const w = Math.max(80, side === "left" ? startW - dx : startW + dx);
                setColWidths(prev => ({ ...prev, [idx]: w }));
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            };

            const getWidth = (idx: number) => colWidths[idx] || (idx === activeStepIdx ? 460 : 360);



            const matchesSearch = (code: string, q: string) => {
              if (!q.trim()) return true;
              const ql = q.toLowerCase();
              if (code.toLowerCase().includes(ql)) return true;
              const partner = poInfoMap[code]?.partner || "";
              return partner.toLowerCase().includes(ql);
            };

            const ColHeader = ({ idx, children }: { idx: number; children: React.ReactNode }) => (
              <>
                {children}
                <Input
                  className="mt-1 h-7 text-xs"
                  placeholder="ค้นหา PO / Partner..."
                  value={colSearch[idx] || ""}
                  onChange={(e) => setColSearch(prev => ({ ...prev, [idx]: e.target.value }))}
                />
              </>
            );

            const ResizeHandle = ({ idx, side = "right" }: { idx: number; side?: "left" | "right" }) => (
              <div
                onMouseDown={(e) => { e.preventDefault(); startResize(idx, e.clientX, getWidth(idx), side); }}
                className="w-3 -mx-1.5 z-20 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 self-stretch shrink-0"
                title={side === "left" ? "ลากขอบซ้ายเพื่อปรับช่องนี้" : "ลากขอบขวาเพื่อปรับช่องนี้"}
              />
            );

            return (
              <div className="overflow-x-auto">
                <div className="flex gap-0 items-stretch min-w-fit">
                  {/* ต้นทาง column */}
                  <div className="border rounded bg-muted/30 flex flex-col shrink-0" style={{ width: getWidth(0) }}>
                    <div className="p-2 border-b bg-muted">
                      <ColHeader idx={0}>
                        <div className="text-xs text-muted-foreground">ต้นทาง</div>
                        <div className="font-semibold text-sm">
                          {activeShipment.origin_location || originMv?.location_name || "(ไม่ระบุ)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          เอกสาร {activeShipment.origin_codes.length} ชุด
                          {originMv && ` • ${new Date(originMv.created_at).toLocaleString("th-TH")}`}
                        </div>
                        {visibleHops[0]?.location_name && (
                          <div className="text-[11px] text-primary font-medium mt-0.5">
                            → ฝากต่อ <b>{visibleHops[0].location_name}</b>
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 mt-1 w-full"
                          onClick={() => exportColumnExcel(activeShipment.origin_codes || [], `ต้นทาง_${activeShipment.origin_location || originMv?.location_name || ""}`, activeShipment.doc_name)}
                        >
                          <FileSpreadsheet className="w-3 h-3 mr-1" />Export Excel
                        </Button>
                      </ColHeader>
                    </div>
                    <ScrollArea className="h-80">
                      <ul className="divide-y text-xs">
                        {activeShipment.origin_codes
                          .filter(c => matchesSearch(c, colSearch[0] || ""))
                          .map((c, i) => (
                          <li key={c} className="px-2 py-1 font-mono">
                            <div>{i + 1}. {c}</div>
                            {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                    <AttachmentPanel
                      movementId={originMv?.id || null}
                      url={originMv?.attachment_url || null}
                      uploadedBy={originMv?.attachment_uploaded_by || null}
                      onChange={(newUrl, newUploader) => {
                        if (!originMv) return;
                        setMovements(prev => prev.map(x => x.id === originMv.id ? { ...x, attachment_url: newUrl, attachment_uploaded_by: newUploader ?? null } : x));
                      }}
                    />
                  </div>


                  {/* completed hops (read-only) — only show arrived / closed */}
                  {visibleHops.map((m, i) => {
                    const colIdx = i + 1;
                    // Compute incoming expected codes for this hop (origin for first, else previous forward)
                    const myIdx = allHops.findIndex(h => h.id === m.id);
                    let incoming: string[] = activeShipment.origin_codes || [];
                    for (let k = myIdx - 1; k >= 0; k--) {
                      if (allHops[k].action === "forward") { incoming = allHops[k].codes || []; break; }
                    }
                    const arrivedSet = new Set(m.codes || []);
                    const incomingSet = new Set(incoming);
                    // Subtract codes that have been adjusted away from this hop —
                    // they no longer count as missing/extra here (they live in
                    // จุดเคลียร์เอกสาร now).
                    const adjustedOut = adjustedOutFrom(m.id);
                    const missingArrAll = incoming.filter(c => !arrivedSet.has(c) && !adjustedOut.has(c));
                    const extraArrAll = (m.codes || []).filter(c => !incomingSet.has(c) && !adjustedOut.has(c));
                    const missCnt = missingArrAll.length;
                    const extraCnt = extraArrAll.length;
                    const isFull = missCnt === 0 && extraCnt === 0;
                    return (
                      <FragmentRow key={m.id}>
                        <ResizeHandle idx={colIdx} side="left" />
                        <div className="border rounded flex flex-col shrink-0" style={{ width: getWidth(colIdx) }}>
                          <div className="p-2 border-b bg-muted">
                            <ColHeader idx={colIdx}>
                              <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                                <span>ปลายทาง {i + 1} — {ACTION_LABELS[m.action] || m.action}</span>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700 font-medium">เสร็จ</span>
                                <Badge variant="outline" className={isFull ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "border-amber-400 text-amber-700 bg-amber-50"}>
                                  {isFull ? "ครบ" : `diff ${missCnt + extraCnt}${missCnt ? ` (ขาด ${missCnt})` : ""}${extraCnt ? ` (เกิน ${extraCnt})` : ""}`}
                                </Badge>
                                {isClosed && i === visibleHops.length - 1 && (
                                  <Badge className="bg-rose-600 text-white">จบล็อต</Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant={isFull ? "outline" : "default"}
                                  disabled={isFull}
                                  className="h-6 text-[10px] px-2 ml-auto"
                                  onClick={() => openAdjust(m.id, m.location_name, missingArrAll, extraArrAll)}
                                  title={isFull ? "เอกสารครบแล้ว — ไม่ต้อง adjust" : "เคลียร์เอกสารส่วนต่างไปยังจุดอื่น"}
                                >Adjust doc</Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => exportColumnExcel(m.codes || [], `ปลายทาง${i + 1}_${m.location_name}`, activeShipment.doc_name)}
                                  title="Export Excel รายการ PO ที่จุดนี้"
                                >
                                  <FileSpreadsheet className="w-3 h-3 mr-1" />Excel
                                </Button>
                              </div>
                              {(m.depositor_name || m.receiver_name) && (
                                <div className="text-[10px] text-muted-foreground">
                                  {m.depositor_name && <>ผู้ฝาก: <b>{m.depositor_name}</b></>}
                                  {m.depositor_name && m.receiver_name && " • "}
                                  {m.receiver_name && <>ผู้รับ: <b>{m.receiver_name}</b></>}
                                </div>
                              )}
                              <div className="font-semibold text-sm">{m.location_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {(m.codes || []).length} ชุด • {new Date(m.created_at).toLocaleString("th-TH")}
                              </div>
                              {(() => {
                                // Find the next destination this point forwarded to:
                                // a "forward" record after this hop OR the next visible arrived/closed location.
                                const nextForward = allHops.slice(myIdx + 1).find(h => h.action === "forward");
                                const nextVisible = visibleHops[i + 1];
                                const nextLoc = nextForward?.location_name || nextVisible?.location_name;
                                if (!nextLoc) return null;
                                return (
                                  <div className="text-[11px] text-primary font-medium mt-0.5">
                                    → ฝากต่อ <b>{nextLoc}</b>
                                  </div>
                                );
                              })()}
                              {m.notes && <div className="text-xs italic text-muted-foreground mt-1">{m.notes}</div>}
                              {m.id === lastHop?.id && lastHop?.action === "arrived" && !isClosed && (
                                <div className="flex flex-wrap gap-1 pt-1.5">
                                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1 min-w-[110px]" onClick={rescanLastArrived}>
                                    สะแกนตรวจอีกครั้ง
                                  </Button>
                                  <Button size="sm" variant="secondary" className="h-7 text-xs flex-1 min-w-[80px]" onClick={() => {
                                    setPopupStep("choose");
                                    setPopupDepositor("");
                                    setPopupReceiver("");
                                    setPopupDestination("");
                                    setArrivedPopupOpen(true);
                                  }}>ฝากต่อ</Button>
                                  <Button size="sm" variant="destructive" className="h-7 text-xs flex-1 min-w-[80px]" onClick={() => { if (window.confirm("ยืนยันการจบล็อตเอกสารนี้?")) closeAfterArrived(); }}>จบล็อตนี้</Button>
                                </div>
                              )}
                            </ColHeader>
                          </div>
                          <ScrollArea className="h-80">
                            <ul className="divide-y text-xs">
                              {(() => {
                                // Display = incoming expected codes (green=scanned/matched, yellow=missing/diff)
                                // Also append any EXTRA scanned codes that weren't expected (also yellow).
                                // Sort: missing (ขาด) first, then extras, then matched — so diff is visible without scrolling.
                                const scannedSet = new Set(m.codes || []);
                                const incomingArr = incoming.filter(c => !adjustedOut.has(c));
                                const extraScanned = (m.codes || []).filter(c => !incomingSet.has(c) && !adjustedOut.has(c));
                                const missingArr = incomingArr.filter(c => !scannedSet.has(c));
                                const matchedArr = incomingArr.filter(c => scannedSet.has(c));
                                const merged = [...missingArr, ...extraScanned, ...matchedArr];
                                return merged
                                  .filter(c => matchesSearch(c, colSearch[colIdx] || ""))
                                  .map((c, idx) => {
                                    const isScanned = scannedSet.has(c);
                                    const isExpected = incomingSet.has(c);
                                    const cls = isScanned && isExpected
                                      ? "bg-emerald-50"          // green: matched
                                      : !isScanned && isExpected
                                        ? "bg-amber-200"         // yellow: missing (diff)
                                        : "bg-amber-50";         // light amber: extra scanned
                                    return (
                                      <li key={c + idx} className={`px-2 py-1 font-mono ${cls}`}>
                                        <div className="flex items-center justify-between gap-1">
                                          <span>{idx + 1}. {c}</span>
                                          {!isScanned && isExpected && <span className="text-[10px] text-amber-800 font-bold">ขาด</span>}
                                          {isScanned && !isExpected && <span className="text-[10px] text-amber-700 font-semibold">เกิน</span>}
                                        </div>
                                        {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                                      </li>
                                    );
                                  });
                              })()}
                            </ul>
                          </ScrollArea>
                          <AttachmentPanel
                            movementId={m.id}
                            url={m.attachment_url || null}
                            uploadedBy={m.attachment_uploaded_by || null}
                            onChange={(newUrl, newUploader) => setMovements(prev => prev.map(x => x.id === m.id ? { ...x, attachment_url: newUrl, attachment_uploaded_by: newUploader ?? null } : x))}
                          />
                        </div>

                      </FragmentRow>
                    );
                  })}

                  {/* จุดเคลียร์เอกสาร — แสดงเฉพาะเมื่อมีการ adjust อย่างน้อย 1 ครั้ง
                       1 คอลัมน์รวมต่อ shipment, แยก section ตาม location ปลายทางที่ adjust ไป */}
                  {adjustMvs.length > 0 && (() => {
                    const colIdx = 9000; // distinct column key for resize/search
                    // group by target location_name, in order of first appearance
                    const byTarget: Record<string, Movement[]> = {};
                    const order: string[] = [];
                    adjustMvs
                      .slice()
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .forEach(a => {
                        if (!byTarget[a.location_name]) { byTarget[a.location_name] = []; order.push(a.location_name); }
                        byTarget[a.location_name].push(a);
                      });
                    const total = adjustMvs.reduce((s, a) => s + (a.codes || []).length, 0);
                    return (
                      <FragmentRow>
                        <ResizeHandle idx={colIdx} side="left" />
                        <div className="border-2 border-dashed border-amber-400 rounded bg-amber-50/40 flex flex-col shrink-0" style={{ width: getWidth(colIdx) }}>
                          <div className="p-2 border-b bg-amber-100/60">
                            <ColHeader idx={colIdx}>
                              <div className="text-xs text-amber-900 font-semibold flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" /> จุดเคลียร์เอกสาร
                              </div>
                              <div className="text-[11px] text-amber-800">
                                เคลียร์ทั้งหมด {total} ชุด • {order.length} จุดปลายทาง
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2 mt-1 w-full"
                                onClick={() => exportColumnExcel(adjustMvs.flatMap(a => a.codes || []), `จุดเคลียร์เอกสาร`, activeShipment.doc_name)}
                              >
                                <FileSpreadsheet className="w-3 h-3 mr-1" />Export Excel
                              </Button>
                            </ColHeader>
                          </div>
                          <ScrollArea className="h-80">
                            <div className="divide-y text-xs">
                              {order.map(loc => {
                                const recs = byTarget[loc];
                                const codes = recs.flatMap(r => r.codes || []);
                                const filtered = codes.filter(c => matchesSearch(c, colSearch[colIdx] || ""));
                                return (
                                  <div key={loc} className="p-2">
                                    <div className="text-[11px] font-semibold text-amber-900 mb-1">
                                      → {loc} <span className="text-amber-700 font-normal">({codes.length} ชุด)</span>
                                    </div>
                                    <ul className="space-y-0.5">
                                      {filtered.map((c, idx) => {
                                        const fromRec = recs.find(r => (r.codes || []).includes(c));
                                        let fromName = "";
                                        try { fromName = fromRec?.notes ? (JSON.parse(fromRec.notes)?.from || "") : ""; } catch {}
                                        return (
                                          <li key={c + idx} className="px-1.5 py-1 font-mono bg-white/70 rounded border border-amber-200">
                                            <div className="flex items-center justify-between gap-1">
                                              <span>{idx + 1}. {c}</span>
                                              {fromName && <span className="text-[9px] text-amber-700">จาก: {fromName}</span>}
                                            </div>
                                            {poInfoMap[c]?.partner && <div className="text-[10px] text-muted-foreground truncate">{poInfoMap[c]!.partner}</div>}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </div>
                      </FragmentRow>
                    );
                  })()}

                  {/* active column (scanner) - shown when ready to pick next destination */}
                  {showActiveDest && (() => {
                    const colIdx = activeStepIdx;
                    // After "forward", header values come from the popup (saved on lastHop) — readonly
                    const afterForward = lastHop?.action === "forward";
                    const headerDepositor = afterForward ? (lastHop?.depositor_name || destDepositor) : destDepositor;
                    const headerReceiver = afterForward ? (lastHop?.receiver_name || destReceiver) : destReceiver;
                    const headerDestination = afterForward ? (lastHop?.location_name || destLocation) : destLocation;
                    // (Expected list now lives in the previous column; nothing extra needed here.)

                    return (
                      <FragmentRow>
                        <ResizeHandle idx={colIdx} side="left" />
                        <div className="border-2 border-primary rounded flex flex-col shrink-0" style={{ width: getWidth(colIdx) }}>
                          <div className="p-2 border-b bg-primary/10 space-y-1.5">
                            <div className="text-xs font-semibold text-primary">▶ ปลายทาง {activeStepIdx} (active)</div>
                            <div>
                              <Label className="text-xs">ชื่อผู้ฝาก <span className="text-destructive">*</span></Label>
                              <Input
                                className={`h-8 text-xs ${afterForward ? "bg-muted" : ""}`}
                                placeholder="พิมพ์ชื่อผู้ฝาก"
                                value={headerDepositor}
                                onChange={(e) => setDestDepositor(e.target.value)}
                                readOnly={afterForward}
                                disabled={!canEditNextDestination && !afterForward}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">ชื่อผู้รับ <span className="text-destructive">*</span></Label>
                              <Input
                                className={`h-8 text-xs ${afterForward ? "bg-muted" : ""}`}
                                placeholder="พิมพ์ชื่อผู้รับ"
                                value={headerReceiver}
                                onChange={(e) => setDestReceiver(e.target.value)}
                                readOnly={afterForward}
                                disabled={!canEditNextDestination && !afterForward}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">จุดต้นทาง</Label>
                              <Input
                                className="h-8 text-xs bg-muted"
                                value={(() => {
                                  // origin of this point = previous arrived's location, or original origin
                                  const prevArrived = [...allHops].reverse().find(h => h.action === "arrived");
                                  return prevArrived?.location_name || activeShipment.origin_location || originMv?.location_name || "";
                                })()}
                                readOnly
                              />
                            </div>
                            <div>
                              <Label className="text-xs">จุดปลายทาง <span className="text-destructive">*</span></Label>
                              {afterForward ? (
                                <Input className="h-8 text-xs bg-muted" value={headerDestination} readOnly />
                              ) : (
                                <LocationCombobox value={destLocation} onChange={setDestLocation} options={locations} placeholder="พิมพ์ หรือเลือกจุด..." disabled={!canEditNextDestination} />
                              )}
                            </div>
                            <Input
                              className="h-8 text-xs"
                              placeholder="หมายเหตุ (optional)"
                              value={destNotes}
                              onChange={(e) => setDestNotes(e.target.value)}
                            />
                            <Input
                              className="h-7 text-xs"
                              placeholder="ค้นหา PO / Partner..."
                              value={colSearch[colIdx] || ""}
                              onChange={(e) => setColSearch(prev => ({ ...prev, [colIdx]: e.target.value }))}
                            />
                          </div>

                          {/* Expected list in active column — light yellow for diff items (carried forward from previous arrival) */}
                          {expectedAtThisHop.length > 0 && (() => {
                            // diff items = expected codes that did NOT arrive at the previous arrived hop
                            const prevArrived = [...allHops].reverse().find(h => h.action === "arrived");
                            const prevArrivedSet = new Set(prevArrived?.codes || []);
                            const scannedSet = new Set(destCodes);
                            const isFirst = !prevArrived;
                            return (
                              <div className="border-b">
                                <div className="px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground flex items-center justify-between">
                                  <span>คาดว่ารับ {expectedAtThisHop.length} ชุด</span>
                                  <span className="text-amber-700">เหลือง = ส่วนต่างจากจุดก่อน</span>
                                </div>
                                <ScrollArea className="h-40">
                                  <ul className="divide-y text-xs">
                                    {expectedAtThisHop
                                      .filter(c => matchesSearch(c, colSearch[colIdx] || ""))
                                      .map((c, idx) => {
                                        const isDiff = !isFirst && !prevArrivedSet.has(c);
                                        const isScanned = scannedSet.has(c);
                                        const cls = isScanned
                                          ? "bg-emerald-50"
                                          : isDiff
                                            ? "bg-amber-100"
                                            : "";
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

                          <div className="p-2">
                            <ScannerPanel codes={destCodes} setCodes={setDestCodes} otherList={expectedAtThisHop} />
                          </div>
                          <div className="p-2 border-t bg-muted/20 flex flex-col gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => saveHop("arrived")}>
                              <CheckCircle2 className="w-4 h-4 mr-1" />บันทึกตรวจ (รับตรวจ)
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { if (window.confirm("ยืนยันการจบล็อตเอกสารนี้?")) saveHop("closed"); }}>
                              <Save className="w-4 h-4 mr-1" />จบล็อตนี้
                            </Button>
                          </div>
                          <AttachmentPanel
                            movementId={null}
                            url={null}
                            onChange={() => {}}
                          />
                        </div>

                      </FragmentRow>
                    );
                  })()}
                </div>

                {compareResult && (
                  <div className={`mt-3 p-3 rounded border ${compareResult.missing.length === 0 && compareResult.extra.length === 0 ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
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
              </div>
            );
          })()}

          <div className="flex justify-end mt-3">
            <Button variant="outline" onClick={() => setMainTab("deposit")}>กลับไปรายการ</Button>
          </div>
        </div>
      )}

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
      {/* Floating vertical scroll slider */}
      <FloatingScrollSlider />

    </div>
  );
}
