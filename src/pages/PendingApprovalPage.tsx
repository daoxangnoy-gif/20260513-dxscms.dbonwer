import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, LogOut, CheckCircle2 } from "lucide-react";

export default function PendingApprovalPage() {
  const { user, signOut, refreshPermissions, userPermissions } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, phone, department")
      .eq("user_id", user.id).maybeSingle().then(({ data }) => {
        if (data) {
          setFullName(data.full_name || "");
          setPhone(data.phone || "");
          setDepartment(data.department || "");
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!fullName.trim()) {
      toast({ title: "กรุณากรอกชื่อจริง", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        department: department.trim() || null,
      }).eq("user_id", user.id);
      if (error) throw error;
      setSavedAt(Date.now());
      toast({ title: "บันทึกข้อมูลสำเร็จ", description: "รอ Admin อนุมัติเข้าใช้งาน" });
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async () => {
    await refreshPermissions();
    toast({ title: "ตรวจสอบสถานะแล้ว", description: userPermissions?.is_active ? "บัญชีถูกอนุมัติแล้ว" : "ยังไม่ได้รับการอนุมัติ" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-card border rounded-xl shadow-sm p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-xl font-bold">รออนุมัติเข้าใช้งาน</h1>
          <p className="text-sm text-muted-foreground">
            บัญชีของคุณยังไม่ได้รับการอนุมัติจาก Admin<br />
            กรุณากรอกข้อมูลเพิ่มเติมเพื่อให้ Admin พิจารณา
          </p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">ชื่อจริง <span className="text-red-500">*</span></Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="ชื่อ-นามสกุล" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">เบอร์โทร</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="020 xxx xxxx" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">แผนก</Label>
            <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="เช่น Buyer, SPC, Operations" />
          </div>
        </div>

        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? "กำลังบันทึก..." : savedAt ? <><CheckCircle2 className="w-4 h-4 mr-1.5" /> บันทึกข้อมูล</> : "บันทึกข้อมูล"}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={handleCheck}>
            ตรวจสอบสถานะ
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-3.5 h-3.5 mr-1.5" /> ออกจากระบบ
          </Button>
        </div>
      </div>
    </div>
  );
}
