import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { useToast } from "@/hooks/use-toast";
import {
  PackageX, Loader2, Download, Database, BarChart3, Save, Calculator, X, ChevronLeft, ChevronRight,
  TrendingUp, ArrowUp, ArrowDown, Minus, RefreshCw, Trash2,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  OOSRow, OOSFilters, OOSSummary, OOSSnapshotMeta, OOSFilterOptions, OOSTrendRow,
  getOOSDetail, saveOOSSnapshot, getOOSFilterOptions, listOOSSnapshots,
  loadOOSSnapshotRows, computeOOSSummary, getWeekLabel, getOOSTrend, deleteOOSSnapshot,
} from "@/lib/oosService";

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

  // ui state
  const [getting, setGetting] = useState(false);
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

  // trend
  const [trend, setTrend] = useState<OOSTrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendLoaded, setTrendLoaded] = useState(false);

  useEffect(() => {
    getOOSFilterOptions().then(setOpts).catch((e) =>
      toast({ title: "โหลดตัวเลือกไม่สำเร็จ", description: e.message, variant: "destructive" })
    );
    refreshSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!hasFilters && !window.confirm("ยังไม่ได้เลือกตัวกรอง — จะดึงข้อมูลทั้งหมด (อาจมากกว่า 140,000 แถว และใช้เวลาหลายวินาที)\n\nดำเนินการต่อไหม?")) return;
    setGetting(true);
    setSummary(null);
    setLastLoadInfo("");
    startTimer("กำลังดึงข้อมูลจากฐานข้อมูล...");
    const t0 = Date.now();
    try {
      const data = await getOOSDetail(currentFilters());
      setRows(data);
      setPage(0);
      setSelectedSnap(LIVE);
      setActiveTab("data");
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      setLastLoadInfo(`ดึง ${data.length.toLocaleString()} แถว ใน ${secs} วินาที`);
      toast({ title: "ดึงข้อมูลสำเร็จ", description: `${data.length.toLocaleString()} แถว · ${secs} วินาที` });
    } catch (e: any) {
      toast({ title: "ดึงข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      stopTimer();
      setGetting(false);
    }
  };

  const handleCal = () => {
    if (rows.length === 0) return;
    setSummary(computeOOSSummary(rows));
    setActiveTab("report");
    toast({ title: "คำนวณสำเร็จ", description: `${weekLabel}` });
  };

  const handleSave = async () => {
    if (!summary) return;
    const existing = snapshots.find((s) => s.week_label === weekLabel);
    if (existing && !window.confirm(`${weekLabel} มี snapshot อยู่แล้ว — บันทึกทับของเดิมไหม?`)) return;
    setSaving(true);
    try {
      const res = await saveOOSSnapshot(weekLabel, currentFilters());
      toast({ title: "บันทึกสำเร็จ", description: `${weekLabel} · ${res.total_rows.toLocaleString()} แถว` });
      await refreshSnapshots();
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
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

  const handleDeleteSnap = async () => {
    if (selectedSnap === LIVE) return;
    const snap = snapshots.find((s) => s.id === selectedSnap);
    if (!snap) return;
    if (!window.confirm(`ลบ snapshot "${snap.week_label} · ${snap.snapshot_date}" (${snap.total_rows.toLocaleString()} แถว)?\n\nลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await deleteOOSSnapshot(selectedSnap);
      setSelectedSnap(LIVE);
      setRows([]); setSummary(null); setPage(0);
      await refreshSnapshots();
      setTrendLoaded(false); // ให้ Trend โหลดใหม่
      toast({ title: "ลบ snapshot แล้ว", description: `${snap.week_label}` });
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
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedSnap} onValueChange={handleSelectSnap}>
            <SelectTrigger className="h-8 w-[210px] text-xs">
              <SelectValue placeholder="เลือก snapshot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LIVE} className="text-xs">● Live (ยังไม่ save)</SelectItem>
              {snapshots.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  📅 {s.week_label} · {s.snapshot_date} ({s.total_rows.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedSnap !== LIVE && (
            <Button size="sm" variant="ghost" onClick={handleDeleteSnap} className="text-xs h-8 px-2 text-destructive hover:text-destructive" title="ลบ snapshot นี้">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="sm" onClick={handleGet} disabled={getting} className="text-xs">
            {getting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Database className="w-3.5 h-3.5 mr-1" />}
            Get
          </Button>
          <Button size="sm" variant="secondary" onClick={handleCal} disabled={rows.length === 0} className="text-xs">
            <Calculator className="w-3.5 h-3.5 mr-1" /> Cal
          </Button>
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={!summary || saving} className="text-xs">
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
        ) : null}
      </div>

      {/* แถบสถานะดึงข้อมูล + ตัวนับวินาที real-time */}
      {(getting || lastLoadInfo) && (
        <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b ${getting ? "bg-primary/5 text-primary" : "bg-green-50 text-green-700"}`}>
          {getting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{loadStatus}</span>
              <span className="font-mono font-semibold tabular-nums ml-1">{elapsed.toFixed(1)} วินาที</span>
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
              <p className="text-sm">เลือกตัวกรอง (ถ้าต้องการ) แล้วกด "Get"</p>
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
                </span>
              </div>
              <div className="overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Division</TableHead>
                      <TableHead className="text-[10px]">Department</TableHead>
                      <TableHead className="text-[10px]">Range Store</TableHead>
                      <TableHead className="text-[10px]">Id Mactch</TableHead>
                      <TableHead className="text-[10px]">SKU</TableHead>
                      <TableHead className="text-[10px]">Barcode</TableHead>
                      <TableHead className="text-[10px]">Name (LA)</TableHead>
                      <TableHead className="text-[10px]">Vendor</TableHead>
                      <TableHead className="text-[10px]">Teadterm</TableHead>
                      <TableHead className="text-[10px]">Type</TableHead>
                      <TableHead className="text-[10px]">Buying</TableHead>
                      <TableHead className="text-[10px]">Rank</TableHead>
                      <TableHead className="text-[10px] text-right">Store Apply</TableHead>
                      <TableHead className="text-[10px] text-right">Stock Store</TableHead>
                      <TableHead className="text-[10px] text-right">Stock DC</TableHead>
                      <TableHead className="text-[10px]">Remark Stock</TableHead>
                      <TableHead className="text-[10px]">Remark OOS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r, i) => (
                      <TableRow key={r.id_match + i}>
                        <TableCell className="text-[11px] py-1">{r.division}</TableCell>
                        <TableCell className="text-[11px] py-1">{r.department}</TableCell>
                        <TableCell className="text-[11px] py-1 whitespace-nowrap">{r.store_name}</TableCell>
                        <TableCell className="text-[11px] py-1 font-mono">{r.id_match}</TableCell>
                        <TableCell className="text-[11px] py-1 font-mono">{r.sku}</TableCell>
                        <TableCell className="text-[11px] py-1 font-mono">{r.barcode}</TableCell>
                        <TableCell className="text-[11px] py-1 max-w-[220px] truncate" title={r.name_la}>{r.name_la}</TableCell>
                        <TableCell className="text-[11px] py-1 max-w-[180px] truncate" title={r.vendor}>{r.vendor}</TableCell>
                        <TableCell className="text-[11px] py-1">{r.teadterm}</TableCell>
                        <TableCell className="text-[11px] py-1">{r.item_type}</TableCell>
                        <TableCell className="text-[11px] py-1">{r.buying}</TableCell>
                        <TableCell className="text-[11px] py-1">{r.rank_sale}</TableCell>
                        <TableCell className="text-[11px] py-1 text-right">{r.store_apply}</TableCell>
                        <TableCell className="text-[11px] py-1 text-right tabular-nums">{Number(r.stock_store).toLocaleString()}</TableCell>
                        <TableCell className="text-[11px] py-1 text-right tabular-nums">{Number(r.stock_dc).toLocaleString()}</TableCell>
                        <TableCell className={`text-[11px] py-1 ${r.remark_stock === "DC No Stock" ? "text-muted-foreground" : ""}`}>{r.remark_stock}</TableCell>
                        <TableCell className="text-[11px] py-1">
                          <span className={r.remark_oos === "Store OOS" ? "text-destructive font-medium" : "text-green-600"}>{r.remark_oos}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
