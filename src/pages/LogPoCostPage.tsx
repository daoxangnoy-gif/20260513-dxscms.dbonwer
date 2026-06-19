import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Download, Search, History } from "lucide-react";
import * as XLSX from "xlsx";

interface LogRow {
  id: string;
  po_cost_id: string | null;
  item_id: string | null;
  goodcode: string | null;
  product_name: string | null;
  vendor: string | null;
  moq: number | null;
  po_cost: number | null;
  po_cost_unit: number | null;
  activity: string;
  changes: any;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
}

const PAGE_SIZE = 100;

const ACTIVITY_COLOR: Record<string, string> = {
  INSERT: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  UPDATE: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  KEYEDIT: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-700 border-red-500/30",
  EXPORT: "bg-violet-500/15 text-violet-700 border-violet-500/30",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function renderChanges(changes: any): { col: string; old: any; new: any }[] {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes).map(([col, v]: [string, any]) => ({
    col,
    old: v?.old,
    new: v?.new,
  }));
}

export default function LogPoCostPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState<string>("ALL");
  const [currencyMap, setCurrencyMap] = useState<Record<string, string>>({}); // vendor_code -> currency

  // เรทแลกเปลี่ยน (ตัวเดียวกับหน้า PO Cost import เก็บใน localStorage)
  const rThb = useMemo(() => { const n = parseFloat(localStorage.getItem("po_cost_rate_thb") || ""); return Number.isFinite(n) && n > 0 ? n : null; }, []);
  const rUsd = useMemo(() => { const n = parseFloat(localStorage.getItem("po_cost_rate_usd") || ""); return Number.isFinite(n) && n > 0 ? n : null; }, []);

  // โหลดสกุลเงินของ vendor (vendor_code -> currency)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("vendor_master").select("vendor_code, supplier_currency");
      const m: Record<string, string> = {};
      for (const v of (data || []) as any[]) { if (v.vendor_code) m[String(v.vendor_code)] = String(v.supplier_currency || "").toUpperCase(); }
      setCurrencyMap(m);
    })();
  }, []);

  // Ex rate ของ vendor (LAK/ไม่ระบุ = 1, THB/USD ใช้เรทจาก localStorage)
  const exRateOf = (vendor: string | null): number | null => {
    const cur = currencyMap[vendor || ""] || "";
    if (cur === "" || cur === "LAK") return 1;
    if (cur === "THB") return rThb;
    if (cur === "USD") return rUsd;
    return 1; // สกุลอื่น ถือเป็น 1 (เหมือน logic import)
  };
  const lakOf = (po: number | null, vendor: string | null): number | null => {
    const rate = exRateOf(vendor);
    return po != null && rate != null ? po * rate : null;
  };

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("po_cost_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (activityFilter !== "ALL") q = q.eq("activity", activityFilter);
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`item_id.ilike.${s},vendor.ilike.${s},goodcode.ilike.${s},product_name.ilike.${s},user_email.ilike.${s}`);
      }

      const { data, error, count } = await q;
      if (error) throw error;
      setRows((data as LogRow[]) || []);
      setTotal(count || 0);
    } catch (err: any) {
      toast({ title: "โหลด Log ผิดพลาด", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, activityFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportXlsx = async () => {
    // Export current filter (all pages)
    let q = supabase
      .from("po_cost_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50000);
    if (activityFilter !== "ALL") q = q.eq("activity", activityFilter);
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`item_id.ilike.${s},vendor.ilike.${s},goodcode.ilike.${s},product_name.ilike.${s},user_email.ilike.${s}`);
    }
    const { data, error } = await q;
    if (error) { toast({ title: "Export ผิดพลาด", description: error.message, variant: "destructive" }); return; }
    const exportedRows = (data as LogRow[]) || [];

    // Log EXPORT activity
    try {
      const { data: userData } = await supabase.auth.getUser();
      const u = userData?.user;
      await supabase.from("po_cost_log").insert({
        activity: "EXPORT",
        user_id: u?.id ?? null,
        user_email: u?.email ?? null,
        changes: {
          rows_exported: { old: null, new: exportedRows.length },
          filter_activity: { old: null, new: activityFilter },
          filter_search: { old: null, new: search.trim() || null },
        },
      });
      // Refresh list to show the new EXPORT entry
      load();
    } catch (e) {
      console.error("Failed to log EXPORT", e);
    }

    const out = exportedRows.map(r => {
      const ch = renderChanges(r.changes);
      const moqCh = ch.find(c => c.col === "moq");
      const costCh = ch.find(c => c.col === "po_cost");
      return {
        Date: fmtDate(r.created_at),
        User: r.user_email || "-",
        Activity: r.activity,
        ItemID: r.item_id || "",
        Goodcode: r.goodcode || "",
        ProductName: r.product_name || "",
        Vendor: r.vendor || "",
        MOQ: r.moq ?? "",
        POCost: r.po_cost ?? "",
        POCostUnit: r.po_cost_unit ?? "",
        ExRate: exRateOf(r.vendor) ?? "",
        POCostLAK: lakOf(r.po_cost, r.vendor) ?? "",
        "MOQ_Old": moqCh?.old ?? "",
        "MOQ_New": moqCh?.new ?? "",
        "POCost_Old": costCh?.old ?? "",
        "POCost_New": costCh?.new ?? "",
        Changes: JSON.stringify(r.changes || {}),
      };
    });
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PO Cost Log");
    XLSX.writeFile(wb, `po_cost_log_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-2 flex-wrap">
        <History className="w-5 h-5 text-primary" />
        <h2 className="text-base font-semibold">Log - PO Cost</h2>
        <Badge variant="secondary" className="ml-1">{total.toLocaleString()} รายการ</Badge>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="ค้นหา Item / Vendor / User..."
              className="pl-7 h-8 w-64 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); load(); } }}
            />
          </div>

          <select
            value={activityFilter}
            onChange={(e) => { setActivityFilter(e.target.value); setPage(0); }}
            className="h-8 text-xs border border-input rounded-md px-2 bg-background"
          >
            <option value="ALL">ทุก Activity</option>
            <option value="INSERT">Insert</option>
            <option value="UPDATE">Update</option>
            <option value="KEYEDIT">Keyedit</option>
            <option value="DELETE">Delete</option>
            <option value="EXPORT">Export</option>
          </select>

          <Button size="sm" variant="outline" onClick={() => { setPage(0); load(); }} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={exportXlsx}>
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted z-10">
            <tr className="text-left">
              <th className="px-2 py-1.5 border-b border-border whitespace-nowrap">Date (yyyymmddhhmm)</th>
              <th className="px-2 py-1.5 border-b border-border">User</th>
              <th className="px-2 py-1.5 border-b border-border">Activity</th>
              <th className="px-2 py-1.5 border-b border-border">Item ID</th>
              <th className="px-2 py-1.5 border-b border-border">Goodcode</th>
              <th className="px-2 py-1.5 border-b border-border">Product Name</th>
              <th className="px-2 py-1.5 border-b border-border">Vendor</th>
              <th className="px-2 py-1.5 border-b border-border text-right">MOQ</th>
              <th className="px-2 py-1.5 border-b border-border text-right">PO Cost</th>
              <th className="px-2 py-1.5 border-b border-border text-right">PO Cost/Unit</th>
              <th className="px-2 py-1.5 border-b border-border text-right">Ex Rate</th>
              <th className="px-2 py-1.5 border-b border-border text-right">PO Cost (LAK)</th>
              <th className="px-2 py-1.5 border-b border-border">Changes (old → new)</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={13} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={13} className="text-center py-8 text-muted-foreground">ไม่มีข้อมูล Log</td></tr>
            )}
            {!loading && rows.map(r => {
              const ch = renderChanges(r.changes);
              return (
                <tr key={r.id} className="hover:bg-muted/50 border-b border-border/50">
                  <td className="px-2 py-1 font-mono">{fmtDate(r.created_at)}</td>
                  <td className="px-2 py-1">{r.user_email || <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-2 py-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${ACTIVITY_COLOR[r.activity] || "bg-muted"}`}>
                      {r.activity}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono">{r.item_id || "-"}</td>
                  <td className="px-2 py-1 font-mono">{r.goodcode || "-"}</td>
                  <td className="px-2 py-1 max-w-[260px] truncate" title={r.product_name || ""}>{r.product_name || "-"}</td>
                  <td className="px-2 py-1">{r.vendor || "-"}</td>
                  <td className="px-2 py-1 text-right">{r.moq ?? "-"}</td>
                  <td className="px-2 py-1 text-right">{r.po_cost ?? "-"}</td>
                  <td className="px-2 py-1 text-right">{r.po_cost_unit != null ? Number(r.po_cost_unit).toFixed(4) : "-"}</td>
                  <td className="px-2 py-1 text-right">
                    {(() => {
                      const cur = currencyMap[r.vendor || ""] || "";
                      const rate = exRateOf(r.vendor);
                      if (rate == null) return <span className="text-muted-foreground">-</span>;
                      return <span>{cur && cur !== "LAK" && <span className="text-muted-foreground mr-1">{cur}</span>}{rate.toLocaleString()}</span>;
                    })()}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {(() => {
                      const lak = lakOf(r.po_cost, r.vendor);
                      return lak != null ? Math.round(lak).toLocaleString() : <span className="text-muted-foreground">-</span>;
                    })()}
                  </td>
                  <td className="px-2 py-1">
                    {ch.length === 0 ? <span className="text-muted-foreground">-</span> : (
                      <div className="flex flex-col gap-0.5">
                        {ch.map((c, i) => (
                          <div key={i} className="text-[11px]">
                            <span className="font-semibold text-foreground">{c.col}:</span>{" "}
                            <span className="text-red-600 line-through">{c.old ?? "∅"}</span>
                            {" → "}
                            <span className="text-emerald-700 font-medium">{c.new ?? "∅"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          หน้า {page + 1} / {totalPages} · แสดง {rows.length} จาก {total.toLocaleString()}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}>
            ก่อนหน้า
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || loading}>
            ถัดไป
          </Button>
        </div>
      </div>
    </div>
  );
}
