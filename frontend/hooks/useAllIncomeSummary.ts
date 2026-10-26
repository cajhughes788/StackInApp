"use client"

import { useEffect, useState } from "react"

import { getAllIncomeSummary } from "@/lib/api/allIncomeApi"
import type { AllIncomeSummary } from "@shared/allIncome"

// Home's "All income" card (getAllIncomeSummary). Kept in memory per month
// so flipping months or coming back to Home shows the last figures at once;
// refetched after a minute, or right away when refreshKey changes (the
// active workspace's entries or expenses changed). Null while loading or if
// it fails — the card then shows its loading state or nothing.
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
    if (!cacheKey || !enabled) {
      setSummary(null)
      return
    }
    const hit = cache.get(cacheKey)
    setSummary(hit?.data ?? null)
    setFailed(false)
    if (hit && hit.refreshKey === refreshKey && Date.now() - hit.at < CACHE_TTL_MS) return

    let cancelled = false
    getAllIncomeSummary(month)
      .then((data) => {
        cache.set(cacheKey, { at: Date.now(), refreshKey, data })
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled && !hit) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey, month, enabled, refreshKey])

  return { summary, failed }
}
