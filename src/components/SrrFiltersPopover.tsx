import { ReactNode, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

interface Props {
  /** Active filter count badge — e.g. sum of selected items across all filters */
  activeCount?: number;
  /** Filter dropdowns (MultiSelect components) */
  children: ReactNode;
  /** Optional label override */
  label?: string;
}

/**
 * Compact "Filters" button that opens a popover containing all SRR filter dropdowns.
 * Used to consolidate 7 filter chips into a single trigger to save vertical space.
 */
export function SrrFiltersPopover({ activeCount = 0, children, label = "Filters" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 px-2.5"
        >
          <SlidersHorizontal className="w-3 h-3" />
          {label}
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[min(900px,calc(100vw-2rem))] p-2"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
