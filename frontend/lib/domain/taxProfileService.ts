"use client";
// /lib/domain/taxProfileService.ts
// ------------------------------------------------------------
// Unified cache + API adapter for TaxProfile.
// NEW ARCHITECTURE — cache-first, infinite TTL, offline queue,
// idempotent writes, no raw storage.* calls.
// ------------------------------------------------------------
import {
// NEW — domain storage for tax profile
loadTaxProfileCache, readTaxProfileCacheRecord, saveTaxProfileCache, clearTaxProfileCache, clearTaxProfileHash, loadTaxProfileHash, saveTaxProfileHash } from "@/lib/storage/taxProfileCache";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import { getTaxProfile as apiGetTaxProfile, saveTaxProfile as apiSaveTaxProfile, API_ENDPOINTS, shouldQueueOfflineMutation } from "@/lib/api";
import { ApiError } from "@/lib/api/core/errors";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { TaxProfile } from "@shared/schemas";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { safeSchemaParse, type SchemaParseResult } from "@/lib/utils/safeSchemaParse";
export type TaxProfileLoadResult = {
    data: TaxProfile.Type | null;
    lastSuccessfulSyncAt: number | null;
    localUpdatedAt: number | null;
    source: "cache" | "backend";
    didFetch: boolean;
};
const TAX_PROFILE_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<WorkspaceId, Promise<TaxProfileLoadResult>>();
const lastSuccessfulSyncAtByWorkspace = new Map<WorkspaceId, number | null>();
// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
/**
 * Normalize any possible API response shape to a pure TaxProfile or null
 * (unchanged from original)
 */
function normalizeResponse(res: any): TaxProfile.Type | null {
    if (!res)
        return null;
    if ("profile" in res)
        return res.profile;
    if ("taxProfile" in res)
        return res.taxProfile;
    return res as TaxProfile.Type;
}
function getLastSuccessfulSyncAt(workspaceId: WorkspaceId): number | null {
    return lastSuccessfulSyncAtByWorkspace.get(workspaceId) ?? null;
}
function setLastSuccessfulSyncAt(workspaceId: WorkspaceId, timestamp: number | null): void {
    lastSuccessfulSyncAtByWorkspace.set(workspaceId, timestamp);
}
async function hashTaxProfile(profile: TaxProfile.Type): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(profile)));
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}
export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<TaxProfileLoadResult> {
    return measureAsync("tax_profile.read_cached_snapshot", async () => {
        const cached = await readTaxProfileCacheRecord(workspaceId);
        if (!cached) {
            return {
                data: null,
                lastSuccessfulSyncAt: null,
                localUpdatedAt: null,
                source: "cache",
                didFetch: false,
            };
        }
        return {
            data: cached.data,
            lastSuccessfulSyncAt:
                getLastSuccessfulSyncAt(workspaceId) ?? cached.lastSuccessfulSyncAt,
            localUpdatedAt: cached.localUpdatedAt,
            source: "cache",
            didFetch: false,
        };
    }, { workspaceId });
}
export function prime(workspaceId: WorkspaceId, profile: TaxProfile.Type | null, options: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
} = {}): TaxProfileLoadResult {
    const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null;
    const localUpdatedAt = options.localUpdatedAt ?? Date.now();
    setLastSuccessfulSyncAt(workspaceId, lastSuccessfulSyncAt);
    void (profile === null
        ? clearTaxProfileCache(workspaceId)
        : saveTaxProfileCache(workspaceId, profile, {
            lastSuccessfulSyncAt,
            localUpdatedAt,
        }));
    return {
        data: profile,
        lastSuccessfulSyncAt,
        localUpdatedAt,
        source: "cache",
        didFetch: false,
    };
}
export function clearSyncMetadata(workspaceId?: WorkspaceId): void {
    if (!workspaceId) {
        lastSuccessfulSyncAtByWorkspace.clear();
        return;
    }
    lastSuccessfulSyncAtByWorkspace.delete(workspaceId);
}
export async function ensureLoaded(workspaceId: WorkspaceId, options: {
    forceBackend?: boolean;
} = {}): Promise<TaxProfileLoadResult> {
    const existing = inFlightLoads.get(workspaceId);
    if (existing)
        return existing;
    const task = (async (): Promise<TaxProfileLoadResult> => {
        const timer = startPerfTimer("tax_profile.ensure_loaded", {
            workspaceId,
            forceBackend: options.forceBackend === true,
        });
        const cached = await readCachedSnapshot(workspaceId);
        const forceBackend = options.forceBackend === true;
        const isFresh = cached.lastSuccessfulSyncAt !== null &&
            Date.now() - cached.lastSuccessfulSyncAt <= TAX_PROFILE_BACKEND_TTL_MS;
        if (!forceBackend && cached.data !== null && isFresh) {
            timer.success({ source: "cache-fresh", hasCache: true });
            return cached;
        }
        if (!forceBackend && cached.data !== null) {
            timer.success({ source: "cache-stale", hasCache: true });
            return cached;
        }
        const result = await fetchBackend(workspaceId);
        timer.success({ source: "backend", hasCache: cached.data !== null });
        return result;
    })();
    inFlightLoads.set(workspaceId, task);
    try {
        return await task;
    }
    finally {
        inFlightLoads.delete(workspaceId);
    }
}
async function fetchBackend(workspaceId: WorkspaceId): Promise<TaxProfileLoadResult> {
    return measureAsync("tax_profile.fetch_backend", async () => {
        const res = await apiGetTaxProfile(workspaceId);
        const data = normalizeResponse(res);
        if (!data) {
            await clearTaxProfileCache(workspaceId);
            setLastSuccessfulSyncAt(workspaceId, Date.now());
            return {
                data: null,
                lastSuccessfulSyncAt: getLastSuccessfulSyncAt(workspaceId),
                localUpdatedAt: Date.now(),
                source: "backend",
                didFetch: true,
            };
        }
        const parsed = safeSchemaParse(TaxProfile.Schema, data);
        if (!parsed.success) {
            await clearTaxProfileCache(workspaceId);
            setLastSuccessfulSyncAt(workspaceId, Date.now());
            return {
                data: null,
                lastSuccessfulSyncAt: getLastSuccessfulSyncAt(workspaceId),
                localUpdatedAt: Date.now(),
                source: "backend",
                didFetch: true,
            };
        }
        const syncedAt = Date.now();
        await saveTaxProfileCache(workspaceId, parsed.data, {
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
        });
        setLastSuccessfulSyncAt(workspaceId, syncedAt);
        return {
            data: parsed.data,
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
            source: "backend",
            didFetch: true,
        };
    }, { workspaceId });
}
// ------------------------------------------------------------
// LOAD (REWRITTEN — NEW ARCHITECTURE)
// ------------------------------------------------------------
// CHANGED (Issue 3): return type widened to TaxProfile.Type | null
export async function load(workspaceId: WorkspaceId, force = false): Promise<TaxProfile.Type | null> {
    const result = await ensureLoaded(workspaceId, { forceBackend: force });
    return result.data;
}
// ------------------------------------------------------------
// SAVE (REWRITTEN — NEW ARCHITECTURE)
// ------------------------------------------------------------
export async function save(workspaceId: WorkspaceId, next: Partial<TaxProfile.Type>): Promise<TaxProfile.Type> {
    // 1) Validate partial
    const partial = safeSchemaParse(TaxProfile.Schema.partial(), next);
    if (!partial.success)
        throw partial.error;
    // 2) Merge with cached or empty base
    const cached = await loadTaxProfileCache(workspaceId);
    const base = (cached ?? {}) as Partial<TaxProfile.Type>;
    const merged = { ...base, ...partial.data } as TaxProfile.Type;
    // 3) Validate full merged profile
    const valid = safeSchemaParse(TaxProfile.Schema, merged);
    if (!valid.success) {
        throw valid.error;
    }
    // 4) Optimistic local cache write
    await saveTaxProfileCache(workspaceId, valid.data);
    setLastSuccessfulSyncAt(workspaceId, null);
    // 5) Idempotency: skip network if hash unchanged
    const newHashHex = await hashTaxProfile(valid.data);
    const existingHash = await loadTaxProfileHash(workspaceId);
    if (existingHash && existingHash === newHashHex) {
        return valid.data;
    }
    // 6) If offline → enqueue mutation
    if (!navigator.onLine) {
        await offlineQueue.enqueue({
            id: crypto.randomUUID(),
            ts: Date.now(),
            endpoint: `${API_ENDPOINTS.taxProfile.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
            method: "POST",
            body: valid.data
        });
        await saveTaxProfileHash(workspaceId, newHashHex);
        return valid.data;
    }
    // 7) Online → send to backend
    try {
        const res = await apiSaveTaxProfile(workspaceId, valid.data);
        const saved = normalizeResponse(res);
        const finalParsed = safeSchemaParse(TaxProfile.Schema, saved);
        if (!finalParsed.success)
            throw finalParsed.error;
        await saveTaxProfileCache(workspaceId, finalParsed.data);
        await saveTaxProfileHash(workspaceId, newHashHex);
        setLastSuccessfulSyncAt(workspaceId, Date.now());
        return finalParsed.data;
    }
    catch (err) {
        if (!shouldQueueOfflineMutation(err)) {
            throw err;
        }
        await offlineQueue.enqueue({
            id: crypto.randomUUID(),
            ts: Date.now(),
            endpoint: `${API_ENDPOINTS.taxProfile.post}?workspaceId=${encodeURIComponent(workspaceId)}`,
            method: "POST",
            body: valid.data
        });
        await saveTaxProfileHash(workspaceId, newHashHex);
        return valid.data;
    }
}

export async function applyReplaySuccess(workspaceId: WorkspaceId, response: unknown): Promise<TaxProfileLoadResult> {
    const normalized = normalizeResponse(response);
    const parsed = safeSchemaParse(TaxProfile.Schema, normalized);
    if (!parsed.success) {
        throw parsed.error;
    }
    const syncedAt = Date.now();
    await saveTaxProfileCache(workspaceId, parsed.data, {
        lastSuccessfulSyncAt: syncedAt,
        localUpdatedAt: syncedAt,
    });
    await saveTaxProfileHash(workspaceId, await hashTaxProfile(parsed.data));
    setLastSuccessfulSyncAt(workspaceId, syncedAt);
    return {
        data: parsed.data,
        lastSuccessfulSyncAt: syncedAt,
        localUpdatedAt: syncedAt,
        source: "backend",
        didFetch: true,
    };
}

export async function applyReplayFailure(workspaceId: WorkspaceId): Promise<void> {
    setLastSuccessfulSyncAt(workspaceId, null);
    await clearTaxProfileHash(workspaceId);
}

export function getTaxProfileReplayFailureFeedback(error: unknown): {
    title: string;
    description: string;
} {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return {
            title: "Tax profile needs attention",
            description: "A queued tax profile change could not sync because your session needs attention. Sign in again, then review your tax profile.",
        };
    }
    if (error instanceof ApiError && error.status === 400) {
        return {
            title: "Tax profile needs attention",
            description: "A queued tax profile change is no longer valid. Review your tax profile and save again.",
        };
    }
    if (error instanceof ApiError && error.status === 409) {
        return {
            title: "Tax profile needs attention",
            description: "A queued tax profile change conflicted with newer tax data. Review your tax profile and save again.",
        };
    }
    return {
        title: "Tax profile needs attention",
        description: "A queued tax profile change could not be synced. Review your tax profile and try again.",
    };
}
// ------------------------------------------------------------
// GETTERS (UPDATED TO REMOVE storage.*)
// ------------------------------------------------------------
export async function getTaxProfile(workspaceId: WorkspaceId) {
    const profile = await loadTaxProfileCache(workspaceId);
    let parsed: SchemaParseResult<typeof TaxProfile.Schema>;
    if (profile) {
        parsed = safeSchemaParse(TaxProfile.Schema, profile);
    }
    else {
        parsed = { success: true, data: null as any };
    }
    if (parsed.success)
        return parsed.data;
    return null;
}
// ------------------------------------------------------------
// CLEAR & INVALIDATE (UPDATED TO REMOVE storage.*)
// ------------------------------------------------------------
export async function clear(workspaceId?: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    await clearTaxProfileCache(workspaceId);
}
export async function invalidate(workspaceId: WorkspaceId): Promise<TaxProfile.Type | null> {
    clearSyncMetadata(workspaceId);
    await clearTaxProfileCache(workspaceId);
    return load(workspaceId, true);
}
