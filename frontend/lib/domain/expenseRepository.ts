"use client";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { ExpenseSchema } from "@shared/schemas/expense";
import { getExpensesForPeriod } from "@/lib/api";
import { measureAsync, startPerfTimer } from "@/lib/observability/perf";
import * as domainExpenses from "@/lib/storage/domainExpenses";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugLog } from "@/lib/debugLoop";
export type ExpensesLoadResult = {
    data: any[];
    lastSuccessfulSyncAt: number | null;
    localUpdatedAt: number | null;
    source: "cache" | "backend";
    didFetch: boolean;
};
const EXPENSES_BACKEND_TTL_MS = 5 * 60 * 1000;
const inFlightLoads = new Map<string, Promise<ExpensesLoadResult>>();
const lastSuccessfulSyncAtByScopedPeriod = new Map<string, number | null>();
function makeScopedPeriodKey(workspaceId: WorkspaceId, periodId: string): string {
    return `${workspaceId}::${periodId}`;
}
function getLastSuccessfulSyncAt(scopedPeriodKey: string): number | null {
    return lastSuccessfulSyncAtByScopedPeriod.get(scopedPeriodKey) ?? null;
}
function setLastSuccessfulSyncAt(scopedPeriodKey: string, timestamp: number | null): void {
    lastSuccessfulSyncAtByScopedPeriod.set(scopedPeriodKey, timestamp);
}
export async function readCachedSnapshot(workspaceId: WorkspaceId, periodId: string): Promise<ExpensesLoadResult> {
    return measureAsync("expenses.read_cached_snapshot", async () => {
        const scopedPeriodKey = makeScopedPeriodKey(workspaceId, periodId);
        const cached = await domainExpenses.readExpensesCacheRecord(scopedPeriodKey);
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
            lastSuccessfulSyncAt: getLastSuccessfulSyncAt(scopedPeriodKey) ?? cached.lastSuccessfulSyncAt,
            localUpdatedAt: cached.localUpdatedAt,
            source: "cache",
            didFetch: false,
        };
    }, { workspaceId, periodId });
}
export async function fetchBackend(workspaceId: WorkspaceId, periodId: string): Promise<ExpensesLoadResult> {
    return measureAsync("expenses.fetch_backend", async () => {
        const sessionVersion = getAuthSessionVersion();
        const scopedPeriodKey = makeScopedPeriodKey(workspaceId, periodId);
        const backend = await getExpensesForPeriod(workspaceId, periodId);
        const parsed = safeSchemaParse(ExpenseSchema.array(), backend);
        if (!parsed.success) {
            throw parsed.error;
        }
        if (!isAuthSessionCurrent(sessionVersion)) {
            debugLog("expenses-repository", "fetch_backend_discarded_stale_session", {
                workspaceId,
                periodId,
                sessionVersion,
                currentSessionVersion: getAuthSessionVersion(),
                expenseCount: parsed.data.length,
            });
            return {
                data: parsed.data,
                lastSuccessfulSyncAt: getLastSuccessfulSyncAt(scopedPeriodKey),
                localUpdatedAt: null,
                source: "backend",
                didFetch: true,
            };
        }
        const syncedAt = Date.now();
        await domainExpenses.setExpensesForPeriod(scopedPeriodKey, parsed.data, {
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
        });
        setLastSuccessfulSyncAt(scopedPeriodKey, syncedAt);
        return {
            data: parsed.data,
            lastSuccessfulSyncAt: syncedAt,
            localUpdatedAt: syncedAt,
            source: "backend",
            didFetch: true,
        };
    }, { workspaceId, periodId });
}
export async function ensureLoaded(workspaceId: WorkspaceId, periodId: string, options: {
    forceBackend?: boolean;
} = {}): Promise<ExpensesLoadResult> {
    const scopedPeriodKey = makeScopedPeriodKey(workspaceId, periodId);
    const existing = inFlightLoads.get(scopedPeriodKey);
    if (existing)
        return existing;
    const task = (async (): Promise<ExpensesLoadResult> => {
        const timer = startPerfTimer("expenses.ensure_loaded", {
            workspaceId,
            periodId,
            forceBackend: options.forceBackend === true,
        });
        const cached = await readCachedSnapshot(workspaceId, periodId);
        const forceBackend = options.forceBackend === true;
        const hasCache = cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null;
        const isFresh = cached.lastSuccessfulSyncAt !== null &&
            Date.now() - cached.lastSuccessfulSyncAt <= EXPENSES_BACKEND_TTL_MS;
        if (!forceBackend && hasCache && isFresh) {
            timer.success({ source: "cache-fresh", hasCache });
            return cached;
        }
        const result = await fetchBackend(workspaceId, periodId);
        timer.success({ source: hasCache ? "backend-stale" : "backend-miss", hasCache });
        return result;
    })();
    inFlightLoads.set(scopedPeriodKey, task);
    try {
        return await task;
    }
    finally {
        inFlightLoads.delete(scopedPeriodKey);
    }
}
export function prime(workspaceId: WorkspaceId, periodId: string, expenses: any[], options: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
} = {}): ExpensesLoadResult {
    const scopedPeriodKey = makeScopedPeriodKey(workspaceId, periodId);
    const lastSuccessfulSyncAt = options.lastSuccessfulSyncAt ?? null;
    setLastSuccessfulSyncAt(scopedPeriodKey, lastSuccessfulSyncAt);
    void domainExpenses.setExpensesForPeriod(scopedPeriodKey, expenses, {
        lastSuccessfulSyncAt,
        localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    });
    return {
        data: expenses,
        lastSuccessfulSyncAt,
        localUpdatedAt: options.localUpdatedAt ?? Date.now(),
        source: "cache",
        didFetch: false,
    };
}
export function clearSyncMetadata(workspaceId?: WorkspaceId, periodId?: string): void {
    if (!workspaceId) {
        lastSuccessfulSyncAtByScopedPeriod.clear();
        inFlightLoads.clear();
        return;
    }
    if (periodId) {
        const scopedPeriodKey = makeScopedPeriodKey(workspaceId, periodId);
        lastSuccessfulSyncAtByScopedPeriod.delete(scopedPeriodKey);
        inFlightLoads.delete(scopedPeriodKey);
        return;
    }
    const prefix = `${workspaceId}::`;
    for (const key of Array.from(lastSuccessfulSyncAtByScopedPeriod.keys())) {
        if (key.startsWith(prefix)) {
            lastSuccessfulSyncAtByScopedPeriod.delete(key);
        }
    }
    for (const key of Array.from(inFlightLoads.keys())) {
        if (key.startsWith(prefix)) {
            inFlightLoads.delete(key);
        }
    }
}
