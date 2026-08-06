"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { WorkspaceId } from "@shared/contracts/workspace";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import * as expenseRepository from "@/lib/domain/expenseRepository";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as domainExpenses from "@/lib/storage/domainExpenses";
import {
  beginHydrationSync,
  beginRevalidationSync,
  completeSync,
  createResourceSyncMeta,
  failSync,
  markLocalUpdate,
  preserveStableReference,
  shouldRevalidateByTtl,
  type ResourceSyncMeta,
  type ResourceSyncState,
} from "@/lib/sync/resourceSync";

type Expense = any;

type ExpensesEntry = {
  expenses: Expense[];
  periodId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
  hasHydrated: boolean;
};

type ExpensesRenderState = {
  status: ExpensesEntry["status"];
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
};

type ExpensesStoreState = {
  byWorkspaceId: Record<WorkspaceId, ExpensesEntry>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
  hydrateFromCache: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    periodId: string,
    opts?: { force?: boolean }
  ) => Promise<void>;
  addExpense: (workspaceId: WorkspaceId, expense: Expense) => void;
  replaceExpense: (workspaceId: WorkspaceId, tempIdOrId: string, expense: Expense) => void;
  removeExpense: (workspaceId: WorkspaceId, id: string) => void;
  getExpense: (workspaceId: WorkspaceId, id: string) => Expense | undefined;
  setExpenses: (workspaceId: WorkspaceId, expenses: Expense[], periodId?: string) => void;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const EXPENSES_BACKEND_TTL_MS = 5 * 60 * 1000;
const EMPTY_EXPENSES: Expense[] = [];
const DEFAULT_EXPENSES_RENDER_STATE: ExpensesRenderState = {
  status: "idle",
  isHydrating: true,
  isRevalidating: false,
  lastSuccessfulSyncAt: null,
};

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, ExpensesEntry>,
  workspaceId: WorkspaceId
): ExpensesEntry =>
  byWorkspaceId[workspaceId] ?? {
    expenses: [],
    periodId: null,
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
    hasHydrated: false,
  };

function toSyncMeta(entry: ExpensesEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: ExpensesEntry,
  nextMeta: ResourceSyncMeta
): Partial<ExpensesEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

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
  if (!left || !right) return false;
  const leftIds = [left.id, left.tempId, left.clientMutationId].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  const rightIds = [right.id, right.tempId, right.clientMutationId].filter(
    (value) => typeof value === "string" && value.length > 0
  );
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

  const nextClientMutationId =
    typeof expense?.clientMutationId === "string" && expense.clientMutationId.length > 0
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
  if (
    typeof currentExpense?.version === "number" &&
    typeof nextExpense?.version === "number"
  ) {
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
    if (currentRecency === null) return nextExpense;
    if (nextRecency === null) return currentExpense;
    return currentRecency >= nextRecency ? currentExpense : nextExpense;
  }

  return currentExpense;
}

function mergeRenderableExpenses(
  nextExpenses: any[],
  currentExpenses: any[],
  periodId: string
): any[] {
  const relevantCurrentExpenses = currentExpenses.filter(
    (expense) => resolveExpensePeriodId(expense) === periodId
  );

  const merged = nextExpenses.map((expense) => {
    const currentMatch = relevantCurrentExpenses.find((candidate) =>
      matchesExpenseIdentity(candidate, expense)
    );
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
    const currentEntry = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    if (currentEntry.hasHydrated && currentEntry.periodId === periodId) return;

    await get().hydrateFromCache(workspaceId, periodId);

    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
          hasHydrated: true,
          periodId,
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

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const hasRenderableData =
        currentEntry.expenses.length > 0 && currentEntry.periodId === periodId;

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            periodId,
            status: hasRenderableData ? "ready" : "loading",
            ...mergeSyncMeta(
              currentEntry,
              beginHydrationSync(toSyncMeta(currentEntry), { hasRenderableData })
            ),
          },
        },
      };
    });

    try {
      const cached = await expenseRepository.readCachedSnapshot(workspaceId, periodId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("expenses-store", "cache_snapshot_loaded", {
        workspaceId,
        periodId,
        expenseCount: cached.data.length,
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
      });

      const currentEntry = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
      const mergedCachedExpenses = mergeRenderableExpenses(
        cached.data,
        currentEntry.expenses,
        periodId
      );

      if (cached.data.length === 0 && cached.lastSuccessfulSyncAt === null) {
        await get().refreshFromBackend(workspaceId, periodId, { force: true });
        return;
      }

      expenseRepository.prime(workspaceId, periodId, mergedCachedExpenses, {
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
        localUpdatedAt: cached.localUpdatedAt,
      });

      set((state) => {
        const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        // A newer hydrate/refresh call for a different period has since
        // superseded this one — don't let this late resolution clobber it.
        if (currentStateEntry.periodId !== periodId) {
          return state;
        }
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentStateEntry,
              expenses: preserveStableReference(
                currentStateEntry.expenses,
                mergedCachedExpenses
              ),
              periodId,
              status: "ready",
              ...mergeSyncMeta(
                currentStateEntry,
                completeSync(toSyncMeta(currentStateEntry), {
                  source: "cache",
                  lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
                  localUpdatedAt: cached.localUpdatedAt,
                })
              ),
            },
          },
        };
      });

      if (shouldRevalidateByTtl(cached.lastSuccessfulSyncAt, EXPENSES_BACKEND_TTL_MS)) {
        void get().refreshFromBackend(workspaceId, periodId, { force: true });
      }
    } catch (err) {
      debugError("expenses-store", "hydrate_from_cache_failed", {
        workspaceId,
        periodId,
        message:
          err instanceof Error ? err.message : "Unknown expenses hydrate error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        if (currentStateEntry.periodId !== periodId) {
          return state;
        }
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentStateEntry,
              periodId,
              status: "error",
              ...mergeSyncMeta(
                currentStateEntry,
                failSync(toSyncMeta(currentStateEntry), {
                  hasRenderableData: currentStateEntry.expenses.length > 0,
                })
              ),
            },
          },
        };
      });
    }
  },

  async refreshFromBackend(workspaceId, periodId, opts) {
    if (!periodId) return;

    const sessionVersion = getAuthSessionVersion();
    const { force = false } = opts ?? {};
    const existing = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const preserveCachedView =
      existing.expenses.length > 0 && existing.periodId === periodId;

    debugLog("expenses-store", "refresh_from_backend_start", {
      workspaceId,
      periodId,
      force,
      sessionVersion,
      preserveCachedView,
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            periodId,
            status: preserveCachedView ? "ready" : "loading",
            ...mergeSyncMeta(
              currentEntry,
              preserveCachedView
                ? beginRevalidationSync(toSyncMeta(currentEntry), { source: "backend" })
                : beginHydrationSync(toSyncMeta(currentEntry), {
                    hasRenderableData: false,
                  })
            ),
          },
        },
      };
    });

    try {
      const resolved = await expenseRepository.ensureLoaded(workspaceId, periodId, {
        forceBackend: force,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("expenses-store", "refresh_from_backend_success", {
        workspaceId,
        periodId,
        force,
        expenseCount: resolved.data.length,
        lastSuccessfulSyncAt: resolved.lastSuccessfulSyncAt,
        source: resolved.source,
        didFetch: resolved.didFetch,
      });

      const mergedResolvedExpenses = mergeRenderableExpenses(
        resolved.data,
        getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses,
        periodId
      );

      if (resolved.didFetch) {
        expenseRepository.prime(workspaceId, periodId, mergedResolvedExpenses, {
          lastSuccessfulSyncAt: resolved.lastSuccessfulSyncAt,
          localUpdatedAt: resolved.localUpdatedAt,
        });
      }

      set((state) => {
        const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        if (currentStateEntry.periodId !== periodId) {
          return state;
        }
        const nextExpenses = preserveStableReference(
          currentStateEntry.expenses,
          mergedResolvedExpenses
        );
        const resolvedSource =
          resolved.didFetch || !preserveCachedView
            ? resolved.source
            : existing.lastSyncSource ?? resolved.source;
        const resolvedLastSuccessfulSyncAt =
          resolved.didFetch || !preserveCachedView
            ? resolved.lastSuccessfulSyncAt
            : existing.lastSuccessfulSyncAt;
        const resolvedLocalUpdatedAt =
          resolved.didFetch || !preserveCachedView
            ? resolved.localUpdatedAt
            : existing.localUpdatedAt;
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentStateEntry,
              expenses: nextExpenses,
              periodId,
              status: "ready",
              ...mergeSyncMeta(
                currentStateEntry,
                completeSync(toSyncMeta(currentStateEntry), {
                  source: resolvedSource,
                  lastSuccessfulSyncAt: resolvedLastSuccessfulSyncAt,
                  localUpdatedAt: resolvedLocalUpdatedAt,
                })
              ),
            },
          },
        };
      });
    } catch (err) {
      debugError("expenses-store", "refresh_from_backend_failed", {
        workspaceId,
        periodId,
        force,
        message:
          err instanceof Error ? err.message : "Unknown expenses refresh error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        if (currentStateEntry.periodId !== periodId) {
          return state;
        }
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentStateEntry,
              periodId,
              status: preserveCachedView ? "ready" : "error",
              ...mergeSyncMeta(
                currentStateEntry,
                failSync(toSyncMeta(currentStateEntry), {
                  hasRenderableData: preserveCachedView,
                })
              ),
            },
          },
        };
      });
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
          : dedupeExpenses([expense, ...currentEntry.expenses]);

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            expenses: preserveStableReference(currentEntry.expenses, nextExpenses),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              markLocalUpdate(toSyncMeta(currentEntry), { source: "optimistic" })
            ),
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
      const remainingExpenses = currentEntry.expenses.filter(
        (entry) => !matchesReplacementTarget(entry, tempIdOrId, expense)
      );
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
            expenses: preserveStableReference(currentEntry.expenses, nextExpenses),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              markLocalUpdate(toSyncMeta(currentEntry), { source: "optimistic" })
            ),
          },
        },
      };
    });
  },

  removeExpense(workspaceId, id) {
    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const nextExpenses = currentEntry.expenses.filter(
        (entry) => entry.id !== id && entry.tempId !== id
      );

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            expenses: preserveStableReference(currentEntry.expenses, nextExpenses),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              markLocalUpdate(toSyncMeta(currentEntry), { source: "optimistic" })
            ),
          },
        },
      };
    });
  },

  getExpense(workspaceId, id) {
    return getWorkspaceEntry(get().byWorkspaceId, workspaceId).expenses.find(
      (entry) => entry.id === id || entry.tempId === id
    );
  },

  setExpenses(workspaceId, expenses, periodId) {
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const resolvedPeriodId = periodId ?? current.periodId;
    const nextLastSuccessfulSyncAt = resolvedPeriodId
      ? expenseRepository.prime(workspaceId, resolvedPeriodId, expenses, {
          lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
          localUpdatedAt: Date.now(),
        }).lastSuccessfulSyncAt
      : current.lastSuccessfulSyncAt;

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            expenses: preserveStableReference(currentEntry.expenses, expenses),
            periodId: resolvedPeriodId,
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              markLocalUpdate(
                completeSync(toSyncMeta(currentEntry), {
                  source: "optimistic",
                  lastSuccessfulSyncAt: nextLastSuccessfulSyncAt,
                  localUpdatedAt: Date.now(),
                }),
                {
                  source: "optimistic",
                }
              )
            ),
          },
        },
      };
    });
  },

  async clear(workspaceId) {
    debugLog("expenses-store", "clear_start", {
      workspaceId: workspaceId ?? null,
      workspaceIds: Object.keys(get().byWorkspaceId),
      expenseCountsByWorkspace: Object.fromEntries(
        Object.entries(get().byWorkspaceId).map(([id, entry]) => [
          id,
          entry.expenses.length,
        ])
      ),
    });

    if (!workspaceId) {
      try {
        await domainExpenses.clearAll();
        expenseRepository.clearSyncMetadata();
      } catch {}
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
    } catch {}

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

export function useExpensesData(workspaceId: WorkspaceId | null): Expense[] {
  return useExpensesStore((state) =>
    workspaceId
      ? state.byWorkspaceId[workspaceId]?.expenses ?? EMPTY_EXPENSES
      : EMPTY_EXPENSES
  );
}

export function useExpensesRenderState(
  workspaceId: WorkspaceId | null
): ExpensesRenderState {
  return useExpensesStore(
    useShallow((state) => {
      if (!workspaceId) {
        return DEFAULT_EXPENSES_RENDER_STATE;
      }

      const entry = state.byWorkspaceId[workspaceId];
      return {
        status: entry?.status ?? "idle",
        isHydrating: entry?.isHydrating ?? true,
        isRevalidating: entry?.isRevalidating ?? false,
        lastSuccessfulSyncAt: entry?.lastSuccessfulSyncAt ?? null,
      };
    })
  );
}
