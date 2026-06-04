"use client";

import { create } from "zustand";

import type { WorkspaceId } from "@shared/contracts/workspace";
import { PayStub } from "@shared/schemas";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as payStubsService from "@/lib/domain/payStubsService";
import {
  beginHydrationSync,
  beginRevalidationSync,
  completeSync,
  createResourceSyncMeta,
  failSync,
  markLocalUpdate,
  preserveStableReference,
  type ResourceSyncMeta,
  type ResourceSyncState,
} from "@/lib/sync/resourceSync";

type PayStubsEntry = {
  payStubs: PayStub.Type[];
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
  hasHydrated: boolean;
};

type PayStubsStoreState = {
  byWorkspaceId: Record<WorkspaceId, PayStubsEntry>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
  hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>;
  setPayStubs: (workspaceId: WorkspaceId, list: PayStub.Type[]) => void;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, PayStubsEntry>,
  workspaceId: WorkspaceId
): PayStubsEntry =>
  byWorkspaceId[workspaceId] ?? {
    payStubs: [],
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
    hasHydrated: false,
  };

function toSyncMeta(entry: PayStubsEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: PayStubsEntry,
  nextMeta: ResourceSyncMeta
): Partial<PayStubsEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

export const usePayStubsStore = create<PayStubsStoreState>((set, get) => ({
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId) {
    if (getWorkspaceEntry(get().byWorkspaceId, workspaceId).hasHydrated) {
      return;
    }

    await get().hydrateFromCache(workspaceId);

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

  async hydrateFromCache(workspaceId) {
    const sessionVersion = getAuthSessionVersion();

    debugLog("paystubs-store", "hydrate_from_cache_start", {
      workspaceId,
      sessionVersion,
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const hasRenderableData = currentEntry.payStubs.length > 0;

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
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
      const cached = await payStubsService.readCachedSnapshot(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("paystubs-store", "hydrate_from_cache_success", {
        workspaceId,
        count: cached.data.length,
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
      });

      if (cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null) {
        set((state) => {
          const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                payStubs: preserveStableReference(currentEntry.payStubs, cached.data),
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
          };
        });
      }
    } catch (err) {
      debugError("paystubs-store", "hydrate_from_cache_error", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentEntry,
              status: "error",
              ...mergeSyncMeta(
                currentEntry,
                failSync(toSyncMeta(currentEntry), {
                  hasRenderableData: currentEntry.payStubs.length > 0,
                })
              ),
            },
          },
        };
      });
    }
  },

  async refreshFromBackend(workspaceId, opts) {
    const sessionVersion = getAuthSessionVersion();
    const force = opts?.force ?? false;
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const preserveCachedView = current.payStubs.length > 0;

    debugLog("paystubs-store", "refresh_from_backend_start", {
      workspaceId,
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
      };
    });

    try {
      const fresh = await payStubsService.ensureLoaded(workspaceId, {
        forceBackend: force,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("paystubs-store", "refresh_from_backend_success", {
        workspaceId,
        force,
        count: fresh.data.length,
        lastSuccessfulSyncAt: fresh.lastSuccessfulSyncAt,
        source: fresh.source,
        didFetch: fresh.didFetch,
      });

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        const nextPayStubs = preserveStableReference(
          currentEntry.payStubs,
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
              ...currentEntry,
              payStubs: nextPayStubs,
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
        };
      });
    } catch (err) {
      debugError("paystubs-store", "refresh_from_backend_error", {
        workspaceId,
        force,
        error: err instanceof Error ? err.message : String(err),
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
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
        };
      });
    }
  },

  setPayStubs(workspaceId, list) {
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const nextMeta = markLocalUpdate(toSyncMeta(current));
    const primed = payStubsService.prime(workspaceId, list, {
      lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
      localUpdatedAt: nextMeta.localUpdatedAt,
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            payStubs: preserveStableReference(currentEntry.payStubs, list),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
                completeSync(toSyncMeta(currentEntry), {
                  source: "optimistic",
                  lastSuccessfulSyncAt: primed.lastSuccessfulSyncAt,
                  localUpdatedAt: primed.localUpdatedAt,
                })
            ),
          },
        },
      };
    });
  },

  async clear(workspaceId) {
    if (!workspaceId) {
      try {
        await payStubsService.clear();
      } catch {}
      set({ byWorkspaceId: {} });
      return;
    }

    try {
      await payStubsService.clear(workspaceId);
    } catch {}

    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });
  },
}));
