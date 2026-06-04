"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export default function SyncStatusIndicator({
  visible,
  label = "Syncing",
  className,
}: {
  visible: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-border/70 bg-background/92 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
        className
      )}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="sr-only">{label}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
