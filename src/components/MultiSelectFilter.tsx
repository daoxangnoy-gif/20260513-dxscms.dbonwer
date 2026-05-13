import { useState, ReactNode } from "react";
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
}

export function MultiSelectFilter({ label, icon, options, selected, onChange, width = "w-72", renderOption, emptyHint }: Props) {
  const [q, setQ] = useState("");
  const filtered = options.filter(o => o.toLowerCase().includes(q.toLowerCase()));
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
        {emptyHint && options.length === 0 && (
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
              <span className="flex-1">{renderOption ? renderOption(o) : o}</span>
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
