import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BookOpen, Plus, Trash2, ImagePlus, Pencil, Check, X, Save, Loader2, Cloud } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface HelpBox {
  id: string;
  title: string;
  body: string;
  images: string[]; // URLs (from storage) — legacy data may contain base64 data URLs
}

interface HelpSection {
  id: string;
  name: string;
  boxes: HelpBox[];
}

const STORAGE_KEY = "srr_help_sections_v1";
const BUCKET = "help-images";

const DEFAULT_SECTIONS: HelpSection[] = [
  {
    id: "dc",
    name: "SRR DC",
    boxes: [
      { id: crypto.randomUUID(), title: "ขั้นตอนที่ 1", body: "เขียนคำอธิบายและใส่รูปประกอบได้ที่นี่...", images: [] },
    ],
  },
  {
    id: "direct",
    name: "SRR DIRECT",
    boxes: [
      { id: crypto.randomUUID(), title: "ขั้นตอนที่ 1", body: "เขียนคำอธิบายและใส่รูปประกอบได้ที่นี่...", images: [] },
    ],
  },
];

function loadLocalSections(): HelpSection[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

async function uploadDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type.split("/")[1] || "png").split("+")[0];
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function fileToUrl(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function HelpBoxCard({
  box, editing, onChange, onDelete, onToggleEdit,
}: {
  box: HelpBox;
  editing: boolean;
  onChange: (b: HelpBox) => void;
  onDelete: () => void;
  onToggleEdit: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const [uploading, setUploading] = useState(false);
  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!arr.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of arr) {
        if (f.size > 8 * 1024 * 1024) {
          toast({ title: "ไฟล์ใหญ่เกิน 8MB", description: f.name, variant: "destructive" });
          continue;
        }
        urls.push(await fileToUrl(f));
      }
      if (urls.length) onChange({ ...box, images: [...box.images, ...urls] });
    } catch (e: any) {
      toast({ title: "อัปโหลดรูปไม่ได้", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (!editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      await handleFiles(files);
      toast({ title: "วางรูปเรียบร้อย", description: `เพิ่ม ${files.length} รูป` });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
      {/* LEFT: Text box */}
      <Card className="shadow-sm border-l-4 border-l-primary/40 flex flex-col">
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2 space-y-0">
          {editing ? (
            <Input
              value={box.title}
              onChange={e => onChange({ ...box, title: e.target.value })}
              className="font-semibold text-base h-9"
              placeholder="หัวข้อ..."
            />
          ) : (
            <CardTitle className="text-base">{box.title || <span className="text-muted-foreground italic">ไม่มีหัวข้อ</span>}</CardTitle>
          )}
          <div className="flex gap-1 flex-shrink-0">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onToggleEdit}>
              {editing ? <Check className="w-4 h-4 text-primary" /> : <Pencil className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          {editing ? (
            <Textarea
              value={box.body}
              onChange={e => onChange({ ...box, body: e.target.value })}
              placeholder="พิมพ์เนื้อหา..."
              className="min-h-[200px] h-full text-sm"
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap text-foreground/90">
              {box.body || <span className="text-muted-foreground italic">ไม่มีเนื้อหา</span>}
            </p>
          )}
        </CardContent>
      </Card>

      {/* RIGHT: Image box (same size as text box) */}
      <Card
        className="shadow-sm overflow-hidden flex flex-col bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary"
        tabIndex={editing ? 0 : -1}
        onPaste={handlePaste}
      >
        <CardContent className="p-2 flex-1 flex flex-col gap-2">
          {box.images.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-md min-h-[240px]">
              <ImagePlus className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">ยังไม่มีรูป</p>
              {editing && (
                <p className="text-[10px] mt-1 opacity-70">คลิกที่กล่องนี้แล้วกด Ctrl+V เพื่อวางรูป</p>
              )}
              {editing && (
                <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="w-3.5 h-3.5 mr-1" /> เพิ่มรูป
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={`grid gap-2 flex-1 ${box.images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {box.images.map((src, i) => (
                  <div key={i} className="relative group rounded-md overflow-hidden border bg-background min-h-[120px]">
                    <img
                      src={src}
                      alt={`${box.title} ${i + 1}`}
                      className="w-full h-full object-cover cursor-zoom-in"
                      onClick={() => setPreview(src)}
                    />
                    {editing && (
                      <button
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                        onClick={() => onChange({ ...box, images: box.images.filter((_, j) => j !== i) })}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editing && (
                <Button variant="outline" size="sm" className="text-xs w-full" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="w-3.5 h-3.5 mr-1" /> เพิ่มรูป
                </Button>
              )}
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl p-2">
          {preview && <img src={preview} alt="preview" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SRRHelpPage() {
  const [sections, setSections] = useState<HelpSection[]>(DEFAULT_SECTIONS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();

  // Load from cloud (with localStorage migration)
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("help_sections")
          .select("id, data")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;

        if (data) {
          setDocId(data.id);
          const cloudSecs = (data.data as any) as HelpSection[];
          if (Array.isArray(cloudSecs) && cloudSecs.length > 0) {
            setSections(cloudSecs);
          } else {
            // Empty cloud doc → migrate from localStorage if exists
            const local = loadLocalSections();
            if (local && local.length > 0) {
              const migrated = await migrateSections(local);
              setSections(migrated);
              await supabase.from("help_sections").update({ data: migrated as any }).eq("id", data.id);
              toast({ title: "ย้ายข้อมูลจากเครื่องสู่ Cloud แล้ว", description: "ข้อมูลปลอดภัยแล้ว" });
            } else {
              setSections(DEFAULT_SECTIONS);
            }
          }
        }
      } catch (e: any) {
        toast({ title: "โหลดไม่ได้", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Migrate base64 images → storage URLs
  const migrateSections = async (secs: HelpSection[]): Promise<HelpSection[]> => {
    const out: HelpSection[] = [];
    for (const sec of secs) {
      const newBoxes: HelpBox[] = [];
      for (const b of sec.boxes) {
        const newImgs: string[] = [];
        for (const img of b.images) {
          if (img.startsWith("data:")) {
            try { newImgs.push(await uploadDataUrl(img)); } catch { /* skip */ }
          } else {
            newImgs.push(img);
          }
        }
        newBoxes.push({ ...b, images: newImgs });
      }
      out.push({ ...sec, boxes: newBoxes });
    }
    return out;
  };

  // Save to cloud (debounced)
  useEffect(() => {
    if (loading) return;
    if (!dirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        if (docId) {
          await supabase.from("help_sections").update({ data: sections as any, updated_at: new Date().toISOString() }).eq("id", docId);
        } else {
          const { data } = await supabase.from("help_sections").insert({ data: sections as any }).select("id").single();
          if (data) setDocId(data.id);
        }
        setDirty(false);
      } catch (e: any) {
        toast({ title: "บันทึก Cloud ไม่ได้", description: e.message, variant: "destructive" });
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [sections, dirty, docId, loading, toast]);

  const setSecs = (updater: (s: HelpSection[]) => HelpSection[]) => {
    setSections(updater);
    setDirty(true);
  };

  const updateBox = (sectionId: string, boxId: string, next: HelpBox) => {
    setSecs(s => s.map(sec => sec.id === sectionId
      ? { ...sec, boxes: sec.boxes.map(b => b.id === boxId ? next : b) }
      : sec));
  };

  const addBox = (sectionId: string) => {
    const newBox: HelpBox = { id: crypto.randomUUID(), title: "หัวข้อใหม่", body: "", images: [] };
    setSecs(s => s.map(sec => sec.id === sectionId ? { ...sec, boxes: [...sec.boxes, newBox] } : sec));
    setEditingId(newBox.id);
  };

  const deleteBox = (sectionId: string, boxId: string) => {
    if (!confirm("ลบกล่องนี้?")) return;
    setSecs(s => s.map(sec => sec.id === sectionId
      ? { ...sec, boxes: sec.boxes.filter(b => b.id !== boxId) }
      : sec));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> กำลังโหลดคู่มือ...
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-center gap-3 pb-2 border-b">
          <BookOpen className="w-7 h-7 text-primary" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold">คู่มือการใช้งาน SRR</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> กำลังบันทึก Cloud...</>
                : dirty ? <><Save className="w-3 h-3" /> รอบันทึก...</>
                : <><Cloud className="w-3 h-3 text-green-600" /> บันทึกไว้บน Cloud · ทุกคนเห็นเหมือนกัน</>}
            </p>
          </div>
        </div>

        {sections.map(sec => (
          <section key={sec.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="w-1.5 h-6 bg-primary rounded-full" />
                {sec.name}
              </h2>
              <Button size="sm" onClick={() => addBox(sec.id)}>
                <Plus className="w-4 h-4 mr-1" /> เพิ่มกล่อง
              </Button>
            </div>

            <div className="space-y-4">
              {sec.boxes.map(box => (
                <HelpBoxCard
                  key={box.id}
                  box={box}
                  editing={editingId === box.id}
                  onChange={(b) => updateBox(sec.id, box.id, b)}
                  onDelete={() => deleteBox(sec.id, box.id)}
                  onToggleEdit={() => setEditingId(editingId === box.id ? null : box.id)}
                />
              ))}
              {sec.boxes.length === 0 && (
                <p className="text-sm text-muted-foreground italic text-center py-8 border-2 border-dashed rounded-lg">
                  ยังไม่มีกล่อง — กด "เพิ่มกล่อง" เพื่อเริ่ม
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}
