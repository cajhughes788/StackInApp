"use client"

import { Capacitor } from "@capacitor/core"

import type {
  SettingsDocumentMeta,
  SettingsGetResponse,
  SettingsSaveRequest,
  SettingsSaveResponse,
} from "@shared/contracts/settingsSync"
import type { WorkspaceId } from "@shared/contracts/workspace"
import {
  SettingsDocSchema,
  SettingsPatch,
  type SettingsPatchType,
  type SettingsType,
} from "@shared/schemas/settings"

import { API_ENDPOINTS, apiFetch, shouldQueueOfflineMutation } from "@/lib/api"
import {
  classifySettingsSyncError,
  getSettingsConflictDetails,
  hasSettingsPatch,
  mergeSettings,
  normalizeSettingsPatch,
} from "@/lib/domain/settingsSync"
import { debugError, debugLog } from "@/lib/debugLoop"
import {
  makeTraceId,
  trace as diagTrace,
  traceCacheRead,
  traceCacheWrite,
  traceApiRequest,
  traceApiResponse,
  traceApiFailure,
  traceReconciliation,
} from "@/lib/diagnostics/trace"
import { getIsOnline, onNetworkChange } from "@/lib/network/status"
import { measureAsync, startPerfTimer } from "@/lib/observability/perf"
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace"
import * as domainSettings from "@/lib/storage/domainSettings"
import { useSettingsSaveStore } from "@/lib/stores/useSettingsSaveStore"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"

export type SettingsLoadResult = {
  data: SettingsType | null
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  source: "cache" | "backend"
  didFetch: boolean
  remoteMeta?: SettingsDocumentMeta | null
}

export type SettingsSaveResult = {
  data: SettingsType | null
  lastSuccessfulSyncAt: number | null
  localUpdatedAt: number | null
  remoteMeta: SettingsDocumentMeta | null
  source: "backend" | "pending" | "conflict" | "validation_error" | "noop"
}

const SETTINGS_BACKEND_TTL_MS = 5 * 60 * 1000
const SETTINGS_RECENT_TTL_MS = 5_000
const inFlightLoads = new Map<WorkspaceId, Promise<SettingsLoadResult>>()
const inFlightSaves = new Map<WorkspaceId, Promise<SettingsSaveResult>>()
const inFlightSync = new Map<WorkspaceId, Promise<void>>()
const recentResults = new Map<WorkspaceId, { result: SettingsLoadResult; resolvedAt: number }>()

function isAndroidPlatform(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android"
  )
}

function validateCachedSettingsData(settings: unknown): SettingsType | null {
  if (settings === null) {
    return null
  }

  const parsed = safeSchemaParse(SettingsDocSchema, settings)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}

function getResponseMeta(meta: SettingsDocumentMeta | null | undefined): SettingsDocumentMeta | null {
  if (!meta) {
    return null
  }

  if (
    typeof meta.version !== "number" ||
    !Number.isFinite(meta.version) ||
    meta.version < 1 ||
    typeof meta.updatedAt !== "string" ||
    meta.updatedAt.length === 0
  ) {
    return null
  }

  return meta
}

async function applyRemoteSnapshot(
  workspaceId: WorkspaceId,
  settings: SettingsType | null,
  remoteMeta: SettingsDocumentMeta | null,
  options: {
    clearPendingPatch?: boolean
    persist?: boolean
  } = {}
): Promise<SettingsLoadResult> {
  const now = Date.now()

  // For the load path (clearPendingPatch: false), apply the IDB pending patch
  // on top of backend data so the caller receives the optimistic merged view.
  const pendingPatch =
    options.clearPendingPatch === false
      ? await domainSettings.loadPendingPatch(workspaceId)
      : null

  const resolvedSettings =
    pendingPatch && settings
      ? mergeSettings(settings, pendingPatch) ?? settings
      : settings

  if (options.persist !== false) {
    await domainSettings.saveSettings(workspaceId, settings, {
      lastSuccessfulSyncAt: now,
      localUpdatedAt: now,
      remoteVersion: remoteMeta?.version ?? null,
    })
    if (options.clearPendingPatch !== false) {
      void domainSettings.clearPendingPatch(workspaceId)
    }
  }

  return {
    data: resolvedSettings,
    lastSuccessfulSyncAt: now,
    localUpdatedAt: now,
    source: "backend",
    didFetch: true,
    remoteMeta,
  }
}

async function performSave(
  workspaceId: WorkspaceId,
  patch: SettingsPatchType,
  options: {
    trace?: {
      traceId: string
      flow: string
    } | null
    expectedVersionOverride?: number | null
    attempt?: number
    bypassOfflineCheck?: boolean
  } = {}
): Promise<SettingsSaveResult> {
  const normalizedPatch = normalizeSettingsPatch(patch)
  if (!normalizedPatch) {
    const localData = validateCachedSettingsData(
      await domainSettings.loadSettings(workspaceId)
    )
    return {
      data: localData,
      lastSuccessfulSyncAt: null,
      localUpdatedAt: Date.now(),
      remoteMeta: null,
      source: "noop",
    }
  }

  const saveStore = useSettingsSaveStore.getState()
  saveStore.setSaveState(workspaceId, { status: "saving" })
  const diagTraceId = makeTraceId("settings_save")
  diagTrace({ category: "settings", layer: "store", event: "SETTINGS_SAVE", phase: "initiated", traceId: diagTraceId, data: { workspaceId, sections: Object.keys(normalizedPatch).join(","), isOnline: getIsOnline() }, level: "normal" })

  debugLog("settings-save", "perform_save_start", {
    workspaceId,
    bypassOfflineCheck: !!options.bypassOfflineCheck,
    attempt: options.attempt ?? 0,
    isOnline: getIsOnline(),
    patchSections: Object.keys(normalizedPatch),
  })

  // ── Offline fast-path ──────────────────────────────────────────
  if (!options.bypassOfflineCheck && !getIsOnline()) {
    debugLog("settings-save", "queued_offline", {
      workspaceId,
      reason: "getIsOnline_false",
      bypassOfflineCheck: false,
    })
    traceCacheWrite("settings", diagTraceId, "pending_patch_write", { workspaceId, reason: "offline" })
    await domainSettings.writePendingPatch(workspaceId, normalizedPatch)
    saveStore.setSaveState(workspaceId, {
      status: "pending",
      message: "Will sync when online",
    })
    if (isAndroidPlatform()) {
      debugLog("android-settings-save", "save_queued_offline", { workspaceId })
    }
    return {
      data: validateCachedSettingsData(await domainSettings.loadSettings(workspaceId)),
      lastSuccessfulSyncAt: null,
      localUpdatedAt: Date.now(),
      remoteMeta: null,
      source: "pending",
    }
  }

  // ── Online path ────────────────────────────────────────────────
  try {
    const record = await domainSettings.readSettingsCacheRecord(workspaceId)
    const expectedVersion =
      typeof options.expectedVersionOverride === "number"
        ? options.expectedVersionOverride
        : record?.remoteVersion ?? null

    debugLog("settings-save", "api_request_start", {
      workspaceId,
      expectedVersion,
      attempt: options.attempt ?? 0,
    })
    traceApiRequest("settings", diagTraceId, { workspaceId, endpoint: "settings.post", expectedVersion: expectedVersion ?? null, attempt: options.attempt ?? 0 })

    const res = await apiFetch<SettingsSaveResponse>(
      API_ENDPOINTS.settings.post(workspaceId),
      {
        method: "POST",
        body: JSON.stringify({
          patch: normalizedPatch,
          expectedVersion,
        } satisfies SettingsSaveRequest),
        timeout: 10000,
        profile: options.trace
          ? {
              traceId: options.trace.traceId,
              flow: options.trace.flow,
              step: "settings_save.network_request",
              metadata: { workspaceId, attempt: options.attempt ?? 0 },
            }
          : undefined,
      }
    )

    const parsed = safeSchemaParse(SettingsDocSchema, res.settings)
    const remoteMeta = getResponseMeta(res.meta)

    diagTrace({
      category: "settings",
      layer: "api",
      event: "SETTINGS_SAVE",
      phase: "raw_response_received",
      traceId: diagTraceId,
      data: {
        workspaceId,
        hasMeta: Boolean(res?.meta),
        metaVersion: typeof res?.meta?.version === "number" ? res.meta.version : null,
        hasSettings: Boolean(res?.settings),
        parsedSuccess: parsed.success,
        parsedMetaValid: remoteMeta !== null,
      },
      level: "normal",
    })

    if (!parsed.success || !remoteMeta) {
      debugError("settings-save", "api_response_invalid", {
        workspaceId,
        parsedSuccess: parsed.success,
        hasMeta: remoteMeta !== null,
      })
      await domainSettings.writePendingPatch(workspaceId, normalizedPatch)
      saveStore.setSaveState(workspaceId, {
        status: "pending",
        message: "Will sync when online",
      })
      return {
        data: validateCachedSettingsData(await domainSettings.loadSettings(workspaceId)),
        lastSuccessfulSyncAt: null,
        localUpdatedAt: Date.now(),
        remoteMeta: null,
        source: "pending",
      }
    }

    const now = Date.now()
    await domainSettings.saveConfirmedSettings(workspaceId, parsed.data, {
      lastSuccessfulSyncAt: now,
      version: remoteMeta.version,
    })
    saveStore.setSaveState(workspaceId, { status: "synced", at: now })
    traceApiResponse("settings", diagTraceId, { workspaceId, newVersion: remoteMeta.version })
    traceCacheWrite("settings", diagTraceId, "confirmed_write", { workspaceId })
    traceReconciliation("settings", diagTraceId, "save_committed", { workspaceId, version: remoteMeta.version })

    debugLog("settings-save", "api_succeeded", {
      workspaceId,
      newVersion: remoteMeta.version,
      savedSections: {
        common: Object.keys(parsed.data?.common ?? {}),
        w2: Object.keys(parsed.data?.w2 ?? {}),
        independent: Object.keys(parsed.data?.independent ?? {}),
      },
    })
    if (isAndroidPlatform()) {
      debugLog("android-settings-save", "persist_succeeded", {
        workspaceId,
        savedSections: {
          common: Object.keys(parsed.data?.common ?? {}),
          w2: Object.keys(parsed.data?.w2 ?? {}),
          independent: Object.keys(parsed.data?.independent ?? {}),
        },
      })
    }

    return {
      data: parsed.data,
      lastSuccessfulSyncAt: now,
      localUpdatedAt: now,
      remoteMeta,
      source: "backend",
    }
  } catch (error) {
    diagTrace({
      category: "settings",
      layer: "api",
      event: "SETTINGS_SAVE",
      phase: "apiFetch_threw",
      traceId: diagTraceId,
      data: {
        workspaceId,
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
        isApiError: (error as any)?.status !== undefined,
        status: (error as any)?.status ?? null,
        isOnline: getIsOnline(),
        attempt: options.attempt ?? 0,
      },
      error,
      level: "errors",
    })

    // ── 409 conflict: rebase once ────────────────────────────────
    const conflict = getSettingsConflictDetails(error)
    if (
      conflict?.currentMeta &&
      (options.attempt ?? 0) === 0 &&
      hasSettingsPatch(normalizedPatch)
    ) {
      traceReconciliation("settings", diagTraceId, "conflict_rebase", { workspaceId, conflictVersion: conflict.currentMeta.version })
      debugLog("settings-save", "conflict_rebase", {
        workspaceId,
        conflictVersion: conflict.currentMeta.version,
        attempt: options.attempt ?? 0,
      })
      return await performSave(workspaceId, normalizedPatch, {
        ...options,
        expectedVersionOverride: conflict.currentMeta.version,
        attempt: 1,
      })
    }

    const classification = classifySettingsSyncError(error, getIsOnline())

    debugError("settings-save", "api_failed", {
      workspaceId,
      failureKind: classification.failureKind,
      retryable: classification.retryable,
      attempt: options.attempt ?? 0,
      isOnline: getIsOnline(),
      message: error instanceof Error ? error.message : String(error),
    })

    // ── Transient / network / 5xx → queue for later ───────────────
    if (classification.retryable || shouldQueueOfflineMutation(error)) {
      await domainSettings.writePendingPatch(workspaceId, normalizedPatch)
      saveStore.setSaveState(workspaceId, {
        status: "pending",
        message: "Will sync when online",
      })
      return {
        data: validateCachedSettingsData(await domainSettings.loadSettings(workspaceId)),
        lastSuccessfulSyncAt: null,
        localUpdatedAt: Date.now(),
        remoteMeta: null,
        source: "pending",
      }
    }

    // ── Auth / forbidden → clear patch, surface error, throw ─────
    if (
      classification.failureKind === "auth" ||
      classification.failureKind === "forbidden"
    ) {
      await domainSettings.clearPendingPatch(workspaceId)
      saveStore.setSaveState(workspaceId, {
        status: "error",
        message: error instanceof Error ? error.message : "Authentication error.",
        retryable: false,
        preservedPatch: false,
      })
      if (isAndroidPlatform()) {
        debugError("android-settings-save", "persist_failed_auth", {
          workspaceId,
          failureKind: classification.failureKind,
        })
      }
      throw error // let the page surface an auth redirect
    }

    // ── 400 / 409+attempt1 / unknown → preserve patch, surface error
    await domainSettings.writePendingPatch(workspaceId, normalizedPatch)
    saveStore.setSaveState(workspaceId, {
      status: "error",
      message: error instanceof Error ? error.message : "Settings sync failed.",
      retryable: false,
      preservedPatch: true,
    })

    if (isAndroidPlatform()) {
      debugError("android-settings-save", "persist_failed", {
        workspaceId,
        failureKind: classification.failureKind,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    const source =
      classification.failureKind === "validation" ? "validation_error" : "conflict"
    return {
      data: validateCachedSettingsData(await domainSettings.loadSettings(workspaceId)),
      lastSuccessfulSyncAt: null,
      localUpdatedAt: Date.now(),
      remoteMeta: null,
      source,
    }
  }
}

export function getCurrentSaveState(workspaceId: WorkspaceId) {
  return useSettingsSaveStore.getState().getSaveState(workspaceId)
}

export async function syncPendingIfNeeded(workspaceId: WorkspaceId): Promise<void> {
  const existing = inFlightSync.get(workspaceId)
  if (existing) {
    debugLog("settings-save", "sync_already_in_flight", { workspaceId })
    return existing
  }

  const task = (async () => {
    const patch = await domainSettings.loadPendingPatch(workspaceId)
    if (!patch) {
      debugLog("settings-save", "sync_no_pending_patch", { workspaceId })
      return
    }

    debugLog("settings-save", "sync_patch_found", {
      workspaceId,
      patchSections: Object.keys(patch),
      isOnline: getIsOnline(),
    })

    await ensureLoaded(workspaceId, { allowOfflineFallback: true })

    // Drain any in-flight user save before reading the patch so we don't
    // capture a snapshot that the concurrent save is about to clear.
    const priorSave = inFlightSaves.get(workspaceId)
    if (priorSave) {
      debugLog("settings-save", "sync_draining_prior_save", { workspaceId })
      try { await priorSave } catch {}
    }

    // Re-read after ensureLoaded (and after any concurrent user save settles)
    // so we don't re-send a patch that has already been flushed.
    const livePatch = await domainSettings.loadPendingPatch(workspaceId)
    if (!livePatch) {
      debugLog("settings-save", "sync_patch_cleared_by_concurrent_save", { workspaceId })
      return
    }

    debugLog("settings-save", "sync_attempting_save", {
      workspaceId,
      livePatchSections: Object.keys(livePatch),
      isOnline: getIsOnline(),
    })

    try {
      await save(workspaceId, livePatch, { bypassOfflineCheck: true })
    } catch {
      // save() handles its own error state; swallow here so the hook doesn't throw
    }
  })()

  inFlightSync.set(workspaceId, task)
  try {
    await task
  } finally {
    inFlightSync.delete(workspaceId)
  }
}

export async function syncAllPendingIfNeeded(workspaceIds: WorkspaceId[]): Promise<void> {
  await Promise.allSettled(workspaceIds.map((id) => syncPendingIfNeeded(id)))
}

export function registerReconnectSync(workspaceIds: WorkspaceId[]): () => void {
  return onNetworkChange((online) => {
    if (!online) return
    debugLog("settings-sync", "reconnect_sync_triggered", { workspaceIds })
    void syncAllPendingIfNeeded(workspaceIds)
  })
}

export async function readCachedSnapshot(
  workspaceId: WorkspaceId
): Promise<SettingsLoadResult | null> {
  return measureAsync(
    "settings.read_cached_snapshot",
    async () => {
      const record = await domainSettings.readSettingsCacheRecord(workspaceId)
      if (!record) return null

      const validated = validateCachedSettingsData(record.data)
      if (record.data !== null && validated === null) {
        debugLog("settings", "cached_snapshot_rejected", { workspaceId })
        await domainSettings.invalidateSettings(workspaceId)
        return null
      }

      // Return the optimistic merged view so bootstrap seeds the store correctly
      const mergedData = mergeSettings(validated, record.pendingPatch) ?? validated

      return {
        data: mergedData,
        lastSuccessfulSyncAt: record.lastSuccessfulSyncAt,
        localUpdatedAt: record.localUpdatedAt,
        source: "cache",
        didFetch: false,
        remoteMeta: record.remoteVersion
          ? { version: record.remoteVersion, updatedAt: "" }
          : null,
      }
    },
    { workspaceId }
  )
}

export function prime(
  workspaceId: WorkspaceId,
  settings: SettingsType | null,
  options: {
    lastSuccessfulSyncAt?: number | null
    persist?: boolean
    remoteMeta?: SettingsDocumentMeta | null
    source?: "cache" | "hint" | "optimistic" | "backend" | "bootstrap"
    localUpdatedAt?: number | null
  } = {}
): SettingsLoadResult {
  const source = options.source ?? "cache"
  const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null
  const localUpdatedAt = options.localUpdatedAt ?? Date.now()

  // Hints are ephemeral in-memory seeds — never write to IDB (would wipe
  // lastSuccessfulSyncAt and force a backend fetch on every startup).
  const shouldPersist = options.persist !== false && source !== "hint"

  if (shouldPersist) {
    void domainSettings.saveSettings(workspaceId, settings, {
      lastSuccessfulSyncAt,
      localUpdatedAt,
      remoteVersion: options.remoteMeta?.version ?? null,
    })
  }

  return {
    data: settings,
    lastSuccessfulSyncAt,
    localUpdatedAt,
    source: source === "backend" || source === "bootstrap" ? "backend" : "cache",
    didFetch: false,
    remoteMeta: options.remoteMeta ?? null,
  }
}

export async function fetchBackend(
  workspaceId: WorkspaceId,
  options: {
    trace?: {
      traceId: string
      flow: string
      step?: string
    } | null
  } = {}
): Promise<SettingsLoadResult> {
  return measureAsync(
    "settings.fetch_backend",
    async () => {
      const res = await apiFetch<SettingsGetResponse>(API_ENDPOINTS.settings.get(workspaceId), {
        method: "GET",
        timeout: 10000,
        profile: options.trace
          ? {
              traceId: options.trace.traceId,
              flow: options.trace.flow,
              step: options.trace.step ?? "settings.fetch_backend",
              metadata: {
                workspaceId,
              },
            }
          : undefined,
      })

      const raw = res.settings ?? null
      if (!raw) {
        return await applyRemoteSnapshot(workspaceId, null, getResponseMeta(res.meta), {
          clearPendingPatch: false,
        })
      }

      const parsed = safeSchemaParse(SettingsDocSchema, raw)
      if (!parsed.success) {
        throw parsed.error
      }

      return await applyRemoteSnapshot(
        workspaceId,
        parsed.data,
        getResponseMeta(res.meta),
        { clearPendingPatch: false }
      )
    },
    { workspaceId }
  )
}

export async function ensureLoaded(
  workspaceId: WorkspaceId,
  options: {
    forceBackend?: boolean
    allowOfflineFallback?: boolean
    trace?: {
      traceId: string
      flow: string
    } | null
  } = {}
): Promise<SettingsLoadResult> {
  const existing = inFlightLoads.get(workspaceId)
  if (existing) {
    return existing
  }

  if (!options.forceBackend) {
    const recent = recentResults.get(workspaceId)
    if (recent && Date.now() - recent.resolvedAt < SETTINGS_RECENT_TTL_MS) {
      return recent.result
    }
  }

  const task = (async (): Promise<SettingsLoadResult> => {
    const diagTraceId = makeTraceId("settings_load")
    diagTrace({ category: "settings", layer: "cache", event: "SETTINGS_LOAD", phase: "initiated", traceId: diagTraceId, data: { workspaceId, forceBackend: options.forceBackend ?? false }, level: "normal" })
    const timer = startPerfTimer("settings.ensure_loaded", {
      workspaceId,
      forceBackend: options.forceBackend === true,
    })
    const trace = options.trace
      ? createProfileTrace(options.trace.flow, { workspaceId }, options.trace.traceId)
      : null
    const forceBackend = options.forceBackend ?? false
    const cached = await withProfileStep(
      trace,
      "settings.cache_snapshot",
      () => readCachedSnapshot(workspaceId),
      { workspaceId }
    )
    traceCacheRead("settings", diagTraceId, { workspaceId, hit: cached !== null, isStale: cached ? Date.now() - (cached.lastSuccessfulSyncAt ?? 0) > SETTINGS_BACKEND_TTL_MS : true })

    if (!getIsOnline() && !options.allowOfflineFallback) {
      debugLog("settings-save", "ensure_loaded_offline_gate", {
        workspaceId,
        hasCache: cached !== null,
        allowOfflineFallback: false,
      })
      const result =
        cached ?? {
          data: null,
          lastSuccessfulSyncAt: null,
          localUpdatedAt: null,
          source: "cache",
          didFetch: false,
        }
      timer.success({ source: "offline-cache", hasCache: cached !== null })
      return result
    }

    if (!getIsOnline() && options.allowOfflineFallback) {
      debugLog("settings-save", "ensure_loaded_offline_fallback_bypass", {
        workspaceId,
        hasCache: cached !== null,
        note: "getIsOnline=false but allowOfflineFallback=true — attempting fetch anyway",
      })
    }

    const isStale =
      forceBackend ||
      !cached?.lastSuccessfulSyncAt ||
      Date.now() - cached.lastSuccessfulSyncAt > SETTINGS_BACKEND_TTL_MS

    if (cached?.data !== null && !isStale) {
      timer.success({ source: "cache-fresh", hasCache: true })
      return cached
    }

    try {
      traceApiRequest("settings", diagTraceId, { workspaceId, endpoint: "settings.get" })
      const fresh = await fetchBackend(workspaceId, {
        trace: options.trace
          ? {
              traceId: options.trace.traceId,
              flow: options.trace.flow,
              step: "settings.fetch_backend",
            }
          : null,
      })
      traceApiResponse("settings", diagTraceId, { workspaceId, source: "backend", hasData: fresh.data !== null })
      traceCacheWrite("settings", diagTraceId, "backend_persist", { workspaceId })
      diagTrace({ category: "settings", layer: "reconciliation", event: "SETTINGS_LOAD", phase: "complete_backend", traceId: diagTraceId, data: { workspaceId, hasRemoteMeta: Boolean(fresh.remoteMeta) }, level: "normal" })
      timer.success({ source: "backend", hasCache: cached !== null })
      return fresh
    } catch (error) {
      if (cached && cached.data !== null) {
        traceApiFailure("settings", diagTraceId, error, { workspaceId, fallback: "cache" })
        timer.success({ source: "cache-fallback", hasCache: true })
        return cached
      }

      traceApiFailure("settings", diagTraceId, error, { workspaceId, fallback: "none" })
      timer.failure(error)
      throw error
    }
  })()

  inFlightLoads.set(workspaceId, task)
  try {
    const result = await task
    recentResults.set(workspaceId, { result, resolvedAt: Date.now() })
    return result
  } finally {
    inFlightLoads.delete(workspaceId)
  }
}

export async function load(
  workspaceId: WorkspaceId,
  force = false,
  options: {
    trace?: {
      traceId: string
      flow: string
    } | null
  } = {}
): Promise<SettingsType | null> {
  const result = await ensureLoaded(workspaceId, {
    forceBackend: force,
    trace: options.trace ?? null,
  })
  return result.data
}

export async function loadForWorkspace(
  workspaceId: WorkspaceId,
  force = false,
  options: {
    trace?: {
      traceId: string
      flow: string
    } | null
  } = {}
): Promise<SettingsType | null> {
  return load(workspaceId, force, options)
}

export async function save(
  workspaceId: WorkspaceId,
  next: Partial<SettingsType>,
  options: {
    trace?: {
      traceId: string
      flow: string
    } | null
    bypassOfflineCheck?: boolean
  } = {}
): Promise<SettingsSaveResult> {
  const partialResult = safeSchemaParse(SettingsPatch, next)
  if (!partialResult.success) {
    throw partialResult.error
  }

  const partial = normalizeSettingsPatch(partialResult.data)
  if (!partial) {
    const record = await domainSettings.readSettingsCacheRecord(workspaceId)
    const localData = validateCachedSettingsData(
      await domainSettings.loadSettings(workspaceId)
    )
    return {
      data: localData,
      lastSuccessfulSyncAt: record?.lastSuccessfulSyncAt ?? null,
      localUpdatedAt: Date.now(),
      remoteMeta: record?.remoteVersion
        ? { version: record.remoteVersion, updatedAt: "" }
        : null,
      source: "noop",
    }
  }

  const priorSave = inFlightSaves.get(workspaceId)
  if (priorSave) {
    try {
      await priorSave
    } catch {}
  }

  const task = performSave(workspaceId, partial, {
    trace: options.trace ?? undefined,
    bypassOfflineCheck: options.bypassOfflineCheck,
  })
  inFlightSaves.set(workspaceId, task)
  try {
    const result = await task
    recentResults.delete(workspaceId)
    return result
  } finally {
    if (inFlightSaves.get(workspaceId) === task) {
      inFlightSaves.delete(workspaceId)
    }
  }
}

export async function invalidate(workspaceId: WorkspaceId): Promise<SettingsType | null> {
  recentResults.delete(workspaceId)
  await domainSettings.invalidateSettings(workspaceId)
  useSettingsSaveStore.getState().clear(workspaceId)
  return load(workspaceId, true)
}

export async function clear(workspaceId?: WorkspaceId): Promise<void> {
  if (workspaceId) {
    recentResults.delete(workspaceId)
  } else {
    recentResults.clear()
  }
  await domainSettings.invalidateSettings(workspaceId)
  useSettingsSaveStore.getState().clear(workspaceId)
}

export async function getCached(
  workspaceId: WorkspaceId
): Promise<SettingsType | null> {
  const data = await domainSettings.loadSettings(workspaceId)
  if (!data) {
    return null
  }

  const parsed = safeSchemaParse(SettingsDocSchema, data)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}
