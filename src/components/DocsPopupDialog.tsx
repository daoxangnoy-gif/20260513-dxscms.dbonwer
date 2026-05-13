import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Trash2, FolderOpen, BookOpen, Filter, X, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  loadCost0Docs,
  deleteCost0Docs,
  exportCost0Docs,
  type Cost0Doc,
} from "@/lib/cost0Docs";

export interface DocRow {
  id: string;
  doc_no: string;
  spc_name: string;
  vendor_code: string;
  vendor_display: string;
  supplier_currency?: string;
  type_store?: string;
  store_name?: string;
  item_count: number;
  suggest_count: number;
  order_value?: number;
  user_id?: string;
  source: "filter" | "vendor" | "import";
  raw: any;
}

type Mode = "filter" | "vendor" | "import" | "cost0";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variant: "dc" | "direct";
  docs: DocRow[];
  initialMode?: Mode;
  onOpenDoc: (doc: DocRow) => void;
  onOpenDocs?: (docs: DocRow[]) => void;
  onDeleteDoc?: (doc: DocRow) => void | Promise<void>;
  /** Bulk delete by ids — if provided, used for "ลบที่ติ๊ก" / "ลบทั้งหมด" */
  onDeleteDocs?: (ids: string[]) => void | Promise<void>;
  canDelete?: boolean;
  latestBatchValue?: string;
  /** Exact doc ids that should be auto-selected & highlighted (the just-imported batch). Takes priority over latestBatchValue. */
  latestDocIds?: string[];
  /** localStorage key for "Doc Cost = 0" tab. Hides tab when omitted. */
  cost0StorageKey?: string;
  /** Increment to force reload of cost0 docs from localStorage. */
  cost0RefreshKey?: number;
}

export function formatDocNo(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
  } catch {
    return "";
  }
}

const fmtMoney = (n: number) =>
  (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Dropdown filter for a column — search + multi-select values
function ColumnFilterDropdown({
  values,
  selected,
  onChange,
  label,
}: {
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => v.toLowerCase().includes(q));
  }, [values, search]);
  const active = selected.size > 0;
  const toggle = (v: string) => {
    const n = new Set(selected);
    n.has(v) ? n.delete(v) : n.add(v);
    onChange(n);
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.has(v));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full h-6 px-1.5 text-[11px] flex items-center gap-1 rounded border bg-background hover:bg-accent/40 transition",
            active && "border-primary text-primary",
          )}
          title={active ? `${selected.size} ค่า: ${[...selected].slice(0, 3).join(", ")}${selected.size > 3 ? "..." : ""}` : `กรอง ${label}`}
        >
          <Filter className="w-3 h-3 shrink-0" />
          <span className="truncate flex-1 text-left">
            {active ? `${selected.size} ค่า` : "ทั้งหมด"}
          </span>
          {active && (
            <X
              className="w-3 h-3 shrink-0 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onChange(new Set()); }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          autoFocus
          placeholder={`ค้นหา ${label}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs mb-2"
        />
        <div className="flex items-center gap-2 px-1 pb-1 border-b mb-1">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={() => {
              const n = new Set(selected);
              if (allFilteredSelected) filtered.forEach((v) => n.delete(v));
              else filtered.forEach((v) => n.add(v));
              onChange(n);
            }}
          />
          <span className="text-[11px] text-muted-foreground">เลือกทั้งหมด ({filtered.length})</span>
          {active && (
            <button
              className="ml-auto text-[11px] text-destructive hover:underline"
              onClick={() => onChange(new Set())}
            >
              ล้าง
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-auto">
          {filtered.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-4">ไม่พบ</div>
          ) : (
            filtered.map((v) => (
              <label
                key={v}
                className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-accent/40 rounded cursor-pointer"
              >
                <Checkbox checked={selected.has(v)} onCheckedChange={() => toggle(v)} />
                <span className="truncate" title={v}>{v || "(ว่าง)"}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DocsPopupDialog({ open, onOpenChange, variant, docs, initialMode = "filter", onOpenDoc, onOpenDocs, onDeleteDoc, onDeleteDocs, canDelete, latestBatchValue, latestDocIds, cost0StorageKey, cost0RefreshKey = 0 }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Cost=0 docs (loaded from localStorage)
  const [cost0Docs, setCost0Docs] = useState<Cost0Doc[]>([]);
  const [cost0Checked, setCost0Checked] = useState<Set<string>>(new Set());
  const [cost0Search, setCost0Search] = useState("");
  // Search SKU Code / Barcode across rows of Doc Cal (filter/vendor/import)
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    if (!open || !cost0StorageKey) return;
    setCost0Docs(loadCost0Docs(cost0StorageKey));
    setCost0Checked(new Set());
  }, [open, cost0StorageKey, cost0RefreshKey]);

  // Stable signature so the auto-select effect re-runs only when contents change.
  const latestIdsKey = (latestDocIds || []).slice().sort().join(",");

  const computeAutoIds = (forMode: Mode): string[] => {
    if (latestDocIds && latestDocIds.length > 0) {
      const set = new Set(latestDocIds);
      return docs.filter((d) => d.source === forMode && set.has(d.id)).map((d) => d.id);
    }
    if (latestBatchValue) {
      return docs
        .filter((d) => d.source === forMode && String(d.raw?.created_at || "") === latestBatchValue)
        .map((d) => d.id);
    }
    return [];
  };

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setFilters({});
    setItemSearch("");
    setChecked(new Set(computeAutoIds(initialMode)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMode, latestBatchValue, latestIdsKey]);

  const handleModeChange = (next: Mode) => {
    setMode(next);
    setFilters({});
    setItemSearch("");
    setChecked(new Set(computeAutoIds(next)));
  };

  useEffect(() => {
    if (!open) return;
    const ids = Array.from(new Set(docs.map((d) => d.user_id).filter(Boolean) as string[])).filter((id) => !userMap.has(id));
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids);
      if (data) {
        setUserMap((prev) => {
          const next = new Map(prev);
          for (const p of data as any[]) next.set(p.user_id, p.full_name || p.email || p.user_id);
          return next;
        });
      }
    })();
  }, [open, docs]);

  const cols: { key: string; label: string; w?: string; numeric?: boolean }[] = variant === "dc"
    ? [
        { key: "doc_no", label: "Doc No", w: "w-36" },
        { key: "spc_name", label: "SPC Name", w: "w-32" },
        { key: "vendor", label: "Vendor", w: "min-w-[260px]" },
        { key: "item_count", label: "SKU tt", w: "w-20", numeric: true },
        { key: "suggest_count", label: "SKU Suggest", w: "w-24", numeric: true },
        { key: "order_value", label: "มูลค่าสั่งซื้อ", w: "w-32", numeric: true },
        { key: "user", label: "User", w: "w-40" },
      ]
    : [
        { key: "doc_no", label: "Doc No", w: "w-36" },
        { key: "spc_name", label: "SPC Name", w: "w-32" },
        { key: "vendor", label: "Vendor", w: "min-w-[240px]" },
        { key: "type_store", label: "Type Store", w: "w-28" },
        { key: "store_name", label: "Store", w: "w-32" },
        { key: "item_count", label: "SKU tt", w: "w-20", numeric: true },
        { key: "suggest_count", label: "SKU Suggest", w: "w-24", numeric: true },
        { key: "order_value", label: "มูลค่าสั่งซื้อ", w: "w-32", numeric: true },
        { key: "user", label: "User", w: "w-40" },
      ];

  const enriched = useMemo(() => docs.map((d) => ({
    ...d,
    user: d.user_id ? (userMap.get(d.user_id) || d.user_id.slice(0, 8)) : "—",
    vendor: `${d.vendor_code} - ${d.vendor_display}${d.supplier_currency ? ` - ${d.supplier_currency}` : ""}`,
  })), [docs, userMap]);

  const filteredByMode = useMemo(
    () => enriched
      .filter((d) => d.source === mode)
      .sort((a, b) => String(b.raw?.created_at || "").localeCompare(String(a.raw?.created_at || ""))),
    [enriched, mode],
  );

  const filtered = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return filteredByMode.filter((d) => {
      for (const [k, sel] of Object.entries(filters)) {
        if (!sel || sel.size === 0) continue;
        const cell = String((d as any)[k] ?? "");
        if (!sel.has(cell)) return false;
      }
      if (q) {
        const rows: any[] = Array.isArray(d.raw?.data) ? d.raw.data : [];
        const hit = rows.some((r) =>
          String(r?.sku_code ?? "").toLowerCase().includes(q) ||
          String(r?.barcode_unit ?? "").toLowerCase().includes(q) ||
          String(r?.main_barcode ?? "").toLowerCase().includes(q)
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [filteredByMode, filters, itemSearch]);

  // distinct values per column (from filteredByMode for relevance)
  const colValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of cols) {
      const set = new Set<string>();
      for (const d of filteredByMode) {
        const v = (d as any)[c.key];
        if (v === undefined || v === null) continue;
        set.add(c.numeric ? String(Number(v) || 0) : String(v));
      }
      const arr = [...set];
      // Doc No: sort newest first (numeric-ish desc); others: asc
      if (c.key === "doc_no") arr.sort((a, b) => b.localeCompare(a));
      else arr.sort((a, b) => a.localeCompare(b));
      map[c.key] = arr;
    }
    return map;
  }, [filteredByMode, cols]);

  const latestExact = latestBatchValue || "";
  const latestIdSet = useMemo(() => new Set(latestDocIds || []), [latestIdsKey]);

  const allFilteredIds = filtered.map((d) => d.id);
  const allChecked = allFilteredIds.length > 0 && allFilteredIds.every((id) => checked.has(id));
  const someChecked = !allChecked && allFilteredIds.some((id) => checked.has(id));

  const toggleAll = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) allFilteredIds.forEach((id) => next.delete(id));
      else allFilteredIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const tickedDocs = useMemo(() => filtered.filter((d) => checked.has(d.id)), [filtered, checked]);
  const tickedRowSum = tickedDocs.reduce((s, d) => s + d.item_count, 0);
  const tickedValueSum = tickedDocs.reduce((s, d) => s + (d.order_value || 0), 0);

  const handleOpenTicked = () => {
    if (tickedDocs.length === 0) return;
    if (tickedDocs.length === 1) onOpenDoc(tickedDocs[0]);
    else if (onOpenDocs) onOpenDocs(tickedDocs);
    else onOpenDoc(tickedDocs[0]);
  };

  const handleDeleteTicked = async () => {
    if (tickedDocs.length === 0 || !onDeleteDocs) return;
    if (!confirm(`ลบ ${tickedDocs.length} Doc ที่ติ๊ก ?`)) return;
    await onDeleteDocs(tickedDocs.map((d) => d.id));
    setChecked(new Set());
  };
  const handleDeleteAllFiltered = async () => {
    if (filtered.length === 0 || !onDeleteDocs) return;
    if (!confirm(`ลบทั้งหมด ${filtered.length} Doc ตาม filter ปัจจุบัน ?`)) return;
    await onDeleteDocs(filtered.map((d) => d.id));
    setChecked(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] h-[90vh] flex flex-col p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="w-4 h-4" /> Documents — {variant === "dc" ? "SRR DC" : "SRR DIRECT"}
            <span className="text-xs text-muted-foreground font-normal ml-2">ดับเบิลคลิกแถว = เปิด · ติ๊ก แล้วกด "อ่านตามที่ติ๊ก" / "ลบที่ติ๊ก"</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => handleModeChange(v as Mode)} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TabsList className="h-8">
              <TabsTrigger value="filter" className="text-xs">Filter Mode ({enriched.filter((d) => d.source === "filter").length})</TabsTrigger>
              <TabsTrigger value="vendor" className="text-xs">Import Vendor ({enriched.filter((d) => d.source === "vendor").length})</TabsTrigger>
              <TabsTrigger value="import" className="text-xs">Import Barcode ({enriched.filter((d) => d.source === "import").length})</TabsTrigger>
              {cost0StorageKey && (
                <TabsTrigger value="cost0" className="text-xs text-amber-700 dark:text-amber-400">
                  Doc Cost = 0 ({cost0Docs.length})
                </TabsTrigger>
              )}
            </TabsList>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {mode !== "cost0" ? (
                <>
                  <div className="relative">
                    <Input
                      placeholder="ค้นหา SKU Code / Barcode..."
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      className="h-7 w-56 text-xs pr-6"
                    />
                    {itemSearch && (
                      <button
                        onClick={() => setItemSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                        title="ล้าง"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {checked.size > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      ติ๊ก {tickedDocs.length} Doc · {tickedRowSum.toLocaleString()} rows · มูลค่า {fmtMoney(tickedValueSum)}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="default"
                    disabled={tickedDocs.length === 0}
                    onClick={handleOpenTicked}
                    className="h-7 text-xs gap-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    อ่านตามที่ติ๊ก{tickedDocs.length > 0 ? ` (${tickedDocs.length})` : ""}
                  </Button>
                  {canDelete && onDeleteDocs && (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={tickedDocs.length === 0}
                        onClick={handleDeleteTicked}
                        className="h-7 text-xs gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        ลบที่ติ๊ก{tickedDocs.length > 0 ? ` (${tickedDocs.length})` : ""}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={filtered.length === 0}
                        onClick={handleDeleteAllFiltered}
                        className="h-7 text-xs gap-1.5 border-destructive text-destructive hover:bg-destructive/10"
                        title="ลบทั้งหมดตาม filter ปัจจุบัน"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        ลบทั้งหมด ({filtered.length})
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <Cost0Toolbar
                  cost0Docs={cost0Docs}
                  search={cost0Search}
                  onSearchChange={setCost0Search}
                  cost0Checked={cost0Checked}
                  onExport={(docs) => exportCost0Docs(docs)}
                  onDelete={(ids) => {
                    if (!cost0StorageKey) return;
                    if (!confirm(`ลบ ${ids.length} Doc Cost=0 ?`)) return;
                    deleteCost0Docs(cost0StorageKey, ids);
                    setCost0Docs(loadCost0Docs(cost0StorageKey));
                    setCost0Checked(new Set());
                  }}
                />
              )}
            </div>
          </div>

          {mode === "cost0" ? (
            <TabsContent value="cost0" className="flex-1 min-h-0 mt-2">
              <Cost0Table
                docs={cost0Docs}
                search={cost0Search}
                checked={cost0Checked}
                setChecked={setCost0Checked}
                variant={variant}
              />
            </TabsContent>
          ) : (
            <TabsContent value={mode} className="flex-1 min-h-0 mt-2">
              <div className="border border-border rounded-md overflow-auto h-full">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr>
                      <th className="w-9 p-2 border-b border-border text-center">
                        <Checkbox
                          checked={allChecked ? true : someChecked ? "indeterminate" : false}
                          onCheckedChange={toggleAll}
                        />
                      </th>
                      {cols.map((c) => {
                        const sel = filters[c.key] || new Set<string>();
                        const active = sel.size > 0;
                        return (
                          <th key={c.key} className={cn("p-1.5 border-b border-border align-top", c.w)}>
                            <div className={cn("flex flex-col gap-1", c.numeric && "items-end")}>
                              <span className={cn("font-semibold text-[11px] flex items-center gap-1", active && "text-primary")}>
                                {c.label}
                                {active && <span className="text-[10px] bg-primary/15 text-primary rounded px-1">{sel.size}</span>}
                              </span>
                              <ColumnFilterDropdown
                                label={c.label}
                                values={colValues[c.key] || []}
                                selected={sel}
                                onChange={(next) => setFilters((prev) => ({ ...prev, [c.key]: next }))}
                              />
                            </div>
                          </th>
                        );
                      })}
                      {canDelete && <th className="w-10 border-b border-border" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={cols.length + 1 + (canDelete ? 1 : 0)} className="text-center text-muted-foreground py-8 text-sm">
                          ไม่พบเอกสารใน Mode นี้
                        </td>
                      </tr>
                    ) : (
                      filtered.map((d) => {
                        const isLatest = latestIdSet.size > 0
                          ? latestIdSet.has(d.id)
                          : (!!latestExact && String(d.raw?.created_at || "") === latestExact);
                        return (
                          <tr
                            key={d.id}
                            className={cn(
                              "hover:bg-accent/40 cursor-pointer border-b border-border/50",
                              checked.has(d.id) && "bg-primary/5",
                              isLatest && "bg-amber-50 dark:bg-amber-950/20",
                            )}
                            onDoubleClick={() => onOpenDoc(d)}
                            title={isLatest ? "🆕 Doc ล่าสุด — ดับเบิลคลิกเพื่อเปิดข้อมูล" : "ดับเบิลคลิกเพื่อเปิดข้อมูล"}
                          >
                            <td className="p-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={checked.has(d.id)} onCheckedChange={() => toggleOne(d.id)} />
                            </td>
                            {cols.map((c) => (
                              <td key={c.key} className={cn("p-2 align-top", c.numeric && "text-right tabular-nums")}>
                                {c.key === "doc_no" ? (
                                  <span className="font-mono font-semibold text-primary">{d.doc_no}</span>
                                ) : c.key === "order_value" ? (
                                  <span>{fmtMoney((d as any).order_value || 0)}</span>
                                ) : c.numeric ? (
                                  <span>{((d as any)[c.key] ?? 0).toLocaleString()}</span>
                                ) : (
                                  <span>{(d as any)[c.key] ?? "—"}</span>
                                )}
                              </td>
                            ))}
                            {canDelete && (
                              <td className="p-1 text-center" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-destructive"
                                  onClick={(e) => { e.stopPropagation(); if (confirm(`ลบ Doc ${d.doc_no} ?`)) onDeleteDoc?.(d); }}
                                  title="ลบ"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">แสดง {filtered.length} / {filteredByMode.length} เอกสาร</div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ============== Cost = 0 Sub-components ==============
function Cost0Toolbar({
  cost0Docs, search, onSearchChange, cost0Checked, onExport, onDelete,
}: {
  cost0Docs: Cost0Doc[];
  search: string;
  onSearchChange: (s: string) => void;
  cost0Checked: Set<string>;
  onExport: (docs: Cost0Doc[]) => void;
  onDelete: (ids: string[]) => void;
}) {
  const ticked = cost0Docs.filter((d) => cost0Checked.has(d.id));
  const tickedRows = ticked.reduce((s, d) => s + d.rows.length, 0);
  return (
    <>
      <Input
        placeholder="ค้นหา Vendor / SPC / SKU..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-7 w-56 text-xs"
      />
      {ticked.length > 0 && (
        <span className="text-[11px] text-muted-foreground">
          ติ๊ก {ticked.length} Doc · {tickedRows.toLocaleString()} rows
        </span>
      )}
      <Button
        size="sm"
        variant="default"
        disabled={ticked.length === 0}
        onClick={() => onExport(ticked)}
        className="h-7 text-xs gap-1.5"
      >
        <Download className="w-3.5 h-3.5" />
        Export ที่ติ๊ก{ticked.length > 0 ? ` (${ticked.length})` : ""}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={ticked.length === 0}
        onClick={() => onDelete([...cost0Checked])}
        className="h-7 text-xs gap-1.5"
      >
        <Trash2 className="w-3.5 h-3.5" />
        ลบที่ติ๊ก{ticked.length > 0 ? ` (${ticked.length})` : ""}
      </Button>
    </>
  );
}

function Cost0Table({
  docs, search, checked, setChecked, variant,
}: {
  docs: Cost0Doc[];
  search: string;
  checked: Set<string>;
  setChecked: (s: Set<string>) => void;
  variant: "dc" | "direct";
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = q
      ? docs.filter((d) =>
          d.vendor_code.toLowerCase().includes(q) ||
          d.vendor_name.toLowerCase().includes(q) ||
          d.spc_name.toLowerCase().includes(q) ||
          d.rows.some((r) => String(r["SKU Code"]).toLowerCase().includes(q)),
        )
      : docs;
    return [...arr].sort((a, b) => b.date.localeCompare(a.date));
  }, [docs, search]);

  const allIds = filtered.map((d) => d.id);
  const allChecked = allIds.length > 0 && allIds.every((id) => checked.has(id));
  const someChecked = !allChecked && allIds.some((id) => checked.has(id));

  const toggleAll = () => {
    const next = new Set(checked);
    if (allChecked) allIds.forEach((id) => next.delete(id));
    else allIds.forEach((id) => next.add(id));
    setChecked(next);
  };
  const toggleOne = (id: string) => {
    const n = new Set(checked);
    n.has(id) ? n.delete(id) : n.add(id);
    setChecked(n);
  };

  return (
    <div className="border border-border rounded-md overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-muted z-10">
          <tr>
            <th className="w-9 p-2 border-b border-border text-center">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={toggleAll}
              />
            </th>
            <th className="p-2 border-b border-border text-left w-36">Doc Date</th>
            <th className="p-2 border-b border-border text-left w-32">SPC Name</th>
            <th className="p-2 border-b border-border text-left min-w-[260px]">Vendor</th>
            <th className="p-2 border-b border-border text-right w-20">Rows</th>
            <th className="p-2 border-b border-border text-right w-24">Total Qty</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                ไม่มี Doc Cost = 0
              </td>
            </tr>
          ) : (
            filtered.map((d) => {
              const totalQty = d.rows.reduce((s, r) => s + (Number(r["Qty Order"]) || 0), 0);
              const docDate = (() => {
                try {
                  const dt = new Date(d.date);
                  const p = (n: number) => String(n).padStart(2, "0");
                  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}${p(dt.getHours())}${p(dt.getMinutes())}`;
                } catch { return ""; }
              })();
              return (
                <tr
                  key={d.id}
                  className={cn(
                    "hover:bg-accent/40 border-b border-border/50",
                    checked.has(d.id) && "bg-primary/5",
                  )}
                >
                  <td className="p-1 text-center">
                    <Checkbox checked={checked.has(d.id)} onCheckedChange={() => toggleOne(d.id)} />
                  </td>
                  <td className="p-2 font-mono font-semibold text-primary">{docDate}</td>
                  <td className="p-2">{d.spc_name || "—"}</td>
                  <td className="p-2">{d.vendor_display || `${d.vendor_code} - ${d.vendor_name}`}</td>
                  <td className="p-2 text-right tabular-nums">{d.rows.length.toLocaleString()}</td>
                  <td className="p-2 text-right tabular-nums">{totalQty.toLocaleString()}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
