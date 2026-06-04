"use client"

import {
  getWithMeta,
  setWithMeta,
  clearWithMeta,
  clearKeysWithMeta,
} from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import type { WorkspaceId } from "@shared/contracts/workspace"
import { ReceiptDraftSchema, type ReceiptDraft } from "@shared/schemas/receiptDraft"
import { CACHE_VERSIONS } from "./cacheVersions"
import {
  type PersistedCachePayload,
  isPersistedCachePayload,
} from "./cachePayload"

export type ReceiptDraftsCacheRecord = {
  data: ReceiptDraft[]
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  cachedAt: number
}

function getReceiptDraftsKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::receiptDrafts`
}

const TTL_MS = undefined
type PersistedReceiptDraftsPayload = PersistedCachePayload<
  ReceiptDraft[],
  "receiptDrafts"
>

export async function loadReceiptDraftsCache(
  workspaceId: WorkspaceId
): Promise<ReceiptDraft[] | null> {
  const record = await readReceiptDraftsCacheRecord(workspaceId)
  return record?.data ?? null
}

export async function readReceiptDraftsCacheRecord(
  workspaceId: WorkspaceId
): Promise<ReceiptDraftsCacheRecord | null> {
  const rec = await getWithMeta<
    ReceiptDraft[] | PersistedReceiptDraftsPayload
  >(getReceiptDraftsKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.receiptDrafts,
  })
  if (!rec?.data) return null

  const payload = isPersistedCachePayload<ReceiptDraft[], "receiptDrafts">(
    rec.data,
    "receiptDrafts"
  )
    ? rec.data
    : {
        receiptDrafts: rec.data,
        lastSuccessfulSyncAt: null,
        localUpdatedAt: rec.ts,
      }

  const parsed = safeSchemaParse(ReceiptDraftSchema.array(), payload.receiptDrafts)
  if (!parsed.success) return null

  return {
    data: parsed.data,
    lastSuccessfulSyncAt:
      typeof payload.lastSuccessfulSyncAt === "number"
        ? payload.lastSuccessfulSyncAt
        : null,
    localUpdatedAt:
      typeof payload.localUpdatedAt === "number" ? payload.localUpdatedAt : rec.ts,
    cachedAt: rec.ts,
  }
}

export async function saveReceiptDraftsCache(
  workspaceId: WorkspaceId,
  drafts: ReceiptDraft[],
  options: {
    lastSuccessfulSyncAt?: number | null
    localUpdatedAt?: number | null
  } = {}
): Promise<void> {
  await setWithMeta<PersistedReceiptDraftsPayload>(
    getReceiptDraftsKey(workspaceId),
    {
      receiptDrafts: drafts,
      lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    },
    {
      ttlMs: TTL_MS,
      version: CACHE_VERSIONS.receiptDrafts,
    }
  )
}

export async function clearReceiptDraftsCache(
  workspaceId?: WorkspaceId
): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta((key) => key.includes("::receiptDrafts"))
    return
  }

  await clearWithMeta(getReceiptDraftsKey(workspaceId))
}
