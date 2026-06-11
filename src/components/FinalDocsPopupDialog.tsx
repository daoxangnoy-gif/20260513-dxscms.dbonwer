import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, BookOpen, X, CheckCircle2, Clock, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ColumnFilterDropdown } from "@/components/DocsPopupDialog";

export interface FinalDocRow {
  id: string;
  saved_at: string;
  date_key?: string;
  spc_name: string;
  vendor_code: string;
  vendor_display: string;
  item_count: number;
  suggest_count: number;
  edited_columns: string[];
  source: "filter" | "vendor" | "import";
  saved_by?: string;
}

type Mode = "filter" | "vendor" | "import";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variant: "dc" | "direct";
  docs: FinalDocRow[];
  loading?: boolean;
  onOpenDoc: (d: FinalDocRow) => void;
  /** Open multiple ticked docs at once. Falls back to onOpenDoc(first) if omitted. */
  onOpenDocs?: (ds: FinalDocRow[]) => void | Promise<void>;
  /** Bulk delete by ids — enables "ลบที่ติ๊ก" / "ลบทั้งหมด". */
  onDeleteDocs?: (ids: string[]) => void | Promise<void>;
  onRefresh?: () => void;
  canDelete?: boolean;
}

export function FinalDocsPopupDialog({
  open, onOpenChange, variant, docs, loading, onOpenDoc, onOpenDocs, onDeleteDocs, onRefresh, canDelete,
}: Props) {
  const [mode, setMode] = useState<Mode>("filter");
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open) return;
    setFilters({});
    setSearch("");
    setChecked(new Set());
  }, [open]);

  const handleModeChange = (next: Mode) => {
    setMode(next);
    setFilters({});
    setSearch("");
    setChecked(new Set());
  };

  // Resolve saved_by → display name
  useEffect(() => {
    if (!open) return;
    const ids = Array.from(new Set(docs.map((d) => d.saved_by).filter(Boolean) as string[])).filter((id) => !userMap.has(id));
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

  const enriched = useMemo(() => docs.map((d) => ({
    ...d,
    user: d.saved_by ? (userMap.get(d.saved_by) || d.saved_by.slice(0, 8)) : "—",
    vendor: `${d.vendor_code} - ${d.vendor_display}`,
  })), [docs, userMap]);

  const filteredByMode = useMemo(
    () => enriched
      .filter((d) => (d.source || "filter") === mode)
      .sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || ""))),
    [enriched, mode],
  );

  const cols: { key: string; label: string; w?: string; numeric?: boolean; filterable?: boolean }[] = [
    { key: "saved_at", label: "วันที่ Save", w: "w-36" },
    { key: "vendor", label: "Vendor", w: "min-w-[240px]", filterable: true },
    { key: "spc_name", label: "SPC", w: "w-28", filterable: true },
    { key: "item_count", label: "Items", w: "w-20", numeric: true, filterable: true },
    { key: "suggest_count", label: "Suggest", w: "w-24", numeric: true, filterable: true },
    { key: "edited_columns", label: "คอลัมน์ที่แก้ไข", w: "min-w-[180px]" },
    { key: "user", label: "User", w: "w-36", filterable: true },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredByMode.filter((d) => {
      for (const [k, sel] of Object.entries(filters)) {
        if (!sel || sel.size === 0) continue;
        const cell = String((d as any)[k] ?? "");
        if (!sel.has(cell)) return false;
      }
      if (q) {
        const hit =
          d.vendor.toLowerCase().includes(q) ||
          String(d.spc_name ?? "").toLowerCase().includes(q) ||
          (d.user || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [filteredByMode, filters, search]);

  const colValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of cols) {
      if (!c.filterable) continue;
      const set = new Set<string>();
      for (const d of filteredByMode) {
        const v = (d as any)[c.key];
        if (v === undefined || v === null) continue;
        set.add(c.numeric ? String(Number(v) || 0) : String(v));
      }
      map[c.key] = [...set].sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [filteredByMode]);

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
  const tickedRowSum = tickedDocs.reduce((s, d) => s + (d.item_count || 0), 0);

  const handleOpenTicked = () => {
    if (tickedDocs.length === 0) return;
    if (tickedDocs.length === 1) onOpenDoc(tickedDocs[0]);
    else if (onOpenDocs) onOpenDocs(tickedDocs);
    else onOpenDoc(tickedDocs[0]);
  };

  const handleDeleteTicked = async () => {
    if (tickedDocs.length === 0 || !onDeleteDocs) return;
    if (!confirm(`ลบ ${tickedDocs.length} Doc Final ที่ติ๊ก ?`)) return;
    await onDeleteDocs(tickedDocs.map((d) => d.id));
    setChecked(new Set());
  };
  const handleDeleteAllFiltered = async () => {
    if (filtered.length === 0 || !onDeleteDocs) return;
    if (!confirm(`ลบทั้งหมด ${filtered.length} Doc Final ตาม filter ปัจจุบัน ?`)) return;
    await onDeleteDocs(filtered.map((d) => d.id));
    setChecked(new Set());
  };

  const fmtDate = (s: string) => {
    try {
      return new Date(s).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return s; }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] h-[90vh] flex flex-col p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="w-4 h-4 text-amber-500" /> Doc Final — {variant === "dc" ? "SRR DC" : "SRR DIRECT"}
            <span className="text-xs text-muted-foreground font-normal ml-2">
              เอกสารที่ผ่านการ Review · บันทึกอัตโนมัติทุกครั้งที่กด Save · เก็บ 60 วัน · ดับเบิลคลิกแถว = เปิด · ติ๊ก แล้วกด "อ่านตามที่ติ๊ก" / "ลบที่ติ๊ก"
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => handleModeChange(v as Mode)} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TabsList className="h-8">
              <TabsTrigger value="filter" className="text-xs">Filter Mode ({enriched.filter((d) => (d.source || "filter") === "filter").length})</TabsTrigger>
              <TabsTrigger value="vendor" className="text-xs">Import Vendor ({enriched.filter((d) => d.source === "vendor").length})</TabsTrigger>
              <TabsTrigger value="import" className="text-xs">Import Barcode ({enriched.filter((d) => d.source === "import").length})</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Input
                  placeholder="ค้นหา Vendor / SPC / User..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 w-56 text-xs pr-6"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                    title="ล้าง"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {checked.size > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  ติ๊ก {tickedDocs.length} Doc · {tickedRowSum.toLocaleString()} rows
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
              <Button size="sm" variant="outline" onClick={() => onRefresh?.()} className="h-7 text-xs gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>

          <TabsContent value={mode} className="flex-1 min-h-0 mt-2">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...
              </div>
            ) : (
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
                              {c.filterable && (
                                <ColumnFilterDropdown
                                  label={c.label}
                                  values={colValues[c.key] || []}
                                  selected={sel}
                                  onChange={(next) => setFilters((prev) => ({ ...prev, [c.key]: next }))}
                                />
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={cols.length + 1} className="text-center text-muted-foreground py-8 text-sm">
                          ยังไม่มี Doc Final ใน Mode นี้ · กด Save เพื่อบันทึกครั้งแรก
                        </td>
                      </tr>
                    ) : (
                      filtered.map((d) => (
                        <tr
                          key={d.id}
                          className={cn(
                            "hover:bg-accent/40 cursor-pointer border-b border-border/50",
                            checked.has(d.id) && "bg-primary/5",
                          )}
                          onDoubleClick={() => onOpenDoc(d)}
                          title="ดับเบิลคลิกเพื่อเปิดมาแสดง"
                        >
                          <td className="p-1 text-center" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={checked.has(d.id)} onCheckedChange={() => toggleOne(d.id)} />
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 opacity-50" />
                              {fmtDate(d.saved_at)}
                            </div>
                          </td>
                          <td className="p-2 font-mono align-top">
                            <div className="font-semibold">{d.vendor_code}</div>
                            <div className="text-muted-foreground truncate max-w-[200px]">{d.vendor_display}</div>
                          </td>
                          <td className="p-2 align-top">{d.spc_name || "—"}</td>
                          <td className="p-2 text-right tabular-nums align-top">{(d.item_count || 0).toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums text-green-600 font-semibold align-top">{(d.suggest_count || 0).toLocaleString()}</td>
                          <td className="p-2 align-top max-w-[220px]">
                            {(d.edited_columns || []).length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {(d.edited_columns as string[]).slice(0, 4).map((c: string) => (
                                  <span key={c} className="bg-amber-100 text-amber-700 rounded px-1 py-0.5 text-[10px]">{c}</span>
                                ))}
                                {(d.edited_columns as string[]).length > 4 && (
                                  <span className="text-muted-foreground text-[10px]">+{(d.edited_columns as string[]).length - 4}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-2 align-top">{d.user}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground mt-1">แสดง {filtered.length} / {filteredByMode.length} เอกสาร</div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
