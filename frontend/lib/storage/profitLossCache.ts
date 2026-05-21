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

export type ProfitLossCacheRecord = {
  data: ProfitLossStatement[]
  cachedAt: number
}

function getProfitLossKey(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType
): string {
  return `workspaces::${workspaceId}::profitLoss::${periodType}`
}

const TTL_MS = undefined

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
  const rec = await getWithMeta<ProfitLossStatement[]>(
    getProfitLossKey(workspaceId, periodType),
    { expectedVersion: CACHE_VERSIONS.profitLoss }
  )
  if (!rec?.data) return null

  const parsed = safeSchemaParse(ProfitLossStatementListSchema, rec.data)
  if (!parsed.success) return null

  return {
    data: parsed.data,
    cachedAt: rec.ts,
  }
}

export async function saveProfitLossCache(
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType,
  list: ProfitLossStatement[]
): Promise<void> {
  await setWithMeta(getProfitLossKey(workspaceId, periodType), list, {
    ttlMs: TTL_MS,
    version: CACHE_VERSIONS.profitLoss,
  })
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
