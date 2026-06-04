"use client"

import type { WorkspaceId } from "@shared/contracts/workspace"
import type { EntryType } from "@shared/schemas/entry"

import { getEntriesForPeriod } from "@/lib/api"
import { measureAsync, startPerfTimer } from "@/lib/observability/perf"
import * as domainEntries from "@/lib/storage/domainEntries"
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession"
import { debugLog } from "@/lib/debugLoop"

export type EntriesLoadResult = {
  data: EntryType[]
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  source: "cache" | "backend"
  didFetch: boolean
}

const ENTRIES_BACKEND_TTL_MS = 5 * 60 * 1000
const inFlightLoads = new Map<string, Promise<EntriesLoadResult>>()
const lastSuccessfulSyncAtByScopedPeriod = new Map<string, number | null>()

function makeScopedPeriodKey(workspaceId: WorkspaceId, periodId: string): string {
  return `${workspaceId}::${periodId}`
}

function getLastSuccessfulSyncAt(scopedPeriodKey: string): number | null {
  return lastSuccessfulSyncAtByScopedPeriod.get(scopedPeriodKey) ?? null
}

function setLastSuccessfulSyncAt(
  scopedPeriodKey: string,
  timestamp: number | null
): void {
  lastSuccessfulSyncAtByScopedPeriod.set(scopedPeriodKey, timestamp)
}

export async function readCachedSnapshot(
  workspaceId: WorkspaceId,
  periodId: string
): Promise<EntriesLoadResult> {
  return measureAsync(
    "entries.read_cached_snapshot",
    async () => {
      const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
      const cached = await domainEntries.readEntriesCacheRecord(scopedKey)

      if (cached === null) {
        return {
          data: [],
          lastSuccessfulSyncAt: null,
          localUpdatedAt: null,
          source: "cache",
          didFetch: false,
        }
      }

      return {
        data: cached.data,
        lastSuccessfulSyncAt:
          getLastSuccessfulSyncAt(scopedKey) ?? cached.lastSuccessfulSyncAt,
        localUpdatedAt: cached.localUpdatedAt,
        source: "cache",
        didFetch: false,
      }
    },
    { workspaceId, periodId }
  )
}

export async function fetchBackend(
  workspaceId: WorkspaceId,
  periodId: string
): Promise<EntriesLoadResult> {
  return measureAsync(
    "entries.fetch_backend",
    async () => {
      const sessionVersion = getAuthSessionVersion()
      const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
      const data: EntryType[] = await getEntriesForPeriod(workspaceId, periodId)

      if (!isAuthSessionCurrent(sessionVersion)) {
        debugLog("entries-repository", "fetch_backend_discarded_stale_session", {
          workspaceId,
          periodId,
          sessionVersion,
          currentSessionVersion: getAuthSessionVersion(),
          entryCount: data.length,
        })
        return {
          data,
          lastSuccessfulSyncAt: getLastSuccessfulSyncAt(scopedKey),
          localUpdatedAt: null,
          source: "backend",
          didFetch: true,
        }
      }

      const syncedAt = Date.now()
      await domainEntries.saveEntries(scopedKey, data, {
        lastSuccessfulSyncAt: syncedAt,
      })
      setLastSuccessfulSyncAt(scopedKey, syncedAt)

      return {
        data,
        lastSuccessfulSyncAt: syncedAt,
        localUpdatedAt: syncedAt,
        source: "backend",
        didFetch: true,
      }
    },
    { workspaceId, periodId }
  )
}

export async function ensureLoaded(
  workspaceId: WorkspaceId,
  periodId: string,
  options: { forceBackend?: boolean } = {}
): Promise<EntriesLoadResult> {
  const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
  const existing = inFlightLoads.get(scopedKey)

  if (existing) return existing

  const task = (async (): Promise<EntriesLoadResult> => {
    const timer = startPerfTimer("entries.ensure_loaded", {
      workspaceId,
      periodId,
      forceBackend: options.forceBackend === true,
    })
    const cached = await readCachedSnapshot(workspaceId, periodId)
    const forceBackend = options.forceBackend === true
    const hasCache =
      cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null
    const isFresh =
      cached.lastSuccessfulSyncAt !== null &&
      Date.now() - cached.lastSuccessfulSyncAt <= ENTRIES_BACKEND_TTL_MS

    if (!forceBackend && hasCache && isFresh) {
      timer.success({ source: "cache-fresh", hasCache })
      return cached
    }

    if (!forceBackend && hasCache && cached.data.length > 0) {
      timer.success({ source: "cache-stale", hasCache })
      return cached
    }

    const result = await fetchBackend(workspaceId, periodId)
    timer.success({ source: "backend", hasCache })
    return result
  })()

  inFlightLoads.set(scopedKey, task)

  try {
    return await task
  } finally {
    inFlightLoads.delete(scopedKey)
  }
}

export function prime(
  workspaceId: WorkspaceId,
  periodId: string,
  entries: EntryType[],
  options: { lastSuccessfulSyncAt?: number | null } = {}
): EntriesLoadResult {
  const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
  const lastSuccessfulSyncAt =
    options.lastSuccessfulSyncAt === undefined
      ? getLastSuccessfulSyncAt(scopedKey)
      : options.lastSuccessfulSyncAt
  setLastSuccessfulSyncAt(scopedKey, lastSuccessfulSyncAt)
  void domainEntries.saveEntries(scopedKey, entries, {
    lastSuccessfulSyncAt,
  })

  return {
    data: entries,
    lastSuccessfulSyncAt,
    localUpdatedAt: null,
    source: "cache",
    didFetch: false,
  }
}

export function clearSyncMetadata(
  workspaceId?: WorkspaceId,
  periodId?: string
): void {
  if (!workspaceId) {
    lastSuccessfulSyncAtByScopedPeriod.clear()
    inFlightLoads.clear()
    return
  }

  if (periodId) {
    const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
    lastSuccessfulSyncAtByScopedPeriod.delete(scopedKey)
    inFlightLoads.delete(scopedKey)
    return
  }

  const prefix = `${workspaceId}::`
  for (const key of Array.from(lastSuccessfulSyncAtByScopedPeriod.keys())) {
    if (key.startsWith(prefix)) {
      lastSuccessfulSyncAtByScopedPeriod.delete(key)
    }
  }
  for (const key of Array.from(inFlightLoads.keys())) {
    if (key.startsWith(prefix)) {
      inFlightLoads.delete(key)
    }
  }
}

export async function clearWorkspaceCache(
  workspaceId: WorkspaceId
): Promise<void> {
  clearSyncMetadata(workspaceId)
  await domainEntries.clearWorkspaceEntries(workspaceId)
}
