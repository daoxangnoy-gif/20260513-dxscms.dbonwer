import { Skeleton } from "@/components/ui/skeleton";

/** Full-app layout skeleton shown while auth/permissions load */
export function AppSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 border-r flex flex-col gap-3 p-4 shrink-0">
        <Skeleton className="h-8 w-32 mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
      {/* Main content */}
      <div className="flex-1 flex flex-col gap-4 p-6">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <TableSkeleton rows={12} />
      </div>
    </div>
  );
}

/** Data-table rows skeleton shown while table data loads */
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full space-y-2">
      {/* Header row */}
      <div className="flex gap-2 pb-1">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-5 flex-1" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" style={{ opacity: 1 - r * 0.06 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
