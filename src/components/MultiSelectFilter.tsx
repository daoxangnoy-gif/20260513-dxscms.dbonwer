import { useState, ReactNode, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search } from "lucide-react";

interface Props {
  label: string;
  icon?: ReactNode;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  width?: string;
  renderOption?: (opt: string) => ReactNode;
  emptyHint?: string;
  counts?: Record<string, number>;
  loading?: boolean;
  loadingLabel?: string;
}

function fmtCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function MultiSelectFilter({ label, icon, options, selected, onChange, width = "w-72", renderOption, emptyHint, counts, loading, loadingLabel }: Props) {
  const [q, setQ] = useState("");

  // Timer: นับวินาทีตั้งแต่เริ่ม loading
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (loading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);
  const filtered = (counts
    ? [...options].sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
    : options
  ).filter(o => o.toLowerCase().includes(q.toLowerCase()));
  const allFilteredSelected = filtered.length > 0 && filtered.every(o => selected.includes(o));

  const toggle = (o: string, c: boolean) =>
    onChange(c ? [...selected, o] : selected.filter(x => x !== o));

  const toggleAll = (c: boolean) => {
    if (c) onChange(Array.from(new Set([...selected, ...filtered])));
    else onChange(selected.filter(s => !filtered.includes(s)));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          {icon}
          {label} ({selected.length || "All"})
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`${width} p-2`} align="start">
        <div className="flex items-center gap-1 mb-1.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา..." className="h-7 text-xs" />
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => onChange([])}>Clear</Button>
        </div>
        {loading && options.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-4 px-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{loadingLabel || "กำลังโหลด..."}</span>
            </div>
            <span className="text-[13px] font-mono font-semibold text-primary tabular-nums">
              {elapsed} วินาที
            </span>
          </div>
        )}
        {!loading && emptyHint && options.length === 0 && (
          <div className="text-[10px] text-muted-foreground py-2 px-1">{emptyHint}</div>
        )}
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer text-xs py-0.5 px-1 hover:bg-accent rounded border-b mb-1 pb-1">
            <Checkbox checked={allFilteredSelected} onCheckedChange={c => toggleAll(!!c)} />
            <span className="font-semibold">เลือกทั้งหมด ({filtered.length})</span>
          </label>
        )}
        <div className="max-h-64 overflow-auto space-y-0.5">
          {filtered.map(o => (
            <label key={o} className="flex items-center gap-2 cursor-pointer text-xs py-0.5 px-1 hover:bg-accent rounded">
              <Checkbox checked={selected.includes(o)} onCheckedChange={c => toggle(o, !!c)} />
              <span className="flex-1 truncate">{renderOption ? renderOption(o) : o}</span>
              {counts && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ({fmtCount(counts[o] || 0)})
                </span>
              )}
            </label>
          ))}
          {filtered.length === 0 && options.length > 0 && (
            <div className="text-[10px] text-muted-foreground py-2 px-1 text-center">ไม่พบผลลัพธ์</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
