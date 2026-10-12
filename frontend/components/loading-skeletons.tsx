import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Placeholder shapes shown while data loads, in place of plain "Loading…"
// text. The label stays available to screen readers.

/** Shaped like the home total card (period, headline number, subtitle). */
export function TotalCardSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-[22px] bg-card p-5", className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-40 bg-muted" />
      <Skeleton className="h-4 w-24 bg-muted" />
      <Skeleton className="h-10 w-48 bg-muted" />
      <Skeleton className="h-4 w-56 bg-muted" />
    </div>
  )
}

/** A few placeholder table rows for the entries / expenses grids. */
export function GridSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-2 rounded-[22px] bg-card p-4" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full bg-muted" />
      ))}
    </div>
  )
}
