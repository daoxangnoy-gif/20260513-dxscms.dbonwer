import { useEffect, useMemo, useState, Fragment } from "react";
import { format, subDays } from "date-fns";
import { CalendarIcon, RefreshCw, Loader2, ChevronRight, ChevronDown, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Mode = "dc" | "direct";

interface Props {
  mode: Mode;
}

// Weekday ordering for sort
const WD_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const wdIdx = (s: string) => {
  const i = WD_ORDER.indexOf(s.toUpperCase());
  return i < 0 ? 999 : i;
};
function sortOrderDays(days: string[]): string[] {
  const single: string[] = [];
  const combo: string[] = [];
  for (const d of days) {
    if (!d) continue;
    const isCombo = /[\/\+,]/.test(d) || d.split(/\s+/).length > 1;
    if (!isCombo && WD_ORDER.includes(d.toUpperCase())) single.push(d);
    else combo.push(d);
  }
  single.sort((a, b) => wdIdx(a) - wdIdx(b));
  combo.sort();
  return [...single, ...combo];
}

interface VendorMasterRow {
  vendor_code: string;
  vendor_name_en?: string | null;
  spc_name: string;
  order_day: string;
}

interface StoreTypeRow {
  store_name: string;
  type_store: string;
}

// Per-vendor PO data (for Report 2 grouping)
interface PoDoc {
  date_key: string;
  spc_name: string;
  vendor_code: string;
  vendor_display: string;
  po_data: any[];
}

// Backfill: push any localStorage POs not yet in DB
async function backfillLocalPOs(
  storageKey: string,
  userId: string,
  defaultSource: string
): Promise<number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const localPOs = JSON.parse(raw) as any[];
    if (!Array.isArray(localPOs) || localPOs.length === 0) return 0;

    // Check what already exists in DB by (date_key, vendor_code)
    const dateKeys = [...new Set(localPOs.map(p => {
      const d = new Date(p.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }))];
    const vendorCodes = [...new Set(localPOs.map(p => p.vendor_code).filter(Boolean))];
    if (dateKeys.length === 0 || vendorCodes.length === 0) return 0;

    const { data: existing } = await supabase
      .from("saved_po_documents")
      .select("date_key, vendor_code")
      .in("date_key", dateKeys)
      .in("vendor_code", vendorCodes);
    const existingKeys = new Set(
      (existing || []).map((e: any) => `${e.date_key}||${e.vendor_code}`)
    );

    // Group local POs by (date_key, vendor_code)
    const byKey = new Map<string, { date_key: string; vendor_code: string; vendor_display: string; spc_name: string; rows: any[] }>();
    for (const po of localPOs) {
      if (!po.vendor_code) continue;
      const d = new Date(po.date);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const k = `${dateKey}||${po.vendor_code}`;
      if (existingKeys.has(k)) continue;
      const cur = byKey.get(k) || {
        date_key: dateKey,
        vendor_code: po.vendor_code,
        vendor_display: po.vendor_name || "",
        spc_name: po.spc_name || "",
        rows: [],
      };
      if (Array.isArray(po.rows)) cur.rows.push(...po.rows);
      if (!cur.spc_name && po.spc_name) cur.spc_name = po.spc_name;
      byKey.set(k, cur);
    }

    if (byKey.size === 0) return 0;

    const inserts = [...byKey.values()].map(v => ({
      date_key: v.date_key,
      spc_name: v.spc_name,
      vendor_code: v.vendor_code,
      vendor_display: v.vendor_display,
      po_data: v.rows as any,
      item_count: v.rows.length,
      source: defaultSource,
      user_id: userId,
    }));

    const { error } = await supabase.from("saved_po_documents").insert(inserts);
    if (error) {
      console.error("[Report2] backfill insert error:", error);
      return 0;
    }
    return inserts.length;
  } catch (err) {
    console.error("[Report2] backfill error:", err);
    return 0;
  }
}

export function SRRReport2Tab({ mode }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [from, setFrom] = useState<Date>(subDays(new Date(), 30));
  const [to, setTo] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);

  const [vendors, setVendors] = useState<VendorMasterRow[]>([]);
  const [stores, setStores] = useState<StoreTypeRow[]>([]);
  // Per-vendor saved PO docs in date range
  const [poDocs, setPoDocs] = useState<PoDoc[]>([]);

  // Filters
  const [spcFilter, setSpcFilter] = useState<string[]>([]);
  const [orderDayFilter, setOrderDayFilter] = useState<string[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>([]);

  // Expand state
  const [expandedSpc, setExpandedSpc] = useState<Set<string>>(new Set());
  const [expandedType, setExpandedType] = useState<Set<string>>(new Set());
  const [expandedStore, setExpandedStore] = useState<Set<string>>(new Set());

  const load = async (_autoBackfill = true) => {
    setLoading(true);
    try {
      const fromStr = format(from, "yyyy-MM-dd");
      const toStr = format(to, "yyyy-MM-dd");

      // 1) Load vendor_master (paginated)
      const vmRows: VendorMasterRow[] = [];
      let pageStart = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("vendor_master")
          .select("vendor_code, vendor_name_en, spc_name, order_day")
          .range(pageStart, pageStart + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as VendorMasterRow[];
        vmRows.push(...batch);
        if (batch.length < PAGE) break;
        pageStart += PAGE;
      }
      setVendors(vmRows);

      // 2) Load store_type (only for direct)
      if (mode === "direct") {
        const stRows: StoreTypeRow[] = [];
        let p = 0;
        while (true) {
          const { data, error } = await supabase
            .from("store_type")
            .select("store_name, type_store")
            .range(p, p + PAGE - 1);
          if (error) throw error;
          const batch = (data || []) as StoreTypeRow[];
          stRows.push(...batch);
          if (batch.length < PAGE) break;
          p += PAGE;
        }
        setStores(stRows);
      } else {
        setStores([]);
      }

      // 3) Load SNAPSHOT docs in date range (Act source)
      //    DC      → srr_snapshots
      //    Direct  → srr_d2s_snapshots (store_name at doc level)
      const snapTable = mode === "dc" ? "srr_snapshots" : "srr_d2s_snapshots";
      const selectCols = mode === "dc"
        ? "date_key, spc_name, vendor_code, vendor_display, data"
        : "date_key, spc_name, vendor_code, vendor_display, data, store_name";

      const snapRows: any[] = [];
      let sp = 0;
      while (true) {
        const { data, error } = await (supabase as any)
          .from(snapTable)
          .select(selectCols)
          .gte("date_key", fromStr)
          .lte("date_key", toStr)
          .range(sp, sp + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as any[];
        snapRows.push(...batch);
        if (batch.length < PAGE) break;
        sp += PAGE;
      }

      // Map snapshots → PoDoc shape (po_data = data; inject store_name for direct)
      const mapped: PoDoc[] = snapRows.map((r: any) => {
        const rawData: any[] = Array.isArray(r.data) ? r.data : [];
        const po_data = (mode === "direct" && r.store_name)
          ? rawData.map((row: any) => ({ ...row, store_name: row.store_name || r.store_name }))
          : rawData;
        return {
          date_key: r.date_key,
          spc_name: r.spc_name,
          vendor_code: r.vendor_code,
          vendor_display: r.vendor_display,
          po_data,
        };
      });
      setPoDocs(mapped);
    } catch (e: any) {
      toast({ title: "Load failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, user?.id]);

  // Vendor lookup spc/od
  const vendorLookup = useMemo(() => {
    const m = new Map<string, { spc: string; od: string; display: string }>();
    for (const v of vendors) {
      if (v.vendor_code) m.set(v.vendor_code, { spc: v.spc_name || "", od: v.order_day || "", display: v.vendor_name_en || v.vendor_code });
    }
    return m;
  }, [vendors]);

  const storeTypeLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stores) if (s.store_name) m.set(s.store_name, s.type_store || "—");
    return m;
  }, [stores]);

  // Filter options
  const allSpcs = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) if (v.spc_name) set.add(v.spc_name);
    return [...set].sort();
  }, [vendors]);

  const allOrderDays = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) if (v.order_day) set.add(v.order_day);
    return sortOrderDays([...set]);
  }, [vendors]);

  const allVendors = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) if (v.vendor_code) set.add(v.vendor_code);
    return [...set].sort();
  }, [vendors]);

  const allTypeStores = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) if (s.type_store) set.add(s.type_store);
    return [...set].sort();
  }, [stores]);

  // ============ DC: SPC -> Vendor (Plan/Act per Order Day) ============
  // Plan = vendor exists in vendor_master for that (spc, od)? 1 : 0
  // Act  = vendor saved a PO in date range for that (spc, od)? (count distinct date_keys)? we use 1
  //        (matching the previous Act semantics: distinct vendor count = 1)
  const dcTree = useMemo(() => {
    const ods = orderDayFilter.length ? sortOrderDays(orderDayFilter) : allOrderDays;
    const spcs = (spcFilter.length ? spcFilter : allSpcs).slice().sort();
    const vendorSet = vendorFilter.length ? new Set(vendorFilter) : null;

    // Build SPC -> Vendor list (from vendor_master), grouped per OD
    // Vendor row: cells per OD = { plan: 1 if (v.spc=spc, v.od=od), act: #SKU suggest >0 from saved POs in range }
    type VendorCell = { plan: number; act: number; suggestSku: number };
    type VendorRow = {
      vendor_code: string;
      vendor_display: string;
      cells: Record<string, VendorCell>;
      totalAct: number;
      totalPlan: number;
      totalSuggest: number;
    };
    type SpcGroup = {
      spc: string;
      vendors: VendorRow[];
      subtotal: Record<string, VendorCell>;
    };

    // Pre-aggregate Act per (vendor, od) across all date_keys in range; also tally suggest SKU count
    // suggest SKU = count of rows in po_data where Quantity > 0
    const actByVendor = new Map<string, { perOd: Map<string, { count: number; sku: number }>; spc: string }>();
    for (const doc of poDocs) {
      const vc = doc.vendor_code;
      if (!vc) continue;
      const lookup = vendorLookup.get(vc);
      const od = lookup?.od || "";
      const spc = doc.spc_name || lookup?.spc || "";
      if (!od || !spc) continue;
      const sku = Array.isArray(doc.po_data)
        ? doc.po_data.filter((r: any) => Number(r.final_suggest_qty ?? r.final_order_qty ?? r["Products to Purchase/Quantity"] ?? 0) > 0).length
        : 0;
      let entry = actByVendor.get(vc);
      if (!entry) {
        entry = { perOd: new Map(), spc };
        actByVendor.set(vc, entry);
      }
      const cur = entry.perOd.get(od) || { count: 0, sku: 0 };
      cur.count += 1;
      cur.sku += sku;
      entry.perOd.set(od, cur);
    }

    const groups: SpcGroup[] = [];
    for (const spc of spcs) {
      // vendors in this spc from vendor_master
      const vendorsInSpc = vendors
        .filter(v => v.spc_name === spc && v.vendor_code && (!vendorSet || vendorSet.has(v.vendor_code)))
        .reduce((acc, v) => {
          if (!acc.has(v.vendor_code)) {
            acc.set(v.vendor_code, { vendor_code: v.vendor_code, vendor_display: v.vendor_name_en || v.vendor_code, ods: new Set<string>() });
          }
          if (v.order_day) acc.get(v.vendor_code)!.ods.add(v.order_day);
          return acc;
        }, new Map<string, { vendor_code: string; vendor_display: string; ods: Set<string> }>());

      // Also include vendors that have POs in this SPC even if not in vendor_master for some reason
      for (const [vc, entry] of actByVendor) {
        if (entry.spc === spc && (!vendorSet || vendorSet.has(vc))) {
          if (!vendorsInSpc.has(vc)) {
            const lookup = vendorLookup.get(vc);
            vendorsInSpc.set(vc, {
              vendor_code: vc,
              vendor_display: lookup?.display || vc,
              ods: new Set(lookup?.od ? [lookup.od] : []),
            });
          }
        }
      }

      const vendorRows: VendorRow[] = [];
      const subtotal: Record<string, VendorCell> = {};
      ods.forEach(od => (subtotal[od] = { plan: 0, act: 0, suggestSku: 0 }));

      for (const [vc, info] of vendorsInSpc) {
        const cells: Record<string, VendorCell> = {};
        let totalPlan = 0, totalAct = 0, totalSuggest = 0;
        for (const od of ods) {
          const plan = info.ods.has(od) ? 1 : 0;
          const actEntry = actByVendor.get(vc)?.perOd.get(od);
          const act = actEntry?.count || 0;
          const suggestSku = actEntry?.sku || 0;
          cells[od] = { plan, act, suggestSku };
          totalPlan += plan;
          totalAct += act;
          totalSuggest += suggestSku;
          subtotal[od].plan += plan;
          subtotal[od].act += act;
          subtotal[od].suggestSku += suggestSku;
        }
        vendorRows.push({
          vendor_code: vc,
          vendor_display: info.vendor_display,
          cells,
          totalAct,
          totalPlan,
          totalSuggest,
        });
      }

      vendorRows.sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));

      // Include only spcs with any plan or act
      const hasAny = ods.some(od => subtotal[od].plan > 0 || subtotal[od].act > 0);
      if (hasAny || spcFilter.length) {
        groups.push({ spc, vendors: vendorRows, subtotal });
      }
    }

    return { groups, ods };
  }, [spcFilter, orderDayFilter, vendorFilter, allSpcs, allOrderDays, vendors, poDocs, vendorLookup]);

  // ============ Direct: SPC -> Type Store -> Store -> Vendor ============
  const directTree = useMemo(() => {
    const ods = orderDayFilter.length ? sortOrderDays(orderDayFilter) : allOrderDays;
    const spcs = (spcFilter.length ? spcFilter : allSpcs).slice().sort();
    const vendorSet = vendorFilter.length ? new Set(vendorFilter) : null;
    const typeSet = typeStoreFilter.length ? new Set(typeStoreFilter) : null;

    // Vendors per (spc, od) from vendor_master
    const vSetByKey = new Map<string, Set<string>>();
    for (const v of vendors) {
      if (!v.vendor_code || !v.spc_name || !v.order_day) continue;
      if (vendorSet && !vendorSet.has(v.vendor_code)) continue;
      const key = `${v.spc_name}||${v.order_day}`;
      if (!vSetByKey.has(key)) vSetByKey.set(key, new Set());
      vSetByKey.get(key)!.add(v.vendor_code);
    }

    // Stores filtered by type_store
    const filteredStores = stores.filter(s => (typeSet ? typeSet.has(s.type_store) : true));
    const typeMap = new Map<string, string[]>();
    for (const s of filteredStores) {
      const ts = s.type_store || "—";
      if (!typeMap.has(ts)) typeMap.set(ts, []);
      typeMap.get(ts)!.push(s.store_name);
    }
    for (const arr of typeMap.values()) arr.sort();
    const typeStoresSorted = [...typeMap.keys()].sort();

    // Pre-extract per-(spc, od, store, vendor) from poDocs
    // act count = #docs that touched this store ; suggestSku = #rows in that doc with Qty>0 for this store
    type Vleaf = { vendor_code: string; vendor_display: string; act: number; suggestSku: number };
    const perStore = new Map<string, Vleaf[]>(); // key: spc||od||store
    for (const doc of poDocs) {
      const vc = doc.vendor_code;
      if (!vc) continue;
      if (vendorSet && !vendorSet.has(vc)) continue;
      const lookup = vendorLookup.get(vc);
      const od = lookup?.od || "";
      const spc = doc.spc_name || lookup?.spc || "";
      if (!spc || !od) continue;
      // Aggregate rows by store
      const storeAgg = new Map<string, { sku: number }>();
      if (Array.isArray(doc.po_data)) {
        for (const r of doc.po_data as any[]) {
          const st = String(r.store_name || r["Store Name"] || r["Delivery To"] || r["Store"] || "").trim();
          if (!st) continue;
          if (!storeAgg.has(st)) storeAgg.set(st, { sku: 0 });
          if (Number(r.final_order_qty ?? r.final_suggest_qty ?? r["Products to Purchase/Quantity"] ?? 0) > 0) storeAgg.get(st)!.sku += 1;
        }
      }
      for (const [st, agg] of storeAgg) {
        if (typeSet && !typeSet.has(storeTypeLookup.get(st) || "—")) continue;
        const key = `${spc}||${od}||${st}`;
        if (!perStore.has(key)) perStore.set(key, []);
        const arr = perStore.get(key)!;
        const existing = arr.find(x => x.vendor_code === vc);
        if (existing) {
          existing.act += 1;
          existing.suggestSku += agg.sku;
        } else {
          arr.push({
            vendor_code: vc,
            vendor_display: doc.vendor_display || lookup?.display || vc,
            act: 1,
            suggestSku: agg.sku,
          });
        }
      }
    }

    type Cell = { plan: number; act: number; suggestSku: number };
    type StoreRow = {
      name: string;
      cells: Record<string, Cell>;
      vendors: Array<{
        vendor_code: string;
        vendor_display: string;
        cells: Record<string, Cell>;
      }>;
    };
    type TypeGroup = { type: string; storeRows: StoreRow[]; subtotal: Record<string, Cell> };
    type SpcGroup = { spc: string; types: TypeGroup[]; subtotal: Record<string, Cell> };

    const groups: SpcGroup[] = [];
    for (const spc of spcs) {
      const spcSub: Record<string, Cell> = {};
      ods.forEach(od => (spcSub[od] = { plan: 0, act: 0, suggestSku: 0 }));
      const types: TypeGroup[] = [];

      for (const ts of typeStoresSorted) {
        const tSub: Record<string, Cell> = {};
        ods.forEach(od => (tSub[od] = { plan: 0, act: 0, suggestSku: 0 }));
        const storeRows: StoreRow[] = [];

        for (const sname of typeMap.get(ts) || []) {
          const cells: Record<string, Cell> = {};
          // collect vendors that appeared in any od at this store
          const vendorAgg = new Map<string, { display: string; cells: Record<string, Cell> }>();

          for (const od of ods) {
            const planVendors = vSetByKey.get(`${spc}||${od}`) || new Set();
            const plan = planVendors.size; // store leaf plan = #vendors expected for (spc,od)
            const actLeaves = perStore.get(`${spc}||${od}||${sname}`) || [];
            const act = actLeaves.reduce((s, x) => s + x.act, 0);
            const suggestSku = actLeaves.reduce((s, x) => s + x.suggestSku, 0);
            cells[od] = { plan, act, suggestSku };
            tSub[od].plan += plan;
            tSub[od].act += act;
            tSub[od].suggestSku += suggestSku;
            spcSub[od].plan += plan;
            spcSub[od].act += act;
            spcSub[od].suggestSku += suggestSku;

            // Per-vendor in this store
            for (const leaf of actLeaves) {
              if (!vendorAgg.has(leaf.vendor_code)) {
                vendorAgg.set(leaf.vendor_code, {
                  display: leaf.vendor_display,
                  cells: Object.fromEntries(ods.map(o => [o, { plan: 0, act: 0, suggestSku: 0 }])) as Record<string, Cell>,
                });
              }
              const vRow = vendorAgg.get(leaf.vendor_code)!;
              const vLookup = vendorLookup.get(leaf.vendor_code);
              vRow.cells[od] = {
                plan: vLookup?.od === od ? 1 : 0,
                act: leaf.act,
                suggestSku: leaf.suggestSku,
              };
            }
          }

          const vendorList = [...vendorAgg.entries()]
            .map(([vc, v]) => ({ vendor_code: vc, vendor_display: v.display, cells: v.cells }))
            .sort((a, b) => a.vendor_code.localeCompare(b.vendor_code));

          storeRows.push({ name: sname, cells, vendors: vendorList });
        }

        if (storeRows.length > 0) types.push({ type: ts, storeRows, subtotal: tSub });
      }

      const hasAny = ods.some(od => spcSub[od].plan > 0 || spcSub[od].act > 0);
      if (hasAny || spcFilter.length) groups.push({ spc, types, subtotal: spcSub });
    }
    return { groups, ods };
  }, [spcFilter, orderDayFilter, vendorFilter, typeStoreFilter, allSpcs, allOrderDays, vendors, stores, poDocs, vendorLookup, storeTypeLookup]);

  const toggleSpc = (spc: string) => {
    setExpandedSpc(prev => {
      const next = new Set(prev);
      if (next.has(spc)) next.delete(spc); else next.add(spc);
      return next;
    });
  };
  const toggleType = (key: string) => {
    setExpandedType(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleStore = (key: string) => {
    setExpandedStore(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Totals
  const dcTotals = useMemo(() => {
    const t: Record<string, { plan: number; act: number }> = {};
    let gp = 0, ga = 0;
    for (const od of dcTree.ods) {
      let p = 0, a = 0;
      for (const g of dcTree.groups) {
        p += g.subtotal[od].plan;
        a += g.subtotal[od].act;
      }
      t[od] = { plan: p, act: a };
      gp += p; ga += a;
    }
    return { perOd: t, gp, ga };
  }, [dcTree]);

  const directTotals = useMemo(() => {
    const t: Record<string, { plan: number; act: number }> = {};
    let gp = 0, ga = 0;
    for (const od of directTree.ods) {
      let p = 0, a = 0;
      for (const g of directTree.groups) {
        p += g.subtotal[od].plan;
        a += g.subtotal[od].act;
      }
      t[od] = { plan: p, act: a };
      gp += p; ga += a;
    }
    return { perOd: t, gp, ga };
  }, [directTree]);

  const renderDiff = (d: number, extra?: string) => (
    <span
      className={cn(
        "tabular-nums",
        d < 0 && "text-destructive font-medium",
        d > 0 && "text-emerald-600 dark:text-emerald-400 font-medium",
        extra,
      )}
    >
      {d === 0 ? "" : d > 0 ? `+${d}` : d}
    </span>
  );

  const handleManualSync = async () => {
    if (!user?.id) {
      toast({ title: "ต้อง login ก่อน", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const key = mode === "dc" ? "srr_saved_pos" : "srr_saved_pos_d2s";
      const filled = await backfillLocalPOs(key, user.id, "filter");
      toast({
        title: filled > 0 ? "ซิงค์สำเร็จ" : "ไม่พบ PO ที่ต้องซิงค์",
        description: filled > 0 ? `${filled} เอกสารถูกอัปโหลด` : "ทุก PO ใน local ถูกซิงค์ไปแล้ว",
      });
      await load(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 p-3">
      <Card className="p-3 flex flex-wrap items-end gap-3">
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
              <Calendar mode="single" selected={from} onSelect={d => d && setFrom(d)} className={cn("p-3 pointer-events-auto")} />
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
              <Calendar mode="single" selected={to} onSelect={d => d && setTo(d)} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
        </div>

        <Button onClick={() => load(true)} size="sm" className="h-8 text-xs gap-1.5" disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Load
        </Button>
        <Button onClick={handleManualSync} size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={loading}>
          <UploadCloud className="w-3.5 h-3.5" />
          Sync Local POs
        </Button>

        <div className="flex flex-wrap items-end gap-2">
          <MultiSelectFilter label="SPC" options={allSpcs} selected={spcFilter} onChange={setSpcFilter} />
          <MultiSelectFilter label="Order Day" options={allOrderDays} selected={orderDayFilter} onChange={setOrderDayFilter} />
          <MultiSelectFilter label="Vendor" options={allVendors} selected={vendorFilter} onChange={setVendorFilter} />
          {mode === "direct" && (
            <MultiSelectFilter label="Store Type" options={allTypeStores} selected={typeStoreFilter} onChange={setTypeStoreFilter} />
          )}
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {mode === "dc"
            ? "Plan = vendors in Vendor Master · Act = snapshot docs · Group: SPC → Vendor"
            : "Plan = vendors × stores · Act = snapshot docs · Group: SPC → Type → Store → Vendor"}
        </div>
      </Card>

      <Card className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full overflow-auto">
          <div className="min-w-max">
            {mode === "dc" ? (
              <table className="text-xs border-collapse w-max">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th rowSpan={2} className="border border-border px-3 py-1.5 text-left font-semibold sticky left-0 bg-muted z-20 min-w-[260px]">
                      Spc / Vendor
                    </th>
                    {dcTree.ods.map(od => (
                      <th key={od} colSpan={3} className="border border-border px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                        {od}
                      </th>
                    ))}
                    <th colSpan={3} className="border border-border px-2 py-1.5 text-center font-semibold bg-primary/10">
                      Total
                    </th>
                  </tr>
                  <tr>
                    {dcTree.ods.map(od => (
                      <Fragment key={od}>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Plan</th>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Act</th>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Diff</th>
                      </Fragment>
                    ))}
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Plan</th>
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Act</th>
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {dcTree.groups.map(g => {
                    const spcOpen = expandedSpc.has(g.spc);
                    let rp = 0, ra = 0;
                    for (const od of dcTree.ods) {
                      rp += g.subtotal[od].plan;
                      ra += g.subtotal[od].act;
                    }
                    return (
                      <Fragment key={g.spc}>
                        <tr className="bg-accent/40 hover:bg-accent/60 cursor-pointer" onClick={() => toggleSpc(g.spc)}>
                          <td className="border border-border px-2 py-1 font-semibold sticky left-0 bg-accent/40 z-10">
                            <span className="inline-flex items-center gap-1">
                              {spcOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {g.spc}
                              <span className="ml-1 text-[10px] text-muted-foreground">({g.vendors.length} vendors)</span>
                            </span>
                          </td>
                          {dcTree.ods.map(od => {
                            const c = g.subtotal[od];
                            return (
                              <Fragment key={od}>
                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                              </Fragment>
                            );
                          })}
                          <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/10 font-semibold">{rp || ""}</td>
                          <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/10 font-semibold">{ra || ""}</td>
                          <td className="border border-border px-2 py-1 text-right bg-primary/10 font-semibold">{renderDiff(ra - rp)}</td>
                        </tr>
                        {spcOpen && g.vendors.map(v => {
                          let vp = 0, va = 0, vsku = 0;
                          for (const od of dcTree.ods) {
                            vp += v.cells[od].plan;
                            va += v.cells[od].act;
                            vsku += v.cells[od].suggestSku;
                          }
                          return (
                            <tr key={`${g.spc}||${v.vendor_code}`} className="hover:bg-accent/20">
                              <td className="border border-border px-2 py-1 pl-8 sticky left-0 bg-card z-10">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="font-mono text-[11px] text-muted-foreground">{v.vendor_code}</span>
                                  <span className="text-foreground/80">{v.vendor_display}</span>
                                  {vsku > 0 && (
                                    <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-4 px-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold tabular-nums">
                                      {vsku} SKU
                                    </span>
                                  )}
                                </span>
                              </td>
                              {dcTree.ods.map(od => {
                                const c = v.cells[od];
                                return (
                                  <Fragment key={od}>
                                    <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                    <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                    <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                                  </Fragment>
                                );
                              })}
                              <td className="border border-border px-2 py-1 text-right tabular-nums">{vp || ""}</td>
                              <td className="border border-border px-2 py-1 text-right tabular-nums">{va || ""}</td>
                              <td className="border border-border px-2 py-1 text-right">{renderDiff(va - vp)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-muted/60 font-semibold">
                    <td className="border border-border px-3 py-1.5 sticky left-0 bg-muted z-10">Total</td>
                    {dcTree.ods.map(od => {
                      const p = dcTotals.perOd[od]?.plan || 0;
                      const a = dcTotals.perOd[od]?.act || 0;
                      return (
                        <Fragment key={od}>
                          <td className="border border-border px-2 py-1.5 text-right tabular-nums">{p || ""}</td>
                          <td className="border border-border px-2 py-1.5 text-right tabular-nums">{a || ""}</td>
                          <td className="border border-border px-2 py-1.5 text-right">{renderDiff(a - p)}</td>
                        </Fragment>
                      );
                    })}
                    <td className="border border-border px-2 py-1.5 text-right tabular-nums bg-primary/15">{dcTotals.gp || ""}</td>
                    <td className="border border-border px-2 py-1.5 text-right tabular-nums bg-primary/15">{dcTotals.ga || ""}</td>
                    <td className="border border-border px-2 py-1.5 text-right bg-primary/15">{renderDiff(dcTotals.ga - dcTotals.gp)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="text-xs border-collapse w-max">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th rowSpan={2} className="border border-border px-3 py-1.5 text-left font-semibold sticky left-0 bg-muted z-20 min-w-[320px]">
                      Spc / Type / Store / Vendor
                    </th>
                    {directTree.ods.map(od => (
                      <th key={od} colSpan={3} className="border border-border px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                        {od}
                      </th>
                    ))}
                    <th colSpan={3} className="border border-border px-2 py-1.5 text-center font-semibold bg-primary/10">Total</th>
                  </tr>
                  <tr>
                    {directTree.ods.map(od => (
                      <Fragment key={od}>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Plan</th>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Act</th>
                        <th className="border border-border px-2 py-1 text-center font-medium text-[10px]">Diff</th>
                      </Fragment>
                    ))}
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Plan</th>
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Act</th>
                    <th className="border border-border px-2 py-1 text-center font-medium text-[10px] bg-primary/10">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {directTree.groups.map(g => {
                    const spcOpen = expandedSpc.has(g.spc);
                    let rp = 0, ra = 0;
                    for (const od of directTree.ods) { rp += g.subtotal[od].plan; ra += g.subtotal[od].act; }
                    return (
                      <Fragment key={g.spc}>
                        <tr className="bg-accent/40 hover:bg-accent/60 cursor-pointer" onClick={() => toggleSpc(g.spc)}>
                          <td className="border border-border px-2 py-1 font-semibold sticky left-0 bg-accent/40 z-10">
                            <span className="inline-flex items-center gap-1">
                              {spcOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {g.spc}
                            </span>
                          </td>
                          {directTree.ods.map(od => {
                            const c = g.subtotal[od];
                            return (
                              <Fragment key={od}>
                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                              </Fragment>
                            );
                          })}
                          <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/10 font-semibold">{rp || ""}</td>
                          <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/10 font-semibold">{ra || ""}</td>
                          <td className="border border-border px-2 py-1 text-right bg-primary/10 font-semibold">{renderDiff(ra - rp)}</td>
                        </tr>
                        {spcOpen && g.types.map(t => {
                          const tKey = `${g.spc}||${t.type}`;
                          const tOpen = expandedType.has(tKey);
                          let trp = 0, tra = 0;
                          for (const od of directTree.ods) { trp += t.subtotal[od].plan; tra += t.subtotal[od].act; }
                          return (
                            <Fragment key={tKey}>
                              <tr className="bg-muted/50 hover:bg-muted/70 cursor-pointer" onClick={() => toggleType(tKey)}>
                                <td className="border border-border px-2 py-1 pl-8 sticky left-0 bg-muted/50 z-10">
                                  <span className="inline-flex items-center gap-1">
                                    {tOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="italic">{t.type}</span>
                                  </span>
                                </td>
                                {directTree.ods.map(od => {
                                  const c = t.subtotal[od];
                                  return (
                                    <Fragment key={od}>
                                      <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                      <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                      <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                                    </Fragment>
                                  );
                                })}
                                <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/5 font-medium">{trp || ""}</td>
                                <td className="border border-border px-2 py-1 text-right tabular-nums bg-primary/5 font-medium">{tra || ""}</td>
                                <td className="border border-border px-2 py-1 text-right bg-primary/5">{renderDiff(tra - trp)}</td>
                              </tr>
                              {tOpen && t.storeRows.map(sr => {
                                const sKey = `${tKey}||${sr.name}`;
                                const sOpen = expandedStore.has(sKey);
                                let srp = 0, sra = 0;
                                for (const od of directTree.ods) { srp += sr.cells[od].plan; sra += sr.cells[od].act; }
                                return (
                                  <Fragment key={sKey}>
                                    <tr
                                      className={cn(
                                        "hover:bg-accent/20",
                                        sr.vendors.length > 0 && "cursor-pointer"
                                      )}
                                      onClick={() => sr.vendors.length > 0 && toggleStore(sKey)}
                                    >
                                      <td className="border border-border px-2 py-1 pl-14 sticky left-0 bg-card z-10 text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                          {sr.vendors.length > 0 ? (
                                            sOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
                                          ) : <span className="w-3" />}
                                          {sr.name}
                                          {sr.vendors.length > 0 && (
                                            <span className="ml-1 text-[10px]">({sr.vendors.length} vendors)</span>
                                          )}
                                        </span>
                                      </td>
                                      {directTree.ods.map(od => {
                                        const c = sr.cells[od];
                                        return (
                                          <Fragment key={od}>
                                            <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                            <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                            <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                                          </Fragment>
                                        );
                                      })}
                                      <td className="border border-border px-2 py-1 text-right tabular-nums">{srp || ""}</td>
                                      <td className="border border-border px-2 py-1 text-right tabular-nums">{sra || ""}</td>
                                      <td className="border border-border px-2 py-1 text-right">{renderDiff(sra - srp)}</td>
                                    </tr>
                                    {sOpen && sr.vendors.map(v => {
                                      let vp = 0, va = 0, vsku = 0;
                                      for (const od of directTree.ods) {
                                        vp += v.cells[od].plan;
                                        va += v.cells[od].act;
                                        vsku += v.cells[od].suggestSku;
                                      }
                                      return (
                                        <tr key={`${sKey}||${v.vendor_code}`} className="hover:bg-accent/10">
                                          <td className="border border-border px-2 py-1 pl-20 sticky left-0 bg-card z-10">
                                            <span className="inline-flex items-center gap-1.5">
                                              <span className="font-mono text-[11px] text-muted-foreground">{v.vendor_code}</span>
                                              <span className="text-foreground/80">{v.vendor_display}</span>
                                              {vsku > 0 && (
                                                <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-4 px-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold tabular-nums">
                                                  {vsku} SKU
                                                </span>
                                              )}
                                            </span>
                                          </td>
                                          {directTree.ods.map(od => {
                                            const c = v.cells[od];
                                            return (
                                              <Fragment key={od}>
                                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.plan || ""}</td>
                                                <td className="border border-border px-2 py-1 text-right tabular-nums">{c.act || ""}</td>
                                                <td className="border border-border px-2 py-1 text-right">{renderDiff(c.act - c.plan)}</td>
                                              </Fragment>
                                            );
                                          })}
                                          <td className="border border-border px-2 py-1 text-right tabular-nums">{vp || ""}</td>
                                          <td className="border border-border px-2 py-1 text-right tabular-nums">{va || ""}</td>
                                          <td className="border border-border px-2 py-1 text-right">{renderDiff(va - vp)}</td>
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-muted/60 font-semibold">
                    <td className="border border-border px-3 py-1.5 sticky left-0 bg-muted z-10">Total</td>
                    {directTree.ods.map(od => {
                      const p = directTotals.perOd[od]?.plan || 0;
                      const a = directTotals.perOd[od]?.act || 0;
                      return (
                        <Fragment key={od}>
                          <td className="border border-border px-2 py-1.5 text-right tabular-nums">{p || ""}</td>
                          <td className="border border-border px-2 py-1.5 text-right tabular-nums">{a || ""}</td>
                          <td className="border border-border px-2 py-1.5 text-right">{renderDiff(a - p)}</td>
                        </Fragment>
                      );
                    })}
                    <td className="border border-border px-2 py-1.5 text-right tabular-nums bg-primary/15">{directTotals.gp || ""}</td>
                    <td className="border border-border px-2 py-1.5 text-right tabular-nums bg-primary/15">{directTotals.ga || ""}</td>
                    <td className="border border-border px-2 py-1.5 text-right bg-primary/15">{renderDiff(directTotals.ga - directTotals.gp)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {((mode === "dc" && dcTree.groups.length === 0) || (mode === "direct" && directTree.groups.length === 0)) && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                {loading ? "Loading..." : "No data — adjust filters or date range and Load again."}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
