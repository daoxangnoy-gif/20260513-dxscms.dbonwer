import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Search } from "lucide-react";

interface StoreEntry { store_name: string; type_store: string; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stores: StoreEntry[]; // unique from current doc
}

export default function StorePriorityDialog({ open, onOpenChange, stores }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [priorities, setPriorities] = useState<Record<string, string>>({}); // store_name → priority string

  // Load existing priorities for user
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from("store_priority")
          .select("store_name, priority")
          .eq("user_id", user.id);
        if (error) throw error;
        const map: Record<string, string> = {};
        for (const r of (data || []) as any[]) {
          if (r.priority != null) map[r.store_name] = String(r.priority);
        }
        setPriorities(map);
      } catch (e: any) {
        toast({ title: "Load error", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, user, toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = [...stores].sort((a, b) => (a.type_store || "").localeCompare(b.type_store || "") || a.store_name.localeCompare(b.store_name));
    if (!q) return arr;
    return arr.filter(s => s.store_name.toLowerCase().includes(q) || (s.type_store || "").toLowerCase().includes(q));
  }, [stores, search]);

  const save = async () => {
    if (!user) { toast({ title: "ต้องเข้าสู่ระบบ", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const upserts: any[] = [];
      for (const s of stores) {
        const v = priorities[s.store_name];
        const n = v == null || v === "" ? null : Number(v);
        if (n == null || !Number.isFinite(n)) continue;
        upserts.push({
          user_id: user.id,
          store_name: s.store_name,
          type_store: s.type_store || null,
          priority: Math.round(n),
        });
      }
      if (upserts.length === 0) {
        toast({ title: "ยังไม่ได้ใส่ค่า Priority", variant: "destructive" });
        return;
      }
      const { error } = await (supabase as any)
        .from("store_priority")
        .upsert(upserts, { onConflict: "user_id,store_name" });
      if (error) throw error;
      toast({ title: "บันทึก Priority สำเร็จ", description: `${upserts.length} stores` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Save error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Store Priority</DialogTitle>
          <DialogDescription>
            กำหนดลำดับความสำคัญของแต่ละ Store (1 = สำคัญที่สุด) — ใช้สำหรับสูตรคำนวณภายหลัง
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ค้นหา Store / Type..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {filtered.length}/{stores.length}
          </span>
        </div>

        <div className="border rounded overflow-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-2 py-1.5 text-left">Type Store</th>
                <th className="px-2 py-1.5 text-left">Store Name</th>
                <th className="px-2 py-1.5 text-right w-24">Priority</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">
                  <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> กำลังโหลด...
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">
                  ไม่มี Store — ดึง Min/Max Doc ใน Tab คำนวน SAR ก่อน
                </td></tr>
              ) : filtered.map(s => (
                <tr key={s.store_name} className="border-t hover:bg-muted/50">
                  <td className="px-2 py-1">{s.type_store}</td>
                  <td className="px-2 py-1">{s.store_name}</td>
                  <td className="px-2 py-1 text-right">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      value={priorities[s.store_name] ?? ""}
                      onChange={e => setPriorities(p => ({ ...p, [s.store_name]: e.target.value }))}
                      className="h-7 text-xs w-20 text-right inline-block"
                      placeholder="-"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
