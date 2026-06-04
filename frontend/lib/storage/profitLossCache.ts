import {
  getWithMeta,
  setWithMeta,
  clearWithMeta,
  clearKeysWithMeta,
} from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import type { WorkspaceId } from "@shared/contracts/workspace"
import { CACHE_VERSIONS } from "./cacheVersions"
import {
  ProfitLossStatementListSchema,
  type ProfitLossPeriodType,
  type ProfitLossStatement,
} from "@shared/schemas/profitLoss"
import {
  type PersistedCachePayload,
  isPersistedCachePayload,
} from "./cachePayload"

export type ProfitLossCacheRecord = {
  data: ProfitLossStatement[]
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  cachedAt: number
}

function getProfitLossKey(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType
): string {
  return `workspaces::${workspaceId}::profitLoss::${periodType}`
}

const TTL_MS = undefined
type PersistedProfitLossPayload = PersistedCachePayload<
  ProfitLossStatement[],
  "statements"
>

export async function loadProfitLossCache(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType
): Promise<ProfitLossStatement[] | null> {
  const record = await readProfitLossCacheRecord(workspaceId, periodType)
  return record?.data ?? null
}

export async function readProfitLossCacheRecord(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType
): Promise<ProfitLossCacheRecord | null> {
  const rec = await getWithMeta<ProfitLossStatement[] | PersistedProfitLossPayload>(
    getProfitLossKey(workspaceId, periodType),
    { expectedVersion: CACHE_VERSIONS.profitLoss }
  )
  if (!rec?.data) return null

  const payload = isPersistedCachePayload<ProfitLossStatement[], "statements">(
    rec.data,
    "statements"
  )
    ? rec.data
    : {
        statements: rec.data,
        lastSuccessfulSyncAt: null,
        localUpdatedAt: rec.ts,
      }

  const parsed = safeSchemaParse(ProfitLossStatementListSchema, payload.statements)
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

export async function saveProfitLossCache(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType,
  list: ProfitLossStatement[],
  options: {
    lastSuccessfulSyncAt?: number | null
    localUpdatedAt?: number | null
  } = {}
): Promise<void> {
  await setWithMeta<PersistedProfitLossPayload>(
    getProfitLossKey(workspaceId, periodType),
    {
      statements: list,
      lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    },
    {
      ttlMs: TTL_MS,
      version: CACHE_VERSIONS.profitLoss,
    }
  )
}

export async function clearProfitLossCache(workspaceId?: WorkspaceId): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta((key) => key.includes("::profitLoss::"))
    return
  }

  await clearKeysWithMeta((key) =>
    key.startsWith(`workspaces::${workspaceId}::profitLoss::`)
  )
}
