"use client"

import { useEffect, useState } from "react"

import { getAllIncomeSummary } from "@/lib/api/allIncomeApi"
import { readAllIncomeCache, saveAllIncomeCache } from "@/lib/storage/allIncomeCache"
import type { AllIncomeSummary } from "@shared/allIncome"

// Home's "All income" card (getAllIncomeSummary). Kept in memory per month
// so flipping months or coming back to Home shows the last figures at once,
// and saved on the device (allIncomeCache) so a fresh launch does too while
// the server copy loads. Refetched after a minute, or right away when
// refreshKey changes (the active workspace's entries or expenses changed).
// Null while loading or if it fails — the card then shows its loading state
// or nothing.
const CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { at: number; refreshKey: string; data: AllIncomeSummary }>()

export function useAllIncomeSummary(
  uid: string | null,
  month: string,
  enabled: boolean,
  refreshKey: string
): { summary: AllIncomeSummary | null; failed: boolean } {
  const cacheKey = uid ? `${uid}:${month}` : null
  const cached = cacheKey ? cache.get(cacheKey) : undefined
  const [summary, setSummary] = useState<AllIncomeSummary | null>(cached?.data ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!uid || !cacheKey || !enabled) {
      setSummary(null)
      return
    }
    const hit = cache.get(cacheKey)
    setSummary(hit?.data ?? null)
    setFailed(false)
    if (hit && hit.refreshKey === refreshKey && Date.now() - hit.at < CACHE_TTL_MS) return

    let cancelled = false
    let fetched = false
    let shown = !!hit
    // Not in memory (fresh launch): show the device copy until the server answers.
    if (!hit) {
      void readAllIncomeCache(uid, month)
        .then((saved) => {
          if (!saved || cancelled || fetched) return
          shown = true
          setSummary(saved)
          setFailed(false)
        })
        .catch(() => {})
    }
    getAllIncomeSummary(month)
      .then((data) => {
        fetched = true
        cache.set(cacheKey, { at: Date.now(), refreshKey, data })
        void saveAllIncomeCache(uid, data).catch(() => {})
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled && !shown) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [uid, cacheKey, month, enabled, refreshKey])

  return { summary, failed }
}
