"use client"

import { useEffect, useState } from "react"

import { getProfitLossInsights } from "@/lib/api/profitLossApi"
import type { ProfitLossInsights } from "@shared/schemas/profitLossInsights"

// The P&L page's small insights summary (getProfitLossInsights). Kept in
// memory for 5 minutes per workspace so going back and forth between
// statements doesn't refetch. Null while loading or if it fails — the
// sections it feeds simply don't show.
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: ProfitLossInsights }>()

export function useProfitLossInsights(workspaceId: string | null, enabled: boolean): ProfitLossInsights | null {
  const cached = workspaceId ? cache.get(workspaceId) : undefined
  const [insights, setInsights] = useState<ProfitLossInsights | null>(cached?.data ?? null)

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setInsights(null)
      return
    }
    const hit = cache.get(workspaceId)
    setInsights(hit?.data ?? null)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return

    let cancelled = false
    getProfitLossInsights(workspaceId)
      .then((data) => {
        cache.set(workspaceId, { at: Date.now(), data })
        if (!cancelled) setInsights(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId, enabled])

  return insights
}
