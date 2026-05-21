"use client";
// /lib/domain/settingsService.ts
import { Capacitor } from "@capacitor/core";
import { SettingsDocSchema, SettingsPatch, SettingsType, } from "@shared/schemas/settings";
import { API_ENDPOINTS, apiFetch, shouldQueueOfflineMutation } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import * as domainSettings from "@/lib/storage/domainSettings";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import { getIsOnline } from "@/lib/network/status";
import { debugError, debugLog } from "@/lib/debugLoop";
import type { WorkspaceId } from "@shared/contracts/workspace";
type SettingsResponse = {
    ok: boolean;
    settings?: SettingsType;
    error?: string;
};
export type SettingsLoadResult = {
    data: SettingsType | null;
    lastBackendSync: number | null;
};
const SETTINGS_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<WorkspaceId, Promise<SettingsLoadResult>>();
const lastBackendSyncByWorkspace = new Map<WorkspaceId, number | null>();

function isAndroidPlatform(): boolean {
    return typeof window !== "undefined" &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android";
}
function validateCachedSettingsData(settings: unknown): SettingsType | null {
    if (settings === null) {
        return null;
    }
    const parsed = safeSchemaParse(SettingsDocSchema, settings);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}
function getLastBackendSync(workspaceId: WorkspaceId): number | null {
    return lastBackendSyncByWorkspace.get(workspaceId) ?? null;
}
function setLastBackendSync(workspaceId: WorkspaceId, timestamp: number | null): void {
    lastBackendSyncByWorkspace.set(workspaceId, timestamp);
}
export function prime(workspaceId: WorkspaceId, settings: SettingsType | null, options: {
    lastBackendSync?: number | null;
    persist?: boolean;
} = {}): SettingsLoadResult {
    const lastBackendSync = options.lastBackendSync === undefined
        ? Date.now()
        : options.lastBackendSync;
    setLastBackendSync(workspaceId, lastBackendSync);
    if (options.persist !== false) {
        void domainSettings.saveSettings(workspaceId, settings);
    }
    return {
        data: settings,
        lastBackendSync,
    };
}
export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<SettingsLoadResult | null> {
    return measureAsync("settings.read_cached_snapshot", async () => {
        const data = await getCached(workspaceId);
        const lastBackendSync = getLastBackendSync(workspaceId);
        if (data === null) {
            return null;
        }
        const validated = validateCachedSettingsData(data);
        if (validated === null) {
            debugLog("settings", "cached_snapshot_rejected", {
                workspaceId,
            });
            await domainSettings.invalidateSettings(workspaceId);
            setLastBackendSync(workspaceId, null);
            return null;
        }
        return {
            data: validated,
            lastBackendSync,
        };
    }, { workspaceId });
}
// ------------------------------------------------------------
// load()
// ------------------------------------------------------------
export async function load(workspaceId: WorkspaceId, force = false, options: {
    trace?: {
        traceId: string;
        flow: string;
    } | null;
} = {}): Promise<SettingsType | null> {
    const result = await ensureLoaded(workspaceId, {
        forceBackend: force,
        trace: options.trace ?? null,
    });
    return result.data;
}
export async function loadForWorkspace(workspaceId: WorkspaceId, force = false, options: {
    trace?: {
        traceId: string;
        flow: string;
    } | null;
} = {}): Promise<SettingsType | null> {
    return load(workspaceId, force, options);
}
// ------------------------------------------------------------
// fetchBackend()
// ------------------------------------------------------------
export async function fetchBackend(workspaceId: WorkspaceId, options: {
    trace?: {
        traceId: string;
        flow: string;
        step?: string;
    } | null;
} = {}): Promise<SettingsType | null> {
    return measureAsync("settings.fetch_backend", async () => {
        try {
            const res = await apiFetch<SettingsResponse>(API_ENDPOINTS.settings.get(workspaceId), {
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
            });
            const raw = res.settings ?? null;
            if (!raw) {
                prime(workspaceId, null);
                return null;
            }
            const parsed = safeSchemaParse(SettingsDocSchema, raw);
            if (!parsed.success) {
                throw parsed.error;
            }
            prime(workspaceId, parsed.data);
            return parsed.data;
        }
        catch (err) {
            throw err;
        }
    }, { workspaceId });
}
export async function ensureLoaded(workspaceId: WorkspaceId, options: {
    forceBackend?: boolean;
    trace?: {
        traceId: string;
        flow: string;
    } | null;
} = {}): Promise<SettingsLoadResult> {
    const existing = inFlightLoads.get(workspaceId);
    if (existing)
        return existing;
    const task = (async (): Promise<SettingsLoadResult> => {
        const timer = startPerfTimer("settings.ensure_loaded", {
            workspaceId,
            forceBackend: options.forceBackend === true,
        });
        const trace = options.trace
            ? createProfileTrace(options.trace.flow, { workspaceId }, options.trace.traceId)
            : null;
        const forceBackend = options.forceBackend ?? false;
        const cached = await withProfileStep(trace, "settings.cache_snapshot", () => readCachedSnapshot(workspaceId), { workspaceId });
        const online = getIsOnline();
        if (!online) {
            const result = cached ?? { data: null, lastBackendSync: null };
            timer.success({ source: "offline-cache", hasCache: cached !== null });
            return result;
        }
        const isStale = forceBackend ||
            !cached?.lastBackendSync ||
            Date.now() - cached.lastBackendSync > SETTINGS_BACKEND_TTL_MS;
        if (cached?.data !== null && !isStale) {
            timer.success({ source: "cache-fresh", hasCache: true });
            return cached;
        }
        try {
            const fresh = await fetchBackend(workspaceId, {
                trace: options.trace
                    ? {
                        traceId: options.trace.traceId,
                        flow: options.trace.flow,
                        step: "settings.fetch_backend",
                    }
                    : null,
            });
            const lastBackendSync = getLastBackendSync(workspaceId);
            const result = {
                data: fresh,
                lastBackendSync,
            };
            timer.success({ source: "backend", hasCache: cached !== null });
            return result;
        }
        catch (error) {
            if (cached && cached.data !== null) {
                timer.success({ source: "cache-fallback", hasCache: true });
                return cached;
            }
            timer.failure(error);
            throw error;
        }
    })();
    inFlightLoads.set(workspaceId, task);
    try {
        return await task;
    }
    finally {
        inFlightLoads.delete(workspaceId);
    }
}
// ------------------------------------------------------------
// save(next)
// ------------------------------------------------------------
export async function save(workspaceId: WorkspaceId, next: Partial<SettingsType>, options: {
    trace?: {
        traceId: string;
        flow: string;
    } | null;
} = {}): Promise<SettingsType | null> {
    const partialResult = safeSchemaParse(SettingsPatch, next);
    if (!partialResult.success) {
        throw partialResult.error;
    }
    const partial = partialResult.data;
    if (isAndroidPlatform()) {
        debugLog("android-settings-save", "service_save_started", {
            workspaceId,
            sectionKeys: {
                common: Object.keys(partial.common ?? {}),
                w2: Object.keys(partial.w2 ?? {}),
                independent: Object.keys(partial.independent ?? {}),
            },
        });
    }
    const online = getIsOnline();
    if (!online) {
        await offlineQueue.enqueue({
            id: crypto.randomUUID?.() ?? String(Date.now()),
            ts: Date.now(),
            workspaceId,
            endpoint: API_ENDPOINTS.settings.post(workspaceId),
            method: "POST",
            body: JSON.stringify(partial),
        });
        if (isAndroidPlatform()) {
            debugLog("android-settings-save", "service_save_queued_offline", {
                workspaceId,
                reason: "offline",
            });
        }
        return await domainSettings.loadSettings(workspaceId);
    }
    try {
        const res = await apiFetch<SettingsResponse>(API_ENDPOINTS.settings.post(workspaceId), {
            method: "POST",
            body: JSON.stringify(partial),
            timeout: 10000,
            profile: options.trace
                ? {
                    traceId: options.trace.traceId,
                    flow: options.trace.flow,
                    step: "settings_save.network_request",
                    metadata: {
                        workspaceId,
                    },
                }
                : undefined,
        });
        const parsed = safeSchemaParse(SettingsDocSchema, res.settings);
        if (!parsed.success) {
            if (isAndroidPlatform()) {
                debugError("android-settings-save", "service_save_invalid_response", {
                    workspaceId,
                });
            }
            return await domainSettings.loadSettings(workspaceId);
        }
        prime(workspaceId, parsed.data);
        if (isAndroidPlatform()) {
            debugLog("android-settings-save", "service_save_backend_success", {
                workspaceId,
            });
        }
        return parsed.data;
    }
    catch (err) {
        if (!shouldQueueOfflineMutation(err)) {
            if (isAndroidPlatform()) {
                debugError("android-settings-save", "service_save_backend_rejected", {
                    workspaceId,
                    message: err instanceof Error ? err.message : String(err),
                    status: typeof (err as any)?.status === "number" ? (err as any).status : null,
                });
            }
            throw err;
        }
        await offlineQueue.enqueue({
            id: crypto.randomUUID?.() ?? String(Date.now()),
            ts: Date.now(),
            workspaceId,
            endpoint: API_ENDPOINTS.settings.post(workspaceId),
            method: "POST",
            body: JSON.stringify(partial),
        });
        if (isAndroidPlatform()) {
            debugLog("android-settings-save", "service_save_queued_offline", {
                workspaceId,
                reason: "retryable_error",
                message: err instanceof Error ? err.message : String(err),
                status: typeof (err as any)?.status === "number" ? (err as any).status : null,
            });
        }
        return await domainSettings.loadSettings(workspaceId);
    }
}
// ------------------------------------------------------------
// invalidate / clear
// ------------------------------------------------------------
export async function invalidate(workspaceId: WorkspaceId): Promise<SettingsType | null> {
    setLastBackendSync(workspaceId, null);
    await domainSettings.invalidateSettings(workspaceId);
    return load(workspaceId, true);
}
export async function clear(workspaceId?: WorkspaceId): Promise<void> {
    if (!workspaceId) {
        lastBackendSyncByWorkspace.clear();
        await domainSettings.invalidateSettings();
        return;
    }
    setLastBackendSync(workspaceId, null);
    await domainSettings.invalidateSettings(workspaceId);
}
// ------------------------------------------------------------
// getCached()
// ------------------------------------------------------------
export async function getCached(workspaceId: WorkspaceId): Promise<SettingsType | null> {
    const data = await domainSettings.loadSettings(workspaceId);
    if (!data)
        return null;
    const parsed = safeSchemaParse(SettingsDocSchema, data);
    if (!parsed.success)
        return null;
    return parsed.data;
}
