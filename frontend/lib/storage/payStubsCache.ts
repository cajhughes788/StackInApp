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
import {
  type PersistedCachePayload,
  isPersistedCachePayload,
} from "./cachePayload"

export type PayStubsCacheRecord = {
  data: PayStub.Type[]
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  cachedAt: number
}

function getPayStubsKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::payStubs`
}

// TTL = infinite
const TTL_MS = undefined
type PersistedPayStubsPayload = PersistedCachePayload<PayStub.Type[], "payStubs">

export async function loadPayStubsCache(
  workspaceId: WorkspaceId
): Promise<PayStub.Type[] | null> {
  const record = await readPayStubsCacheRecord(workspaceId)
  return record?.data ?? null
}

export async function readPayStubsCacheRecord(
  workspaceId: WorkspaceId
): Promise<PayStubsCacheRecord | null> {
  const rec = await getWithMeta<PayStub.Type[] | PersistedPayStubsPayload>(
    getPayStubsKey(workspaceId),
    {
      expectedVersion: CACHE_VERSIONS.payStubs,
    }
  )
  if (!rec?.data) return null

  const payload = isPersistedCachePayload<PayStub.Type[], "payStubs">(
    rec.data,
    "payStubs"
  )
    ? rec.data
    : {
        payStubs: rec.data,
        lastSuccessfulSyncAt: null,
        localUpdatedAt: rec.ts,
      }

  const parsed = safeSchemaParse(PayStub.Schema.array(), payload.payStubs)
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

export async function savePayStubsCache(
  workspaceId: WorkspaceId,
  list: PayStub.Type[],
  options: {
    lastSuccessfulSyncAt?: number | null
    localUpdatedAt?: number | null
  } = {}
): Promise<void> {
  await setWithMeta<PersistedPayStubsPayload>(
    getPayStubsKey(workspaceId),
    {
      payStubs: list,
      lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    },
    {
      ttlMs: TTL_MS,
      version: CACHE_VERSIONS.payStubs,
    }
  )
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
