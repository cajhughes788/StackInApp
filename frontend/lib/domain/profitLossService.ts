"use client";
import { readProfitLossCacheRecord, saveProfitLossCache, clearProfitLossCache, } from "@/lib/storage/profitLossCache";
import { getProfitLossStatements as apiGetProfitLossStatements, generateProfitLossStatement as apiGenerateProfitLossStatement, } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { ProfitLossStatementListSchema, type ProfitLossPeriodType, type ProfitLossStatement, } from "@shared/schemas/profitLoss";
export type ProfitLossLoadResult = {
    data: ProfitLossStatement[];
    lastBackendSync: number | null;
};
const PROFIT_LOSS_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<string, Promise<ProfitLossLoadResult>>();
const lastBackendSyncByScope = new Map<string, number | null>();
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
function getLastBackendSync(scopeKey: string): number | null {
    return lastBackendSyncByScope.get(scopeKey) ?? null;
}
function setLastBackendSync(scopeKey: string, timestamp: number | null): void {
    lastBackendSyncByScope.set(scopeKey, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossLoadResult> {
    return measureAsync("profit_loss.read_cached_snapshot", async () => {
        const scopeKey = makeScopeKey(workspaceId, periodType);
        const cached = await readProfitLossCacheRecord(workspaceId, periodType);
        if (cached === null) {
            return {
                data: [],
                lastBackendSync: null,
            };
        }
        return {
            data: cached.data,
            lastBackendSync: getLastBackendSync(scopeKey) ?? cached.cachedAt,
        };
    }, { workspaceId, periodType });
}
export function prime(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, list: ProfitLossStatement[], options: {
    lastBackendSync?: number | null;
} = {}): ProfitLossLoadResult {
    const scopeKey = makeScopeKey(workspaceId, periodType);
    const lastBackendSync = options.lastBackendSync ?? Date.now();
    setLastBackendSync(scopeKey, lastBackendSync);
    void saveProfitLossCache(workspaceId, periodType, list);
    return {
        data: list,
        lastBackendSync,
    };
}
export function clearSyncMetadata(workspaceId?: WorkspaceId, periodType?: ProfitLossPeriodType): void {
    if (!workspaceId) {
        lastBackendSyncByScope.clear();
        return;
    }
    if (periodType) {
        lastBackendSyncByScope.delete(makeScopeKey(workspaceId, periodType));
        return;
    }
    const prefix = `${workspaceId}::`;
    for (const key of Array.from(lastBackendSyncByScope.keys())) {
        if (key.startsWith(prefix)) {
            lastBackendSyncByScope.delete(key);
        }
    }
}
async function fetchBackend(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): Promise<ProfitLossLoadResult> {
    return measureAsync("profit_loss.fetch_backend", async () => {
        const res = await apiGetProfitLossStatements(workspaceId, periodType, false);
        const list = normalizeResponse(res);
        const parsed = safeSchemaParse(ProfitLossStatementListSchema, list);
        if (!parsed.success) {
            throw parsed.error;
        }
        await saveProfitLossCache(workspaceId, periodType, parsed.data);
        const syncedAt = Date.now();
        setLastBackendSync(makeScopeKey(workspaceId, periodType), syncedAt);
        return {
            data: parsed.data,
            lastBackendSync: syncedAt,
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
        const isFresh = cached.lastBackendSync !== null &&
            Date.now() - cached.lastBackendSync <= PROFIT_LOSS_BACKEND_TTL_MS;
        const hasCache = cached.data.length > 0 || cached.lastBackendSync !== null;
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
export async function regenerate(workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, periodKey: string): Promise<ProfitLossStatement> {
    const statement = await apiGenerateProfitLossStatement(workspaceId, periodType, periodKey, true);
    const current = await getCached(workspaceId, periodType);
    const next = [statement, ...current.filter((item) => item.id !== statement.id)].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    await saveProfitLossCache(workspaceId, periodType, next);
    setLastBackendSync(makeScopeKey(workspaceId, periodType), Date.now());
    return statement;
}
export async function clear(workspaceId?: WorkspaceId): Promise<void> {
    clearSyncMetadata(workspaceId);
    await clearProfitLossCache(workspaceId);
}
