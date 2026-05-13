import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, CalendarDays, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { SnapshotBatch } from "@/lib/snapshotService";

interface Props {
  batches: SnapshotBatch[];
  /** Single mode: "today" or a batch ISO timestamp */
  value?: string;
  onChange?: (value: string) => void;
  /** Multi mode: array of batch ISO timestamps (no "today" entry) */
  values?: string[];
  onChangeMulti?: (values: string[]) => void;
  /** Enable multi-select mode */
  multiple?: boolean;
  mode?: "filter" | "vendor" | "import";
  loading?: boolean;
  className?: string;
}

/**
 * Searchable picker for snapshot batches.
 * - Single mode (default): radio-style; "today" loads recent (all days).
 * - Multi mode: checkbox + Select All / Clear; merges multiple batches.
 */
export function SnapshotBatchPicker({
  batches, value, onChange, values, onChangeMulti, multiple, mode, loading, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const modeBatches = useMemo(
    () => (mode ? batches.filter((b) => (b.source || "filter") === mode) : batches),
    [batches, mode],
  );

  // Filtered list (case-insensitive on label/date_key)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modeBatches;
    return modeBatches.filter(b => b.label.toLowerCase().includes(q) || b.date_key.toLowerCase().includes(q));
  }, [modeBatches, query]);

  // ---- SINGLE MODE LABEL ----
  const singleLabel = useMemo(() => {
    if (!value || value === "today") return "ล่าสุด (ทุกวัน)";
    const b = modeBatches.find(b => b.value === value);
    return b ? b.label : value;
  }, [value, modeBatches]);

  // ---- MULTI MODE LABEL ----
  const multiLabel = useMemo(() => {
    const sel = values || [];
    if (sel.length === 0) return "ล่าสุด (ทุกวัน)";
    if (sel.length === 1) {
      const b = modeBatches.find(x => x.value === sel[0]);
      return b ? b.label : sel[0];
    }
    return `เลือก ${sel.length} batch`;
  }, [values, modeBatches]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(b => (values || []).includes(b.value));

  const toggleAll = (checked: boolean) => {
    if (!onChangeMulti) return;
    const cur = new Set(values || []);
    if (checked) filtered.forEach(b => cur.add(b.value));
    else filtered.forEach(b => cur.delete(b.value));
    onChangeMulti(Array.from(cur));
  };

  const toggleOne = (v: string) => {
    if (!onChangeMulti) return;
    const cur = new Set(values || []);
    if (cur.has(v)) cur.delete(v);
    else cur.add(v);
    onChangeMulti(Array.from(cur));
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-[220px] justify-between text-xs font-normal px-2"
          >
            <span className="truncate">📅 {multiple ? multiLabel : singleLabel}</span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="end">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="ค้นหาวันที่/เวลา..."
              className="text-xs h-8"
              value={query}
              onValueChange={setQuery}
            />

            {multiple && (
              <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={(c) => toggleAll(!!c)}
                  />
                  <span className="font-semibold">เลือกทั้งหมด ({filtered.length})</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onChangeMulti?.([])}
                >
                  Clear
                </Button>
              </div>
            )}

            <CommandList>
              <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                ไม่พบ
              </CommandEmpty>

              <CommandGroup>
                {/* Single-mode "today" option */}
                {!multiple && (
                  <CommandItem
                    value="__today__"
                    onSelect={() => { onChange?.("today"); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5", value === "today" ? "opacity-100" : "opacity-0")} />
                    📅 ล่าสุด (ทุกวัน)
                  </CommandItem>
                )}

                {filtered.map(b => {
                  const isSelected = multiple
                    ? (values || []).includes(b.value)
                    : value === b.value;
                  return (
                    <CommandItem
                      key={b.value}
                      value={b.value}
                      onSelect={() => {
                        if (multiple) toggleOne(b.value);
                        else { onChange?.(b.value); setOpen(false); }
                      }}
                      className="text-xs"
                    >
                      {multiple ? (
                        <Checkbox
                          checked={isSelected}
                          className="mr-2"
                          onCheckedChange={() => toggleOne(b.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                      )}
                      <span className="flex-1 truncate">📅 {b.label}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">{b.count} docs</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
