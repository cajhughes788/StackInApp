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
    lastSuccessfulSyncAt: number | null;
    localUpdatedAt: number | null;
    source: "cache" | "backend";
    didFetch: boolean;
};
const PAY_STUBS_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<WorkspaceId, Promise<PayStubsLoadResult>>();
const lastSuccessfulSyncAtByWorkspace = new Map<WorkspaceId, number | null>();
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
function getLastSuccessfulSyncAt(workspaceId: WorkspaceId): number | null {
    return lastSuccessfulSyncAtByWorkspace.get(workspaceId) ?? null;
}
function setLastSuccessfulSyncAt(workspaceId: WorkspaceId, timestamp: number | null): void {
    lastSuccessfulSyncAtByWorkspace.set(workspaceId, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId): Promise<PayStubsLoadResult> {
    return measureAsync("pay_stubs.read_cached_snapshot", async () => {
        const cached = await readPayStubsCacheRecord(workspaceId);
        if (cached === null) {
            return {
                data: [],
                lastSuccessfulSyncAt: null,
                localUpdatedAt: null,
                source: "cache",
                didFetch: false,
            };
        }
        return {
            data: cached.data,
            lastSuccessfulSyncAt: getLastSuccessfulSyncAt(workspaceId) ?? cached.lastSuccessfulSyncAt,
            localUpdatedAt: cached.localUpdatedAt,
            source: "cache",
            didFetch: false,
        };
    }, { workspaceId });
}
export function prime(workspaceId: WorkspaceId, list: PayStub.Type[], options: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
} = {}): PayStubsLoadResult {
    const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null;
    const localUpdatedAt = options.localUpdatedAt ?? Date.now();
    setLastSuccessfulSyncAt(workspaceId, lastSuccessfulSyncAt);
    void savePayStubsCache(workspaceId, list, {
        lastSuccessfulSyncAt,
        localUpdatedAt,
    });
    return {
        data: list,
        lastSuccessfulSyncAt,
        localUpdatedAt,
        source: "cache",
        didFetch: false,
    };
}
function getStubRecency(stub: PayStub.Type): number {
    const updated = stub.updatedAt ? new Date(stub.updatedAt).getTime() : 0;
    const created = stub.createdAt ? new Date(stub.createdAt).getTime() : 0;
    return Math.max(Number.isNaN(updated) ? 0 : updated, Number.isNaN(created) ? 0 : created);
}
/**
 * Upserts `incoming` into `base` by periodId. A stub never gets replaced by
 * an older copy of itself (server updatedAt), so a slow full fetch that
 * started before an entry write can't clobber the stub that write returned.
 */
export function mergePayStubs(base: PayStub.Type[], incoming: PayStub.Type[]): PayStub.Type[] {
    const byPeriodId = new Map(base.map((stub) => [stub.periodId, stub]));
    for (const stub of incoming) {
        const existing = byPeriodId.get(stub.periodId);
        if (!existing || getStubRecency(stub) >= getStubRecency(existing)) {
            byPeriodId.set(stub.periodId, stub);
        }
    }
    return [...byPeriodId.values()].sort((a, b) => String(b.periodStart ?? "").localeCompare(String(a.periodStart ?? "")));
}
/**
 * Full-list counterpart of mergePayStubs: `fresh` decides which periods
 * exist, but any period `local` holds a newer copy of wins.
 */
export function reconcileFetchedPayStubs(fresh: PayStub.Type[], local: PayStub.Type[]): PayStub.Type[] {
    const localByPeriodId = new Map(local.map((stub) => [stub.periodId, stub]));
    let changed = false;
    const next = fresh.map((stub) => {
        const localStub = localByPeriodId.get(stub.periodId);
        if (localStub && getStubRecency(localStub) > getStubRecency(stub)) {
            changed = true;
            return localStub;
        }
        return stub;
    });
    return changed ? next : fresh;
}
/** Applies mutation-returned stubs to the persisted cache only (used when
 * the store hasn't loaded this workspace yet). No-op without a cache. */
export async function mergeIntoCache(workspaceId: WorkspaceId, stubs: PayStub.Type[]): Promise<void> {
    const record = await readPayStubsCacheRecord(workspaceId);
    if (!record) return;
    await savePayStubsCache(workspaceId, mergePayStubs(record.data, stubs), {
        lastSuccessfulSyncAt: record.lastSuccessfulSyncAt,
        localUpdatedAt: Date.now(),
    });
}
export function clearSyncMetadata(workspaceId?: WorkspaceId): void {
    if (!workspaceId) {
        lastSuccessfulSyncAtByWorkspace.clear();
        return;
    }
    lastSuccessfulSyncAtByWorkspace.delete(workspaceId);
}
async function fetchBackend(workspaceId: WorkspaceId): Promise<PayStubsLoadResult> {
    return measureAsync("pay_stubs.fetch_backend", async () => {
        const res = await apiGetPayStubs(workspaceId);
        const list = normalizeResponse(res);
        const parsed = safeSchemaParse(PayStub.Schema.array(), list);
        if (!parsed.success) {
            throw parsed.error;
        }
        const syncedAt = Date.now();
        await savePayStubsCache(workspaceId, parsed.data, {
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
export async function ensureLoaded(workspaceId: WorkspaceId, options: {
    forceBackend?: boolean;
} = {}): Promise<PayStubsLoadResult> {
    const existing = inFlightLoads.get(workspaceId);
    if (existing) {
        if (options.forceBackend !== true)
            return existing;
        // A forced load must observe writes newer than the in-flight request
        // (e.g. a post-confirm refresh while a pre-confirm fetch is still
        // running) — wait it out, then fetch again so this result lands last.
        return existing.catch(() => undefined).then(() => ensureLoaded(workspaceId, options));
    }
    const task = (async (): Promise<PayStubsLoadResult> => {
        const timer = startPerfTimer("pay_stubs.ensure_loaded", {
            workspaceId,
            forceBackend: options.forceBackend === true,
        });
        const cached = await readCachedSnapshot(workspaceId);
        const forceBackend = options.forceBackend === true;
        const isFresh = cached.lastSuccessfulSyncAt !== null &&
            Date.now() - cached.lastSuccessfulSyncAt <= PAY_STUBS_BACKEND_TTL_MS;
        const hasCache = cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null;
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
 * invalidate — zeroes the TTL timestamp (both in-memory + IndexedDB)
 * without discarding cached data or eagerly refetching. The next
 * ensureLoaded call will skip the freshness check and fetch fresh
 * data, but cached stubs stay visible in the UI until that completes.
 *
 * Deliberately lazy (mirrors profitLossService.invalidate): an eager
 * fetch here would race the reconcile-time invalidate call from the
 * same mutation, and an earlier (pre-confirm) fetch resolving after
 * the later (post-confirm) one would clobber fresh data with stale.
 * ------------------------------------------------------------
 */
export async function invalidate(workspaceId: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    const record = await readPayStubsCacheRecord(workspaceId);
    if (!record) return;
    await savePayStubsCache(workspaceId, record.data, {
        lastSuccessfulSyncAt: null,
        localUpdatedAt: record.localUpdatedAt,
    });
}
