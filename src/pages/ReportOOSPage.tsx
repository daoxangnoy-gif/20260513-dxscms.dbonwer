import { useState, useEffect, useMemo, Fragment } from "react";
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
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  OOSRow, OOSFilters, OOSSummary, OOSSnapshotMeta, OOSFilterOptions,
  getOOSDetail, saveOOSSnapshot, getOOSFilterOptions, listOOSSnapshots,
  loadOOSSnapshotRows, computeOOSSummary, getWeekLabel,
} from "@/lib/oosService";

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

  // snapshots
  const [snapshots, setSnapshots] = useState<OOSSnapshotMeta[]>([]);
  const [selectedSnap, setSelectedSnap] = useState<string>(LIVE);

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
    setGetting(true);
    setSummary(null);
    try {
      const data = await getOOSDetail(currentFilters());
      setRows(data);
      setPage(0);
      setSelectedSnap(LIVE);
      setActiveTab("data");
      toast({ title: "ดึงข้อมูลสำเร็จ", description: `${data.length.toLocaleString()} แถว` });
    } catch (e: any) {
      toast({ title: "ดึงข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
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
    try {
      const data = await loadOOSSnapshotRows(val);
      setRows(data);
      setSummary(computeOOSSummary(data));
      setPage(0);
      toast({ title: "โหลด snapshot สำเร็จ", description: `${data.length.toLocaleString()} แถว` });
    } catch (e: any) {
      toast({ title: "โหลด snapshot ไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setGetting(false);
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 pt-2 border-b border-border">
          <TabsList className="h-9">
            <TabsTrigger value="data" className="text-xs gap-1.5"><Database className="w-3.5 h-3.5" /> Data</TabsTrigger>
            <TabsTrigger value="report" className="text-xs gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Report</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
