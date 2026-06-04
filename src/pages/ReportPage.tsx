import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, TrendingUp, Loader2, ChevronRight, ChevronDown, Download, X } from "lucide-react";
import * as XLSX from "xlsx";
import { getSnapshotDates, loadSnapshots, loadRecentSnapshots } from "@/lib/snapshotService";

interface PivotRow {
  spc_name: string;
  order_day: string;
  vendor_count: number;
  suggest_items: number;
  po_created: number;
}

interface VendorSku {
  sku_code: string;
  product_name: string;
  qty: number;
  uom: string;
  moq: number;
  amount: number;
  qty_po: number;
  amount_po: number;
}

interface VendorRow {
  vendor_code: string;
  vendor_name: string;
  spc_name: string;
  total_sku: number;
  sku_suggest: number;
  sku_po: number;
  diff_sku: number;
  last_po_date: string;
  last_po_doc: string;
  skus: VendorSku[];
}

async function fetchAllPaged(buildQuery: () => any, pageSize = 1000, hardCap = 200_000) {
  const all: any[] = [];
  let from = 0;
  while (from < hardCap) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export default function ReportPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("pivot");
  const [snapshotDates, setSnapshotDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [pivotData, setPivotData] = useState<PivotRow[]>([]);

  // Compare tab state
  const [vendorRows, setVendorRows] = useState<VendorRow[]>([]);
  const [poDateFilter, setPoDateFilter] = useState<string>("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [compareLoading, setCompareLoading] = useState(false);
  const [loadStep, setLoadStep] = useState<string>("");

  useEffect(() => {
    getSnapshotDates().then(dates => {
      setSnapshotDates(dates);
      if (dates.length > 0) setSelectedDate(dates[0]);
    }).catch(() => {});
  }, []);

  // ============ PIVOT TAB ============
  const loadPivotData = async () => {
    if (!selectedDate) return;
    setLoading(true);
    try {
      const snapshots = await loadSnapshots(selectedDate);
      const pivotMap = new Map<string, PivotRow>();
      for (const snap of snapshots) {
        const rows = (snap as any).data as any[];
        for (const row of rows) {
          const key = `${snap.spc_name}|${row.order_day || "N/A"}`;
          if (!pivotMap.has(key)) pivotMap.set(key, { spc_name: snap.spc_name, order_day: row.order_day || "N/A", vendor_count: 0, suggest_items: 0, po_created: 0 });
          const p = pivotMap.get(key)!;
          p.suggest_items++;
          if (row.final_suggest_qty > 0) p.po_created++;
        }
        const vendorSet = new Map<string, Set<string>>();
        for (const row of rows) {
          const key = `${snap.spc_name}|${row.order_day || "N/A"}`;
          if (!vendorSet.has(key)) vendorSet.set(key, new Set());
          vendorSet.get(key)!.add(row.vendor_code);
        }
        for (const [key, vSet] of vendorSet) {
          if (pivotMap.has(key)) pivotMap.get(key)!.vendor_count = vSet.size;
        }
      }
      setPivotData([...pivotMap.values()].sort((a, b) => a.spc_name.localeCompare(b.spc_name) || a.order_day.localeCompare(b.order_day)));
      toast({ title: "โหลดข้อมูล Pivot สำเร็จ", description: `${pivotMap.size} แถว` });
    } catch (err: any) {
      toast({ title: "โหลดไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ============ COMPARE TAB — load (parallel + grouped) ============
  const loadCompareData = async () => {
    setCompareLoading(true);
    setLoadStep("Loading vendors...");
    try {
      // Run vendor + on_order in parallel
      const [vendors, onOrders] = await Promise.all([
        fetchAllPaged(() =>
          supabase.from("vendor_master").select("vendor_code, vendor_name_en, vendor_name_la, spc_name").not("vendor_code", "is", null)
        ),
        (async () => {
          setLoadStep("Loading PO history...");
          return fetchAllPaged(() => {
            let qq: any = supabase.from("on_order").select("sku_code, last_po_date, po_number, po_qty, sku_name");
            if (poDateFilter) qq = qq.eq("last_po_date", poDateFilter);
            return qq;
          });
        })(),
      ]);

      const vMap = new Map<string, { name: string; spc: string }>();
      for (const v of vendors) {
        if (!v.vendor_code) continue;
        if (!vMap.has(v.vendor_code)) vMap.set(v.vendor_code, { name: v.vendor_name_en || v.vendor_name_la || "", spc: v.spc_name || "" });
      }

      // Total SKU: Active + Basic
      setLoadStep("Loading SKU master (Active/Basic)...");
      const dms = await fetchAllPaged(() =>
        supabase.from("data_master").select("sku_code, vendor_code, buying_status, item_type")
          .not("vendor_code", "is", null).not("sku_code", "is", null)
      );
      const totalSkuByVendor = new Map<string, number>();
      const skuToVendor = new Map<string, string>();
      for (const d of dms) {
        if (!d.vendor_code || !d.sku_code) continue;
        skuToVendor.set(d.sku_code, d.vendor_code);
        const bs = (d.buying_status || "").toString().trim().toLowerCase();
        const it = (d.item_type || "").toString().trim().toLowerCase();
        if (bs === "active" && it === "basic") {
          totalSkuByVendor.set(d.vendor_code, (totalSkuByVendor.get(d.vendor_code) || 0) + 1);
        }
      }

      // Latest snapshot per vendor → suggest count + sku detail
      setLoadStep("Loading snapshots...");
      const recent = await loadRecentSnapshots(); // metadata only — data:[] — used for suggest_count/item_count only
      const latestSnapByVendor = new Map<string, any>();
      for (const snap of recent) {
        const cur = latestSnapByVendor.get(snap.vendor_code);
        if (!cur || snap.created_at > cur.created_at) latestSnapByVendor.set(snap.vendor_code, snap);
      }
      const skusByVendor = new Map<string, Map<string, VendorSku>>();
      const costBySku = new Map<string, number>();
      for (const [vc, snap] of latestSnapByVendor) {
        const m = new Map<string, VendorSku>();
        const rows = (snap.data || []) as any[];
        for (const r of rows) {
          const sk = r.sku_code || "";
          const cost = Number(r.po_cost_unit ?? r.po_cost ?? 0);
          if (sk && cost) costBySku.set(sk, cost);
          const fq = Number(r.final_suggest_qty ?? r.suggest_qty ?? 0);
          if (!fq || fq <= 0) continue;
          if (!sk || m.has(sk)) continue;
          m.set(sk, {
            sku_code: sk,
            product_name: r.product_name_la || r.product_name_en || "",
            qty: fq,
            uom: r.final_suggest_uom || r.order_uom_edit || "",
            moq: Number(r.moq ?? 0),
            amount: fq * cost,
            qty_po: 0,
            amount_po: 0,
          });
        }
        skusByVendor.set(vc, m);
      }

      // Group on_order by vendor + per-sku PO qty
      setLoadStep("Grouping PO data...");
      const poByVendor = new Map<string, { skus: Map<string, { qty: number; name: string }>; lastDate: string; lastDoc: string }>();
      for (const o of onOrders) {
        const vc = skuToVendor.get(o.sku_code || "");
        if (!vc) continue;
        if (!poByVendor.has(vc)) poByVendor.set(vc, { skus: new Map(), lastDate: "", lastDoc: "" });
        const g = poByVendor.get(vc)!;
        if (o.sku_code) {
          const cur = g.skus.get(o.sku_code) || { qty: 0, name: o.sku_name || "" };
          cur.qty += Number(o.po_qty || 0);
          if (!cur.name && o.sku_name) cur.name = o.sku_name;
          g.skus.set(o.sku_code, cur);
        }
        if (o.last_po_date && (!g.lastDate || o.last_po_date > g.lastDate)) {
          g.lastDate = o.last_po_date;
          g.lastDoc = o.po_number || "";
        }
      }

      const rows: VendorRow[] = [];
      const vendorIter = poDateFilter ? [...poByVendor.keys()] : [...vMap.keys()];
      for (const vc of vendorIter) {
        const v = vMap.get(vc) || { name: "", spc: "" };
        const skuMap: Map<string, VendorSku> = skusByVendor.get(vc) || new Map();
        const po = poByVendor.get(vc);
        if (po) {
          for (const [sk, info] of po.skus) {
            const cost = costBySku.get(sk) || 0;
            const existing = skuMap.get(sk);
            if (existing) {
              existing.qty_po = info.qty;
              existing.amount_po = info.qty * cost;
            } else {
              skuMap.set(sk, {
                sku_code: sk,
                product_name: info.name,
                qty: 0, uom: "", moq: 0, amount: 0,
                qty_po: info.qty,
                amount_po: info.qty * cost,
              });
            }
          }
        }
        const suggest = [...skuMap.values()].filter(s => s.qty > 0).length;
        const skuPo = po?.skus.size || 0;
        rows.push({
          vendor_code: vc,
          vendor_name: v.name,
          spc_name: v.spc,
          total_sku: totalSkuByVendor.get(vc) || 0,
          sku_suggest: suggest,
          sku_po: skuPo,
          diff_sku: skuPo - suggest,
          last_po_date: po?.lastDate || "",
          last_po_doc: po?.lastDoc || "",
          skus: [...skuMap.values()],
        });
      }
      rows.sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));
      setVendorRows(rows);
      setLoadStep("");
      toast({ title: "โหลดสำเร็จ", description: `${rows.length} vendors` });
    } catch (err: any) {
      toast({ title: "โหลดไม่สำเร็จ", description: err.message, variant: "destructive" });
    } finally {
      setCompareLoading(false);
    }
  };

  // Manual load only — no auto-refresh on tab switch / filter change


  const filteredVendorRows = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendorRows;
    return vendorRows.filter(r =>
      r.vendor_code.toLowerCase().includes(q) ||
      r.vendor_name.toLowerCase().includes(q) ||
      r.spc_name.toLowerCase().includes(q)
    );
  }, [vendorRows, vendorSearch]);

  const toggleExpand = (vc: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(vc)) s.delete(vc); else s.add(vc);
      return s;
    });
  };

  const exportCompare = () => {
    const wb = XLSX.utils.book_new();
    const main = filteredVendorRows.map(r => ({
      "SPC Name": r.spc_name,
      "Vendor Code": r.vendor_code,
      "Vendor Name": r.vendor_name,
      "Total SKU": r.total_sku,
      "SKU Suggest": r.sku_suggest,
      "SKU PO": r.sku_po,
      "Diff SKU": r.diff_sku,
      "Last PO Date": r.last_po_date,
      "Last PO Doc": r.last_po_doc,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main), "Vendors");
    // Detail sheet
    const detail: any[] = [];
    for (const r of filteredVendorRows) {
      for (const s of r.skus) {
        detail.push({
          "Vendor Code": r.vendor_code, "Vendor Name": r.vendor_name,
          "SKU Code": s.sku_code, "Product Name": s.product_name,
          "Qty": s.qty, "UoM": s.uom, "MOQ": s.moq, "Amount": s.amount,
          "Qty PO": s.qty_po, "Amount PO": s.amount_po,
        });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "SKU Detail");
    XLSX.writeFile(wb, `Compare_PO_${poDateFilter || "all"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPivot = () => {
    const wb = XLSX.utils.book_new();
    const data = pivotData.map(r => ({
      "SPC Name": r.spc_name, "Order Day": r.order_day,
      "Vendors": r.vendor_count, "Suggest Items": r.suggest_items, "PO Created": r.po_created,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Pivot");
    XLSX.writeFile(wb, `Pivot_Report_${selectedDate}.xlsx`);
  };

  const pivotTotals = useMemo(() => ({
    vendors: pivotData.reduce((s, r) => s + r.vendor_count, 0),
    items: pivotData.reduce((s, r) => s + r.suggest_items, 0),
    pos: pivotData.reduce((s, r) => s + r.po_created, 0),
  }), [pivotData]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Report Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "pivot" && (
            <>
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="เลือกวันที่" /></SelectTrigger>
                <SelectContent>
                  {snapshotDates.map(d => <SelectItem key={d} value={d} className="text-xs">📅 {d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={loadPivotData} disabled={loading || !selectedDate} className="text-xs">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <BarChart3 className="w-3.5 h-3.5 mr-1" />}
                โหลด
              </Button>
              <Button size="sm" variant="outline" onClick={exportPivot} disabled={pivotData.length === 0} className="text-xs">
                <Download className="w-3.5 h-3.5 mr-1" /> Export
              </Button>
            </>
          )}
          {activeTab === "compare" && (
            <>
              <div className="relative">
                <Input
                  type="date"
                  value={poDateFilter}
                  onChange={(e) => setPoDateFilter(e.target.value)}
                  className="h-8 w-[160px] text-xs pr-7"
                  placeholder="Last PO Date"
                />
                {poDateFilter && (
                  <button onClick={() => setPoDateFilter("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-muted rounded">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <Input
                placeholder="ค้นหา Vendor..."
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                className="h-8 w-[180px] text-xs"
              />
              <Button size="sm" onClick={loadCompareData} disabled={compareLoading} className="text-xs">
                {compareLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <TrendingUp className="w-3.5 h-3.5 mr-1" />}
                Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={exportCompare} disabled={filteredVendorRows.length === 0} className="text-xs">
                <Download className="w-3.5 h-3.5 mr-1" /> Export
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-2 border-b border-border">
          <TabsList className="h-9">
            <TabsTrigger value="pivot" className="text-xs gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Pivot Report</TabsTrigger>
            <TabsTrigger value="compare" className="text-xs gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Compare PO</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="pivot" className="flex-1 overflow-auto p-4 mt-0">
          {pivotData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">เลือกวันที่แล้วกด "โหลด"</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Vendors</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{pivotTotals.vendors}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Suggest Items</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{pivotTotals.items.toLocaleString()}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">PO Created</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{pivotTotals.pos.toLocaleString()}</p></CardContent></Card>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>SPC Name</TableHead><TableHead>Order Day</TableHead>
                  <TableHead className="text-right">Vendors</TableHead>
                  <TableHead className="text-right">Suggest Items</TableHead>
                  <TableHead className="text-right">PO Created</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pivotData.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.spc_name}</TableCell>
                      <TableCell>{r.order_day}</TableCell>
                      <TableCell className="text-right">{r.vendor_count}</TableCell>
                      <TableCell className="text-right">{r.suggest_items.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{r.po_created.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>

        <TabsContent value="compare" className="flex-1 overflow-auto p-4 mt-0">
          {compareLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-xs">{loadStep || "กำลังโหลดข้อมูล..."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>SPC Name</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Total SKU</TableHead>
                  <TableHead className="text-right">SKU Suggest</TableHead>
                  <TableHead className="text-right">SKU PO</TableHead>
                  <TableHead className="text-right">Diff SKU</TableHead>
                  <TableHead>Last PO Date</TableHead>
                  <TableHead>Last PO Doc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVendorRows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">ไม่พบข้อมูล</TableCell></TableRow>
                )}
                {filteredVendorRows.map((r) => {
                  const isOpen = expanded.has(r.vendor_code);
                  return (
                    <Fragment key={r.vendor_code}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpand(r.vendor_code)}>
                        <TableCell className="p-1">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </TableCell>
                        <TableCell className="text-xs">{r.spc_name}</TableCell>
                        <TableCell className="text-xs"><span className="font-mono">{r.vendor_code}</span> · {r.vendor_name}</TableCell>
                        <TableCell className="text-right text-xs">{r.total_sku.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{r.sku_suggest.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{r.sku_po.toLocaleString()}</TableCell>
                        <TableCell className={`text-right text-xs font-medium ${r.diff_sku < 0 ? "text-destructive" : r.diff_sku > 0 ? "text-green-600" : ""}`}>{r.diff_sku.toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.last_po_date || "-"}</TableCell>
                        <TableCell className="text-xs font-mono">{r.last_po_doc || "-"}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={r.vendor_code + "-d"} className="bg-muted/30">
                          <TableCell></TableCell>
                          <TableCell colSpan={8} className="p-0">
                            <div className="px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">SKUs ({r.skus.length})</p>
                              <Table>
                                <TableHeader><TableRow>
                                  <TableHead className="h-7 text-[10px]">SKU Code</TableHead>
                                  <TableHead className="h-7 text-[10px]">Product Name</TableHead>
                                  <TableHead className="h-7 text-[10px] text-right">Qty</TableHead>
                                  <TableHead className="h-7 text-[10px]">UoM</TableHead>
                                  <TableHead className="h-7 text-[10px] text-right">MOQ</TableHead>
                                  <TableHead className="h-7 text-[10px] text-right">Amount</TableHead>
                                  <TableHead className="h-7 text-[10px] text-right">Qty PO</TableHead>
                                  <TableHead className="h-7 text-[10px] text-right">Amount PO</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                  {r.skus.map((s) => (
                                    <TableRow key={s.sku_code}>
                                      <TableCell className="text-[11px] font-mono py-1">{s.sku_code}</TableCell>
                                      <TableCell className="text-[11px] py-1">{s.product_name}</TableCell>
                                      <TableCell className="text-[11px] py-1 text-right">{s.qty.toLocaleString()}</TableCell>
                                      <TableCell className="text-[11px] py-1">{s.uom}</TableCell>
                                      <TableCell className="text-[11px] py-1 text-right">{s.moq.toLocaleString()}</TableCell>
                                      <TableCell className="text-[11px] py-1 text-right">{s.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                      <TableCell className="text-[11px] py-1 text-right">{s.qty_po.toLocaleString()}</TableCell>
                                      <TableCell className="text-[11px] py-1 text-right">{s.amount_po.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
