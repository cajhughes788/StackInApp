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
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  source: "cache" | "backend"
  didFetch: boolean
}

const RECEIPT_DRAFTS_BACKEND_TTL_MS = 5 * 60 * 1000
const inFlightLoads = new Map<WorkspaceId, Promise<ReceiptDraftsLoadResult>>()
const lastSuccessfulSyncAtByWorkspace = new Map<WorkspaceId, number | null>()

function getLastSuccessfulSyncAt(workspaceId: WorkspaceId): number | null {
  return lastSuccessfulSyncAtByWorkspace.get(workspaceId) ?? null
}

function setLastSuccessfulSyncAt(workspaceId: WorkspaceId, timestamp: number | null): void {
  lastSuccessfulSyncAtByWorkspace.set(workspaceId, timestamp)
}

export async function readCachedSnapshot(
  workspaceId: WorkspaceId
): Promise<ReceiptDraftsLoadResult> {
  return measureAsync("receipt_drafts.read_cached_snapshot", async () => {
    const cached = await readReceiptDraftsCacheRecord(workspaceId)
    if (!cached) {
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
        getLastSuccessfulSyncAt(workspaceId) ?? cached.lastSuccessfulSyncAt,
      localUpdatedAt: cached.localUpdatedAt,
      source: "cache",
      didFetch: false,
    }
  }, { workspaceId })
}

export function prime(
  workspaceId: WorkspaceId,
  drafts: ReceiptDraft[],
  options: {
    lastSuccessfulSyncAt?: number | null
    localUpdatedAt?: number | null
  } = {}
): ReceiptDraftsLoadResult {
  const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null
  const localUpdatedAt = options.localUpdatedAt ?? Date.now()
  setLastSuccessfulSyncAt(workspaceId, lastSuccessfulSyncAt)
  void saveReceiptDraftsCache(workspaceId, drafts, {
    lastSuccessfulSyncAt,
    localUpdatedAt,
  })

  return {
    data: drafts,
    lastSuccessfulSyncAt,
    localUpdatedAt,
    source: "cache",
    didFetch: false,
  }
}

export function clearSyncMetadata(workspaceId?: WorkspaceId): void {
  if (!workspaceId) {
    lastSuccessfulSyncAtByWorkspace.clear()
    inFlightLoads.clear()
    return
  }

  lastSuccessfulSyncAtByWorkspace.delete(workspaceId)
  inFlightLoads.delete(workspaceId)
}

async function fetchBackend(workspaceId: WorkspaceId): Promise<ReceiptDraftsLoadResult> {
  return measureAsync("receipt_drafts.fetch_backend", async () => {
    const res = await apiGetReceiptDrafts(workspaceId)
    const parsed = safeSchemaParse(ReceiptDraftSchema.array(), res)
    if (!parsed.success) {
      throw parsed.error
    }

    const syncedAt = Date.now()
    await saveReceiptDraftsCache(workspaceId, parsed.data, {
      lastSuccessfulSyncAt: syncedAt,
      localUpdatedAt: syncedAt,
    })
    setLastSuccessfulSyncAt(workspaceId, syncedAt)

    return {
      data: parsed.data,
      lastSuccessfulSyncAt: syncedAt,
      localUpdatedAt: syncedAt,
      source: "backend",
      didFetch: true,
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
    const hasCache = cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null
    const isFresh =
      cached.lastSuccessfulSyncAt !== null &&
      Date.now() - cached.lastSuccessfulSyncAt <= RECEIPT_DRAFTS_BACKEND_TTL_MS

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
