"use client"

import type { WorkspaceId, WorkspaceType } from "@shared/contracts/workspace"

import { usePayStubsStore } from "@/lib/stores/usePaystubsStore"
import { useProfitLossStore } from "@/lib/stores/useProfitLossStore"

const PREFETCH_DEDUPE_WINDOW_MS = 15_000

const lastPrefetchAtByKey = new Map<string, number>()
const inFlightPrefetchByKey = new Map<string, Promise<void>>()

function shouldSkipPrefetch(key: string): boolean {
  const lastPrefetchAt = lastPrefetchAtByKey.get(key) ?? 0
  return Date.now() - lastPrefetchAt < PREFETCH_DEDUPE_WINDOW_MS
}

function runPrefetch(key: string, task: () => Promise<void>): void {
  if (shouldSkipPrefetch(key)) {
    return
  }

  const existing = inFlightPrefetchByKey.get(key)
  if (existing) {
    return
  }

  lastPrefetchAtByKey.set(key, Date.now())
  const promise = task().finally(() => {
    inFlightPrefetchByKey.delete(key)
  })
  inFlightPrefetchByKey.set(key, promise)
}

async function prefetchPayStubs(workspaceId: WorkspaceId): Promise<void> {
  await usePayStubsStore.getState().hydrateFromCacheOnce(workspaceId)
  await usePayStubsStore.getState().refreshFromBackend(workspaceId, { force: false })
}

async function prefetchProfitLoss(workspaceId: WorkspaceId): Promise<void> {
  await useProfitLossStore.getState().hydrateFromCacheOnce(workspaceId, "month")
  await useProfitLossStore
    .getState()
    .refreshFromBackend(workspaceId, "month", { force: false })
}

export function prefetchRouteData(
  href: string,
  workspaceId: WorkspaceId | null,
  workspaceType: WorkspaceType | null
): void {
  if (!workspaceId || !workspaceType) {
    return
  }

  if ((href === "/app/earnings" || href === "/app/paystubs") && workspaceType === "w2") {
    runPrefetch(`paystubs:${workspaceId}`, () => prefetchPayStubs(workspaceId))
    return
  }

  if (href === "/app/profitloss" && workspaceType === "independent") {
    runPrefetch(`profitloss:${workspaceId}:month`, () => prefetchProfitLoss(workspaceId))
  }
}
