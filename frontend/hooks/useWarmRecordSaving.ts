"use client"

import { useEffect } from "react"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { wakeServer } from "@/lib/api/core/wake"
import { wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { isNativeSpeechAvailable } from "@/plugins/NativeSpeech"

// The entry and expense forms sit on Home. Saves show at once, but the
// server behind them was cold in most first saves (~5–6s in the logs),
// which is how long a new record stays unconfirmed and when "Entry queued"
// can show on a weak connection. So their save servers are woken when Home
// is up, when the app comes back on screen, and when the form is used
// (wakeServer skips any it woke in the last few minutes).

export function wakeRecordSaving(includeExpenses: boolean): void {
  wakeServer(API_ENDPOINTS.entries.post)
  wakeServer(API_ENDPOINTS.recurringRules.post)
  // The voice entry server too, where the mic shows (the iPhone app), so the
  // first fill-in of the day isn't held up by a cold server.
  if (isNativeSpeechAvailable()) wakeVoiceEntry()
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
