"use client";
// /lib/domain/payStubsService.ts
// ------------------------------------------------------------
// Unified PayStub domain service (NEW ARCHITECTURE)
// Cache-first, infinite TTL, schema-validated.
// No raw storage.* usage.
// ------------------------------------------------------------
import { readPayStubsCacheRecord, savePayStubsCache, clearPayStubsCache } from "@/lib/storage/payStubsCache";
import { getPayStubs as apiGetPayStubs } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { PayStub } from "@shared/schemas";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import type { WorkspaceId } from "@shared/contracts/workspace";
export type PayStubsLoadResult = {
    data: PayStub.Type[];
    lastBackendSync: number | null;
};
const PAY_STUBS_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<WorkspaceId, Promise<PayStubsLoadResult>>();
const lastBackendSyncByWorkspace = new Map<WorkspaceId, number | null>();
/**
 * Normalize possible API responses to a consistent array of PayStub.Type
 */
function normalizeResponse(res: any): PayStub.Type[] {
    if (!res)
        return [];
    if (Array.isArray(res))
        return res;
    if (res?.paystubs)
        return res.paystubs;
    if (res?.data)
        return res.data;
    return [];
}
function getLastBackendSync(workspaceId: WorkspaceId): number | null {
    return lastBackendSyncByWorkspace.get(workspaceId) ?? null;
}
function setLastBackendSync(workspaceId: WorkspaceId, timestamp: number | null): void {
    lastBackendSyncByWorkspace.set(workspaceId, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<PayStubsLoadResult> {
    return measureAsync("pay_stubs.read_cached_snapshot", async () => {
        const cached = await readPayStubsCacheRecord(workspaceId);
        if (cached === null) {
            return {
                data: [],
                lastBackendSync: null,
            };
        }
        return {
            data: cached.data,
            lastBackendSync: getLastBackendSync(workspaceId) ?? cached.cachedAt,
        };
    }, { workspaceId });
}
export function prime(workspaceId: WorkspaceId, list: PayStub.Type[], options: {
    lastBackendSync?: number | null;
} = {}): PayStubsLoadResult {
    const lastBackendSync = options.lastBackendSync ?? Date.now();
    setLastBackendSync(workspaceId, lastBackendSync);
    void savePayStubsCache(workspaceId, list);
    return {
        data: list,
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
async function fetchBackend(workspaceId: WorkspaceId): Promise<PayStubsLoadResult> {
    return measureAsync("pay_stubs.fetch_backend", async () => {
        const res = await apiGetPayStubs(workspaceId);
        const list = normalizeResponse(res);
        const parsed = safeSchemaParse(PayStub.Schema.array(), list);
        if (!parsed.success) {
            throw parsed.error;
        }
        await savePayStubsCache(workspaceId, parsed.data);
        const syncedAt = Date.now();
        setLastBackendSync(workspaceId, syncedAt);
        return {
            data: parsed.data,
            lastBackendSync: syncedAt,
        };
    }, { workspaceId });
}
export async function ensureLoaded(workspaceId: WorkspaceId, options: {
    forceBackend?: boolean;
} = {}): Promise<PayStubsLoadResult> {
    const existing = inFlightLoads.get(workspaceId);
    if (existing)
        return existing;
    const task = (async (): Promise<PayStubsLoadResult> => {
        const timer = startPerfTimer("pay_stubs.ensure_loaded", {
            workspaceId,
            forceBackend: options.forceBackend === true,
        });
        const cached = await readCachedSnapshot(workspaceId);
        const forceBackend = options.forceBackend === true;
        const isFresh = cached.lastBackendSync !== null &&
            Date.now() - cached.lastBackendSync <= PAY_STUBS_BACKEND_TTL_MS;
        const hasCache = cached.data.length > 0 || cached.lastBackendSync !== null;
        if (!forceBackend && hasCache && isFresh) {
            timer.success({ source: "cache-fresh", hasCache });
            return cached;
        }
        const result = await fetchBackend(workspaceId);
        timer.success({ source: hasCache ? "backend-stale" : "backend-miss", hasCache });
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
/**
 * ------------------------------------------------------------
 * LOAD — REWRITTEN (NEW ARCHITECTURE)
 * ------------------------------------------------------------
 * 1) Cache-first (infinite TTL)
 * 2) Fetch from backend if missing/forced
 * 3) Save canonical
 */
export async function load(workspaceId: WorkspaceId, force = false): Promise<PayStub.Type[]> {
    const result = await ensureLoaded(workspaceId, { forceBackend: force });
    return result.data;
}
/**
 * ------------------------------------------------------------
 * REVALIDATE — REWRITTEN
 * ------------------------------------------------------------
 * Always fetch fresh and overwrite cache.
 */
export async function revalidate(workspaceId: WorkspaceId): Promise<PayStub.Type[]> {
    const result = await fetchBackend(workspaceId);
    return result.data;
}
/**
 * ------------------------------------------------------------
 * getCached — REWRITTEN
 * ------------------------------------------------------------
 * Domain-storage already validated on write → no need to re-validate.
 */
export async function getCached(workspaceId: WorkspaceId): Promise<PayStub.Type[]> {
    const cached = await readPayStubsCacheRecord(workspaceId);
    return cached?.data ?? [];
}
/**
 * ------------------------------------------------------------
 * clear — REWRITTEN
 * ------------------------------------------------------------
 */
export async function clear(workspaceId?: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    await clearPayStubsCache(workspaceId);
}
/**
 * ------------------------------------------------------------
 * invalidate — only calls new clear() + load(true)
 * ------------------------------------------------------------
 */
export async function invalidate(workspaceId: WorkspaceId): Promise<PayStub.Type[]> {
    await clear(workspaceId);
    return load(workspaceId, true);
}
