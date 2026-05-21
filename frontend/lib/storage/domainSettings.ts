// /lib/storage/domainSettings.ts
import type { WorkspaceId } from "@shared/contracts/workspace"
import {
  setWithMeta,
  getWithMeta,
  clearWithMeta,
  clearKeysWithMeta,
} from "./metadata"
import { CACHE_VERSIONS } from "./cacheVersions"

// --------------------------------------------------------------
// Helpers: compute storage keys (WORKSPACE-SCOPED)
// --------------------------------------------------------------


function computeSettingsKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::settings`
}

function computeSettingsHashKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::settingsHash`
}

// --------------------------------------------------------------
// Load settings (cache-first, FLEXIBLE)
// --------------------------------------------------------------

export async function loadSettings(
  workspaceId: WorkspaceId
): Promise<any | null> {
  const key = computeSettingsKey(workspaceId)
  const meta = await getWithMeta<any>(key, {
    expectedVersion: CACHE_VERSIONS.settings,
  })

  if (!meta) return null

  // Do NOT validate against Settings schema here.
  // Cache may contain partial or older-version data.
  if (typeof meta.data !== "object" || meta.data === null) {
    return null
  }

  return meta.data
}

// --------------------------------------------------------------
// Save settings (store EXACT object provided by caller)
// --------------------------------------------------------------

export async function saveSettings(
  workspaceId: WorkspaceId,
  next: any
): Promise<any | null> {
  const key = computeSettingsKey(workspaceId)

  // Null means “wipe settings”
  if (next === null) {
    await setWithMeta(key, null, {
      ttlMs: Infinity,
      version: CACHE_VERSIONS.settings,
    })
    return null
  }

  // Store exactly what caller provides (canonical or optimistic).
  await setWithMeta(key, next, {
    ttlMs: Infinity,
    version: CACHE_VERSIONS.settings,
  })
  return next
}

// --------------------------------------------------------------
// Settings hash helpers (workspace-scoped)
// --------------------------------------------------------------

export async function loadSettingsHash(
  workspaceId: WorkspaceId
): Promise<string | null> {
  const key = computeSettingsHashKey(workspaceId)
  const meta = await getWithMeta<string>(key, {
    expectedVersion: CACHE_VERSIONS.settingsHash,
  })
  return meta?.data ?? null
}

export async function saveSettingsHash(
  workspaceId: WorkspaceId,
  hash: string
): Promise<void> {
  const key = computeSettingsHashKey(workspaceId)
  await setWithMeta(key, hash, {
    ttlMs: Infinity,
    version: CACHE_VERSIONS.settingsHash,
  })
}

// --------------------------------------------------------------
// Invalidate settings (clear both data + hash)
// --------------------------------------------------------------

export async function invalidateSettings(
  workspaceId?: WorkspaceId
): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta(
      (key) => key.includes("::settings") || key.includes("::settingsHash")
    )
    return
  }

  const settingsKey = computeSettingsKey(workspaceId)
  const hashKey = computeSettingsHashKey(workspaceId)

  await clearWithMeta(settingsKey)
  await clearWithMeta(hashKey)
}

export async function clearWorkspaceSettings(
  workspaceId: WorkspaceId
): Promise<void> {
  await invalidateSettings(workspaceId)
}
