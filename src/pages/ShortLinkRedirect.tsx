import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

// เปิด short link: #/r/:id -> ค้น target_url ใน short_links แล้ว redirect
export default function ShortLinkRedirect() {
  const { id } = useParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) { setError("ลิงก์ไม่ถูกต้อง"); return; }
      const { data, error } = await supabase
        .from("short_links" as any)
        .select("target_url")
        .eq("id", id)
        .maybeSingle();
      const target = (data as any)?.target_url;
      if (error || !target) { setError("ไม่พบลิงก์ หรือ ลิงก์หมดอายุแล้ว"); return; }
      window.location.replace(target);
    })();
  }, [id]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {error ? (
        <span className="text-destructive">{error}</span>
      ) : (
        <>
          <Loader2 className="w-6 h-6 animate-spin" />
          กำลังเปิดไฟล์...
        </>
      )}
    </div>
  );
}
