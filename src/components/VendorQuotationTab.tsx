import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, RefreshCw, Search, Paperclip, Trash2, FileText, ExternalLink } from "lucide-react";

const BUCKET = "vendor-quotations";
const ACCEPT = ".pdf,.xls,.xlsx,.csv,image/*";

interface VendorRow {
  vendor_code: string;
  vendor_name: string;
  currency: string;
}
interface CountRow { active: number; discon: number; inactive: number; }
interface QuotationFile {
  id: string;
  vendor_code: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_at: string;
}

export default function VendorQuotationTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [counts, setCounts] = useState<Record<string, CountRow>>({});
  const [files, setFiles] = useState<Record<string, QuotationFile[]>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingVendorRef = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // 1) vendor ทั้งหมด (วนดึงทีละ 1000 จนครบ)
      const vmap = new Map<string, VendorRow>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("vendor_master")
          .select("vendor_code, vendor_name_en, vendor_name_la, supplier_currency")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const v of data as any[]) {
          if (!v.vendor_code) continue;
          if (!vmap.has(v.vendor_code)) {
            vmap.set(v.vendor_code, {
              vendor_code: v.vendor_code,
              vendor_name: v.vendor_name_la || v.vendor_name_en || "",
              currency: (v.supplier_currency || "").toUpperCase(),
            });
          }
        }
        if (data.length < PAGE) break;
      }
      const vlist = [...vmap.values()].sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));
      setVendors(vlist);

      // 2) นับสถานะต่อ vendor (RPC)
      const { data: cdata, error: cerr } = await (supabase as any).rpc("get_vendor_quotation_counts");
      const cmap: Record<string, CountRow> = {};
      if (!cerr && cdata) {
        for (const r of cdata as any[]) {
          cmap[r.vendor_code] = {
            active: Number(r.active_count) || 0,
            discon: Number(r.discon_count) || 0,
            inactive: Number(r.inactive_count) || 0,
          };
        }
      }
      setCounts(cmap);

      // 3) ไฟล์ที่แนบไว้
      await loadFiles();
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadFiles = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("vendor_quotation")
      .select("id, vendor_code, file_name, file_url, file_type, uploaded_at")
      .order("uploaded_at", { ascending: false });
    const fmap: Record<string, QuotationFile[]> = {};
    for (const f of (data || []) as QuotationFile[]) {
      if (!fmap[f.vendor_code]) fmap[f.vendor_code] = [];
      fmap[f.vendor_code].push(f);
    }
    setFiles(fmap);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const triggerUpload = (vendorCode: string) => {
    pendingVendorRef.current = vendorCode;
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const vendorCode = pendingVendorRef.current;
    e.target.value = "";
    if (!file || !vendorCode) return;
    setUploadingFor(vendorCode);
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${vendorCode}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: insErr } = await (supabase as any).from("vendor_quotation").insert({
        vendor_code: vendorCode,
        file_name: file.name,
        file_url: url,
        file_type: file.type || null,
        file_size: file.size,
        uploaded_by: user?.id ?? null,
      });
      if (insErr) throw insErr;
      toast({ title: "แนบไฟล์สำเร็จ", description: file.name });
      await loadFiles();
    } catch (err: any) {
      toast({ title: "แนบไฟล์ไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setUploadingFor(null);
      pendingVendorRef.current = null;
    }
  };

  const deleteFile = async (f: QuotationFile) => {
    if (!window.confirm(`ลบไฟล์ "${f.file_name}" ?`)) return;
    try {
      // ลบ object ใน storage (path = ส่วนหลัง /vendor-quotations/)
      const marker = `/${BUCKET}/`;
      const idx = f.file_url.indexOf(marker);
      if (idx >= 0) {
        const path = decodeURIComponent(f.file_url.slice(idx + marker.length));
        await supabase.storage.from(BUCKET).remove([path]);
      }
      const { error } = await (supabase as any).from("vendor_quotation").delete().eq("id", f.id);
      if (error) throw error;
      toast({ title: "ลบไฟล์แล้ว", description: f.file_name });
      await loadFiles();
    } catch (err: any) {
      toast({ title: "ลบไฟล์ไม่สำเร็จ", description: err.message, variant: "destructive" });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      v.vendor_code.toLowerCase().includes(q) ||
      v.vendor_name.toLowerCase().includes(q) ||
      v.currency.toLowerCase().includes(q)
    );
  }, [vendors, search]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFile} />

      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card flex-wrap">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="ค้นหา Vendor / รหัส / สกุลเงิน..."
            className="pl-7 h-8 w-72 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length.toLocaleString()} / {vendors.length.toLocaleString()} vendor</span>
        <Button size="sm" variant="outline" className="ml-auto text-xs" onClick={loadAll} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted z-10">
            <tr className="text-left">
              <th className="px-3 py-2 border-b">รหัส</th>
              <th className="px-3 py-2 border-b">ผู้สนอง (Vendor)</th>
              <th className="px-3 py-2 border-b">สกุลเงิน</th>
              <th className="px-3 py-2 border-b text-right">Active</th>
              <th className="px-3 py-2 border-b text-right">Discon</th>
              <th className="px-3 py-2 border-b text-right">Inactive</th>
              <th className="px-3 py-2 border-b">ใบเสนอราคา (แนบไฟล์)</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">ไม่พบ Vendor</td></tr>
            )}
            {!loading && filtered.map((v) => {
              const c = counts[v.vendor_code] || { active: 0, discon: 0, inactive: 0 };
              const vf = files[v.vendor_code] || [];
              return (
                <tr key={v.vendor_code} className="border-b border-border/50 hover:bg-muted/40 align-top">
                  <td className="px-3 py-1.5 font-mono">{v.vendor_code}</td>
                  <td className="px-3 py-1.5">{v.vendor_name || <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-1.5">{v.currency || <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.active > 0 ? <span className="text-emerald-600 font-medium">{c.active.toLocaleString()}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.discon > 0 ? <span className="text-amber-600 font-medium">{c.discon.toLocaleString()}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.inactive > 0 ? <span className="text-red-600 font-medium">{c.inactive.toLocaleString()}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-col gap-1">
                      {vf.map((f) => (
                        <div key={f.id} className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[260px]" title={f.file_name}>{f.file_name}</a>
                          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                          <button className="ml-1 text-destructive hover:bg-red-50 rounded p-0.5" title="ลบไฟล์" onClick={() => deleteFile(f)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] w-fit gap-1"
                        onClick={() => triggerUpload(v.vendor_code)} disabled={uploadingFor === v.vendor_code}>
                        {uploadingFor === v.vendor_code ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                        แนบไฟล์
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
