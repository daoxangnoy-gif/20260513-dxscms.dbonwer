import { useRef, useState } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SearchColumn {
  key: string;
  label: string;
}

export interface SearchChip {
  col: string;       // "all" or column key
  label: string;     // human label of column
  value: string;     // search value
}

interface Props {
  columns: SearchColumn[];           // searchable columns
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  placeholder?: string;
  className?: string;
}

export function TableChipSearch({
  columns,
  chips,
  onChipsChange,
  placeholder = "ค้นหา...",
  className,
}: Props) {
  const [value, setValue] = useState("");
  const [activeCol, setActiveCol] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const colOptions: SearchColumn[] = [{ key: "all", label: "ทุกคอลัมน์" }, ...columns];
  const activeLabel = colOptions.find(c => c.key === activeCol)?.label || "ทุกคอลัมน์";

  const addChip = (colKey?: string) => {
    const v = value.trim();
    if (!v) return;
    const target = colKey || activeCol;
    const label = colOptions.find(c => c.key === target)?.label || target;
    onChipsChange([...chips, { col: target, label, value: v }]);
    setValue("");
  };

  const removeChip = (idx: number) => {
    onChipsChange(chips.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    onChipsChange([]);
    setValue("");
  };

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

      {chips.map((c, i) => (
        <Badge
          key={i}
          variant="secondary"
          className="text-[10px] gap-1 pl-1.5 pr-0.5 py-0 h-5"
        >
          <span className="font-medium opacity-70">{c.label}:</span>
          <span className="font-semibold">{c.value}</span>
          <button
            onClick={() => removeChip(i)}
            className="ml-0.5 hover:bg-destructive/20 rounded p-0.5"
            aria-label="remove"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </Badge>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-1.5 gap-0.5">
            {activeLabel}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {colOptions.map(col => (
            <DropdownMenuItem
              key={col.key}
              onClick={() => {
                setActiveCol(col.key);
                inputRef.current?.focus();
              }}
              className={cn("text-xs", activeCol === col.key && "font-bold")}
            >
              {col.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            addChip();
          }
        }}
        placeholder={`${placeholder} (Enter เพื่อเพิ่ม)`}
        className="h-7 text-xs w-48"
      />

      {value && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px] text-primary"
          onClick={() => addChip()}
        >
          + เพิ่ม
        </Button>
      )}

      {(chips.length > 0 || value) && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[10px] px-2"
          onClick={clearAll}
        >
          <X className="w-3 h-3 mr-1" /> ล้าง
        </Button>
      )}
    </div>
  );
}

/**
 * Apply chips to a row set. "all" chip matches any string-coerced column value.
 * Specific column chip matches that single column.
 */
export function applyChipFilter<T extends Record<string, any>>(
  rows: T[],
  chips: SearchChip[],
  searchableKeys: string[],
): T[] {
  if (chips.length === 0) return rows;
  return rows.filter(r => {
    for (const c of chips) {
      const needle = c.value.toLowerCase();
      if (c.col === "all") {
        const hit = searchableKeys.some(k =>
          String(r[k] ?? "").toLowerCase().includes(needle),
        );
        if (!hit) return false;
      } else {
        const v = String(r[c.col] ?? "").toLowerCase();
        if (!v.includes(needle)) return false;
      }
    }
    return true;
  });
}
