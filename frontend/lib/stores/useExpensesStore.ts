"use client";
import { create } from "zustand";
import type { WorkspaceId } from "@shared/contracts/workspace";
import * as domainExpenses from "@/lib/storage/domainExpenses";
import * as expenseRepository from "@/lib/domain/expenseRepository";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
type Expense = any;
type ExpensesEntry = {
    expenses: Expense[];
    periodId: string | null;
    status: "idle" | "loading" | "ready" | "error";
    lastBackendSync: number | null;
    hasHydrated: boolean;
};
type ExpensesStoreState = {
    byWorkspaceId: Record<WorkspaceId, ExpensesEntry>;
    hydrateFromCacheOnce: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
    hydrateFromCache: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
    refreshFromBackend: (workspaceId: WorkspaceId, periodId: string, opts?: {
        force?: boolean;
    }) => Promise<void>;
    addExpense: (workspaceId: WorkspaceId, expense: Expense) => void;
    replaceExpense: (workspaceId: WorkspaceId, tempIdOrId: string, expense: Expense) => void;
    removeExpense: (workspaceId: WorkspaceId, id: string) => void;
    getExpense: (workspaceId: WorkspaceId, id: string) => Expense | undefined;
    setExpenses: (workspaceId: WorkspaceId, expenses: Expense[], periodId?: string) => void;
    clear: (workspaceId?: WorkspaceId) => Promise<void>;
};
const getWorkspaceEntry = (byWorkspaceId: Record<WorkspaceId, ExpensesEntry>, workspaceId: WorkspaceId): ExpensesEntry => byWorkspaceId[workspaceId] ?? {
    expenses: [],
    periodId: null,
    status: "idle",
    lastBackendSync: null,
    hasHydrated: false,
};

function resolveExpensePeriodId(expense: any): string | null {
    if (typeof expense?.periodId === "string" && expense.periodId.length > 0) {
        return expense.periodId;
    }
    if (typeof expense?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expense.date)) {
        return expense.date.slice(0, 7);
    }
    return null;
}

function matchesExpenseIdentity(left: any, right: any): boolean {
    if (!left || !right)
        return false;
    const leftIds = [left.id, left.tempId, left.clientMutationId].filter((value) => typeof value === "string" && value.length > 0);
    const rightIds = [right.id, right.tempId, right.clientMutationId].filter((value) => typeof value === "string" && value.length > 0);
    return leftIds.some((value) => rightIds.includes(value));
}

function dedupeExpenses(expenses: any[]): any[] {
    const next: any[] = [];
    for (const expense of expenses) {
        if (next.some((entry) => matchesExpenseIdentity(entry, expense))) {
            continue;
        }
        next.push(expense);
    }
    return next;
}

function matchesReplacementTarget(entry: any, tempIdOrId: string, expense: any): boolean {
    if (entry?.id === tempIdOrId || entry?.tempId === tempIdOrId) {
        return true;
    }
    const nextClientMutationId = typeof expense?.clientMutationId === "string" && expense.clientMutationId.length > 0
        ? expense.clientMutationId
        : null;
    return nextClientMutationId !== null && entry?.clientMutationId === nextClientMutationId;
}
function isOptimisticExpense(expense: any): boolean {
    return typeof expense?.tempId === "string" && expense.tempId.startsWith("tmp-");
}
function getExpenseRecency(expense: any): number | null {
    for (const value of [
        expense?.updatedAtLocal,
        expense?.updatedAt,
        expense?.createdAtLocal,
        expense?.createdAt,
    ]) {
        if (typeof value !== "string" || value.length === 0) {
            continue;
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return null;
}
function selectPreferredExpense(currentExpense: any, nextExpense: any): any {
    const currentOptimistic = isOptimisticExpense(currentExpense);
    const nextOptimistic = isOptimisticExpense(nextExpense);
    if (currentOptimistic && !nextOptimistic) {
        return nextExpense;
    }
    if (!currentOptimistic && nextOptimistic) {
        return currentExpense;
    }
    if (typeof currentExpense?.version === "number" && typeof nextExpense?.version === "number") {
        if (currentExpense.version > nextExpense.version) {
            return currentExpense;
        }
        if (nextExpense.version > currentExpense.version) {
            return nextExpense;
        }
    }
    const currentRecency = getExpenseRecency(currentExpense);
    const nextRecency = getExpenseRecency(nextExpense);
    if (currentRecency !== null || nextRecency !== null) {
        if (currentRecency === null) {
            return nextExpense;
        }
        if (nextRecency === null) {
            return currentExpense;
        }
        if (currentRecency >= nextRecency) {
            return currentExpense;
        }
        return nextExpense;
    }
    return currentExpense;
}
function mergeRenderableExpenses(nextExpenses: any[], currentExpenses: any[], periodId: string): any[] {
    const relevantCurrentExpenses = currentExpenses.filter((expense) => resolveExpensePeriodId(expense) === periodId);
    const merged = nextExpenses.map((expense) => {
        const currentMatch = relevantCurrentExpenses.find((candidate) => matchesExpenseIdentity(candidate, expense));
        return currentMatch ? selectPreferredExpense(currentMatch, expense) : expense;
    });
    for (const expense of relevantCurrentExpenses) {
        if (merged.some((candidate) => matchesExpenseIdentity(candidate, expense))) {
            continue;
        }
        merged.push(expense);
    }
    return dedupeExpenses(merged);
}
export const useExpensesStore = create<ExpensesStoreState>((set, get) => ({
    byWorkspaceId: {},
    async hydrateFromCacheOnce(workspaceId, periodId) {
        if (getWorkspaceEntry(get().byWorkspaceId, workspaceId).hasHydrated)
            return;
        await get().hydrateFromCache(workspaceId, periodId);
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    hasHydrated: true,
                },
            },
        }));
    },
    async hydrateFromCache(workspaceId, periodId) {
        const sessionVersion = getAuthSessionVersion();
        debugLog("expenses-store", "hydrate_from_cache_start", {
            workspaceId,
            periodId,
            sessionVersion,
        });
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    periodId,
                    status: "loading",
                },
            },
        }));
        try {
            const cached = await expenseRepository.readCachedSnapshot(workspaceId, periodId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("expenses-store", "cache_snapshot_loaded", {
                workspaceId,
                periodId,
                expenseCount: cached.data.length,
                lastBackendSync: cached.lastBackendSync,
            });
            const mergedCachedExpenses = mergeRenderableExpenses(cached.data, getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses, periodId);
            if (cached.data.length > 0 || cached.lastBackendSync !== null) {
                expenseRepository.prime(workspaceId, periodId, mergedCachedExpenses, {
                    lastBackendSync: cached.lastBackendSync ?? Date.now(),
                });
                set((state) => ({
                    byWorkspaceId: {
                        ...state.byWorkspaceId,
                        [workspaceId]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                            expenses: mergedCachedExpenses,
                            periodId,
                            status: "ready",
                            lastBackendSync: cached.lastBackendSync,
                        },
                    },
                }));
            }
            const resolved = await expenseRepository.ensureLoaded(workspaceId, periodId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("expenses-store", "hydrate_from_cache_success", {
                workspaceId,
                periodId,
                expenseCount: resolved.data.length,
                lastBackendSync: resolved.lastBackendSync,
            });
            const mergedResolvedExpenses = mergeRenderableExpenses(resolved.data, getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses, periodId);
            expenseRepository.prime(workspaceId, periodId, mergedResolvedExpenses, {
                lastBackendSync: resolved.lastBackendSync ?? Date.now(),
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        expenses: mergedResolvedExpenses,
                        periodId,
                        status: "ready",
                        lastBackendSync: resolved.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("expenses-store", "hydrate_from_cache_failed", {
                workspaceId,
                periodId,
                message: err instanceof Error ? err.message : "Unknown expenses hydrate error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        periodId,
                        status: "error",
                        lastBackendSync: getWorkspaceEntry(state.byWorkspaceId, workspaceId).lastBackendSync,
                    },
                },
            }));
        }
    },
    async refreshFromBackend(workspaceId, periodId, opts) {
        if (!periodId)
            return;
        const sessionVersion = getAuthSessionVersion();
        const { force = false } = opts ?? {};
        const existing = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
        const preserveCachedView = existing.expenses.length > 0 &&
            existing.periodId === periodId;
        debugLog("expenses-store", "refresh_from_backend_start", {
            workspaceId,
            periodId,
            force,
            sessionVersion,
            preserveCachedView,
        });
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    periodId,
                    status: preserveCachedView ? "ready" : "loading",
                },
            },
        }));
        try {
            const resolved = await expenseRepository.ensureLoaded(workspaceId, periodId, {
                forceBackend: force,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("expenses-store", "refresh_from_backend_success", {
                workspaceId,
                periodId,
                force,
                expenseCount: resolved.data.length,
                lastBackendSync: resolved.lastBackendSync,
            });
            const mergedResolvedExpenses = mergeRenderableExpenses(resolved.data, getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses, periodId);
            expenseRepository.prime(workspaceId, periodId, mergedResolvedExpenses, {
                lastBackendSync: resolved.lastBackendSync ?? Date.now(),
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        expenses: mergedResolvedExpenses,
                        periodId,
                        status: "ready",
                        lastBackendSync: resolved.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("expenses-store", "refresh_from_backend_failed", {
                workspaceId,
                periodId,
                force,
                message: err instanceof Error ? err.message : "Unknown expenses refresh error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        periodId,
                        status: "error",
                        lastBackendSync: getWorkspaceEntry(state.byWorkspaceId, workspaceId).lastBackendSync,
                    },
                },
            }));
        }
    },
    addExpense(workspaceId, expense) {
        set((state) => {
            const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
            const currentPeriodId = currentEntry.periodId;
            const expensePeriodId = resolveExpensePeriodId(expense);
            const nextExpenses =
                currentPeriodId !== null &&
                    expensePeriodId !== null &&
                    expensePeriodId !== currentPeriodId
                    ? currentEntry.expenses
                    : dedupeExpenses([
                        expense,
                        ...currentEntry.expenses,
                    ]);
            return {
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...currentEntry,
                        expenses: nextExpenses,
                        status: "ready",
                    },
                },
            };
        });
    },
    replaceExpense(workspaceId, tempIdOrId, expense) {
        set((state) => {
            const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
            const currentPeriodId = currentEntry.periodId;
            const expensePeriodId = resolveExpensePeriodId(expense);
            const remainingExpenses = currentEntry.expenses.filter((entry) => !matchesReplacementTarget(entry, tempIdOrId, expense));
            const nextExpenses =
                currentPeriodId !== null &&
                    expensePeriodId !== null &&
                    expensePeriodId !== currentPeriodId
                    ? remainingExpenses
                    : dedupeExpenses([expense, ...remainingExpenses]);
            return {
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...currentEntry,
                        expenses: nextExpenses,
                        status: "ready",
                    },
                },
            };
        });
    },
    removeExpense(workspaceId, id) {
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    expenses: getWorkspaceEntry(state.byWorkspaceId, workspaceId).expenses.filter((entry) => entry.id !== id && entry.tempId !== id),
                    status: "ready",
                },
            },
        }));
    },
    getExpense(workspaceId, id) {
        return getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses.find((entry) => entry.id === id || entry.tempId === id);
    },
    setExpenses(workspaceId, expenses, periodId) {
        const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
        const resolvedPeriodId = periodId ?? current.periodId;
        const nextLastBackendSync = resolvedPeriodId
            ? expenseRepository.prime(workspaceId, resolvedPeriodId, expenses, {
                lastBackendSync: current.lastBackendSync ?? Date.now(),
            }).lastBackendSync
            : current.lastBackendSync;
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    expenses,
                    periodId: resolvedPeriodId,
                    status: "ready",
                    lastBackendSync: nextLastBackendSync,
                },
            },
        }));
    },
    async clear(workspaceId) {
        debugLog("expenses-store", "clear_start", {
            workspaceId: workspaceId ?? null,
            workspaceIds: Object.keys(get().byWorkspaceId),
            expenseCountsByWorkspace: Object.fromEntries(Object.entries(get().byWorkspaceId).map(([id, entry]) => [id, entry.expenses.length])),
        });
        if (!workspaceId) {
            try {
                await domainExpenses.clearAll();
                expenseRepository.clearSyncMetadata();
            }
            catch (err) {
            }
            set({ byWorkspaceId: {} });
            debugLog("expenses-store", "clear_complete", {
                workspaceId: null,
                workspaceIds: Object.keys(get().byWorkspaceId),
            });
            return;
        }
        try {
            await domainExpenses.clearWorkspace(workspaceId);
            expenseRepository.clearSyncMetadata(workspaceId);
        }
        catch (err) {
        }
        set((state) => {
            const copy = { ...state.byWorkspaceId };
            delete copy[workspaceId];
            return { byWorkspaceId: copy };
        });
        debugLog("expenses-store", "clear_complete", {
            workspaceId,
            workspaceIds: Object.keys(get().byWorkspaceId),
        });
    },
}));
