"use client";
// /lib/domain/taxProfileService.ts
// ------------------------------------------------------------
// Unified cache + API adapter for TaxProfile.
// NEW ARCHITECTURE — cache-first, infinite TTL, offline queue,
// idempotent writes, no raw storage.* calls.
// ------------------------------------------------------------
import { 
// NEW — domain storage for tax profile
loadTaxProfileCache, saveTaxProfileCache, clearTaxProfileCache, loadTaxProfileHash, saveTaxProfileHash } from "@/lib/storage/taxProfileCache";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import { getTaxProfile as apiGetTaxProfile, saveTaxProfile as apiSaveTaxProfile, API_ENDPOINTS, shouldQueueOfflineMutation } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { TaxProfile } from "@shared/schemas";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { safeSchemaParse, type SchemaParseResult } from "@/lib/utils/safeSchemaParse";
export type TaxProfileLoadResult = {
    data: TaxProfile.Type | null;
    lastBackendSync: number | null;
};
const TAX_PROFILE_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<WorkspaceId, Promise<TaxProfileLoadResult>>();
const lastBackendSyncByWorkspace = new Map<WorkspaceId, number | null>();
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
function getLastBackendSync(workspaceId: WorkspaceId): number | null {
    return lastBackendSyncByWorkspace.get(workspaceId) ?? null;
}
function setLastBackendSync(workspaceId: WorkspaceId, timestamp: number | null): void {
    lastBackendSyncByWorkspace.set(workspaceId, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<TaxProfileLoadResult> {
    return measureAsync("tax_profile.read_cached_snapshot", async () => {
        const cached = await loadTaxProfileCache(workspaceId);
        if (!cached) {
            return {
                data: null,
                lastBackendSync: null,
            };
        }
        const parsed = safeSchemaParse(TaxProfile.Schema, cached);
        return {
            data: parsed.success ? parsed.data : null,
            lastBackendSync: parsed.success ? getLastBackendSync(workspaceId) : null,
        };
    }, { workspaceId });
}
export function prime(workspaceId: WorkspaceId, profile: TaxProfile.Type | null, options: {
    lastBackendSync?: number | null;
} = {}): TaxProfileLoadResult {
    const lastBackendSync = options.lastBackendSync ?? Date.now();
    setLastBackendSync(workspaceId, lastBackendSync);
    void (profile === null
        ? clearTaxProfileCache(workspaceId)
        : saveTaxProfileCache(workspaceId, profile));
    return {
        data: profile,
        lastBackendSync,
    };
}
export function clearSyncMetadata(workspaceId?: WorkspaceId): void {
    if (!workspaceId) {
        lastBackendSyncByWorkspace.clear();
        return;
    }
    lastBackendSyncByWorkspace.delete(workspaceId);
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
        const isFresh = cached.lastBackendSync !== null &&
            Date.now() - cached.lastBackendSync <= TAX_PROFILE_BACKEND_TTL_MS;
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
            setLastBackendSync(workspaceId, Date.now());
            return {
                data: null,
                lastBackendSync: getLastBackendSync(workspaceId),
            };
        }
        const parsed = safeSchemaParse(TaxProfile.Schema, data);
        if (!parsed.success) {
            await clearTaxProfileCache(workspaceId);
            setLastBackendSync(workspaceId, Date.now());
            return {
                data: null,
                lastBackendSync: getLastBackendSync(workspaceId),
            };
        }
        await saveTaxProfileCache(workspaceId, parsed.data);
        const syncedAt = Date.now();
        setLastBackendSync(workspaceId, syncedAt);
        return {
            data: parsed.data,
            lastBackendSync: syncedAt,
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
    setLastBackendSync(workspaceId, null);
    // 5) Idempotency: skip network if hash unchanged
    const newHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(valid.data)));
    const newHashHex = Array.from(new Uint8Array(newHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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
        setLastBackendSync(workspaceId, Date.now());
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
