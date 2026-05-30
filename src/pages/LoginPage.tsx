import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Calculator, LogIn, UserPlus } from "lucide-react";
import dxScmLogo from "@/assets/dx-scm-logo.png";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignUp) {
      if (!fullName.trim() || !phone.trim() || !department.trim() || !email.trim() || !password.trim()) {
        toast({ title: "กรุณากรอกข้อมูลให้ครบทุกช่อง", variant: "destructive" });
        return;
      }
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim(), phone: phone.trim(), department: department.trim() } },
        });
        if (error) throw error;
        // Best-effort: update profile with phone/department in case trigger doesn't pick them up
        const uid = data.user?.id;
        if (uid) {
          await supabase.from("profiles").update({
            full_name: fullName.trim(),
            phone: phone.trim(),
            department: department.trim(),
          }).eq("user_id", uid);
        }
        toast({ title: "สมัครสมาชิกสำเร็จ", description: "รอ Admin อนุมัติเข้าใช้งาน" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Background decorations */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.15),transparent_60%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(99,102,241,0.1),transparent_60%)] pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <Card className="w-full max-w-md shadow-2xl border-0 bg-white/95 backdrop-blur-sm relative z-10">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <img
              src={dxScmLogo}
              alt="DX SCM Logo"
              className="w-10 h-10 object-contain"
            />
          </div>
          <CardTitle className="text-xl font-bold">DX Supplychain Management</CardTitle>
          <CardDescription className="text-sm">{isSignUp ? "สร้างบัญชีใหม่เพื่อเข้าใช้งาน" : "เข้าสู่ระบบเพื่อดำเนินการต่อ"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fullName">ชื่อ-นามสกุล <span className="text-red-500">*</span></Label>
                  <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="ชื่อ นามสกุล" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">เบอร์โทร <span className="text-red-500">*</span></Label>
                  <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="020 xxx xxxx" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department">แผนก <span className="text-red-500">*</span></Label>
                  <Input id="department" value={department} onChange={e => setDepartment(e.target.value)} placeholder="เช่น Buyer, SPC, Operations" required />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "กำลังดำเนินการ..." : isSignUp ? (
                <><UserPlus className="w-4 h-4 mr-2" />สมัครสมาชิก</>
              ) : (
                <><LogIn className="w-4 h-4 mr-2" />เข้าสู่ระบบ</>
              )}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {isSignUp ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?"}{" "}
            <button onClick={() => setIsSignUp(!isSignUp)} className="text-primary hover:underline font-medium">
              {isSignUp ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
