import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronRight, RefreshCw, FileText, ShoppingCart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Mode = "dc" | "direct";
type Source = "snapshots" | "saved_po";
type ImportMode = "filter" | "vendor" | "import";

interface SkuRow {
  sku_code: string;
  product_name: string;
  qty: number;
  unit_price: number;
  amount: number;
  store_name?: string;
  type_store?: string;
}

interface ReportRow {
  date_key: string;
  vendor_code: string;
  vendor_display: string;
  spc_name: string;
  store_name?: string;
  type_store?: string;
  currency: string;
  import_mode: ImportMode;
  qty: number;
  amount: number;
  item_count: number;
  skus: SkuRow[];
}

interface Props {
  mode: Mode;
}

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MODE_LABEL: Record<ImportMode, string> = {
  filter: "Filter",
  vendor: "Imp Vendor",
  import: "Imp Barcode",
};
const MODE_CLR: Record<ImportMode, string> = {
  filter: "bg-primary/15 text-primary border-primary/30",
  vendor: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  import: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

export function SRRReportTab({ mode }: Props) {
  const { toast } = useToast();
  const [source, setSource] = useState<Source>("snapshots");
  const [from, setFrom] = useState<Date>(subDays(new Date(), 30));
  const [to, setTo] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [spcFilter, setSpcFilter] = useState<string[]>([]);
  const [storeFilter, setStoreFilter] = useState<string[]>([]);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>([]);
  const [modeFilter, setModeFilter] = useState<ImportMode[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const fromStr = format(from, "yyyy-MM-dd");
      const toStr = format(to, "yyyy-MM-dd");
      const dataField = source === "snapshots" ? "data" : "po_data";

      const snapshotTable = mode === "dc" ? "srr_snapshots" : "srr_d2s_snapshots";

      const query =
        source === "snapshots"
          ? supabase
              .from(snapshotTable)
              .select("id, date_key, spc_name, vendor_code, vendor_display, source, data")
              .gte("date_key", fromStr)
              .lte("date_key", toStr)
              .order("date_key", { ascending: false })
          : supabase
              .from("saved_po_documents")
              .select("id, date_key, spc_name, vendor_code, vendor_display, source, po_data")
              .gte("date_key", fromStr)
              .lte("date_key", toStr)
              .order("date_key", { ascending: false });

      const { data: docsRaw, error } = await query;
      if (error) throw error;
      const docs = (docsRaw || []) as any[];

      // Currency lookup
      const vcs = [...new Set((docs || []).map((d: any) => d.vendor_code).filter(Boolean))];
      const currencyMap = new Map<string, string>();
      if (vcs.length > 0) {
        for (let i = 0; i < vcs.length; i += 200) {
          const batch = vcs.slice(i, i + 200);
          const { data: vm } = await supabase
            .from("vendor_master")
            .select("vendor_code, supplier_currency")
            .in("vendor_code", batch);
          for (const v of vm || []) {
            if (v.vendor_code && !currencyMap.has(v.vendor_code)) {
              currencyMap.set(v.vendor_code, v.supplier_currency || "—");
            }
          }
        }
      }

      const out: ReportRow[] = [];
      for (const doc of docs || []) {
        const data: any[] = (doc as any)[dataField] || [];
        const currency = currencyMap.get(doc.vendor_code) || "—";
        const importMode: ImportMode = ((doc as any).source as ImportMode) || "filter";

        const getQty = (r: any) =>
          source === "snapshots"
            ? Number(mode === "dc" ? r.final_suggest_qty : r.final_order_qty) || 0
            : Number(r["Products to Purchase/Quantity"]) ||
              Number(mode === "dc" ? r.final_suggest_qty : r.final_order_qty) ||
              0;
        const getCu = (r: any) =>
          source === "snapshots"
            ? Number(r.po_cost_unit) || 0
            : Number(r["Products to Purchase/Unit Price"]) || Number(r.po_cost_unit) || 0;

        if (mode === "dc") {
          const skus: SkuRow[] = [];
          let amount = 0;
          let qty = 0;
          for (const r of data) {
            const q = getQty(r);
            const cu = getCu(r);
            if (q <= 0) continue;
            const a = q * cu;
            amount += a;
            qty += q;
            skus.push({
              sku_code: String(r.sku_code || r.barcode_unit || r["Products to Purchase/barcode"] || "—"),
              product_name: String(r.product_name_la || r.product_name_en || r["Product name"] || ""),
              qty: q,
              unit_price: cu,
              amount: a,
            });
          }
          if (skus.length > 0) {
            out.push({
              date_key: doc.date_key,
              vendor_code: doc.vendor_code,
              vendor_display: doc.vendor_display || doc.vendor_code,
              spc_name: doc.spc_name,
              currency,
              import_mode: importMode,
              qty,
              amount,
              item_count: skus.length,
              skus: skus.sort((a, b) => b.amount - a.amount),
            });
          }
        } else {
          // Direct: aggregate per date+vendor+store
          const storeMap = new Map<string, ReportRow>();
          for (const r of data) {
            const q = getQty(r);
            const cu = getCu(r);
            if (q <= 0) continue;
            const store = r.store_name || (doc as any).store_name || "—";
            const ts = r.type_store || (doc as any).type_store || "—";
            const key = `${store}||${ts}`;
            if (!storeMap.has(key)) {
              storeMap.set(key, {
                date_key: doc.date_key,
                vendor_code: doc.vendor_code,
                vendor_display: doc.vendor_display || doc.vendor_code,
                spc_name: doc.spc_name,
                store_name: store,
                type_store: ts,
                currency,
                import_mode: importMode,
                qty: 0,
                amount: 0,
                item_count: 0,
                skus: [],
              });
            }
            const ent = storeMap.get(key)!;
            const a = q * cu;
            ent.qty += q;
            ent.amount += a;
            ent.item_count++;
            ent.skus.push({
              sku_code: String(r.sku_code || r.barcode_unit || r["Products to Purchase/barcode"] || "—"),
              product_name: String(r.product_name_la || r.product_name_en || r["Product name"] || ""),
              qty: q,
              unit_price: cu,
              amount: a,
              store_name: store,
              type_store: ts,
            });
          }
          for (const ent of storeMap.values()) {
            ent.skus.sort((a, b) => b.amount - a.amount);
            out.push(ent);
          }
        }
      }
      setRows(out);
    } catch (e: any) {
      toast({ title: "Load failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [source]);

  // Filter options
  const spcOptions = useMemo(
    () => [...new Set(rows.map(r => r.spc_name).filter(Boolean))].sort(),
    [rows]
  );
  const storeOptions = useMemo(
    () => [...new Set(rows.map(r => r.store_name || "").filter(Boolean))].sort(),
    [rows]
  );
  const typeStoreOptions = useMemo(
    () => [...new Set(rows.map(r => r.type_store || "").filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (modeFilter.length && !modeFilter.includes(r.import_mode)) return false;
      if (spcFilter.length && !spcFilter.includes(r.spc_name)) return false;
      if (mode === "direct") {
        if (storeFilter.length && !storeFilter.includes(r.store_name || "")) return false;
        if (typeStoreFilter.length && !typeStoreFilter.includes(r.type_store || "")) return false;
      }
      return true;
    });
  }, [rows, spcFilter, storeFilter, typeStoreFilter, modeFilter, mode]);

  // Group: Currency → Date → Vendor (DC: skus, Direct: stores → skus)
  const grouped = useMemo(() => {
    type StoreBucket = {
      store_name: string;
      type_store: string;
      qty: number;
      amount: number;
      item_count: number;
      skus: SkuRow[];
    };
    type VendorBucket = {
      vendor_code: string;
      vendor_display: string;
      qty: number;
      amount: number;
      item_count: number;
      modes: Set<ImportMode>;
      skus: SkuRow[]; // DC only
      stores: StoreBucket[]; // Direct only
      modeAmounts: Record<ImportMode, number>;
    };
    type DateBucket = {
      date_key: string;
      vendors: VendorBucket[];
      total: number;
      modeAmounts: Record<ImportMode, number>;
    };
    type CurrencyBucket = {
      currency: string;
      dates: DateBucket[];
      grand: number;
      modeAmounts: Record<ImportMode, number>;
    };

    const cMap = new Map<string, Map<string, Map<string, VendorBucket>>>();
    for (const r of filtered) {
      if (!cMap.has(r.currency)) cMap.set(r.currency, new Map());
      const dMap = cMap.get(r.currency)!;
      if (!dMap.has(r.date_key)) dMap.set(r.date_key, new Map());
      const vMap = dMap.get(r.date_key)!;
      // Vendor key includes mode so different modes are separate vendor cards
      const vKey = `${r.vendor_code}::${r.import_mode}`;
      if (!vMap.has(vKey)) {
        vMap.set(vKey, {
          vendor_code: r.vendor_code,
          vendor_display: r.vendor_display,
          qty: 0,
          amount: 0,
          item_count: 0,
          modes: new Set([r.import_mode]),
          skus: [],
          stores: [],
          modeAmounts: { filter: 0, vendor: 0, import: 0 },
        });
      }
      const vb = vMap.get(vKey)!;
      vb.qty += r.qty;
      vb.amount += r.amount;
      vb.item_count += r.item_count;
      vb.modes.add(r.import_mode);
      vb.modeAmounts[r.import_mode] += r.amount;
      if (mode === "dc") {
        vb.skus.push(...r.skus);
      } else {
        vb.stores.push({
          store_name: r.store_name || "—",
          type_store: r.type_store || "—",
          qty: r.qty,
          amount: r.amount,
          item_count: r.item_count,
          skus: r.skus,
        });
      }
    }

    const result: CurrencyBucket[] = [];
    for (const [currency, dMap] of cMap) {
      const dates: DateBucket[] = [];
      let grand = 0;
      const cModeAmounts: Record<ImportMode, number> = { filter: 0, vendor: 0, import: 0 };
      for (const [date_key, vMap] of dMap) {
        const vendors = [...vMap.values()].sort((a, b) => b.amount - a.amount);
        // Sort skus & stores
        for (const v of vendors) {
          if (mode === "dc") v.skus.sort((a, b) => b.amount - a.amount);
          else v.stores.sort((a, b) => b.amount - a.amount);
        }
        const total = vendors.reduce((s, v) => s + v.amount, 0);
        const dModeAmounts: Record<ImportMode, number> = { filter: 0, vendor: 0, import: 0 };
        for (const v of vendors) {
          dModeAmounts.filter += v.modeAmounts.filter;
          dModeAmounts.vendor += v.modeAmounts.vendor;
          dModeAmounts.import += v.modeAmounts.import;
        }
        cModeAmounts.filter += dModeAmounts.filter;
        cModeAmounts.vendor += dModeAmounts.vendor;
        cModeAmounts.import += dModeAmounts.import;
        grand += total;
        dates.push({ date_key, vendors, total, modeAmounts: dModeAmounts });
      }
      dates.sort((a, b) => b.date_key.localeCompare(a.date_key));
      result.push({ currency, dates, grand, modeAmounts: cModeAmounts });
    }
    result.sort((a, b) => b.grand - a.grand);
    return result;
  }, [filtered, mode]);

  const toggleDate = (k: string) => {
    setExpandedDates(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };
  const toggleVendor = (k: string) => {
    setExpandedVendors(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };
  const toggleStore = (k: string) => {
    setExpandedStores(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };

  const renderModeBreakdown = (
    amounts: Record<ImportMode, number>,
    currency: string,
  ) => {
    const entries = (Object.entries(amounts) as [ImportMode, number][]).filter(([, v]) => v > 0);
    if (entries.length <= 1) return null;
    return (
      <div className="flex flex-wrap items-center gap-1 mt-0.5">
        {entries.map(([m, v]) => (
          <span
            key={m}
            className={cn(
              "text-[9px] px-1.5 py-0.5 rounded border tabular-nums",
              MODE_CLR[m],
            )}
          >
            {MODE_LABEL[m]}: {fmt(v)} {currency}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 p-3">
      {/* Toolbar */}
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Source</label>
          <ToggleGroup
            type="single"
            value={source}
            onValueChange={v => v && setSource(v as Source)}
            size="sm"
          >
            <ToggleGroupItem value="snapshots" className="text-xs gap-1">
              <FileText className="w-3 h-3" /> Snapshots
            </ToggleGroupItem>
            <ToggleGroupItem value="saved_po" className="text-xs gap-1">
              <ShoppingCart className="w-3 h-3" /> Saved POs
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                {format(from, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={from}
                onSelect={d => d && setFrom(d)}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                {format(to, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={to}
                onSelect={d => d && setTo(d)}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button onClick={load} size="sm" className="h-8 text-xs gap-1.5" disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Load
        </Button>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Mode</label>
          <ToggleGroup
            type="multiple"
            value={modeFilter}
            onValueChange={v => setModeFilter(v as ImportMode[])}
            size="sm"
          >
            <ToggleGroupItem value="filter" className="text-xs">Filter</ToggleGroupItem>
            <ToggleGroupItem value="vendor" className="text-xs">Imp Vendor</ToggleGroupItem>
            <ToggleGroupItem value="import" className="text-xs">Imp Barcode</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex-1" />

        <div className="flex items-end gap-2">
          <MultiSelectFilter
            label="SPC"
            options={spcOptions}
            selected={spcFilter}
            onChange={setSpcFilter}
          />
          {mode === "direct" && (
            <>
              <MultiSelectFilter
                label="Store"
                options={storeOptions}
                selected={storeFilter}
                onChange={setStoreFilter}
              />
              <MultiSelectFilter
                label="Type Store"
                options={typeStoreOptions}
                selected={typeStoreFilter}
                onChange={setTypeStoreFilter}
              />
            </>
          )}
        </div>
      </Card>

      {/* Tree */}
      <ScrollArea className="flex-1 min-h-0 border rounded-md bg-card">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
            ไม่มีข้อมูลในช่วงวันที่ที่เลือก
          </div>
        ) : (
          <div className="p-2 space-y-3">
            {grouped.map(cb => (
              <div key={cb.currency} className="border rounded-md overflow-hidden">
                {/* Currency header */}
                <div className="flex items-center justify-between bg-primary/10 px-3 py-2 border-b gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="default" className="font-mono text-xs">
                      {cb.currency}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {cb.dates.length} วัน
                    </span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {(Object.entries(cb.modeAmounts) as [ImportMode, number][])
                        .filter(([, v]) => v > 0)
                        .map(([m, v]) => (
                          <span
                            key={m}
                            className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded border tabular-nums",
                              MODE_CLR[m],
                            )}
                          >
                            {MODE_LABEL[m]}: {fmt(v)}
                          </span>
                        ))}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums whitespace-nowrap">
                    {fmt(cb.grand)} <span className="text-xs text-muted-foreground ml-1">{cb.currency}</span>
                  </div>
                </div>

                {/* Dates */}
                <div className="divide-y">
                  {cb.dates.map(db => {
                    const dKey = `${cb.currency}::${db.date_key}`;
                    const dOpen = expandedDates.has(dKey);
                    return (
                      <div key={dKey}>
                        <button
                          onClick={() => toggleDate(dKey)}
                          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/50 text-left gap-3"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {dOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            <span className="text-xs font-medium">{db.date_key}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1">
                              {db.vendors.length} vendor
                            </Badge>
                            {renderModeBreakdown(db.modeAmounts, cb.currency)}
                          </div>
                          <div className="text-xs font-medium tabular-nums whitespace-nowrap">
                            {fmt(db.total)}
                          </div>
                        </button>

                        {dOpen && (
                          <div className="bg-muted/30 divide-y divide-border/50">
                            {db.vendors.map(v => {
                              const vKey = `${dKey}::${v.vendor_code}::${[...v.modes].join("-")}`;
                              const vOpen = expandedVendors.has(vKey);
                              const canExpand =
                                (mode === "dc" && v.skus.length > 0) ||
                                (mode === "direct" && v.stores.length > 0);
                              const vMode: ImportMode = [...v.modes][0] || "filter";
                              return (
                                <div key={vKey}>
                                  <button
                                    onClick={() => canExpand && toggleVendor(vKey)}
                                    className={cn(
                                      "w-full grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 pl-7 pr-3 py-1.5 text-left",
                                      canExpand && "hover:bg-muted/60"
                                    )}
                                    disabled={!canExpand}
                                  >
                                    {/* col 1: chevron */}
                                    {canExpand ? (
                                      vOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
                                    ) : (
                                      <span className="w-3" />
                                    )}
                                    {/* col 2: vendor code + amount (close together, left-aligned) */}
                                    <div className="flex flex-col min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                          {v.vendor_code}
                                        </span>
                                        <span className="text-[11px] tabular-nums font-semibold text-primary">
                                          {fmt(v.amount)} <span className="text-muted-foreground font-normal">{cb.currency}</span>
                                        </span>
                                        <span
                                          className={cn(
                                            "text-[9px] px-1.5 py-0.5 rounded border",
                                            MODE_CLR[vMode],
                                          )}
                                        >
                                          {MODE_LABEL[vMode]}
                                        </span>
                                        <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                          {mode === "dc" ? `${v.item_count} sku` : `${v.stores.length} store`}
                                        </Badge>
                                      </div>
                                      <div className="text-[11px] truncate text-muted-foreground">
                                        {v.vendor_display}
                                      </div>
                                    </div>
                                    {/* col 3: spacer */}
                                    <div />
                                    {/* col 4: qty info */}
                                    <div className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                                      qty {fmt(v.qty)}
                                    </div>
                                  </button>

                                  {/* DC: sku list */}
                                  {canExpand && vOpen && mode === "dc" && (
                                    <div className="bg-background/50 divide-y divide-border/30">
                                      <div className="grid grid-cols-[140px_1fr_80px_100px_110px] gap-2 px-3 py-1 pl-12 text-[10px] font-medium text-muted-foreground bg-muted/40">
                                        <span>SKU</span>
                                        <span>Product</span>
                                        <span className="text-right">Qty</span>
                                        <span className="text-right">Unit Price</span>
                                        <span className="text-right">Amount</span>
                                      </div>
                                      {v.skus.map((s, idx) => (
                                        <div
                                          key={`${vKey}::sku::${s.sku_code}::${idx}`}
                                          className="grid grid-cols-[140px_1fr_80px_100px_110px] gap-2 px-3 py-1 pl-12 text-[10px]"
                                        >
                                          <span className="font-mono truncate">{s.sku_code}</span>
                                          <span className="truncate text-muted-foreground">{s.product_name}</span>
                                          <span className="text-right tabular-nums">{fmt(s.qty)}</span>
                                          <span className="text-right tabular-nums">{fmt(s.unit_price)}</span>
                                          <span className="text-right tabular-nums font-medium">{fmt(s.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Direct: store list (each expandable to skus) */}
                                  {canExpand && vOpen && mode === "direct" && (
                                    <div className="bg-background/50 divide-y divide-border/30">
                                      {v.stores.map((st, sIdx) => {
                                        const sKey = `${vKey}::store::${st.store_name}::${st.type_store}::${sIdx}`;
                                        const sOpen = expandedStores.has(sKey);
                                        return (
                                          <div key={sKey}>
                                            <button
                                              onClick={() => toggleStore(sKey)}
                                              className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pl-12 pr-3 py-1 hover:bg-muted/40 text-left"
                                            >
                                              {sOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                                <span className="text-[10px] truncate">{st.store_name}</span>
                                                <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">
                                                  {st.type_store}
                                                </Badge>
                                                <span className="text-[10px] tabular-nums font-medium">
                                                  {fmt(st.amount)}
                                                </span>
                                                <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                                                  {st.item_count} sku
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground">
                                                  qty {fmt(st.qty)}
                                                </span>
                                              </div>
                                              <span />
                                            </button>
                                            {sOpen && (
                                              <div className="bg-muted/20 divide-y divide-border/20">
                                                <div className="grid grid-cols-[140px_1fr_80px_100px_110px] gap-2 px-3 py-1 pl-20 text-[10px] font-medium text-muted-foreground bg-muted/30">
                                                  <span>SKU</span>
                                                  <span>Product</span>
                                                  <span className="text-right">Qty</span>
                                                  <span className="text-right">Unit Price</span>
                                                  <span className="text-right">Amount</span>
                                                </div>
                                                {st.skus.map((s, idx) => (
                                                  <div
                                                    key={`${sKey}::sku::${s.sku_code}::${idx}`}
                                                    className="grid grid-cols-[140px_1fr_80px_100px_110px] gap-2 px-3 py-1 pl-20 text-[10px]"
                                                  >
                                                    <span className="font-mono truncate">{s.sku_code}</span>
                                                    <span className="truncate text-muted-foreground">{s.product_name}</span>
                                                    <span className="text-right tabular-nums">{fmt(s.qty)}</span>
                                                    <span className="text-right tabular-nums">{fmt(s.unit_price)}</span>
                                                    <span className="text-right tabular-nums font-medium">{fmt(s.amount)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
