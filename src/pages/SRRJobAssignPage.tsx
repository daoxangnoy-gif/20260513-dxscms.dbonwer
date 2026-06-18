import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, Plus, Paperclip, Clipboard, MessageCircle, CheckCircle2, Trash2, FileText, Calendar, Pencil,
  Clock, BellRing, Search, Monitor, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Extension {
  at: string;    // วันที่กดต่อเวลา (YYYY-MM-DD)
  from: string;  // วันนัดส่งก่อนต่อ
  to: string;    // วันนัดส่งใหม่
  days: number;  // จำนวนวันที่ต่อเพิ่ม (to - from)
}

interface JobRow {
  id: string;
  user_id: string;
  assignee_name: string;
  assignee_phone: string | null;
  content: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  due_date: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  original_due_date: string | null;
  extensions: Extension[] | null;
  completion_note: string | null;
  completion_attachment_url: string | null;
  completion_attachment_name: string | null;
  completion_attachment_type: string | null;
}

const BUCKET = "job-assignments";
// โดเมน production คงที่ ใช้สร้าง short link เสมอ (localhost จะกดไม่ได้ใน WhatsApp)
const PUBLIC_APP_URL = "https://daoxangnoy-gif.github.io/20260513-dxscms.dbonwer/";
const SIGNED_TTL = 60 * 60;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"];

function extractObjectPath(url: string | null, bucketId: string): string | null {
  if (!url) return null;
  const markers = [
    `/storage/v1/object/public/${bucketId}/`,
    `/storage/v1/object/sign/${bucketId}/`,
    `/${bucketId}/`,
  ];
  for (const m of markers) {
    const i = url.indexOf(m);
    if (i >= 0) return url.slice(i + m.length).split("?")[0];
  }
  return null;
}

function daysUntil(due: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// ส่วนต่างวัน (to - from) เป็นจำนวนวัน
function dateDiffDays(from: string, to: string): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export default function SRRJobAssignPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"assigned" | "done">("assigned");
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  const [showOnlyUpcoming, setShowOnlyUpcoming] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // ต่อเวลา dialog
  const [extendRow, setExtendRow] = useState<JobRow | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extendSaving, setExtendSaving] = useState(false);

  // ทำเครื่องหมายสำเร็จ + แนบหลักฐาน dialog
  const [doneRow, setDoneRow] = useState<JobRow | null>(null);
  const [doneNote, setDoneNote] = useState("");
  const [doneFile, setDoneFile] = useState<File | null>(null);
  const [doneSaving, setDoneSaving] = useState(false);
  const doneFileRef = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<{ user_id: string; full_name: string; phone: string | null }[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userListOpen, setUserListOpen] = useState(false);

  // create / edit dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [phone, setPhone] = useState("");
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [existingAttachment, setExistingAttachment] = useState<{ url: string; name: string; type: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // popup เลือกช่องทางส่ง WhatsApp (Desktop app / WhatsApp Web)
  const [waChoice, setWaChoice] = useState<{ phone: string; message: string } | null>(null);

  const loadRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("job_assignments" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows(((data as any) || []) as JobRow[]);
    setLoading(false);
  };

  const loadUsers = async () => {
    const { data, error } = await supabase.rpc("get_assignable_users" as any);
    if (error) { console.error(error); return; }
    setUsers((data as any) || []);
  };

  useEffect(() => { loadRows(); loadUsers(); }, [user?.id]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const pickUser = (u: { full_name: string; phone: string | null }) => {
    setAssignee(u.full_name);
    setPhone(u.phone || "");
    setUserSearch(u.full_name);
    setUserListOpen(false);
  };

  // paste image from clipboard
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

  const pasteFromClipboard = async () => {
    try {
      // @ts-ignore
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t: string) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          setFile(new File([blob], `clipboard_${Date.now()}.png`, { type: imageType }));
          toast.success("วางรูปจาก clipboard แล้ว");
          return;
        }
      }
      toast.error("ไม่มีรูปใน clipboard");
    } catch {
      toast.error("ใช้ Ctrl+V ในกล่องนี้แทนได้");
    }
  };

  const resetForm = () => {
    setAssignee(""); setPhone(""); setContent(""); setDueDate(""); setFile(null);
    setEditingId(null); setExistingAttachment(null);
  };

  const openEdit = (r: JobRow) => {
    resetForm();
    setEditingId(r.id);
    setAssignee(r.assignee_name);
    setPhone(r.assignee_phone || "");
    setUserSearch(r.assignee_name);
    setContent(r.content);
    setDueDate(r.due_date);
    if (r.attachment_url) {
      setExistingAttachment({
        url: r.attachment_url,
        name: r.attachment_name || "file",
        type: r.attachment_type || "",
      });
    }
    setOpenCreate(true);
  };

  const tabRows = useMemo(
    () => rows.filter(r => tab === "done" ? r.status === "done" : r.status !== "done"),
    [rows, tab]
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tabRows.filter(r => {
      if (tab !== "done") {
        const d = daysUntil(r.due_date);
        if (showOnlyOverdue && d >= 0) return false;
        if (showOnlyUpcoming && d < 0) return false;
      }
      if (q) {
        const name = (r.assignee_name || "").toLowerCase();
        const assignDate = (r.created_at || "").slice(0, 10); // วันที่สั่งงาน
        if (!name.includes(q) && !assignDate.includes(q) && !(r.due_date || "").includes(q)) return false;
      }
      return true;
    });
  }, [tabRows, tab, showOnlyOverdue, showOnlyUpcoming, searchTerm]);

  const uploadFile = async (f: File) => {
    if (!ALLOWED_TYPES.includes(f.type)) throw new Error("รองรับเฉพาะ PDF / PNG / JPG");
    if (f.size > 10 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 10MB");
    const ext = f.name.split(".").pop() || "bin";
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, name: f.name, type: f.type };
  };

  const openSignedUrl = async (url: string | null) => {
    if (!url) return;
    const path = extractObjectPath(url, BUCKET);
    if (!path) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
    if (error || !data?.signedUrl) { toast.error("เปิดไฟล์ไม่สำเร็จ"); return; }
    window.open(data.signedUrl, "_blank");
    return data.signedUrl;
  };

  const getSignedUrl = async (url: string | null): Promise<string> => {
    if (!url) return "";
    const path = extractObjectPath(url, BUCKET);
    if (!path) return url;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7 * 24 * 60 * 60);
    return data?.signedUrl || url;
  };

  // ย่อลิงก์แบบ self-hosted: เก็บใน short_links แล้วคืนลิงก์ #/r/:id ของระบบเอง
  // (ถ้าล้มเหลว จะคืนลิงก์เดิมเพื่อไม่ให้ผู้ใช้ตกค้าง)
  const genShortId = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // ตัดตัวกำกวม 0/O/1/l/I
    let s = "";
    for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  const createShortLink = async (targetUrl: string): Promise<string> => {
    if (!targetUrl) return targetUrl;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = genShortId();
        const { error } = await supabase
          .from("short_links" as any)
          .insert({ id, target_url: targetUrl } as any);
        if (!error) {
          return `${PUBLIC_APP_URL}#/r/${id}`;
        }
        // ชน id ซ้ำ -> สุ่มใหม่; error อื่น -> เลิก
        if (!String(error.message || "").toLowerCase().includes("duplicate")) break;
      }
    } catch {
      /* ignore -> fallback */
    }
    return targetUrl;
  };

  const buildMessage = (r: { assignee_name: string; content: string; due_date: string; fileLink: string; original_due_date?: string | null }) => {
    const extended = r.original_due_date && r.original_due_date !== r.due_date;
    const dueLine = extended
      ? `วันที่นัดส่งงานเดิมคือ : ${r.original_due_date}\nวันที่นัดส่งงานต่อเวลาใหม่ : ${r.due_date}`
      : `วันที่นัดส่งงานคือ : ${r.due_date}`;
    return `แจ้งมอบหมายงาน ให้คุน ${r.assignee_name}
คุนมีรายละเอียดงานถูกมอบหมายมาใหม่ดั่งนี้ : ${r.content}
ไฟล : ${r.fileLink || "-"}
${dueLine}
ขอให้คุน ${r.assignee_name} ช่วยวางแผน และ ส่งงานตามกำหนดด้วย
ขอบคุนครับ.`;
  };

  const normalizePhone = (p: string) => {
    let s = (p || "").replace(/[^\d+]/g, "");
    if (s.startsWith("+")) s = s.slice(1);
    else if (s.startsWith("0")) s = "66" + s.slice(1); // assume TH; user can override input
    return s;
  };

  // เปิด popup ให้ผู้ใช้เลือกช่องทางส่งทุกครั้ง (Desktop app / WhatsApp Web)
  const openWhatsApp = (toPhone: string, message: string) => {
    const p = normalizePhone(toPhone);
    if (!p) { toast.error("ไม่มีเบอร์โทรปลายทาง"); return; }
    setWaChoice({ phone: toPhone, message });
  };

  // ยิงเปิดจริงตามช่องทางที่เลือก
  const launchWhatsApp = (mode: "app" | "web", toPhone: string, message: string) => {
    const p = normalizePhone(toPhone);
    if (!p) { toast.error("ไม่มีเบอร์โทรปลายทาง"); return; }
    if (mode === "app") {
      // เปิดแอป WhatsApp บนเครื่อง (Desktop/Mobile native app)
      window.location.href = `whatsapp://send?phone=${p}&text=${encodeURIComponent(message)}`;
    } else {
      // เปิด WhatsApp Web ในแท็บใหม่ (ไม่เด้งไปแอป)
      const a = document.createElement("a");
      a.href = `https://web.whatsapp.com/send?phone=${p}&text=${encodeURIComponent(message)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setWaChoice(null);
  };

  const handleSave = async () => {
    if (!user) { toast.error("กรุณาเข้าสู่ระบบ"); return; }
    if (!assignee.trim()) { toast.error("กรอกชื่อผู้รับงาน"); return; }
    if (!content.trim()) { toast.error("กรอกเนื้อหางาน"); return; }
    if (!dueDate) { toast.error("เลือกวันที่นัดส่งงาน"); return; }
    const targetPhone = phone.trim();
    if (!targetPhone) { toast.error("ไม่มีเบอร์ปลายทาง — เลือกผู้รับงานที่มีเบอร์ในโปรไฟล์"); return; }

    setSaving(true);
    try {
      let attachment_url: string | null = existingAttachment?.url || null;
      let attachment_name: string | null = existingAttachment?.name || null;
      let attachment_type: string | null = existingAttachment?.type || null;
      if (file) {
        const r = await uploadFile(file);
        attachment_url = r.url; attachment_name = r.name; attachment_type = r.type;
      }

      if (editingId) {
        const { error } = await supabase
          .from("job_assignments" as any)
          .update({
            assignee_name: assignee.trim(),
            assignee_phone: targetPhone,
            content: content.trim(),
            attachment_url,
            attachment_name,
            attachment_type,
            due_date: dueDate,
          } as any)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("แก้ไขรายการเรียบร้อย");
      } else {
        const { error } = await supabase
          .from("job_assignments" as any)
          .insert({
            user_id: user.id,
            assignee_name: assignee.trim(),
            assignee_phone: targetPhone,
            content: content.trim(),
            attachment_url,
            attachment_name,
            attachment_type,
            due_date: dueDate,
          } as any);
        if (error) throw error;

        const fileLink = attachment_url ? await createShortLink(await getSignedUrl(attachment_url)) : "";
        const msg = buildMessage({
          assignee_name: assignee.trim(),
          content: content.trim(),
          due_date: dueDate,
          fileLink,
        });
        openWhatsApp(targetPhone, msg);
        toast.success("บันทึกแล้ว — เลือกช่องทางส่ง WhatsApp");
      }

      setOpenCreate(false);
      resetForm();
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const handleResend = async (r: JobRow) => {
    const fileLink = r.attachment_url ? await createShortLink(await getSignedUrl(r.attachment_url)) : "";
    const msg = buildMessage({
      assignee_name: r.assignee_name,
      content: r.content,
      due_date: r.due_date,
      fileLink,
      original_due_date: r.original_due_date,
    });
    openWhatsApp(r.assignee_phone || "", msg);
  };

  // ===== ทวงงาน — ข้อความเดิม + หัวเรื่องเด่น (WhatsApp ส่งสติกเกอร์จริง/reply เจาะจงไม่ได้) =====
  const handleRemind = async (r: JobRow) => {
    const fileLink = r.attachment_url ? await createShortLink(await getSignedUrl(r.attachment_url)) : "";
    const base = buildMessage({
      assignee_name: r.assignee_name,
      content: r.content,
      due_date: r.due_date,
      fileLink,
      original_due_date: r.original_due_date,
    });
    const overdue = daysUntil(r.due_date);
    const overdueLine = overdue < 0 ? `\n⏰ เลยกำหนดส่งมาแล้ว ${Math.abs(overdue)} วัน` : overdue === 0 ? `\n⏰ ครบกำหนดส่ง *วันนี้*` : "";
    const msg = `🔴📢 !! ขอทวงงาน !! 📢🔴${overdueLine}\n━━━━━━━━━━━━━━\n${base}`;
    openWhatsApp(r.assignee_phone || "", msg);
  };

  // ===== ต่อเวลา — ตั้งวันนัดส่งใหม่ + บันทึกประวัติการต่อ =====
  const openExtend = (r: JobRow) => {
    setExtendRow(r);
    setExtendDate(r.due_date);
  };

  const handleExtend = async () => {
    if (!extendRow) return;
    if (!extendDate) { toast.error("เลือกวันนัดส่งใหม่"); return; }
    const oldDue = extendRow.due_date;
    const days = dateDiffDays(oldDue, extendDate);
    if (days === 0) { toast.error("วันใหม่ต้องไม่ตรงกับวันเดิม"); return; }
    setExtendSaving(true);
    try {
      const exts: Extension[] = [...(extendRow.extensions || [])];
      exts.push({ at: new Date().toISOString().slice(0, 10), from: oldDue, to: extendDate, days });
      const original = extendRow.original_due_date || oldDue;
      const { error } = await supabase
        .from("job_assignments" as any)
        .update({ due_date: extendDate, original_due_date: original, extensions: exts as any } as any)
        .eq("id", extendRow.id);
      if (error) throw error;
      toast.success(`ต่อเวลาเป็น ${extendDate} แล้ว (${days > 0 ? "+" : ""}${days} วัน)`);
      setExtendRow(null);
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "ต่อเวลาไม่สำเร็จ");
    } finally {
      setExtendSaving(false);
    }
  };

  // ===== สำเร็จ — แนบหลักฐาน (ไฟล์/ข้อความ) แล้วย้ายไปแท็บงานสำเร็จ =====
  const openDone = (r: JobRow) => {
    setDoneRow(r);
    setDoneNote("");
    setDoneFile(null);
  };

  const handleDoneSave = async () => {
    if (!doneRow) return;
    if (!doneNote.trim() && !doneFile) { toast.error("กรอกข้อความ หรือ แนบไฟล์ อย่างน้อย 1 อย่าง"); return; }
    setDoneSaving(true);
    try {
      let cu: string | null = null, cn: string | null = null, ct: string | null = null;
      if (doneFile) {
        const u = await uploadFile(doneFile);
        cu = u.url; cn = u.name; ct = u.type;
      }
      const { error } = await supabase
        .from("job_assignments" as any)
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          completion_note: doneNote.trim() || null,
          completion_attachment_url: cu,
          completion_attachment_name: cn,
          completion_attachment_type: ct,
        } as any)
        .eq("id", doneRow.id);
      if (error) throw error;
      toast.success("บันทึกงานสำเร็จแล้ว — ย้ายไปแท็บงานสำเร็จ");
      setDoneRow(null);
      await loadRows();
    } catch (e: any) {
      toast.error(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setDoneSaving(false);
    }
  };

  // ===== แสดงสถานะ: วันนัดส่งเดิมเลยกี่วัน / ต่อเวลาครั้งที่ N กี่วัน =====
  const renderTimeStatus = (r: JobRow) => {
    const exts = r.extensions || [];
    if (exts.length === 0) return null;
    const origDue = r.original_due_date || r.due_date;
    const ref = (r.status === "done" && r.completed_at) ? new Date(r.completed_at) : new Date();
    ref.setHours(0, 0, 0, 0);
    const origMid = new Date(origDue); origMid.setHours(0, 0, 0, 0);
    const pastOrig = Math.round((ref.getTime() - origMid.getTime()) / 86400000);
    return (
      <div className="mt-1 space-y-0.5 text-[10px] leading-tight text-left">
        <div className="text-muted-foreground">
          เดิม {origDue}{pastOrig > 0 ? ` · เลย ${pastOrig} วัน` : ""}
        </div>
        {exts.map((e, i) => (
          <div key={i} className="text-blue-600 font-medium">
            ต่อเวลาครั้งที่ {i + 1}: +{e.days} วัน → {e.to}
          </div>
        ))}
      </div>
    );
  };

  const handleDelete = async (r: JobRow) => {
    if (!confirm("ลบรายการนี้?")) return;
    const { error } = await supabase.from("job_assignments" as any).delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("ลบแล้ว");
    await loadRows();
  };

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Job Assign — มอบหมายงาน</h1>
        <Button size="sm" onClick={() => { resetForm(); setUserSearch(""); setOpenCreate(true); }}>
          <Plus className="w-4 h-4 mr-1" /> มอบหมายงาน
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="assigned">มอบหมายงาน ({rows.filter(r => r.status !== "done").length})</TabsTrigger>
            <TabsTrigger value="done">งานสำเร็จ ({rows.filter(r => r.status === "done").length})</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "assigned" && (
          <>
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={showOnlyUpcoming} onCheckedChange={(c) => { setShowOnlyUpcoming(!!c); if (c) setShowOnlyOverdue(false); }} />
              ยังไม่ถึงกำหนด
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={showOnlyOverdue} onCheckedChange={(c) => { setShowOnlyOverdue(!!c); if (c) setShowOnlyUpcoming(false); }} />
              เลยกำหนด
            </label>
          </>
        )}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="ค้นหา ชื่อผู้รับงาน / วันที่สั่งงาน (YYYY-MM-DD)"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto border rounded-md">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">ไม่มีรายการ</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-2">ผู้รับงาน</th>
                <th className="px-2 py-2">เบอร์</th>
                <th className="px-2 py-2">เนื้อหางาน</th>
                <th className="px-2 py-2">ไฟล์</th>
                <th className="px-2 py-2">วันที่นัดส่ง</th>
                <th className="px-2 py-2 text-center">Countdown</th>
                <th className="px-2 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const d = daysUntil(r.due_date);
                const overdue = tab !== "done" && d < 0;
                return (
                  <tr key={r.id} className={`border-t ${overdue ? "bg-red-50" : ""}`}>
                    <td className="px-2 py-2 font-medium">{r.assignee_name}</td>
                    <td className="px-2 py-2 font-mono">{r.assignee_phone || "-"}</td>
                    <td className="px-2 py-2 max-w-[320px] whitespace-pre-wrap">{r.content}</td>
                    <td className="px-2 py-2">
                      {r.attachment_url ? (
                        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => openSignedUrl(r.attachment_url)}>
                          <Paperclip className="w-3 h-3 mr-1" />{r.attachment_name || "file"}
                        </Button>
                      ) : "-"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.due_date}</td>
                    <td className="px-2 py-2 text-center align-top">
                      {tab === "done" ? (
                        <span className="text-green-600 font-medium whitespace-nowrap">
                          ✓ {r.completed_at ? new Date(r.completed_at).toLocaleDateString("th-TH") : "สำเร็จ"}
                        </span>
                      ) : (
                        <span className={overdue ? "text-red-600 font-bold" : d <= 1 ? "text-orange-600 font-semibold" : ""}>
                          {overdue ? `เลย ${Math.abs(d)} วัน` : d === 0 ? "วันนี้" : `เหลือ ${d} วัน`}
                        </span>
                      )}
                      {renderTimeStatus(r)}
                      {tab === "done" && (r.completion_note || r.completion_attachment_url) && (
                        <div className="mt-1 text-[10px] text-left text-muted-foreground space-y-0.5">
                          {r.completion_note && <div className="whitespace-pre-wrap">📝 {r.completion_note}</div>}
                          {r.completion_attachment_url && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-blue-600 underline"
                              onClick={() => openSignedUrl(r.completion_attachment_url)}
                            >
                              <Paperclip className="w-3 h-3" />{r.completion_attachment_name || "หลักฐาน"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {tab !== "done" && (
                          <>
                            <Button variant="outline" size="sm" className="h-7" onClick={() => openEdit(r)} title="แก้ไข">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-7" onClick={() => handleResend(r)} title="ส่งซ้ำผ่าน WhatsApp">
                              <MessageCircle className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 text-amber-600 border-amber-300" onClick={() => handleRemind(r)} title="ทวงงาน (WhatsApp)">
                              <BellRing className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-7" onClick={() => openExtend(r)} title="ต่อเวลา (ตั้งวันนัดส่งใหม่)">
                              <Clock className="w-3.5 h-3.5 mr-1" />ต่อเวลา
                            </Button>
                            <Button variant="default" size="sm" className="h-7" onClick={() => openDone(r)}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />สำเร็จ
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => handleDelete(r)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "แก้ไขรายการงาน" : "มอบหมายงานใหม่"}</DialogTitle>
            <DialogDescription>
              {editingId ? "แก้ไขข้อมูลแล้วกดบันทึก (ไม่ส่ง WhatsApp ซ้ำ — กดปุ่ม 💬 ที่แถวเพื่อส่งซ้ำ)" : "กรอกข้อมูล แล้วระบบจะเด้งไปหน้า WhatsApp เพื่อส่งข้อความ"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <label className="text-xs font-medium">ชื่อผู้รับงาน * (เลือกจากรายชื่อผู้ใช้)</label>
              <Input
                value={userSearch}
                onChange={e => { setUserSearch(e.target.value); setUserListOpen(true); setAssignee(e.target.value); }}
                onFocus={() => setUserListOpen(true)}
                onBlur={() => setTimeout(() => setUserListOpen(false), 200)}
                placeholder="พิมพ์เพื่อค้นหา..."
              />
              {userListOpen && filteredUsers.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto border rounded-md bg-popover shadow-md">
                  {filteredUsers.map(u => (
                    <button
                      key={u.user_id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex justify-between gap-2"
                      onMouseDown={(e) => { e.preventDefault(); pickUser(u); }}
                    >
                      <span className="font-medium truncate">{u.full_name}</span>
                      <span className="text-muted-foreground font-mono">{u.phone || "-"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">เบอร์ปลายทาง (ดึงจากโปรไฟล์) *</label>
              <Input value={phone} readOnly placeholder="เลือกผู้รับงานก่อน" className="bg-muted/40" />
              <p className="text-[10px] text-muted-foreground mt-1">ขึ้นต้น 0 = ไทย หรือเริ่มด้วยรหัสประเทศ เช่น 856...</p>
            </div>
            <div>
              <label className="text-xs font-medium">เนื้อหางาน *</label>
              <Textarea rows={4} value={content} onChange={e => setContent(e.target.value)} placeholder="อธิบายงาน..." />
            </div>
            <div>
              <label className="text-xs font-medium">วันที่นัดส่งงาน *</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium">แนบไฟล์ (PDF / PNG / JPG / Excel ≤ 10MB)</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv,application/pdf,image/png,image/jpeg,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Paperclip className="w-3.5 h-3.5 mr-1" />เลือกไฟล์
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={pasteFromClipboard}>
                  <Clipboard className="w-3.5 h-3.5 mr-1" />วางจาก Clipboard
                </Button>
                {file ? (
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {file.name} ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                ) : existingAttachment ? (
                  <span className="text-xs text-muted-foreground truncate flex-1 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" />{existingAttachment.name} (เดิม)
                    <button type="button" className="text-destructive ml-1 underline" onClick={() => setExistingAttachment(null)}>ลบ</button>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : editingId ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <MessageCircle className="w-4 h-4 mr-1" />}
              {editingId ? "บันทึกการแก้ไข" : "Save & ส่ง WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* เลือกช่องทางส่ง WhatsApp */}
      <Dialog open={!!waChoice} onOpenChange={(o) => { if (!o) setWaChoice(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>ส่งผ่าน WhatsApp</DialogTitle>
            <DialogDescription>เลือกช่องทางที่จะเปิด</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => waChoice && launchWhatsApp("app", waChoice.phone, waChoice.message)}
            >
              <Monitor className="w-5 h-5 mr-2 text-emerald-600" />
              <div className="text-left">
                <div className="font-medium">แอป Desktop / มือถือ</div>
                <div className="text-[11px] text-muted-foreground">เปิดแอป WhatsApp ที่ติดตั้งบนเครื่อง</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => waChoice && launchWhatsApp("web", waChoice.phone, waChoice.message)}
            >
              <Globe className="w-5 h-5 mr-2 text-blue-600" />
              <div className="text-left">
                <div className="font-medium">WhatsApp Web</div>
                <div className="text-[11px] text-muted-foreground">เปิด web.whatsapp.com ในแท็บใหม่</div>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWaChoice(null)}>ยกเลิก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ต่อเวลา dialog */}
      <Dialog open={!!extendRow} onOpenChange={(o) => { if (!o) setExtendRow(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ต่อเวลา — ตั้งวันนัดส่งใหม่</DialogTitle>
            <DialogDescription>
              {extendRow ? `งานของ ${extendRow.assignee_name} · วันนัดส่งเดิม ${extendRow.due_date}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">วันนัดส่งใหม่ *</label>
              <Input type="date" value={extendDate} onChange={e => setExtendDate(e.target.value)} />
              {extendRow && extendDate && dateDiffDays(extendRow.due_date, extendDate) !== 0 && (
                <p className="text-[11px] mt-1 text-blue-600">
                  {dateDiffDays(extendRow.due_date, extendDate) > 0 ? "ต่อเพิ่ม" : "ร่นเข้า"} {Math.abs(dateDiffDays(extendRow.due_date, extendDate))} วัน
                  {(extendRow.extensions?.length || 0) > 0 ? ` · เป็นการต่อครั้งที่ ${(extendRow.extensions?.length || 0) + 1}` : ""}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendRow(null)} disabled={extendSaving}>ยกเลิก</Button>
            <Button onClick={handleExtend} disabled={extendSaving}>
              {extendSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Clock className="w-4 h-4 mr-1" />}
              บันทึกต่อเวลา
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* สำเร็จ + แนบหลักฐาน dialog */}
      <Dialog open={!!doneRow} onOpenChange={(o) => { if (!o) setDoneRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันงานสำเร็จ — แนบหลักฐาน</DialogTitle>
            <DialogDescription>
              {doneRow ? `งานของ ${doneRow.assignee_name} — แนบไฟล์ หรือ กรอกข้อความ อย่างน้อย 1 อย่าง` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">ข้อความอธิบายว่าเสร็จยังไง</label>
              <Textarea rows={3} value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder="เช่น ส่งของครบแล้ว / แนบใบส่งของ..." />
            </div>
            <div>
              <label className="text-xs font-medium">แนบหลักฐาน (PDF / PNG / JPG / Excel ≤ 10MB)</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  ref={doneFileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv,application/pdf,image/png,image/jpeg,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="hidden"
                  onChange={e => setDoneFile(e.target.files?.[0] || null)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => doneFileRef.current?.click()}>
                  <Paperclip className="w-3.5 h-3.5 mr-1" />เลือกไฟล์
                </Button>
                {doneFile && (
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {doneFile.name} ({(doneFile.size / 1024).toFixed(0)} KB)
                    <button type="button" className="text-destructive ml-2 underline" onClick={() => setDoneFile(null)}>ลบ</button>
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneRow(null)} disabled={doneSaving}>ยกเลิก</Button>
            <Button onClick={handleDoneSave} disabled={doneSaving}>
              {doneSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              บันทึกสำเร็จ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
