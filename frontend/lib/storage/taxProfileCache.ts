// /lib/storage/taxProfileCache.ts
// ------------------------------------------------------------
// Local cache adapter for TaxProfile.
// • cache-only (no network, no offline queue)
// • uses metadata layer for versioning + TTL
// ------------------------------------------------------------

import { TaxProfile } from "@shared/schemas"
import type { WorkspaceId } from "@shared/contracts/workspace"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import {
  getWithMeta,
  setWithMeta,
  clearWithMeta,
  clearKeysWithMeta,
} from "./metadata"
import { CACHE_VERSIONS } from "./cacheVersions"

const KEY_PREFIX = "taxProfile"
const HASH_KEY_PREFIX = "taxProfile.hash"

// By architecture: TTL is effectively infinite unless future rules change.
// Using `undefined` retains forever; can be swapped later in shared constants.
const TTL_MS = undefined

function getTaxProfileKey(workspaceId: WorkspaceId): string {
  return `${KEY_PREFIX}:${workspaceId}`
}

function getTaxProfileHashKey(workspaceId: WorkspaceId): string {
  return `${HASH_KEY_PREFIX}:${workspaceId}`
}

/**
 * Load tax profile from local cache.
 * - No network logic.
 * - Ensures schema validation.
 */
export async function loadTaxProfileCache(
  workspaceId: WorkspaceId
): Promise<TaxProfile.Type | null> {
  const record = await getWithMeta<TaxProfile.Type>(getTaxProfileKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.taxProfile,
  })
  if (!record?.data) return null

  const parsed = safeSchemaParse(TaxProfile.Schema, record.data)
  return parsed.success ? parsed.data : null
}

/**
 * Save tax profile to local cache.
 * - canonical place to write to device storage
 */
export async function saveTaxProfileCache(
  workspaceId: WorkspaceId,
  profile: TaxProfile.Type
): Promise<void> {
  await setWithMeta(getTaxProfileKey(workspaceId), profile, {
    ttlMs: TTL_MS,
    version: CACHE_VERSIONS.taxProfile,
  })
}

/**
 * Clear tax profile cache entirely.
 */
export async function clearTaxProfileCache(
  workspaceId?: WorkspaceId
): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta(
      (key) =>
        key.startsWith(`${KEY_PREFIX}:`) ||
        key.startsWith(`${HASH_KEY_PREFIX}:`)
    )
    return
  }

  await clearWithMeta(getTaxProfileKey(workspaceId))
  await clearWithMeta(getTaxProfileHashKey(workspaceId))
}

/**
 * Load the hash stored for the tax profile.
 * (Used for local change detection / idempotency)
 */
export async function loadTaxProfileHash(
  workspaceId: WorkspaceId
): Promise<string | null> {
  const record = await getWithMeta<string>(getTaxProfileHashKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.taxProfileHash,
  })
  return record?.data ?? null
}

/**
 * Persist a hash for the tax profile.
 * This allows:
 *   - idempotent saves
 *   - local diff detection
 */
export async function saveTaxProfileHash(
  workspaceId: WorkspaceId,
  hash: string
): Promise<void> {
  await setWithMeta(getTaxProfileHashKey(workspaceId), hash, {
    ttlMs: TTL_MS,
    version: CACHE_VERSIONS.taxProfileHash,
  })
}
