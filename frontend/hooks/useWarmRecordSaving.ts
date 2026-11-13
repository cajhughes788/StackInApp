"use client"

import { useEffect } from "react"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { wakeServer } from "@/lib/api/core/wake"

// The entry and expense forms sit on Home. Saves show at once, but the
// server behind them was cold in most first saves (~5–6s in the logs),
// which is how long a new record stays unconfirmed and when "Entry queued"
// can show on a weak connection. So their save servers are woken when Home
// is up, when the app comes back on screen, and when the form is used
// (wakeServer skips any it woke in the last few minutes).

export function wakeRecordSaving(includeExpenses: boolean): void {
  wakeServer(API_ENDPOINTS.entries.post)
  wakeServer(API_ENDPOINTS.recurringRules.post)
  if (includeExpenses) {
    wakeServer(API_ENDPOINTS.expenses.post)
    wakeServer(API_ENDPOINTS.receiptAssets.post)
  }
}

export function useWarmRecordSaving(enabled: boolean, includeExpenses: boolean): void {
  useEffect(() => {
    if (!enabled) return
    wakeRecordSaving(includeExpenses)
    const onVisible = () => {
      if (document.visibilityState === "visible") wakeRecordSaving(includeExpenses)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [enabled, includeExpenses])
}
