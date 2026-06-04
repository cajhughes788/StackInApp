"use client";

import { create } from "zustand";

import type { WorkspaceId } from "@shared/contracts/workspace";
import type {
  ProfitLossPeriodType,
  ProfitLossStatement,
} from "@shared/schemas/profitLoss";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as profitLossService from "@/lib/domain/profitLossService";
import {
  beginHydrationSync,
  beginRevalidationSync,
  completeSync,
  createResourceSyncMeta,
  failSync,
  preserveStableReference,
  type ResourceSyncMeta,
  type ResourceSyncState,
} from "@/lib/sync/resourceSync";

type ProfitLossPeriodEntry = {
  statements: ProfitLossStatement[];
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
  hasHydrated: boolean;
};

type ProfitLossWorkspaceEntry = Record<
  ProfitLossPeriodType,
  ProfitLossPeriodEntry
>;

type ProfitLossStoreState = {
  byWorkspaceId: Record<WorkspaceId, Partial<ProfitLossWorkspaceEntry>>;
  hydrateFromCacheOnce: (
    workspaceId: WorkspaceId,
    periodType: ProfitLossPeriodType
  ) => Promise<void>;
  hydrateFromCache: (
    workspaceId: WorkspaceId,
    periodType: ProfitLossPeriodType
  ) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    periodType: ProfitLossPeriodType,
    opts?: { force?: boolean }
  ) => Promise<void>;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const makePeriodEntry = (): ProfitLossPeriodEntry => ({
  statements: [],
  status: "idle",
  ...createResourceSyncMeta(),
  isHydrating: false,
  isRevalidating: false,
  hasHydrated: false,
});

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, Partial<ProfitLossWorkspaceEntry>>,
  workspaceId: WorkspaceId,
  periodType: ProfitLossPeriodType
): ProfitLossPeriodEntry =>
  byWorkspaceId[workspaceId]?.[periodType] ?? makePeriodEntry();

function toSyncMeta(entry: ProfitLossPeriodEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: ProfitLossPeriodEntry,
  nextMeta: ResourceSyncMeta
): Partial<ProfitLossPeriodEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

export const useProfitLossStore = create<ProfitLossStoreState>((set, get) => ({
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId, periodType) {
    if (getWorkspaceEntry(get().byWorkspaceId, workspaceId, periodType).hasHydrated) {
      return;
    }

    await get().hydrateFromCache(workspaceId, periodType);

    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...state.byWorkspaceId[workspaceId],
          [periodType]: {
            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
            hasHydrated: true,
          },
        },
      },
    }));
  },

  async hydrateFromCache(workspaceId, periodType) {
    const sessionVersion = getAuthSessionVersion();

    debugLog("profit-loss-store", "hydrate_from_cache_start", {
      workspaceId,
      periodType,
      sessionVersion,
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType);
      const hasRenderableData = currentEntry.statements.length > 0;

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...state.byWorkspaceId[workspaceId],
            [periodType]: {
              ...currentEntry,
              status: hasRenderableData ? "ready" : "loading",
              ...mergeSyncMeta(
                currentEntry,
                beginHydrationSync(toSyncMeta(currentEntry), { hasRenderableData })
              ),
            },
          },
        },
      };
    });

    try {
      const cached = await profitLossService.readCachedSnapshot(workspaceId, periodType);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      if (cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null) {
        set((state) => {
          const currentEntry = getWorkspaceEntry(
            state.byWorkspaceId,
            workspaceId,
            periodType
          );
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...state.byWorkspaceId[workspaceId],
                [periodType]: {
                  ...currentEntry,
                  statements: preserveStableReference(
                    currentEntry.statements,
                    cached.data
                  ),
                  status: "ready",
                  ...mergeSyncMeta(
                    currentEntry,
                    completeSync(toSyncMeta(currentEntry), {
                      source: "cache",
                      lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
                      localUpdatedAt: cached.localUpdatedAt,
                    })
                  ),
                },
              },
            },
          };
        });
      }
    } catch (error) {
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugError("profit-loss-store", "hydrate_from_cache_failed", {
        workspaceId,
        periodType,
        message: error instanceof Error ? error.message : String(error),
      });

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...state.byWorkspaceId[workspaceId],
              [periodType]: {
                ...currentEntry,
                status: "error",
                ...mergeSyncMeta(
                  currentEntry,
                  failSync(toSyncMeta(currentEntry), {
                    hasRenderableData: currentEntry.statements.length > 0,
                  })
                ),
              },
            },
          },
        };
      });
    }
  },

  async refreshFromBackend(workspaceId, periodType, opts) {
    const sessionVersion = getAuthSessionVersion();
    const force = opts?.force ?? false;
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId, periodType);
    const preserveCachedView = current.statements.length > 0;

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...state.byWorkspaceId[workspaceId],
            [periodType]: {
              ...currentEntry,
              status: preserveCachedView ? "ready" : "loading",
              ...mergeSyncMeta(
                currentEntry,
                preserveCachedView
                  ? beginRevalidationSync(toSyncMeta(currentEntry), {
                      source: "backend",
                    })
                  : beginHydrationSync(toSyncMeta(currentEntry), {
                      hasRenderableData: false,
                    })
              ),
            },
          },
        },
      };
    });

    try {
      const fresh = await profitLossService.ensureLoaded(workspaceId, periodType, {
        forceBackend: force,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceEntry(
          state.byWorkspaceId,
          workspaceId,
          periodType
        );
        const nextStatements = preserveStableReference(
          currentEntry.statements,
          fresh.data
        );
        const resolvedSource =
          fresh.didFetch || !preserveCachedView
            ? fresh.source
            : current.lastSyncSource ?? fresh.source;
        const resolvedLastSuccessfulSyncAt =
          fresh.didFetch || !preserveCachedView
            ? fresh.lastSuccessfulSyncAt
            : current.lastSuccessfulSyncAt;
        const resolvedLocalUpdatedAt =
          fresh.didFetch || !preserveCachedView
            ? fresh.localUpdatedAt
            : current.localUpdatedAt;
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...state.byWorkspaceId[workspaceId],
              [periodType]: {
                ...currentEntry,
                statements: nextStatements,
                status: "ready",
                ...mergeSyncMeta(
                  currentEntry,
                  completeSync(toSyncMeta(currentEntry), {
                    source: resolvedSource,
                    lastSuccessfulSyncAt: resolvedLastSuccessfulSyncAt,
                    localUpdatedAt: resolvedLocalUpdatedAt,
                  })
                ),
              },
            },
          },
        };
      });
    } catch (error) {
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugError("profit-loss-store", "refresh_from_backend_failed", {
        workspaceId,
        periodType,
        force,
        message: error instanceof Error ? error.message : String(error),
      });

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...state.byWorkspaceId[workspaceId],
              [periodType]: {
                ...currentEntry,
                status: preserveCachedView ? "ready" : "error",
                ...mergeSyncMeta(
                  currentEntry,
                  failSync(toSyncMeta(currentEntry), {
                    hasRenderableData: preserveCachedView,
                  })
                ),
              },
            },
          },
        };
      });
    }
  },

  async clear(workspaceId) {
    await profitLossService.clear(workspaceId);

    if (!workspaceId) {
      set({ byWorkspaceId: {} });
      return;
    }

    set((state) => {
      const next = { ...state.byWorkspaceId };
      delete next[workspaceId];
      return { byWorkspaceId: next };
    });
  },
}));
