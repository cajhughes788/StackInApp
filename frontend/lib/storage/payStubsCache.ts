// /lib/storage/payStubsCache.ts
// ------------------------------------------------------------
// Local cache for PayStubs (read-only domain)
// Infinite TTL by design
// ------------------------------------------------------------

import {
  getWithMeta,
  setWithMeta,
  clearWithMeta,
  clearKeysWithMeta,
} from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import { PayStub } from "@shared/schemas"
import type { WorkspaceId } from "@shared/contracts/workspace"
import { CACHE_VERSIONS } from "./cacheVersions"

export type PayStubsCacheRecord = {
  data: PayStub.Type[]
  cachedAt: number
}

function getPayStubsKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::payStubs`
}

// TTL = infinite
const TTL_MS = undefined

export async function loadPayStubsCache(
  workspaceId: WorkspaceId
): Promise<PayStub.Type[] | null> {
  const record = await readPayStubsCacheRecord(workspaceId)
  return record?.data ?? null
}

export async function readPayStubsCacheRecord(
  workspaceId: WorkspaceId
): Promise<PayStubsCacheRecord | null> {
  const rec = await getWithMeta<PayStub.Type[]>(getPayStubsKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.payStubs,
  })
  if (!rec?.data) return null

  const parsed = safeSchemaParse(PayStub.Schema.array(), rec.data)
  if (!parsed.success) return null

  return {
    data: parsed.data,
    cachedAt: rec.ts,
  }
}

export async function savePayStubsCache(
  workspaceId: WorkspaceId,
  list: PayStub.Type[]
): Promise<void> {
  await setWithMeta(getPayStubsKey(workspaceId), list, {
    ttlMs: TTL_MS,
    version: CACHE_VERSIONS.payStubs,
  })
}

export async function clearPayStubsCache(
  workspaceId?: WorkspaceId
): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta((key) => key.includes("::payStubs"))
    return
  }

  await clearWithMeta(getPayStubsKey(workspaceId))
}
