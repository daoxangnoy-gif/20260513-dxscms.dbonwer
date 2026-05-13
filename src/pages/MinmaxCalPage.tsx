import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, Calculator, Upload, Save, Download, FileText, Trash2,
  RotateCcw, Search, Settings2, X, Store, Tag, Activity, Layers,
} from "lucide-react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

interface CalcRow {
  sku_code: string;
  product_name_la: string | null;
  product_name_en: string | null;
  main_barcode: string | null;
  unit_of_measure: string | null;
  store_name: string;
  type_store: string;
  size_store: string;
  unit_pick: number;
  avg_sale: number;
  rank_sale: string;
  rank_factor: number;
  min_cal: number;
  max_cal: number;
  is_default_min: boolean;
  item_type: string;
  buying_status: string;
  min_edit?: number | null;
  max_edit?: number | null;
  // when row comes from previous Doc (filtered out of current calc), keep its final
  from_doc?: boolean;
  doc_min_final?: number;
  doc_max_final?: number;
}

interface DocRow {
  id: string;
  doc_name: string;
  user_id: string;
  n_factor: number;
  item_count: number;
  created_at: string;
  data: any;
}

const PAGE_SIZE = 100;
// PostgREST hard cap on this project = 1000. We loop until batch < 1000.
const RPC_BATCH = 1000;

// Searchable columns for Odoo-style search
const SEARCH_COLUMNS: { key: keyof CalcRow; label: string }[] = [
  { key: "sku_code", label: "SKU Code" },
  { key: "main_barcode", label: "Barcode" },
  { key: "product_name_la", label: "Product Name (LA)" },
  { key: "product_name_en", label: "Product Name (EN)" },
  { key: "store_name", label: "Store Name" },
  { key: "type_store", label: "Type Store" },
  { key: "size_store", label: "Size Store" },
];

interface SearchChip { col: keyof CalcRow; value: string; label: string; }

function fmtDocName() {
  const d = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-minmaxcal`;
}

// Fetch RPC in batches to bypass PostgREST 1000-row limit.
// PostgREST hard caps each response at 1000 even when range asks for more.
async function fetchAllCalc(params: any, onProgress?: (loaded: number, batches: number) => void): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  let batches = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .rpc("get_minmax_calc_all", params)
      .range(offset, offset + RPC_BATCH - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    batches++;
    onProgress?.(all.length, batches);
    if (batch.length < RPC_BATCH) break;
    offset += RPC_BATCH;
  }
  return all;
}

export default function MinmaxCalPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [hasData, setHasData] = useState(false);

  // Calc state
  const [rows, setRows] = useState<CalcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState<string>("");
  const [phasePct, setPhasePct] = useState<number>(0);
  const [phaseTimes, setPhaseTimes] = useState<{ fetch?: number; merge?: number; rowCount?: number; docCount?: number; readBatches?: number }>({});
  const [nFactor, setNFactor] = useState<number>(3);
  const [nInput, setNInput] = useState<string>("3");
  const [page, setPage] = useState(0);
  const [forceCal, setForceCal] = useState<Record<string, { min?: boolean; max?: boolean }>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const rowKey = (r: CalcRow) => `${r.sku_code}|${r.store_name}`;

  // Filters
  const [storeFilter, setStoreFilter] = useState<string[]>([]);
  const [typeStoreFilter, setTypeStoreFilter] = useState<string[]>([]);
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>([]);
  const [buyingFilter, setBuyingFilter] = useState<string[]>([]);
  const [filterOpts, setFilterOpts] = useState<{
    stores: { store_name: string; type_store: string }[];
    types: string[];
    itemTypes: string[];
    buyingStatuses: string[];
  }>({ stores: [], types: [], itemTypes: [], buyingStatuses: [] });

  // Odoo-style search
  const [searchValue, setSearchValue] = useState("");
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Doc state
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<DocRow | null>(null);

  // dialogs
  const [setNOpen, setSetNOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"calc" | "doc">("calc");

  // ====== load filter options ======
  const loadFilterOpts = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any).rpc("get_minmax_filter_options").single();
      if (error) throw error;
      const stores = (data?.stores || []) as { store_name: string; type_store: string }[];
      const types = Array.from(new Set(stores.map(s => s.type_store).filter(Boolean))).sort();
      setFilterOpts({
        stores,
        types,
        itemTypes: data?.item_types || [],
        buyingStatuses: data?.buying_statuses || [],
      });
    } catch (err: any) {
      console.error("load filter opts", err);
    }
  }, []);

  useEffect(() => { loadFilterOpts(); }, [loadFilterOpts]);

  // ====== Load latest Doc rows (for merging with filtered calc) ======
  const loadLatestDocRows = useCallback(async (): Promise<CalcRow[]> => {
    const { data: latest } = await (supabase as any)
      .from("minmax_cal_documents")
      .select("data").order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!latest?.data || !Array.isArray(latest.data)) return [];
    return (latest.data as any[]).map(r => ({
      sku_code: r.sku_code,
      product_name_la: r.product_name_la,
      product_name_en: r.product_name_en,
      main_barcode: r.main_barcode,
      unit_of_measure: r.unit_of_measure,
      store_name: r.store_name,
      type_store: r.type_store || "",
      size_store: r.size_store || "",
      unit_pick: Number(r.unit_pick) || 1,
      avg_sale: Number(r.avg_sale) || 0,
      rank_sale: r.rank_sale || "D",
      rank_factor: Number(r.rank_factor) || 7,
      min_cal: Number(r.min_cal) || 0,
      max_cal: Number(r.max_cal) || 0,
      is_default_min: !!r.is_default_min,
      item_type: r.item_type || "",
      buying_status: r.buying_status || "",
      min_edit: r.min_edit ?? null,
      max_edit: r.max_edit ?? null,
      from_doc: true,
      doc_min_final: r.min_final ?? null,
      doc_max_final: r.max_final ?? null,
    }));
  }, []);

  const hasFilters = storeFilter.length > 0 || typeStoreFilter.length > 0
    || itemTypeFilter.length > 0 || buyingFilter.length > 0;

  // ====== Calculate ======
  const calculate = useCallback(async (n: number) => {
    setLoading(true);
    setPhaseTimes({});
    setPhaseLabel("กำลังคำนวณ Min/Max ใน DB...");
    setPhasePct(5);
    try {
      const t0 = performance.now();
      const params: any = { p_n_factor: n };
      if (storeFilter.length) params.p_store_names = storeFilter;
      if (typeStoreFilter.length) params.p_type_stores = typeStoreFilter;
      if (itemTypeFilter.length) params.p_item_types = itemTypeFilter;
      if (buyingFilter.length) params.p_buying_statuses = buyingFilter;

      // Fetch all calc rows in batches
      setPhasePct(15);
      let lastBatchCount = 0;
      const fetched = await fetchAllCalc(params, (loaded, batches) => {
        lastBatchCount = batches;
        setPhaseLabel(`อ่าน batch #${batches} · รวม ${loaded.toLocaleString()} แถว`);
        setPhasePct(Math.min(60, 15 + batches * 5));
      });
      const fetchMs = Math.round(performance.now() - t0);
      setPhasePct(60);
      setPhaseLabel(`รับข้อมูล ${fetched.length.toLocaleString()} แถว · ${fetchMs}ms`);
      await new Promise(r => setTimeout(r, 0));

      const calcRows: CalcRow[] = fetched.map((r: any) => ({
        sku_code: r.sku_code,
        product_name_la: r.product_name_la,
        product_name_en: r.product_name_en,
        main_barcode: r.main_barcode,
        unit_of_measure: r.unit_of_measure,
        store_name: r.store_name,
        type_store: r.type_store,
        size_store: r.size_store,
        unit_pick: Number(r.unit_pick) || 1,
        avg_sale: Number(r.avg_sale) || 0,
        rank_sale: r.rank_sale || "D",
        rank_factor: Number(r.rank_factor) || 7,
        min_cal: Number(r.min_cal) || 0,
        max_cal: Number(r.max_cal) || 0,
        is_default_min: !!r.is_default_min,
        item_type: r.item_type || "",
        buying_status: r.buying_status || "",
        min_edit: null,
        max_edit: null,
      }));

      // Phase 2: merge edits/from-doc
      setPhasePct(75);
      setPhaseLabel("รวมข้อมูลกับ Doc ล่าสุด...");
      const tMerge = performance.now();
      const docRows = await loadLatestDocRows();
      const docMap = new Map<string, CalcRow>();
      for (const d of docRows) docMap.set(`${d.sku_code}|${d.store_name}`, d);

      // Apply edits from doc onto current calc rows
      for (const r of calcRows) {
        const e = docMap.get(`${r.sku_code}|${r.store_name}`);
        if (e) {
          r.min_edit = e.min_edit ?? null;
          r.max_edit = e.max_edit ?? null;
        }
      }

      let mergedFromDoc = 0;
      let finalRows: CalcRow[] = calcRows;
      if (hasFilters && docRows.length > 0) {
        // Build set of keys present in current calc
        const calcKeys = new Set(calcRows.map(r => `${r.sku_code}|${r.store_name}`));
        // Add doc rows that are NOT in current filter (so unselected stores/items keep their values)
        const extra: CalcRow[] = [];
        for (const d of docRows) {
          const k = `${d.sku_code}|${d.store_name}`;
          if (!calcKeys.has(k)) extra.push(d);
        }

        // Backfill item_type/buying_status for old Doc rows that don't have them
        const needBackfill = extra.filter(r => !r.item_type || !r.buying_status);
        if (needBackfill.length > 0) {
          const skus = Array.from(new Set(needBackfill.map(r => r.sku_code))).filter(Boolean);
          if (skus.length > 0) {
            const skuMeta = new Map<string, { item_type: string; buying_status: string }>();
            // batch by 1000 to avoid URL length issues
            for (let i = 0; i < skus.length; i += 500) {
              const slice = skus.slice(i, i + 500);
              const { data: meta } = await (supabase as any)
                .from("data_master")
                .select("sku_code,item_type,buying_status")
                .in("sku_code", slice);
              for (const m of (meta || [])) {
                skuMeta.set(m.sku_code, { item_type: m.item_type || "", buying_status: m.buying_status || "" });
              }
            }
            for (const r of extra) {
              if (!r.item_type || !r.buying_status) {
                const m = skuMeta.get(r.sku_code);
                if (m) {
                  if (!r.item_type) r.item_type = m.item_type;
                  if (!r.buying_status) r.buying_status = m.buying_status;
                }
              }
            }
          }
        }

        // Apply same filters to Doc rows so they obey Store/Type/Item Type/Buying Status
        const storeSet = storeFilter.length ? new Set(storeFilter) : null;
        const typeSet = typeStoreFilter.length ? new Set(typeStoreFilter) : null;
        const itemSet = itemTypeFilter.length ? new Set(itemTypeFilter) : null;
        const buySet = buyingFilter.length ? new Set(buyingFilter) : null;
        const filteredExtra = extra.filter(r => {
          if (storeSet && !storeSet.has(r.store_name)) return false;
          if (typeSet && !typeSet.has(r.type_store)) return false;
          if (itemSet && !itemSet.has(r.item_type)) return false;
          if (buySet && !buySet.has(r.buying_status)) return false;
          return true;
        });

        mergedFromDoc = filteredExtra.length;
        finalRows = [...calcRows, ...filteredExtra];
      }

      const mergeMs = Math.round(performance.now() - tMerge);
      setPhaseTimes({ fetch: fetchMs, merge: mergeMs, rowCount: calcRows.length, docCount: mergedFromDoc, readBatches: lastBatchCount });

      setRows(finalRows);
      setHasData(true);
      setPage(0);
      setPhasePct(100); setPhaseLabel("");
      toast({
        title: "คำนวณเสร็จสิ้น",
        description: `Calc ${calcRows.length.toLocaleString()} แถว${mergedFromDoc > 0 ? ` + ${mergedFromDoc.toLocaleString()} จาก Doc` : ""}`,
      });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, storeFilter, typeStoreFilter, itemTypeFilter, buyingFilter, hasFilters, loadLatestDocRows]);

  // ====== load docs list ======
  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("minmax_cal_documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDocs((data || []) as DocRow[]);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDocsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ====== finals (Min / Max) ======
  const getFinal = (r: CalcRow): { min: number; max: number; minSrc: "edit" | "cal" | "doc"; maxSrc: "edit" | "cal" | "doc" } => {
    if (r.from_doc) {
      return {
        min: Number(r.doc_min_final ?? r.min_cal),
        max: Number(r.doc_max_final ?? r.max_cal),
        minSrc: "doc", maxSrc: "doc",
      };
    }
    const k = `${r.sku_code}|${r.store_name}`;
    const force = forceCal[k] || {};
    const useMinCal = force.min === true || r.min_edit == null;
    const useMaxCal = force.max === true || r.max_edit == null;
    return {
      min: useMinCal ? r.min_cal : Number(r.min_edit),
      max: useMaxCal ? r.max_cal : Number(r.max_edit),
      minSrc: useMinCal ? "cal" : "edit",
      maxSrc: useMaxCal ? "cal" : "edit",
    };
  };

  // ====== filter + paginate ======
  const filtered = useMemo(() => {
    if (searchChips.length === 0 && !searchValue.trim()) return rows;
    return rows.filter(r => {
      // chips: each chip must match
      for (const c of searchChips) {
        const v = String(r[c.col] ?? "").toLowerCase();
        if (!v.includes(c.value.toLowerCase())) return false;
      }
      // Free-text search (any column)
      const q = searchValue.trim().toLowerCase();
      if (q) {
        const hit = SEARCH_COLUMNS.some(c => String(r[c.key] ?? "").toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, searchChips, searchValue]);

  const pageRows = useMemo(() =>
    filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
  [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const addSearchChip = (col: keyof CalcRow) => {
    if (!searchValue.trim()) return;
    const colLabel = SEARCH_COLUMNS.find(c => c.key === col)?.label || String(col);
    setSearchChips(prev => [...prev, { col, value: searchValue.trim(), label: colLabel }]);
    setSearchValue("");
    setShowSearchDropdown(false);
    setPage(0);
  };

  // ====== Import Min/Max edits ======
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = "";
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "");
      const sample = json[0] || {};
      const keyMap: Record<string, string> = {};
      for (const k of Object.keys(sample)) {
        const n = norm(k);
        if (n === "skucode" || n === "sku") keyMap[k] = "sku_code";
        else if (n === "minqty" || n === "min" || n === "minval") keyMap[k] = "min_qty";
        else if (n === "maxqty" || n === "max" || n === "maxval") keyMap[k] = "max_qty";
        else if (n === "storename" || n === "store") keyMap[k] = "store_name";
      }
      const editMap = new Map<string, { min?: number; max?: number; storeFilter?: string }>();
      for (const row of json) {
        const sku = String(row[Object.keys(keyMap).find(k => keyMap[k] === "sku_code") || ""] ?? "").trim();
        if (!sku) continue;
        const minRaw = row[Object.keys(keyMap).find(k => keyMap[k] === "min_qty") || ""];
        const maxRaw = row[Object.keys(keyMap).find(k => keyMap[k] === "max_qty") || ""];
        const storeRaw = row[Object.keys(keyMap).find(k => keyMap[k] === "store_name") || ""];
        const min = minRaw === undefined || minRaw === "" ? undefined : Number(minRaw);
        const max = maxRaw === undefined || maxRaw === "" ? undefined : Number(maxRaw);
        const storeFilter = storeRaw ? String(storeRaw).trim() : undefined;
        editMap.set(sku + "|" + (storeFilter || ""), { min, max, storeFilter });
      }
      let updated = 0;
      const next = rows.map(r => {
        const tryKeys = [`${r.sku_code}|${r.store_name}`, `${r.sku_code}|`];
        for (const k of tryKeys) {
          const e = editMap.get(k);
          if (e) {
            updated++;
            return { ...r, min_edit: e.min ?? r.min_edit, max_edit: e.max ?? r.max_edit };
          }
        }
        return r;
      });
      setRows(next);
      setForceCal({});
      toast({ title: "Import สำเร็จ", description: `อัปเดต ${updated} แถว` });
      setImportOpen(false);
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    }
  };

  // ====== Save as document ======
  const saveDoc = async () => {
    if (!user) { toast({ title: "ต้องเข้าสู่ระบบ", variant: "destructive" }); return; }
    if (rows.length === 0) { toast({ title: "ยังไม่มีข้อมูลให้บันทึก", variant: "destructive" }); return; }
    const name = saveName.trim() || fmtDocName();
    try {
      const payload = rows.map(r => {
        const f = getFinal(r);
        return {
          sku_code: r.sku_code,
          product_name_la: r.product_name_la,
          product_name_en: r.product_name_en,
          main_barcode: r.main_barcode,
          unit_of_measure: r.unit_of_measure,
          store_name: r.store_name,
          type_store: r.type_store,
          size_store: r.size_store,
          unit_pick: r.unit_pick,
          avg_sale: r.avg_sale,
          rank_sale: r.rank_sale,
          rank_factor: r.rank_factor,
          item_type: r.item_type,
          buying_status: r.buying_status,
          min_cal: r.min_cal,
          max_cal: r.max_cal,
          min_edit: r.min_edit ?? null,
          max_edit: r.max_edit ?? null,
          min_final: f.min,
          max_final: f.max,
        };
      });
      const { error } = await (supabase as any).from("minmax_cal_documents").insert({
        doc_name: name,
        user_id: user.id,
        n_factor: nFactor,
        item_count: payload.length,
        data: payload,
      });
      if (error) throw error;
      toast({ title: "บันทึก Doc สำเร็จ", description: `${name} (${payload.length.toLocaleString()} แถว)` });
      setSaveOpen(false);
      setSaveName("");
      loadDocs();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // ====== Doc actions ======
  const deleteDoc = async (id: string) => {
    if (!confirm("ลบ Doc นี้?")) return;
    const { error } = await (supabase as any).from("minmax_cal_documents").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "ลบสำเร็จ" });
    loadDocs();
  };

  const exportDoc = async (doc: DocRow) => {
    const data = (doc.data || []) as any[];
    // Collect unique sku_codes to fetch master enrichment
    const skuSet = [...new Set(data.map(r => String(r.sku_code || "")).filter(Boolean))];
    const masterMap = new Map<string, any>();
    // Batch fetch data_master in chunks of 500 to avoid URL limit
    try {
      for (let i = 0; i < skuSet.length; i += 500) {
        const chunk = skuSet.slice(i, i + 500);
        const { data: rows } = await supabase
          .from("data_master")
          .select("sku_code,division_group,division,department,sub_department,class,sub_class,vendor_code,vendor_display_name")
          .in("sku_code", chunk);
        (rows || []).forEach((m: any) => masterMap.set(String(m.sku_code), m));
      }
    } catch (e) {
      console.warn("exportDoc: master fetch failed", e);
    }
    const sheet = data.map(r => {
      const m = masterMap.get(String(r.sku_code)) || {};
      return {
        "SKU Code": r.sku_code,
        "Product Name (LA)": r.product_name_la,
        "Product Name (EN)": r.product_name_en,
        "Barcode": r.main_barcode,
        "UoM": r.unit_of_measure,
        "Division Group": m.division_group ?? "",
        "Division": m.division ?? "",
        "Department": m.department ?? "",
        "Sub-Department": m.sub_department ?? "",
        "Class": m.class ?? "",
        "Sub-Class": m.sub_class ?? "",
        "seller_ids/vendor_code": m.vendor_code ?? "",
        "seller_ids/display_name": m.vendor_display_name ?? "",
        "Store Name": r.store_name,
        "Type Store": r.type_store,
        "Size Store": r.size_store,
        "Item Type": r.item_type,
        "Buying Status": r.buying_status,
        "Unit Pick": r.unit_pick,
        "Avg Sale": r.avg_sale,
        "Rank": r.rank_sale,
        "Min Cal": r.min_cal,
        "Max Cal": r.max_cal,
        "Min Edit": r.min_edit,
        "Max Edit": r.max_edit,
        "Min": r.min_final,
        "Max": r.max_final,
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheet);
    // Force "SKU Code" + "Barcode" columns to text to preserve leading zeros
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const header = sheet[0] ? Object.keys(sheet[0]) : [];
    const textCols = ["SKU Code", "Barcode", "seller_ids/vendor_code"];
    textCols.forEach(name => {
      const colIdx = header.indexOf(name);
      if (colIdx < 0) return;
      for (let R = 1; R <= range.e.r; R++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: colIdx });
        const cell = ws[addr];
        if (cell && cell.v != null && cell.v !== "") {
          cell.t = "s";
          cell.v = String(cell.v);
          cell.z = "@";
        }
      }
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MinMax");
    XLSX.writeFile(wb, `${doc.doc_name}.xlsx`);
  };

  const exportTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ sku_code: "", store_name: "", min_qty: "", max_qty: "" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MinMax_Import");
    XLSX.writeFile(wb, "minmax_import_template.xlsx");
  };

  // Export current rows (Calc + Doc merged) — supports 3 modes
  const exportRows = (mode: "page" | "selected" | "all") => {
    let source: CalcRow[] = [];
    if (mode === "page") source = pageRows;
    else if (mode === "selected") source = filtered.filter(r => selectedKeys.has(rowKey(r)));
    else source = filtered;

    if (source.length === 0) {
      toast({ title: "ไม่มีข้อมูลให้ Export", variant: "destructive" });
      return;
    }
    const sheet = source.map(r => {
      const f = getFinal(r);
      return {
        "SKU Code": r.sku_code,
        "Product Name (LA)": r.product_name_la,
        "Product Name (EN)": r.product_name_en,
        "Barcode": r.main_barcode,
        "UoM": r.unit_of_measure,
        "Store Name": r.store_name,
        "Type Store": r.type_store,
        "Size Store": r.size_store,
        "Item Type": r.item_type,
        "Buying Status": r.buying_status,
        "Unit Pick": r.unit_pick,
        "Avg Sale": r.avg_sale,
        "Rank": r.rank_sale,
        "Rank Factor": r.rank_factor,
        "Min Cal": r.min_cal,
        "Max Cal": r.max_cal,
        "Min Edit": r.min_edit,
        "Max Edit": r.max_edit,
        "Min": f.min,
        "Max": f.max,
        "Source": r.from_doc ? "Doc" : "Calc",
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MinMax");
    const ts = fmtDocName().replace("-minmaxcal", "");
    const suffix = mode === "page" ? "page" : mode === "selected" ? "selected" : "all";
    XLSX.writeFile(wb, `minmax_${suffix}_${ts}.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${sheet.length.toLocaleString()} แถว (${suffix})` });
  };

  // ====== inline edit ======
  const setEdit = (r: CalcRow, field: "min_edit" | "max_edit", value: string) => {
    const v = value === "" ? null : Number(value);
    setRows(prev => prev.map(x =>
      x.sku_code === r.sku_code && x.store_name === r.store_name
        ? { ...x, [field]: Number.isNaN(v as any) ? null : v }
        : x
    ));
    setForceCal(prev => {
      const k = `${r.sku_code}|${r.store_name}`;
      const cur = prev[k] || {};
      const next = { ...cur, [field === "min_edit" ? "min" : "max"]: false };
      return { ...prev, [k]: next };
    });
  };

  const toggleSrc = (r: CalcRow, which: "min" | "max") => {
    if (r.from_doc) return;
    const k = `${r.sku_code}|${r.store_name}`;
    setForceCal(prev => {
      const cur = prev[k] || {};
      const useEditNow = (which === "min" ? r.min_edit != null && cur.min !== true : r.max_edit != null && cur.max !== true);
      const nextVal = useEditNow ? true : false;
      return { ...prev, [k]: { ...cur, [which]: nextVal } };
    });
  };

  const calcCount = useMemo(() => rows.filter(r => !r.from_doc).length, [rows]);
  const docCount = useMemo(() => rows.filter(r => r.from_doc).length, [rows]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">Min/Max Calculator</h1>
          <p className="text-xs text-muted-foreground">
            Data Control · คำนวณ Min/Max ต่อ SKU × Store · N = {nFactor}
            {rows.length > 0 && (
              <> · {rows.length.toLocaleString()} แถว
                {hasFilters && docCount > 0 && (
                  <> (Calc {calcCount.toLocaleString()} + Doc {docCount.toLocaleString()})</>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            onClick={() => calculate(nFactor)}
            disabled={loading}
            className="text-xs"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Calculator className="w-3.5 h-3.5 mr-1" />}
            Calculate
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setNInput(String(nFactor)); setSetNOpen(true); }} className="text-xs">
            <Settings2 className="w-3.5 h-3.5 mr-1" /> Set N ({nFactor})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="text-xs" disabled={rows.length === 0}>
            <Upload className="w-3.5 h-3.5 mr-1" /> Import Min/Max
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs" disabled={rows.length === 0}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export Data <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => exportRows("page")}>
                <FileText className="w-3.5 h-3.5 mr-2" /> Export This Page ({pageRows.length.toLocaleString()})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRows("selected")} disabled={selectedKeys.size === 0}>
                <Tag className="w-3.5 h-3.5 mr-2" /> Export Selected ({selectedKeys.size.toLocaleString()})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportRows("all")}>
                <Download className="w-3.5 h-3.5 mr-2" /> Export All Filtered ({filtered.length.toLocaleString()})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="default" onClick={() => { setSaveName(fmtDocName()); setSaveOpen(true); }}
            disabled={rows.length === 0} className="text-xs">
            <Save className="w-3.5 h-3.5 mr-1" /> Save Doc
          </Button>
        </div>
      </div>

      {/* Phase Progress */}
      {(loading || phaseTimes.fetch != null) && (
        <div className="px-6 py-2 bg-muted/30 border-b border-border space-y-1">
          {loading && (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{phaseLabel || "พร้อม"}</span>
                <span className="text-muted-foreground tabular-nums">{phasePct}%</span>
              </div>
              <Progress value={phasePct} className="h-1.5" />
            </>
          )}
          <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap items-center">
            {phaseTimes.fetch != null && (
              <span className="font-medium">
                <span className="text-foreground">① Read Cal:</span> {phaseTimes.fetch}ms · {phaseTimes.readBatches ?? 0} batches → <span className="text-primary font-bold">{(phaseTimes.rowCount ?? 0).toLocaleString()}</span> แถว
              </span>
            )}
            {phaseTimes.merge != null && (
              <span className="font-medium">
                <span className="text-foreground">② Merge Doc:</span> {phaseTimes.merge}ms{(phaseTimes.docCount ?? 0) > 0 && <> · +<span className="text-amber-600 dark:text-amber-400 font-bold">{(phaseTimes.docCount ?? 0).toLocaleString()}</span> จาก Doc</>}
              </span>
            )}
            {rows.length > 0 && (
              <span className="font-medium ml-auto">
                <span className="text-foreground">③ แสดง:</span> <span className="text-primary font-bold">{filtered.length.toLocaleString()}</span> / รวม {rows.length.toLocaleString()} แถว · หน้า {page + 1}/{totalPages} ({Math.min(filtered.length, (page + 1) * PAGE_SIZE) - page * PAGE_SIZE} แถวบนหน้านี้)
              </span>
            )}
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger value="calc" className="text-xs">Calc</TabsTrigger>
          <TabsTrigger value="doc" className="text-xs">
            <FileText className="w-3 h-3 mr-1" /> Doc ({docs.length})
          </TabsTrigger>
        </TabsList>

        {/* ============== Calc TAB ============== */}
        <TabsContent value="calc" className="flex-1 flex flex-col overflow-hidden mt-2">
          {/* Filter Row */}
          <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            <MultiSelectFilter
              label="Store"
              icon={<Store className="w-3 h-3 mr-1" />}
              options={filterOpts.stores.map(s => s.store_name)}
              selected={storeFilter}
              onChange={setStoreFilter}
              width="w-80"
            />
            <MultiSelectFilter
              label="Type Store"
              icon={<Layers className="w-3 h-3 mr-1" />}
              options={filterOpts.types}
              selected={typeStoreFilter}
              onChange={setTypeStoreFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Item Type"
              icon={<Tag className="w-3 h-3 mr-1" />}
              options={filterOpts.itemTypes}
              selected={itemTypeFilter}
              onChange={setItemTypeFilter}
              width="w-56"
            />
            <MultiSelectFilter
              label="Buying Status"
              icon={<Activity className="w-3 h-3 mr-1" />}
              options={filterOpts.buyingStatuses}
              selected={buyingFilter}
              onChange={setBuyingFilter}
              width="w-56"
            />
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setStoreFilter([]); setTypeStoreFilter([]); setItemTypeFilter([]); setBuyingFilter([]); }}>
                <X className="w-3 h-3 mr-1" /> Clear Filters
              </Button>
            )}
            {hasFilters && (
              <Badge variant="outline" className="text-[10px] ml-auto">
                💡 Calc เฉพาะที่ Filter · ที่เหลือดึงจาก Doc ล่าสุด (เมื่อ Calculate)
              </Badge>
            )}
          </div>

          {/* Odoo-style Search */}
          <div className="px-6 pb-2 flex items-center gap-2 flex-wrap bg-muted/20 mx-6 rounded-md py-2 mb-2">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {searchChips.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs gap-1 pl-2 pr-1 py-0.5">
                <span className="font-medium">{c.label}:</span>
                <span className="font-semibold">{c.value}</span>
                <button onClick={() => setSearchChips(p => p.filter((_, idx) => idx !== i))}
                  className="ml-0.5 hover:bg-destructive/20 rounded p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            <div className="relative flex-1 min-w-[200px]">
              <Input
                ref={searchInputRef}
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                placeholder="พิมพ์เพื่อค้นหา..."
                value={searchValue}
                onChange={e => { setSearchValue(e.target.value); setShowSearchDropdown(true); setPage(0); }}
                onFocus={() => setShowSearchDropdown(true)}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
              />
              {showSearchDropdown && searchValue.trim() && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg w-80 max-h-80 overflow-y-auto">
                  {SEARCH_COLUMNS.map(col => (
                    <button
                      key={col.key}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-primary/10 text-left transition-colors"
                      onClick={() => addSearchChip(col.key)}
                    >
                      <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span>Search <span className="font-semibold text-primary">{col.label}</span> for: <span className="font-mono">{searchValue}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(searchChips.length > 0 || searchValue) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setSearchChips([]); setSearchValue(""); setPage(0); }}>
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
            {filtered.length > 0 && (
              <span className="text-xs text-muted-foreground">
                แสดง {Math.min(filtered.length, (page + 1) * PAGE_SIZE).toLocaleString()} / {filtered.length.toLocaleString()}
              </span>
            )}
          </div>

          {/* Table with frozen header */}
          <div className="flex-1 overflow-hidden px-6 pb-3">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> กำลังคำนวณ...
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Calculator className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">กดปุ่ม "Calculate" เพื่อคำนวณ Min/Max</p>
              </div>
            ) : (
              <div className="border border-border rounded-md overflow-auto h-full">
                <table className="text-xs w-full border-collapse">
                  <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-2 py-1.5 w-8 border-b border-border bg-muted">
                        <Checkbox
                          checked={pageRows.length > 0 && pageRows.every(r => selectedKeys.has(rowKey(r)))}
                          onCheckedChange={(v) => {
                            setSelectedKeys(prev => {
                              const next = new Set(prev);
                              if (v) pageRows.forEach(r => next.add(rowKey(r)));
                              else pageRows.forEach(r => next.delete(rowKey(r)));
                              return next;
                            });
                          }}
                        />
                      </th>
                      {[
                        "SKU Code", "Product Name", "Store", "Type", "Size", "Item Type", "Buying", "Unit Pick",
                        "Avg Sale", "Rank", "Min Cal", "Max Cal", "Min Edit", "Max Edit", "Min", "Max", "Source",
                      ].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap bg-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => {
                      const f = getFinal(r);
                      return (
                        <tr key={`${r.sku_code}|${r.store_name}|${i}`}
                          className={cn(
                            "hover:bg-muted/30 border-b border-border/40",
                            r.from_doc && "bg-amber-50/30 dark:bg-amber-950/10",
                            selectedKeys.has(rowKey(r)) && "bg-primary/5"
                          )}>
                          <td className="px-2 py-1 w-8">
                            <Checkbox
                              checked={selectedKeys.has(rowKey(r))}
                              onCheckedChange={(v) => {
                                setSelectedKeys(prev => {
                                  const next = new Set(prev);
                                  const k = rowKey(r);
                                  if (v) next.add(k); else next.delete(k);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">{r.sku_code}</td>
                          <td className="px-2 py-1 max-w-[260px] truncate" title={r.product_name_la || r.product_name_en || ""}>
                            {r.product_name_la || r.product_name_en}
                          </td>
                          <td className="px-2 py-1">{r.store_name}</td>
                          <td className="px-2 py-1">{r.type_store}</td>
                          <td className="px-2 py-1">{r.size_store}</td>
                          <td className="px-2 py-1 text-[10px]">{r.item_type}</td>
                          <td className="px-2 py-1 text-[10px]">{r.buying_status}</td>
                          <td className="px-2 py-1 text-right">{r.unit_pick}</td>
                          <td className="px-2 py-1 text-right">{r.avg_sale.toFixed(2)}</td>
                          <td className="px-2 py-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {r.rank_sale}·{r.rank_factor}
                            </Badge>
                          </td>
                          <td className={cn("px-2 py-1 text-right tabular-nums",
                            r.is_default_min && "text-warning")}>
                            {r.min_cal}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.max_cal}</td>
                          <td className="px-2 py-1 w-20">
                            <Input
                              type="number" value={r.min_edit ?? ""}
                              disabled={r.from_doc}
                              onChange={(e) => setEdit(r, "min_edit", e.target.value)}
                              className="h-6 text-xs px-1 text-right"
                            />
                          </td>
                          <td className="px-2 py-1 w-20">
                            <Input
                              type="number" value={r.max_edit ?? ""}
                              disabled={r.from_doc}
                              onChange={(e) => setEdit(r, "max_edit", e.target.value)}
                              className="h-6 text-xs px-1 text-right"
                            />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <button onClick={() => toggleSrc(r, "min")}
                              className={cn("px-1.5 py-0.5 rounded font-semibold w-full text-right",
                                f.minSrc === "edit" ? "bg-primary/15 text-primary" :
                                f.minSrc === "doc" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                                "bg-muted")}
                              title={`${f.minSrc.toUpperCase()}`}>
                              {f.min}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <button onClick={() => toggleSrc(r, "max")}
                              className={cn("px-1.5 py-0.5 rounded font-semibold w-full text-right",
                                f.maxSrc === "edit" ? "bg-primary/15 text-primary" :
                                f.maxSrc === "doc" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                                "bg-muted")}
                              title={`${f.maxSrc.toUpperCase()}`}>
                              {f.max}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-[10px]">
                            {r.from_doc ? (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300">Doc</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-4 px-1">Calc</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {filtered.length > PAGE_SIZE && (
            <div className="px-6 py-2 border-t border-border flex items-center justify-between bg-card">
              <span className="text-xs text-muted-foreground">หน้า {page + 1} / {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">ก่อนหน้า</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">ถัดไป</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============== DOC TAB ============== */}
        <TabsContent value="doc" className="flex-1 overflow-auto px-6 mt-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">รายการ Document ที่บันทึก (Doc ล่าสุดจะถูกใช้โดย SRR)</p>
            <Button size="sm" variant="outline" onClick={loadDocs} disabled={docsLoading} className="text-xs">
              <RotateCcw className={cn("w-3.5 h-3.5 mr-1", docsLoading && "animate-spin")} /> Refresh
            </Button>
          </div>
          {docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">ยังไม่มี Document</p>
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="text-xs w-full">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Doc Name</th>
                    <th className="px-3 py-2 text-right font-medium">N</th>
                    <th className="px-3 py-2 text-right font-medium">Items</th>
                    <th className="px-3 py-2 text-left font-medium">Created</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, idx) => (
                    <tr key={d.id} className="border-t border-border/40 hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono">{d.doc_name}</td>
                      <td className="px-3 py-2 text-right">{d.n_factor}</td>
                      <td className="px-3 py-2 text-right">{d.item_count.toLocaleString()}</td>
                      <td className="px-3 py-2">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        {idx === 0 && <Badge className="text-[10px] h-5">Active</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewingDoc(d)}>
                            View
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => exportDoc(d)}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteDoc(d.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ===== Set N dialog ===== */}
      <Dialog open={setNOpen} onOpenChange={setSetNOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Set N (ตัวคูณ Avg Sale สำหรับ Max Cal)</DialogTitle>
            <DialogDescription>สูตร Max = RoundUp((Min + Avg × N) / UnitPick) × UnitPick</DialogDescription>
          </DialogHeader>
          <Input type="number" value={nInput} onChange={e => setNInput(e.target.value)} className="text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetNOpen(false)}>ยกเลิก</Button>
            <Button onClick={() => {
              const v = Number(nInput);
              if (!Number.isFinite(v) || v <= 0) {
                toast({ title: "ค่า N ไม่ถูกต้อง", variant: "destructive" }); return;
              }
              setNFactor(v); setSetNOpen(false);
              if (rows.length > 0) calculate(v);
            }}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Import dialog ===== */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Import Min/Max</DialogTitle>
            <DialogDescription>
              ไฟล์ Excel ต้องมีคอลัมน์: <code>sku_code</code>, <code>min_qty</code>, <code>max_qty</code>
              (ใส่ <code>store_name</code> เพิ่มเพื่อระบุร้าน ถ้าไม่ใส่จะ apply ทุกร้านของ SKU นั้น)
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={exportTemplate} className="text-xs self-start">
              <Download className="w-3.5 h-3.5 mr-1" /> Download Template
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="text-xs" />
            <p className="text-[11px] text-muted-foreground">
              * ต้องกด Calculate ก่อนเพื่อให้มีรายการในตาราง แล้วค่อย Import จะนำไปอัปเดตช่อง Min Edit / Max Edit
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Save dialog ===== */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Save Document</DialogTitle>
            <DialogDescription>
              SRR จะดึงค่า Min/Max จาก Doc ล่าสุด · บันทึก {rows.length.toLocaleString()} แถว
              {hasFilters && docCount > 0 && (
                <> ({calcCount.toLocaleString()} จาก Calc + {docCount.toLocaleString()} จาก Doc เดิม)</>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input value={saveName} onChange={e => setSaveName(e.target.value)} className="text-sm font-mono" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>ยกเลิก</Button>
            <Button onClick={saveDoc}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== View Doc ===== */}
      <Dialog open={!!viewingDoc} onOpenChange={(o) => !o && setViewingDoc(null)}>
        <DialogContent className="sm:max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{viewingDoc?.doc_name}</DialogTitle>
            <DialogDescription>
              N = {viewingDoc?.n_factor} · {viewingDoc?.item_count.toLocaleString()} แถว ·
              {viewingDoc && " " + new Date(viewingDoc.created_at).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border border-border rounded">
            <table className="text-xs w-full">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  {["SKU", "Store", "Type", "Size", "UnitPick", "Avg", "Rank", "MinCal", "MaxCal", "MinEdit", "MaxEdit", "Min", "Max"].map(h =>
                    <th key={h} className="px-2 py-1 text-left font-medium bg-muted">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {((viewingDoc?.data as any[]) || []).slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="px-2 py-0.5 font-mono">{r.sku_code}</td>
                    <td className="px-2 py-0.5">{r.store_name}</td>
                    <td className="px-2 py-0.5">{r.type_store}</td>
                    <td className="px-2 py-0.5">{r.size_store}</td>
                    <td className="px-2 py-0.5 text-right">{r.unit_pick}</td>
                    <td className="px-2 py-0.5 text-right">{Number(r.avg_sale).toFixed(2)}</td>
                    <td className="px-2 py-0.5">{r.rank_sale}</td>
                    <td className="px-2 py-0.5 text-right">{r.min_cal}</td>
                    <td className="px-2 py-0.5 text-right">{r.max_cal}</td>
                    <td className="px-2 py-0.5 text-right">{r.min_edit ?? "-"}</td>
                    <td className="px-2 py-0.5 text-right">{r.max_edit ?? "-"}</td>
                    <td className="px-2 py-0.5 text-right font-semibold">{r.min_final}</td>
                    <td className="px-2 py-0.5 text-right font-semibold">{r.max_final}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {((viewingDoc?.data as any[]) || []).length > 500 && (
              <p className="text-[10px] text-muted-foreground text-center py-2">
                แสดง 500 แถวแรก จากทั้งหมด {((viewingDoc?.data as any[]) || []).length.toLocaleString()} แถว
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingDoc(null)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
