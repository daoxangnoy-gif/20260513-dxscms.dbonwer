import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { useToast } from "@/hooks/use-toast";
import {
  PackageX, Loader2, Download, Database, BarChart3, Save, Calculator, X, ChevronLeft, ChevronRight,
  TrendingUp, ArrowUp, ArrowDown, Minus, RefreshCw, Trash2, ChevronDown,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  OOSRow, OOSFilters, OOSSummary, OOSSnapshotMeta, OOSFilterOptions, OOSTrendRow,
  getOOSDetailPreview, getOOSDetailPage, saveOOSSnapshot, getOOSFilterOptions, listOOSSnapshots,
  loadOOSSnapshotRows, computeOOSSummary, getWeekLabel, getOOSTrend, deleteOOSSnapshot,
  refreshOOSMv, getOOSMvStatus,
} from "@/lib/oosService";

const GET_CHUNK = 50000; // ขนาด chunk ตอนโหลดชุดเต็ม (เลี่ยง payload ใหญ่)

// คอลัมน์ Data tab (ลากปรับกว้างได้ + บรรทัดเดียว)
type DataCol = { key: keyof OOSRow; label: string; w: number; align?: "right"; mono?: boolean };
const DATA_COLUMNS: DataCol[] = [
  { key: "division", label: "Division", w: 95 },
  { key: "department", label: "Department", w: 130 },
  { key: "store_name", label: "Range Store", w: 170 },
  { key: "id_match", label: "Id Mactch", w: 190, mono: true },
  { key: "sku", label: "SKU", w: 100, mono: true },
  { key: "barcode", label: "Barcode", w: 125, mono: true },
  { key: "name_la", label: "Name (LA)", w: 240 },
  { key: "vendor", label: "Vendor", w: 200 },
  { key: "teadterm", label: "Teadterm", w: 90 },
  { key: "item_type", label: "Type", w: 80 },
  { key: "buying", label: "Buying", w: 100 },
  { key: "rank_sale", label: "Rank", w: 60 },
  { key: "store_apply", label: "Store Apply", w: 95, align: "right" },
  { key: "stock_store", label: "Stock Store", w: 95, align: "right" },
  { key: "stock_dc", label: "Stock DC", w: 90, align: "right" },
  { key: "remark_stock", label: "Remark Stock", w: 120 },
  { key: "remark_oos", label: "Remark OOS", w: 120 },
];

const TREND_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

const PAGE_SIZE = 50;
const LIVE = "__live__";

function pct(n: number) {
  return (n * 100).toFixed(2) + "%";
}
function pctClass(n: number) {
  if (n > 0.4) return "text-destructive font-semibold";
  if (n >= 0.2) return "text-amber-600 font-medium";
  return "text-green-600";
}

export default function ReportOOSPage() {
  const { toast } = useToast();
  const weekLabel = useMemo(() => getWeekLabel(), []);

  const [activeTab, setActiveTab] = useState("data");
  const [opts, setOpts] = useState<OOSFilterOptions | null>(null);

  // filters
  const [spc, setSpc] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [typeStores, setTypeStores] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);

  // data
  const [rows, setRows] = useState<OOSRow[]>([]);
  const [summary, setSummary] = useState<OOSSummary | null>(null);

  // ความกว้างคอลัมน์ Data tab (ลากปรับได้)
  const [colW, setColW] = useState<Record<string, number>>(() =>
    Object.fromEntries(DATA_COLUMNS.map((c) => [c.key, c.w]))
  );
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colW[key];
    const onMove = (ev: MouseEvent) =>
      setColW((w) => ({ ...w, [key]: Math.max(48, startW + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };
  const tableW = useMemo(() => DATA_COLUMNS.reduce((s, c) => s + colW[c.key], 0), [colW]);

  // ui state
  const [getting, setGetting] = useState(false);      // phase 1: ยังไม่มีแถวเลย
  const [loadingMore, setLoadingMore] = useState(false); // phase 2: มีแถวแล้ว กำลังโหลดเพิ่ม
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // สถานะการดึงข้อมูล + ตัวนับวินาที real-time
  const [loadStatus, setLoadStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [lastLoadInfo, setLastLoadInfo] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimer = (status: string) => {
    setLoadStatus(status);
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // snapshots
  const [snapshots, setSnapshots] = useState<OOSSnapshotMeta[]>([]);
  const [selectedSnap, setSelectedSnap] = useState<string>(LIVE);
  const [snapChecked, setSnapChecked] = useState<Set<string>>(new Set());

  // materialized view freshness
  const [mvAt, setMvAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // trend
  const [trend, setTrend] = useState<OOSTrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendLoaded, setTrendLoaded] = useState(false);

  useEffect(() => {
    getOOSFilterOptions().then(setOpts).catch((e) =>
      toast({ title: "โหลดตัวเลือกไม่สำเร็จ", description: e.message, variant: "destructive" })
    );
    refreshSnapshots();
    getOOSMvStatus().then((s) => setMvAt(s.refreshed_at)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtMvAt = (iso: string | null) => {
    if (!iso) return "ยังไม่เคย refresh";
    const d = new Date(iso);
    return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const handleRefreshMv = async () => {
    if (!window.confirm("รีเฟรชข้อมูล OOS จากฐานข้อมูลล่าสุด?\n\nใช้เวลาประมาณ 1-2 นาที (ทำหลัง import stock ใหม่)")) return;
    setRefreshing(true);
    startTimer("กำลังรีเฟรชข้อมูล (ประมวลผลฝั่ง server)...");
    try {
      const res = await refreshOOSMv();
      setMvAt(res.refreshed_at);
      setLastLoadInfo(`รีเฟรชข้อมูลแล้ว · ${res.row_count.toLocaleString()} แถว`);
      toast({ title: "รีเฟรชข้อมูลสำเร็จ", description: `${res.row_count.toLocaleString()} แถว · ข้อมูล ณ ${fmtMvAt(res.refreshed_at)}` });
    } catch (e: any) {
      toast({
        title: "รีเฟรชไม่สำเร็จ/ใช้เวลานาน",
        description: `${e.message || e} — ถ้าใช้เวลานานเกิน อาจยังทำงานเบื้องหลัง รอสักครู่แล้วเปิดหน้าใหม่เพื่อเช็ค "ข้อมูล ณ"`,
        variant: "destructive",
      });
    } finally {
      stopTimer();
      setRefreshing(false);
    }
  };

  const refreshSnapshots = () =>
    listOOSSnapshots().then(setSnapshots).catch(() => {});

  const currentFilters = (): OOSFilters => ({
    spc, vendors, divisions, departments, typeStores, stores,
  });

  // ===== display maps =====
  const vendorLabel = useMemo(() => {
    const m = new Map<string, string>();
    opts?.vendors.forEach((v) =>
      m.set(v.vendor_code, v.vendor_name_en ? `${v.vendor_code} · ${v.vendor_name_en}` : v.vendor_code)
    );
    return m;
  }, [opts]);

  // store options กรองตาม type store ที่เลือก
  const storeOptions = useMemo(() => {
    const list = opts?.stores || [];
    const f = typeStores.length ? list.filter((s) => typeStores.includes(s.type_store)) : list;
    return f.map((s) => s.store_name);
  }, [opts, typeStores]);

  const clearFilters = () => {
    setSpc([]); setVendors([]); setDivisions([]); setDepartments([]); setTypeStores([]); setStores([]);
  };

  // ===== actions =====
  const handleGet = async () => {
    if (!hasFilters) {
      toast({
        title: "กรุณาเลือกตัวกรองอย่างน้อย 1 อย่าง",
        description: "เพื่อไม่ให้ดึงข้อมูลทั้งหมด (หนักมาก ~140k แถว) — ถ้าต้องการดูทั้งหมด ให้ Save เป็น snapshot แล้วเปิดจาก dropdown",
        variant: "destructive",
      });
      return;
    }
    setGetting(true);
    setSummary(null);
    setLastLoadInfo("");
    setSelectedSnap(LIVE);
    setActiveTab("data");
    startTimer("กำลังดึงตัวอย่าง 100 แถวแรก...");
    const t0 = Date.now();
    const f = currentFilters();
    try {
      // Phase 1: preview 100 แถว (เร็ว) → โชว์ทันที
      const preview = await getOOSDetailPreview(f, 100);
      setRows(preview);
      setPage(0);
      setGetting(false);          // ตารางขึ้นแล้ว
      setLoadingMore(true);       // โหลดส่วนที่เหลือต่อ

      // Phase 2: โหลดชุดเต็มทีละ chunk แล้ว append (progressive)
      let acc: OOSRow[] = [];
      let offset = 0;
      while (true) {
        setLoadStatus(`กำลังโหลดข้อมูลทั้งหมด... ${acc.length.toLocaleString()} แถว`);
        const chunk = await getOOSDetailPage(f, GET_CHUNK, offset);
        acc = offset === 0 ? chunk : acc.concat(chunk);
        setRows([...acc]);
        if (chunk.length < GET_CHUNK) break;
        offset += GET_CHUNK;
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      setLastLoadInfo(`ดึง ${acc.length.toLocaleString()} แถว ใน ${secs} วินาที`);
      toast({ title: "ดึงข้อมูลครบแล้ว", description: `${acc.length.toLocaleString()} แถว · ${secs} วินาที` });
    } catch (e: any) {
      toast({
        title: "ดึงข้อมูลไม่สำเร็จ/ไม่ครบ",
        description: `${e.message || e} — ถ้าข้อมูลใหญ่ ลองใส่ตัวกรอง หรือ Save เป็น snapshot แล้วเปิดดู`,
        variant: "destructive",
      });
    } finally {
      stopTimer();
      setGetting(false);
      setLoadingMore(false);
    }
  };

  const handleCal = () => {
    if (rows.length === 0) return;
    setSummary(computeOOSSummary(rows));
    setActiveTab("report");
    toast({ title: "คำนวณสำเร็จ", description: `${weekLabel}` });
  };

  const handleSave = async () => {
    // Save ทำงาน server-side (regenerate จาก filter) ไม่ต้องโหลดมา client ก่อน → Save ทั้งหมดได้
    const scope = hasFilters ? "ตามตัวกรองที่เลือก" : "ทั้งหมด (~140k แถว — ใช้เวลาสักครู่)";
    const existing = snapshots.find((s) => s.week_label === weekLabel);
    const msg = existing
      ? `${weekLabel} มี snapshot อยู่แล้ว — บันทึกทับของเดิม (${scope}) ไหม?`
      : `บันทึก snapshot ${weekLabel} (${scope})?`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    startTimer("กำลังบันทึก snapshot (ประมวลผลฝั่ง server)...");
    try {
      const res = await saveOOSSnapshot(weekLabel, currentFilters());
      setLastLoadInfo(`บันทึก ${weekLabel} · ${res.total_rows.toLocaleString()} แถว`);
      toast({ title: "บันทึกสำเร็จ", description: `${weekLabel} · ${res.total_rows.toLocaleString()} แถว` });
      await refreshSnapshots();
      setTrendLoaded(false); // ให้ Trend โหลดใหม่
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      stopTimer();
      setSaving(false);
    }
  };

  const handleSelectSnap = async (val: string) => {
    setSelectedSnap(val);
    if (val === LIVE) {
      setRows([]); setSummary(null); setPage(0);
      return;
    }
    setGetting(true);
    setLastLoadInfo("");
    startTimer("กำลังโหลด snapshot...");
    const t0 = Date.now();
    try {
      const data = await loadOOSSnapshotRows(val);
      setRows(data);
      setSummary(computeOOSSummary(data));
      setPage(0);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      setLastLoadInfo(`โหลด ${data.length.toLocaleString()} แถว ใน ${secs} วินาที`);
      toast({ title: "โหลด snapshot สำเร็จ", description: `${data.length.toLocaleString()} แถว · ${secs} วินาที` });
    } catch (e: any) {
      toast({ title: "โหลด snapshot ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      stopTimer();
      setGetting(false);
    }
  };

  const toggleSnapCheck = (id: string, checked: boolean) =>
    setSnapChecked((prev) => {
      const s = new Set(prev);
      if (checked) s.add(id); else s.delete(id);
      return s;
    });

  const handleDeleteSelected = async () => {
    const ids = [...snapChecked];
    if (ids.length === 0) return;
    if (!window.confirm(`ลบ snapshot ที่เลือก ${ids.length} รายการ?\n\nลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await Promise.all(ids.map((id) => deleteOOSSnapshot(id)));
      if (ids.includes(selectedSnap)) {
        setSelectedSnap(LIVE);
        setRows([]); setSummary(null); setPage(0);
      }
      setSnapChecked(new Set());
      await refreshSnapshots();
      setTrendLoaded(false); // ให้ Trend โหลดใหม่
      toast({ title: `ลบ ${ids.length} snapshot แล้ว` });
    } catch (e: any) {
      toast({ title: "ลบไม่สำเร็จ", description: e.message, variant: "destructive" });
    }
  };

  // ===== Trend =====
  const loadTrend = async () => {
    setTrendLoading(true);
    try {
      const data = await getOOSTrend();
      setTrend(data);
      setTrendLoaded(true);
    } catch (e: any) {
      toast({ title: "โหลด Trend ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setTrendLoading(false);
    }
  };

  // ===== data tab: search + paginate =====
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        r.barcode.toLowerCase().includes(q) ||
        r.name_la.toLowerCase().includes(q) ||
        r.store_name.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, page]
  );
  useEffect(() => { setPage(0); }, [search]);

  // โหลด trend อัตโนมัติครั้งแรกที่เปิดแท็บ Trend
  useEffect(() => {
    if (activeTab === "trend" && !trendLoaded && !trendLoading) loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ===== trend pivot (type_store x week -> %OOS, นิยาม B) =====
  const trendView = useMemo(() => {
    const GRAND = "∑ ALL"; // แถวรวมทั้งหมดจาก RPC (distinct ข้ามทุกกลุ่ม)
    // weeks เรียงตามวันที่
    const weekMap = new Map<string, string>(); // week_label -> snapshot_date
    for (const r of trend) {
      const cur = weekMap.get(r.week_label);
      if (!cur || r.snapshot_date > cur) weekMap.set(r.week_label, r.snapshot_date);
    }
    const weeks = [...weekMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([w]) => w);

    const types = [...new Set(trend.map((r) => r.type_store).filter((t) => t !== GRAND))].sort();

    const cell = new Map<string, number>();       // "type|week" -> pct
    const grandCell = new Map<string, number>();   // "week" -> pct
    for (const r of trend) {
      const p = r.n_range > 0 ? r.n_oos / r.n_range : 0;
      if (r.type_store === GRAND) grandCell.set(r.week_label, p);
      else cell.set(`${r.type_store}|${r.week_label}`, p);
    }

    // chart data: 1 จุดต่อ week, field ต่อ type + Total (% ตัวเลข)
    const chart = weeks.map((w) => {
      const row: any = { week: w };
      for (const t of types) {
        const c = cell.get(`${t}|${w}`);
        row[t] = c == null ? null : +(c * 100).toFixed(2);
      }
      const g = grandCell.get(w);
      row["Total"] = g == null ? null : +(g * 100).toFixed(2);
      return row;
    });

    const getPct = (type: string, w: string) => cell.get(`${type}|${w}`) ?? null;
    const getTotalPct = (w: string) => grandCell.get(w) ?? null;
    return { weeks, types, chart, getPct, getTotalPct };
  }, [trend]);

  // ===== export =====
  const handleExport = () => {
    if (rows.length === 0) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Data (ตรงตามไฟล์ตัวอย่าง)
    const dataSheet = rows.map((r) => ({
      Division: r.division,
      Department: r.department,
      "Range Store": r.store_name,
      "Id Mactch": r.id_match,
      SKU: r.sku,
      Barcode: r.barcode,
      "Name (LA)": r.name_la,
      Vendor: r.vendor,
      Teadterm: r.teadterm,
      Type: r.item_type,
      Buying: r.buying,
      Rank: r.rank_sale,
      "Store Apply": r.store_apply,
      "Stock Store": r.stock_store,
      "Stock DC": r.stock_dc,
      "Remark Stock": r.remark_stock,
      "Remark OOS": r.remark_oos,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataSheet), "Data");

    // Sheet 2: Report (+ Total ราย type store)
    const sum = summary || computeOOSSummary(rows);
    const reportSheet: any[] = [];
    let curType = "";
    for (const s of sum.stores) {
      if (s.type_store !== curType) {
        curType = s.type_store;
      }
      reportSheet.push({
        Week: weekLabel,
        "Type store": s.type_store,
        "Store Name": s.store_name,
        StockHaveStock: s.have_stock,
        "Store OOS": s.oos,
        "Range Store": s.range,
        "% OOS": s.pct_oos,
      });
      // ถ้าเป็นสาขาสุดท้ายของ type นี้ → ใส่ total
      const idx = sum.stores.indexOf(s);
      const next = sum.stores[idx + 1];
      if (!next || next.type_store !== s.type_store) {
        const t = sum.totals.find((x) => x.type_store === s.type_store);
        if (t)
          reportSheet.push({
            Week: weekLabel,
            "Type store": s.type_store,
            "Store Name": "Total (Distinct SKU)",
            StockHaveStock: t.have_stock,
            "Store OOS": t.oos,
            "Range Store": t.range,
            "% OOS": t.range > 0 ? t.oos / t.range : 0,
          });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportSheet), "Report");

    XLSX.writeFile(wb, `Report_OOS_${weekLabel.replace(/\s/g, "")}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const hasFilters = spc.length || vendors.length || divisions.length || departments.length || typeStores.length || stores.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <PackageX className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Report OOS</h1>
          <Badge variant="secondary" className="ml-1">{weekLabel}</Badge>
          <span className="text-[11px] text-muted-foreground ml-1" title="เวลาที่ข้อมูลถูกประมวลผลล่าสุด (กดรีเฟรชหลัง import stock ใหม่)">
            🗄 ข้อมูล ณ {fmtMvAt(mvAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-[240px] text-xs justify-between font-normal">
                <span className="truncate">
                  {selectedSnap === LIVE
                    ? "● Live (ยังไม่ save)"
                    : (() => { const s = snapshots.find((x) => x.id === selectedSnap); return s ? `📅 ${s.week_label} · ${s.snapshot_date}` : "เลือก snapshot"; })()}
                </span>
                <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[340px] p-2" align="end">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-xs font-semibold">Snapshot ({snapshots.length})</span>
                <button className="text-[10px] text-primary hover:underline" onClick={refreshSnapshots}>รีเฟรช</button>
              </div>
              <button
                className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent ${selectedSnap === LIVE ? "bg-accent font-medium" : ""}`}
                onClick={() => handleSelectSnap(LIVE)}
              >
                ● Live (ยังไม่ save)
              </button>
              <div className="max-h-64 overflow-auto space-y-0.5 mt-1 border-t pt-1">
                {snapshots.length === 0 && (
                  <div className="text-[10px] text-muted-foreground py-3 px-2 text-center">ยังไม่มี snapshot — กด Save ในแท็บ Report</div>
                )}
                {snapshots.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-1 rounded hover:bg-accent/60">
                    <Checkbox checked={snapChecked.has(s.id)} onCheckedChange={(c) => toggleSnapCheck(s.id, !!c)} />
                    <button
                      className={`flex-1 text-left text-xs py-1.5 truncate ${selectedSnap === s.id ? "font-semibold text-primary" : ""}`}
                      onClick={() => handleSelectSnap(s.id)}
                      title={`${s.week_label} · ${s.snapshot_date} · ${s.total_rows.toLocaleString()} แถว`}
                    >
                      {selectedSnap === s.id ? "✓ " : ""}📅 {s.week_label} · {s.snapshot_date}
                      <span className="text-muted-foreground"> ({s.total_rows.toLocaleString()})</span>
                    </button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm" variant="ghost"
            onClick={handleDeleteSelected}
            disabled={snapChecked.size === 0}
            className="text-xs h-8 px-2 text-destructive hover:text-destructive disabled:opacity-40"
            title="ลบ snapshot ที่เลือก"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> ลบที่เลือก{snapChecked.size > 0 ? ` (${snapChecked.size})` : ""}
          </Button>
          <Button size="sm" variant="outline" onClick={handleRefreshMv} disabled={refreshing || getting || loadingMore} className="text-xs" title="ประมวลผลข้อมูล OOS จาก stock ล่าสุด (ทำหลัง import)">
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            รีเฟรชข้อมูล
          </Button>
          <Button size="sm" onClick={handleGet} disabled={getting || loadingMore || refreshing} className="text-xs">
            {getting || loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Database className="w-3.5 h-3.5 mr-1" />}
            Get
          </Button>
          <Button size="sm" variant="secondary" onClick={handleCal} disabled={rows.length === 0 || loadingMore} className="text-xs" title={loadingMore ? "รอโหลดข้อมูลครบก่อน" : ""}>
            <Calculator className="w-3.5 h-3.5 mr-1" /> Cal
          </Button>
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={saving || getting || loadingMore} className="text-xs" title="บันทึก snapshot (ทำงานฝั่ง server — Save ทั้งหมดได้โดยไม่ต้อง Get)">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={rows.length === 0} className="text-xs">
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border flex-wrap bg-muted/30">
        <MultiSelectFilter label="SPC" options={opts?.spc || []} selected={spc} onChange={setSpc} width="w-64" />
        <MultiSelectFilter
          label="Vendor" options={(opts?.vendors || []).map((v) => v.vendor_code)} selected={vendors}
          onChange={setVendors} width="w-80" renderOption={(o) => vendorLabel.get(o) || o}
        />
        <MultiSelectFilter label="Division" options={opts?.divisions || []} selected={divisions} onChange={setDivisions} width="w-64" />
        <MultiSelectFilter label="Department" options={opts?.departments || []} selected={departments} onChange={setDepartments} width="w-72" />
        <MultiSelectFilter
          label="Type Store" options={opts?.type_stores || []} selected={typeStores}
          onChange={(v) => { setTypeStores(v); setStores((prev) => prev.filter((s) => storeOptions.includes(s))); }}
          width="w-56"
        />
        <MultiSelectFilter label="Store" options={storeOptions} selected={stores} onChange={setStores} width="w-72" />
        {hasFilters ? (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
            <X className="w-3.5 h-3.5 mr-1" /> ล้างตัวกรอง
          </Button>
        ) : (
          <span className="text-[11px] text-amber-600 ml-1">⚠ เลือกตัวกรองอย่างน้อย 1 อย่างก่อนกด Get (ถ้าต้องการดูทั้งหมด ให้ Save แล้วเปิดจาก snapshot)</span>
        )}
      </div>

      {/* แถบสถานะดึงข้อมูล + ตัวนับวินาที real-time */}
      {(getting || loadingMore || saving || refreshing || lastLoadInfo) && (
        <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b ${getting || loadingMore || saving || refreshing ? "bg-primary/5 text-primary" : "bg-green-50 text-green-700"}`}>
          {getting || loadingMore || saving || refreshing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{loadStatus}</span>
              <span className="font-mono font-semibold tabular-nums ml-1">{elapsed.toFixed(1)} วินาที</span>
              {loadingMore && <span className="text-[10px] opacity-70">(เลื่อนดูได้เลย กำลังโหลดเพิ่ม)</span>}
            </>
          ) : (
            <>
              <span className="text-green-600">✓</span>
              <span>{lastLoadInfo}</span>
            </>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 pt-2 border-b border-border">
          <TabsList className="h-9">
            <TabsTrigger value="data" className="text-xs gap-1.5"><Database className="w-3.5 h-3.5" /> Data</TabsTrigger>
            <TabsTrigger value="report" className="text-xs gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Report</TabsTrigger>
            <TabsTrigger value="trend" className="text-xs gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Trend</TabsTrigger>
          </TabsList>
        </div>

        {/* ===== DATA TAB ===== */}
        <TabsContent value="data" className="flex-1 overflow-auto p-3 mt-0">
          {getting ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" /><p className="text-xs">กำลังดึงข้อมูล...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Database className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">เลือกตัวกรองอย่างน้อย 1 อย่าง แล้วกด "Get"</p>
              <p className="text-xs mt-1 opacity-70">อยากดูทั้งหมด: Save เป็น snapshot แล้วเปิดจาก dropdown</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <Input
                  placeholder="ค้นหา SKU / Barcode / Name / Store / Vendor..."
                  value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-[320px] text-xs"
                />
                <span className="text-xs text-muted-foreground">
                  แสดง {filteredRows.length === 0 ? 0 : page * PAGE_SIZE + 1}–
                  {Math.min((page + 1) * PAGE_SIZE, filteredRows.length)} จาก {filteredRows.length.toLocaleString()} แถว
                  {loadingMore && <span className="text-primary ml-1">· กำลังโหลดเพิ่ม…</span>}
                </span>
              </div>
              <div className="overflow-auto border rounded">
                <table className="text-xs border-collapse" style={{ tableLayout: "fixed", width: tableW }}>
                  <colgroup>
                    {DATA_COLUMNS.map((c) => <col key={c.key} style={{ width: colW[c.key] }} />)}
                  </colgroup>
                  <thead className="bg-muted/40">
                    <tr>
                      {DATA_COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          className={`relative text-[10px] font-medium px-2 py-1.5 border-b border-r select-none ${c.align === "right" ? "text-right" : "text-left"}`}
                        >
                          <span className="block truncate">{c.label}</span>
                          {/* ขอบลากปรับความกว้าง */}
                          <span
                            onMouseDown={(e) => startResize(c.key as string, e)}
                            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50"
                            title="ลากเพื่อปรับความกว้าง"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => (
                      <tr key={r.id_match + i} className="border-b hover:bg-accent/30">
                        {DATA_COLUMNS.map((c) => {
                          const raw = r[c.key];
                          const display =
                            c.key === "stock_store" || c.key === "stock_dc"
                              ? Number(raw).toLocaleString()
                              : String(raw ?? "");
                          const base = `px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis border-r ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.mono ? "font-mono" : ""}`;
                          if (c.key === "remark_oos") {
                            return (
                              <td key={c.key} className={base} title={display}>
                                <span className={r.remark_oos === "Store OOS" ? "text-destructive font-medium" : "text-green-600"}>{display}</span>
                              </td>
                            );
                          }
                          const extra = c.key === "remark_stock" && r.remark_stock === "DC No Stock" ? " text-muted-foreground" : "";
                          return (
                            <td key={c.key} className={base + extra} title={display}>{display}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* pagination */}
              <div className="flex items-center justify-center gap-2 mt-3">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs tabular-nums">หน้า {page + 1} / {pageCount}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* ===== REPORT TAB ===== */}
        <TabsContent value="report" className="flex-1 overflow-auto p-3 mt-0">
          {!summary ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">กด "Get" แล้วกด "Cal" เพื่อสร้างรายงาน</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Range SKU</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{summary.grand.range.toLocaleString()}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total OOS SKU</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-destructive">{summary.grand.oos.toLocaleString()}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Overall % OOS</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold ${pctClass(summary.grand.pct_oos)}`}>{pct(summary.grand.pct_oos)}</p></CardContent></Card>
              </div>
              <div className="overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Week</TableHead>
                      <TableHead className="text-xs">Type store</TableHead>
                      <TableHead className="text-xs">Store Name</TableHead>
                      <TableHead className="text-xs text-right">StockHaveStock</TableHead>
                      <TableHead className="text-xs text-right">Store OOS</TableHead>
                      <TableHead className="text-xs text-right">Range Store</TableHead>
                      <TableHead className="text-xs text-right">% OOS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.stores.map((s, idx) => {
                      const next = summary.stores[idx + 1];
                      const isLastOfType = !next || next.type_store !== s.type_store;
                      const total = isLastOfType ? summary.totals.find((t) => t.type_store === s.type_store) : null;
                      return (
                        <Fragment key={s.type_store + s.store_name}>
                          <TableRow>
                            <TableCell className="text-xs">{weekLabel}</TableCell>
                            <TableCell className="text-xs">{s.type_store}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{s.store_name}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{s.have_stock.toLocaleString()}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{s.oos.toLocaleString()}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{s.range.toLocaleString()}</TableCell>
                            <TableCell className={`text-xs text-right tabular-nums ${pctClass(s.pct_oos)}`}>{pct(s.pct_oos)}</TableCell>
                          </TableRow>
                          {total && (
                            <TableRow className="bg-muted font-semibold">
                              <TableCell className="text-xs">{weekLabel}</TableCell>
                              <TableCell className="text-xs">{s.type_store}</TableCell>
                              <TableCell className="text-xs">Total (Distinct SKU)</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{total.have_stock.toLocaleString()}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{total.oos.toLocaleString()}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{total.range.toLocaleString()}</TableCell>
                              <TableCell className={`text-xs text-right tabular-nums ${pctClass(total.range > 0 ? total.oos / total.range : 0)}`}>
                                {pct(total.range > 0 ? total.oos / total.range : 0)}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        {/* ===== TREND TAB ===== */}
        <TabsContent value="trend" className="flex-1 overflow-auto p-3 mt-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">เทียบ % OOS ระหว่างสัปดาห์ที่บันทึกไว้ (จาก snapshot)</p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadTrend} disabled={trendLoading}>
              {trendLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Refresh
            </Button>
          </div>

          {trendLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" /><p className="text-xs">กำลังโหลด Trend...</p>
            </div>
          ) : trendView.weeks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <TrendingUp className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">ยังไม่มี snapshot ที่บันทึก — กด "Save" ในแท็บ Report เพื่อเก็บข้อมูลรายสัปดาห์</p>
            </div>
          ) : (
            <>
              {/* กราฟเส้น %OOS ต่อ type store + Total */}
              <div className="h-72 mb-4 border rounded p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendView.chart} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <RTooltip formatter={(v: any) => (v == null ? "-" : `${v}%`)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trendView.types.map((t, i) => (
                      <Line key={t} type="monotone" dataKey={t} stroke={TREND_COLORS[i % TREND_COLORS.length]} strokeWidth={2} connectNulls dot={{ r: 2 }} />
                    ))}
                    <Line type="monotone" dataKey="Total" stroke="#111827" strokeWidth={2.5} strokeDasharray="5 3" connectNulls dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* ตาราง pivot: type store x week (มีลูกศรเทียบสัปดาห์ก่อน) */}
              <div className="overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs sticky left-0 bg-background">Type store</TableHead>
                      {trendView.weeks.map((w) => (
                        <TableHead key={w} className="text-xs text-right whitespace-nowrap">{w}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...trendView.types, "__total__"].map((t) => {
                      const isTotal = t === "__total__";
                      return (
                        <TableRow key={t} className={isTotal ? "bg-muted font-semibold" : ""}>
                          <TableCell className="text-xs sticky left-0 bg-inherit whitespace-nowrap">
                            {isTotal ? "Total (ทุกกลุ่ม)" : t}
                          </TableCell>
                          {trendView.weeks.map((w, wi) => {
                            const cur = isTotal ? trendView.getTotalPct(w) : trendView.getPct(t, w);
                            const prevW = trendView.weeks[wi - 1];
                            const prev = prevW ? (isTotal ? trendView.getTotalPct(prevW) : trendView.getPct(t, prevW)) : null;
                            const delta = cur != null && prev != null ? cur - prev : null;
                            return (
                              <TableCell key={w} className="text-xs text-right tabular-nums">
                                {cur == null ? (
                                  <span className="text-muted-foreground">-</span>
                                ) : (
                                  <span className="inline-flex items-center justify-end gap-1">
                                    {delta != null && Math.abs(delta) >= 0.0005 && (
                                      delta > 0
                                        ? <ArrowUp className="w-3 h-3 text-destructive" />
                                        : <ArrowDown className="w-3 h-3 text-green-600" />
                                    )}
                                    {delta != null && Math.abs(delta) < 0.0005 && <Minus className="w-3 h-3 text-muted-foreground" />}
                                    <span className={pctClass(cur)}>{pct(cur)}</span>
                                  </span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                ↑ แดง = OOS แย่ลงจากสัปดาห์ก่อน · ↓ เขียว = ดีขึ้น · %OOS คิดจากระดับ store-sku (OOS ÷ Range ทั้งหมด)
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
