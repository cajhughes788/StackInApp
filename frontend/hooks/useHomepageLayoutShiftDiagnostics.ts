"use client";

import { useEffect } from "react";

import { debugLog } from "@/lib/debugLoop";

const DIAGNOSTICS_FLAG =
  process.env.NEXT_PUBLIC_ENABLE_SYNC_DIAGNOSTICS === "1";

export function useHomepageLayoutShiftDiagnostics(enabled = DIAGNOSTICS_FLAG) {
  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof PerformanceObserver === "undefined"
    ) {
      return;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value?: number; hadRecentInput?: boolean }
      >) {
        if (entry.hadRecentInput) {
          continue;
        }

        debugLog("home-page", "layout_shift_detected", {
          value: entry.value ?? 0,
          startTime: entry.startTime,
        });
      }
    });

    observer.observe({ type: "layout-shift", buffered: true });
    return () => observer.disconnect();
  }, [enabled]);
}
