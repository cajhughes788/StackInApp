// /lib/storage/domainSettings.ts
import type { WorkspaceId } from "@shared/contracts/workspace"
import type { SettingsPatchType } from "../../../shared/schemas/settings"
import { mergeSettingsPatch, mergeSettings } from "@/lib/domain/settingsSync"
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

function computeSettingsSyncKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::settingsSync`
}

/** Phase 1/2 separate key — kept for migration reads only */
function computeSettingsPendingKey(workspaceId: WorkspaceId): string {
  return `workspaces::${workspaceId}::settingsPending`
}

// --------------------------------------------------------------
// Per-workspace write lock (guards all read-modify-write ops on
// the main settings key: writePendingPatch, clearPendingPatch,
// saveConfirmedSettings)
// --------------------------------------------------------------

const _settingsWriteLocks = new Map<WorkspaceId, Promise<unknown>>()

function withSettingsWriteLock<T>(
  workspaceId: WorkspaceId,
  fn: () => Promise<T>
): Promise<T> {
  const current = _settingsWriteLocks.get(workspaceId) ?? Promise.resolve()
  const next = current.then(fn, fn)
  _settingsWriteLocks.set(workspaceId, next.catch(() => {}))
  return next
}

// --------------------------------------------------------------
// v3 storage payload shape
// --------------------------------------------------------------

type SettingsStoragePayload = {
  settings: any | null
  pendingPatch: SettingsPatchType | null
  remoteVersion: number | null
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
}

export type SettingsCacheRecord = {
  data: any | null
  pendingPatch: SettingsPatchType | null
  remoteVersion: number | null
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  cachedAt: number
}

// --------------------------------------------------------------
// Internal raw write (bypasses lock — callers must lock themselves
// when doing read-modify-write)
// --------------------------------------------------------------

async function writeSettingsPayload(
  workspaceId: WorkspaceId,
  payload: SettingsStoragePayload
): Promise<void> {
  const key = computeSettingsKey(workspaceId)
  await setWithMeta<SettingsStoragePayload>(key, payload, {
    ttlMs: Infinity,
    version: CACHE_VERSIONS.settings,
  })
}

// --------------------------------------------------------------
// One-time migration — runs on the first v3 cache miss per workspace.
// Drains the Phase 1/2 settingsPending key and the pre-v3 settingsSync
// key, merges any salvageable pending patches into a minimal v3 record,
// then deletes both old keys.  After every workspace has upgraded this
// function becomes a no-op (both reads return null immediately).
// --------------------------------------------------------------

async function migrateAndReadPendingPatch(
  workspaceId: WorkspaceId
): Promise<SettingsPatchType | null> {
  const [phase2Meta, syncMeta] = await Promise.all([
    getWithMeta<SettingsPatchType>(computeSettingsPendingKey(workspaceId), {
      expectedVersion: CACHE_VERSIONS.settingsPending,
    }),
    // Read legacy settingsSync key with any version so we can drain it
    getWithMeta<any>(computeSettingsSyncKey(workspaceId)),
  ])

  const phase2Patch = phase2Meta?.data ?? null

  // Inline the old sync-snapshot shape check (parseSettingsSyncSnapshot is gone)
  const syncRaw = syncMeta?.data
  const syncPatch =
    syncRaw &&
    typeof syncRaw === "object" &&
    typeof (syncRaw as any).state === "string" &&
    ["offline_pending", "retrying"].includes((syncRaw as any).state) &&
    (syncRaw as any).pendingPatch
      ? ((syncRaw as any).pendingPatch as SettingsPatchType)
      : null

  const merged = mergeSettingsPatch(phase2Patch, syncPatch)

  // Clean up old keys regardless
  await Promise.all([
    clearWithMeta(computeSettingsPendingKey(workspaceId)),
    clearWithMeta(computeSettingsSyncKey(workspaceId)),
  ])

  return merged
}

// --------------------------------------------------------------
// readSettingsCacheRecord — v3 + one-time migration
// --------------------------------------------------------------

export async function readSettingsCacheRecord(
  workspaceId: WorkspaceId
): Promise<SettingsCacheRecord | null> {
  const key = computeSettingsKey(workspaceId)
  const meta = await getWithMeta<SettingsStoragePayload>(key, {
    expectedVersion: CACHE_VERSIONS.settings,
  })

  if (meta) {
    // v3 hit — parse the payload
    const raw = meta.data
    if (!raw || typeof raw !== "object") return null

    const data = "settings" in raw ? (raw as any).settings ?? null : null
    if (data !== null && typeof data !== "object") return null

    return {
      data,
      pendingPatch:
        raw && typeof (raw as any).pendingPatch === "object"
          ? ((raw as any).pendingPatch as SettingsPatchType | null)
          : null,
      remoteVersion:
        typeof (raw as any).remoteVersion === "number"
          ? (raw as any).remoteVersion
          : null,
      lastSuccessfulSyncAt:
        typeof (raw as any).lastSuccessfulSyncAt === "number"
          ? (raw as any).lastSuccessfulSyncAt
          : null,
      localUpdatedAt:
        typeof (raw as any).localUpdatedAt === "number"
          ? (raw as any).localUpdatedAt
          : meta.ts,
      cachedAt: meta.ts,
    }
  }

  // v3 miss — run one-time migration from Phase 1/2 and legacy keys
  const migratedPatch = await migrateAndReadPendingPatch(workspaceId)
  if (!migratedPatch) return null

  // Write a minimal v3 record so subsequent reads and saveSettings
  // calls preserve the patch
  const now = Date.now()
  await writeSettingsPayload(workspaceId, {
    settings: null,
    pendingPatch: migratedPatch,
    remoteVersion: null,
    lastSuccessfulSyncAt: null,
    localUpdatedAt: now,
  })

  return {
    data: null,
    pendingPatch: migratedPatch,
    remoteVersion: null,
    lastSuccessfulSyncAt: null,
    localUpdatedAt: now,
    cachedAt: now,
  }
}

// --------------------------------------------------------------
// loadSettings — returns the effective (optimistic) state
// --------------------------------------------------------------

export async function loadSettings(
  workspaceId: WorkspaceId
): Promise<any | null> {
  const record = await readSettingsCacheRecord(workspaceId)
  if (!record) return null
  return mergeSettings(record.data, record.pendingPatch) ?? record.data ?? null
}

// --------------------------------------------------------------
// loadPendingPatch — reads from main record
// --------------------------------------------------------------

export async function loadPendingPatch(
  workspaceId: WorkspaceId
): Promise<SettingsPatchType | null> {
  const record = await readSettingsCacheRecord(workspaceId)
  return record?.pendingPatch ?? null
}

// --------------------------------------------------------------
// saveSettings — write data, preserving existing pendingPatch and
// remoteVersion unless explicitly overridden
// --------------------------------------------------------------

export async function saveSettings(
  workspaceId: WorkspaceId,
  next: any,
  options: {
    lastSuccessfulSyncAt?: number | null
    localUpdatedAt?: number | null
    remoteVersion?: number | null
  } = {}
): Promise<any | null> {
  return withSettingsWriteLock(workspaceId, async () => {
    const existing = await readSettingsCacheRecord(workspaceId)

    // Never downgrade: if a confirmed save already wrote a higher version,
    // a concurrent stale backend GET response must not overwrite it.
    const incomingVersion = options.remoteVersion ?? null
    const existingVersion = existing?.remoteVersion ?? null
    if (
      incomingVersion !== null &&
      existingVersion !== null &&
      incomingVersion < existingVersion
    ) {
      return existing?.data ?? null
    }

    await writeSettingsPayload(workspaceId, {
      settings: next,
      pendingPatch: existing?.pendingPatch ?? null,
      remoteVersion: options.remoteVersion ?? existing?.remoteVersion ?? null,
      lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    })
    return next
  })
}

// --------------------------------------------------------------
// writePendingPatch — merges patch into existing, locked
// --------------------------------------------------------------

export async function writePendingPatch(
  workspaceId: WorkspaceId,
  patch: SettingsPatchType
): Promise<void> {
  return withSettingsWriteLock(workspaceId, async () => {
    const existing = await readSettingsCacheRecord(workspaceId)
    const merged = mergeSettingsPatch(existing?.pendingPatch ?? null, patch)
    if (!merged) return

    await writeSettingsPayload(workspaceId, {
      settings: existing?.data ?? null,
      pendingPatch: merged,
      remoteVersion: existing?.remoteVersion ?? null,
      lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: existing?.localUpdatedAt ?? Date.now(),
    })
  })
}

// --------------------------------------------------------------
// clearPendingPatch — zeroes out pendingPatch in main record, locked
// --------------------------------------------------------------

export async function clearPendingPatch(
  workspaceId: WorkspaceId
): Promise<void> {
  return withSettingsWriteLock(workspaceId, async () => {
    const existing = await readSettingsCacheRecord(workspaceId)
    if (!existing) return
    if (existing.pendingPatch === null) return // nothing to clear

    await writeSettingsPayload(workspaceId, {
      settings: existing.data,
      pendingPatch: null,
      remoteVersion: existing.remoteVersion,
      lastSuccessfulSyncAt: existing.lastSuccessfulSyncAt,
      localUpdatedAt: existing.localUpdatedAt ?? Date.now(),
    })
  })
}

// --------------------------------------------------------------
// saveConfirmedSettings — atomic success write, locked
// Writes confirmed data + remoteVersion, clears pendingPatch
// --------------------------------------------------------------

export async function saveConfirmedSettings(
  workspaceId: WorkspaceId,
  data: any,
  meta: { lastSuccessfulSyncAt: number | null; version: number | null }
): Promise<void> {
  return withSettingsWriteLock(workspaceId, async () => {
    const now = Date.now()
    await writeSettingsPayload(workspaceId, {
      settings: data,
      pendingPatch: null,
      remoteVersion: meta.version,
      lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
      localUpdatedAt: now,
    })
  })
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
// Invalidate settings (clear data, hash, sync, and pending keys)
// --------------------------------------------------------------

export async function invalidateSettings(
  workspaceId?: WorkspaceId
): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta(
      (key) =>
        key.includes("::settings") ||
        key.includes("::settingsHash") ||
        key.includes("::settingsPending")
    )
    return
  }

  await Promise.all([
    clearWithMeta(computeSettingsKey(workspaceId)),
    clearWithMeta(computeSettingsHashKey(workspaceId)),
    clearWithMeta(computeSettingsSyncKey(workspaceId)),
    clearWithMeta(computeSettingsPendingKey(workspaceId)),
  ])
}

export async function clearWorkspaceSettings(
  workspaceId: WorkspaceId
): Promise<void> {
  await invalidateSettings(workspaceId)
}
