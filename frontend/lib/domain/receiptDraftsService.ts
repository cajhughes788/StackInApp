"use client"

import type { WorkspaceId } from "@shared/contracts/workspace"
import { ReceiptDraftSchema, type ReceiptDraft } from "@shared/schemas/receiptDraft"
import { getReceiptDrafts as apiGetReceiptDrafts } from "@/lib/api/receiptDraftsApi"
import {
  readReceiptDraftsCacheRecord,
  saveReceiptDraftsCache,
  clearReceiptDraftsCache,
} from "@/lib/storage/receiptDraftsCache"
import { measureAsync, startPerfTimer } from "@/lib/observability/perf"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"

export type ReceiptDraftsLoadResult = {
  data: ReceiptDraft[]
  lastBackendSync: number | null
}

const RECEIPT_DRAFTS_BACKEND_TTL_MS = 5 * 60 * 1000
const inFlightLoads = new Map<WorkspaceId, Promise<ReceiptDraftsLoadResult>>()
const lastBackendSyncByWorkspace = new Map<WorkspaceId, number | null>()

function getLastBackendSync(workspaceId: WorkspaceId): number | null {
  return lastBackendSyncByWorkspace.get(workspaceId) ?? null
}

function setLastBackendSync(workspaceId: WorkspaceId, timestamp: number | null): void {
  lastBackendSyncByWorkspace.set(workspaceId, timestamp)
}

export async function readCachedSnapshot(
  workspaceId: WorkspaceId
): Promise<ReceiptDraftsLoadResult> {
  return measureAsync("receipt_drafts.read_cached_snapshot", async () => {
    const cached = await readReceiptDraftsCacheRecord(workspaceId)
    if (!cached) {
      return {
        data: [],
        lastBackendSync: null,
      }
    }

    return {
      data: cached.data,
      lastBackendSync: getLastBackendSync(workspaceId) ?? cached.cachedAt,
    }
  }, { workspaceId })
}

export function prime(
  workspaceId: WorkspaceId,
  drafts: ReceiptDraft[],
  options: { lastBackendSync?: number | null } = {}
): ReceiptDraftsLoadResult {
  const lastBackendSync = options.lastBackendSync ?? Date.now()
  setLastBackendSync(workspaceId, lastBackendSync)
  void saveReceiptDraftsCache(workspaceId, drafts)

  return {
    data: drafts,
    lastBackendSync,
  }
}

export function clearSyncMetadata(workspaceId?: WorkspaceId): void {
  if (!workspaceId) {
    lastBackendSyncByWorkspace.clear()
    inFlightLoads.clear()
    return
  }

  lastBackendSyncByWorkspace.delete(workspaceId)
  inFlightLoads.delete(workspaceId)
}

async function fetchBackend(workspaceId: WorkspaceId): Promise<ReceiptDraftsLoadResult> {
  return measureAsync("receipt_drafts.fetch_backend", async () => {
    const res = await apiGetReceiptDrafts(workspaceId)
    const parsed = safeSchemaParse(ReceiptDraftSchema.array(), res)
    if (!parsed.success) {
      throw parsed.error
    }

    await saveReceiptDraftsCache(workspaceId, parsed.data)
    const syncedAt = Date.now()
    setLastBackendSync(workspaceId, syncedAt)

    return {
      data: parsed.data,
      lastBackendSync: syncedAt,
    }
  }, { workspaceId })
}

export async function ensureLoaded(
  workspaceId: WorkspaceId,
  options: { forceBackend?: boolean } = {}
): Promise<ReceiptDraftsLoadResult> {
  const existing = inFlightLoads.get(workspaceId)
  if (existing) return existing

  const task = (async (): Promise<ReceiptDraftsLoadResult> => {
    const timer = startPerfTimer("receipt_drafts.ensure_loaded", {
      workspaceId,
      forceBackend: options.forceBackend === true,
    })

    const cached = await readCachedSnapshot(workspaceId)
    const forceBackend = options.forceBackend === true
    const hasCache = cached.data.length > 0 || cached.lastBackendSync !== null
    const isFresh =
      cached.lastBackendSync !== null &&
      Date.now() - cached.lastBackendSync <= RECEIPT_DRAFTS_BACKEND_TTL_MS

    if (!forceBackend && hasCache && isFresh) {
      timer.success({ source: "cache-fresh", hasCache })
      return cached
    }

    const result = await fetchBackend(workspaceId)
    timer.success({ source: hasCache ? "backend-stale" : "backend-miss", hasCache })
    return result
  })()

  inFlightLoads.set(workspaceId, task)
  try {
    return await task
  } finally {
    inFlightLoads.delete(workspaceId)
  }
}

export async function clear(workspaceId?: WorkspaceId): Promise<void> {
  clearSyncMetadata(workspaceId)
  await clearReceiptDraftsCache(workspaceId)
}
