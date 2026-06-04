"use client";
import { readProfitLossCacheRecord, saveProfitLossCache, clearProfitLossCache, } from "@/lib/storage/profitLossCache";
import { getProfitLossStatements as apiGetProfitLossStatements, } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { ProfitLossStatementListSchema, type ProfitLossPeriodType, type ProfitLossStatement, } from "@shared/schemas/profitLoss";
export type ProfitLossLoadResult = {
    data: ProfitLossStatement[];
    lastSuccessfulSyncAt: number | null;
    localUpdatedAt: number | null;
    source: "cache" | "backend";
    didFetch: boolean;
};
const PROFIT_LOSS_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<string, Promise<ProfitLossLoadResult>>();
const lastSuccessfulSyncAtByScope = new Map<string, number | null>();
function normalizeResponse(res: any): ProfitLossStatement[] {
    if (!res)
        return [];
    if (Array.isArray(res))
        return res;
    if (res?.statements)
        return res.statements;
    if (res?.data)
        return res.data;
    return [];
}
function makeScopeKey(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): string {
    return `${workspaceId}::${periodType}`;
}
function getLastSuccessfulSyncAt(scopeKey: string): number | null {
    return lastSuccessfulSyncAtByScope.get(scopeKey) ?? null;
}
function setLastSuccessfulSyncAt(scopeKey: string, timestamp: number | null): void {
    lastSuccessfulSyncAtByScope.set(scopeKey, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossLoadResult> {
    return measureAsync("profit_loss.read_cached_snapshot", async () => {
        const scopeKey = makeScopeKey(workspaceId, periodType);
        const cached = await readProfitLossCacheRecord(workspaceId, periodType);
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
            lastSuccessfulSyncAt: getLastSuccessfulSyncAt(scopeKey) ?? cached.lastSuccessfulSyncAt,
            localUpdatedAt: cached.localUpdatedAt,
            source: "cache",
            didFetch: false,
        };
    }, { workspaceId, periodType });
}
export function prime(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, list: ProfitLossStatement[], options: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
} = {}): ProfitLossLoadResult {
    const scopeKey = makeScopeKey(workspaceId, periodType);
    const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null;
    const localUpdatedAt = options.localUpdatedAt ?? Date.now();
    setLastSuccessfulSyncAt(scopeKey, lastSuccessfulSyncAt);
    void saveProfitLossCache(workspaceId, periodType, list, {
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
export function clearSyncMetadata(workspaceId?: WorkspaceId, periodType?: ProfitLossPeriodType): void {
    if (!workspaceId) {
        lastSuccessfulSyncAtByScope.clear();
        return;
    }
    if (periodType) {
        lastSuccessfulSyncAtByScope.delete(makeScopeKey(workspaceId, periodType));
        return;
    }
    const prefix = `${workspaceId}::`;
    for (const key of Array.from(lastSuccessfulSyncAtByScope.keys())) {
        if (key.startsWith(prefix)) {
            lastSuccessfulSyncAtByScope.delete(key);
        }
    }
}
async function fetchBackend(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossLoadResult> {
    return measureAsync("profit_loss.fetch_backend", async () => {
        const res = await apiGetProfitLossStatements(workspaceId, periodType, true);
        const list = normalizeResponse(res);
        const parsed = safeSchemaParse(ProfitLossStatementListSchema, list);
        if (!parsed.success) {
            throw parsed.error;
        }
        const syncedAt = Date.now();
        await saveProfitLossCache(workspaceId, periodType, parsed.data, {
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
        });
        setLastSuccessfulSyncAt(makeScopeKey(workspaceId, periodType), syncedAt);
        return {
            data: parsed.data,
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
            source: "backend",
            didFetch: true,
        };
    }, { workspaceId, periodType });
}
export async function ensureLoaded(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, options: {
    forceBackend?: boolean;
} = {}): Promise<ProfitLossLoadResult> {
    const scopeKey = makeScopeKey(workspaceId, periodType);
    const existing = inFlightLoads.get(scopeKey);
    if (existing)
        return existing;
    const task = (async (): Promise<ProfitLossLoadResult> => {
        const timer = startPerfTimer("profit_loss.ensure_loaded", {
            workspaceId,
            periodType,
            forceBackend: options.forceBackend === true,
        });
        const cached = await readCachedSnapshot(workspaceId, periodType);
        const forceBackend = options.forceBackend === true;
        const isFresh = cached.lastSuccessfulSyncAt !== null &&
            Date.now() - cached.lastSuccessfulSyncAt <= PROFIT_LOSS_BACKEND_TTL_MS;
        const hasCache = cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null;
        if (!forceBackend && hasCache && isFresh) {
            timer.success({ source: "cache-fresh", hasCache });
            return cached;
        }
        const result = await fetchBackend(workspaceId, periodType);
        timer.success({ source: hasCache ? "backend-stale" : "backend-miss", hasCache });
        return result;
    })();
    inFlightLoads.set(scopeKey, task);
    try {
        return await task;
    }
    finally {
        inFlightLoads.delete(scopeKey);
    }
}
export async function load(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, force = false): Promise<ProfitLossStatement[]> {
    const result = await ensureLoaded(workspaceId, periodType, {
        forceBackend: force,
    });
    return result.data;
}
export async function getCached(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossStatement[]> {
    const cached = await readProfitLossCacheRecord(workspaceId, periodType);
    return cached?.data ?? [];
}
export async function revalidate(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossStatement[]> {
    const result = await fetchBackend(workspaceId, periodType);
    return result.data;
}
// Zeroes the TTL timestamp in both layers (in-memory + IndexedDB) without
// discarding cached statement data. The next ensureLoaded call will skip the
// freshness check and fetch from the backend, but the cached statements remain
// visible in the UI while that fetch completes.
const PERIOD_TYPES: ProfitLossPeriodType[] = ["month", "quarter", "year"];

export async function invalidate(workspaceId: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    await Promise.all(
        PERIOD_TYPES.map(async (periodType) => {
            const record = await readProfitLossCacheRecord(workspaceId, periodType);
            if (!record) return;
            await saveProfitLossCache(workspaceId, periodType, record.data, {
                lastSuccessfulSyncAt: null,
                localUpdatedAt: record.localUpdatedAt,
            });
        })
    );
}

export async function clear(workspaceId?: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    await clearProfitLossCache(workspaceId);
}
