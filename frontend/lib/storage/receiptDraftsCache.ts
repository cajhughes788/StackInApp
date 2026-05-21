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

export type ReceiptDraftsCacheRecord = {
  data: ReceiptDraft[]
  cachedAt: number
}

function getReceiptDraftsKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::receiptDrafts`
}

const TTL_MS = undefined

export async function loadReceiptDraftsCache(
  workspaceId: WorkspaceId
): Promise<ReceiptDraft[] | null> {
  const record = await readReceiptDraftsCacheRecord(workspaceId)
  return record?.data ?? null
}

export async function readReceiptDraftsCacheRecord(
  workspaceId: WorkspaceId
): Promise<ReceiptDraftsCacheRecord | null> {
  const rec = await getWithMeta<ReceiptDraft[]>(getReceiptDraftsKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.receiptDrafts,
  })
  if (!rec?.data) return null

  const parsed = safeSchemaParse(ReceiptDraftSchema.array(), rec.data)
  if (!parsed.success) return null

  return {
    data: parsed.data,
    cachedAt: rec.ts,
  }
}

export async function saveReceiptDraftsCache(
  workspaceId: WorkspaceId,
  drafts: ReceiptDraft[]
): Promise<void> {
  await setWithMeta(getReceiptDraftsKey(workspaceId), drafts, {
    ttlMs: TTL_MS,
    version: CACHE_VERSIONS.receiptDrafts,
  })
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
