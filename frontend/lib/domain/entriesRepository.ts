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
  lastBackendSync: number | null
}

const ENTRIES_BACKEND_TTL_MS = 5 * 60 * 1000
const inFlightLoads = new Map<string, Promise<EntriesLoadResult>>()
const lastBackendSyncByScopedPeriod = new Map<string, number | null>()

function makeScopedPeriodKey(workspaceId: WorkspaceId, periodId: string): string {
  return `${workspaceId}::${periodId}`
}

function getLastBackendSync(scopedPeriodKey: string): number | null {
  return lastBackendSyncByScopedPeriod.get(scopedPeriodKey) ?? null
}

function setLastBackendSync(scopedPeriodKey: string, timestamp: number | null): void {
  lastBackendSyncByScopedPeriod.set(scopedPeriodKey, timestamp)
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
          lastBackendSync: null,
        }
      }

      return {
        data: cached.data,
        lastBackendSync: getLastBackendSync(scopedKey) ?? cached.cachedAt,
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
          lastBackendSync: getLastBackendSync(scopedKey),
        }
      }

      await domainEntries.saveEntries(scopedKey, data)
      const syncedAt = Date.now()
      setLastBackendSync(scopedKey, syncedAt)

      return {
        data,
        lastBackendSync: syncedAt,
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
    const hasCache = cached.data.length > 0 || cached.lastBackendSync !== null
    const isFresh =
      cached.lastBackendSync !== null &&
      Date.now() - cached.lastBackendSync <= ENTRIES_BACKEND_TTL_MS

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
  options: { lastBackendSync?: number | null } = {}
): EntriesLoadResult {
  const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
  const lastBackendSync = options.lastBackendSync ?? Date.now()
  setLastBackendSync(scopedKey, lastBackendSync)
  void domainEntries.saveEntries(scopedKey, entries)

  return {
    data: entries,
    lastBackendSync,
  }
}

export function clearSyncMetadata(
  workspaceId?: WorkspaceId,
  periodId?: string
): void {
  if (!workspaceId) {
    lastBackendSyncByScopedPeriod.clear()
    inFlightLoads.clear()
    return
  }

  if (periodId) {
    const scopedKey = makeScopedPeriodKey(workspaceId, periodId)
    lastBackendSyncByScopedPeriod.delete(scopedKey)
    inFlightLoads.delete(scopedKey)
    return
  }

  const prefix = `${workspaceId}::`
  for (const key of Array.from(lastBackendSyncByScopedPeriod.keys())) {
    if (key.startsWith(prefix)) {
      lastBackendSyncByScopedPeriod.delete(key)
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
