"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { WorkspaceId } from "@shared/contracts/workspace";
import { EntryType } from "@shared/schemas/entry";

import { deleteEntry as deleteEntryApi } from "@/lib/api/entriesApi";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { matchesEntryIdentity, reconcileRenderableEntries } from "@/lib/domain/entrySync";
import * as entriesRepository from "@/lib/domain/entriesRepository";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as domainEntries from "@/lib/storage/domainEntries";
import * as entryDeletionGuards from "@/lib/storage/entryDeletionGuards";
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

type EntriesWorkspaceEntry = {
  entries: EntryType[];
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

type EntriesRenderState = {
  status: EntriesWorkspaceEntry["status"];
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
};

type EntriesStoreState = {
  byWorkspaceId: Record<WorkspaceId, EntriesWorkspaceEntry>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
  hydrateFromCache: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    periodId: string,
    opts?: { force?: boolean }
  ) => Promise<void>;
  setEntries: (
    workspaceId: WorkspaceId,
    entries: EntryType[],
    periodId?: string | null
  ) => void;
  applyEntryMutation: (
    workspaceId: WorkspaceId,
    periodId: string,
    updater: (current: EntryType[]) => EntryType[]
  ) => void;
  clear: (workspaceId?: WorkspaceId) => void;
};

const ENTRIES_BACKEND_TTL_MS = 5 * 60 * 1000;
const EMPTY_ENTRIES: EntryType[] = [];
const DEFAULT_ENTRIES_RENDER_STATE: EntriesRenderState = {
  status: "idle",
  isHydrating: true,
  isRevalidating: false,
  lastSuccessfulSyncAt: null,
};

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, EntriesWorkspaceEntry>,
  workspaceId: WorkspaceId
): EntriesWorkspaceEntry =>
  byWorkspaceId[workspaceId] ?? {
    entries: [],
    periodId: null,
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
    hasHydrated: false,
  };

function toSyncMeta(entry: EntriesWorkspaceEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: EntriesWorkspaceEntry,
  nextMeta: ResourceSyncMeta
): Partial<EntriesWorkspaceEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

async function resolveRenderableEntries(
  workspaceId: WorkspaceId,
  periodId: string,
  nextEntries: EntryType[],
  currentEntries: EntryType[]
) {
  const { visibleEntries, guardedEntries } =
    await entryDeletionGuards.splitDeletedEntries(workspaceId, nextEntries);

  const settledGuards = (await entryDeletionGuards.getDeletedEntryGuards(workspaceId)).filter(
    (guard) => {
      const hasCanonicalId = guard.identities.some(
        (identity) =>
          typeof identity.id === "string" &&
          identity.id.length > 0 &&
          !identity.id.startsWith("tmp-")
      );

      if (!hasCanonicalId) {
        return false;
      }

      const stillPresentInBackend = nextEntries.some((entry) =>
        guard.identities.some((identity) => matchesEntryIdentity(identity, entry))
      );

      return !stillPresentInBackend;
    }
  );

  for (const guard of settledGuards) {
    const canonicalIdentity =
      guard.identities.find(
        (identity) =>
          typeof identity.id === "string" &&
          identity.id.length > 0 &&
          !identity.id.startsWith("tmp-")
      ) ?? guard.identities[0];

    if (!canonicalIdentity) {
      continue;
    }

    await entryDeletionGuards.clearDeletedEntryGuard(workspaceId, canonicalIdentity);
  }

  for (const entry of guardedEntries) {
    if (!entry.id || entry.id.startsWith("tmp-")) {
      continue;
    }

    void deleteEntryApi(workspaceId, entry.id)
      .then(async (response) => {
        if (response.ok) {
          return;
        }
      })
      .catch(() => {});
  }

  return reconcileRenderableEntries(visibleEntries, currentEntries, periodId);
}

export const useEntriesStore = create<EntriesStoreState>((set, get) => ({
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId, periodId) {
    if (getWorkspaceEntry(get().byWorkspaceId, workspaceId).hasHydrated) {
      return;
    }

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
    if (!periodId) {
      return;
    }

    const sessionVersion = getAuthSessionVersion();
    const currentEntry = getWorkspaceEntry(get().byWorkspaceId, workspaceId);

    debugLog("entries-store", "hydrate_from_cache_start", {
      workspaceId,
      periodId,
      sessionVersion,
    });

    set((state) => {
      const existingEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const hasRenderableData =
        existingEntry.entries.length > 0 && existingEntry.periodId === periodId;

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...existingEntry,
            status: hasRenderableData ? "ready" : "loading",
            ...mergeSyncMeta(
              existingEntry,
              beginHydrationSync(toSyncMeta(existingEntry), { hasRenderableData })
            ),
            periodId,
          },
        },
      };
    });

    try {
      const cached = await entriesRepository.readCachedSnapshot(workspaceId, periodId);

      if (!isAuthSessionCurrent(sessionVersion)) {
        return;
      }

      debugLog("entries-store", "cache_snapshot_loaded", {
        workspaceId,
        periodId,
        entryCount: cached.data.length,
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
      });

      if (cached.data.length === 0 && cached.lastSuccessfulSyncAt === null) {
        await get().refreshFromBackend(workspaceId, periodId, { force: true });
        return;
      }

      const existingEntry = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
      const mergedCachedEntries = await resolveRenderableEntries(
        workspaceId,
        periodId,
        cached.data,
        existingEntry.entries
      );

      entriesRepository.prime(workspaceId, periodId, mergedCachedEntries, {
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
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
              entries: preserveStableReference(
                currentStateEntry.entries,
                mergedCachedEntries
              ),
              status: "ready",
              ...mergeSyncMeta(
                currentStateEntry,
                completeSync(toSyncMeta(currentStateEntry), {
                  source: "cache",
                  lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
                  localUpdatedAt: cached.localUpdatedAt,
                })
              ),
              periodId,
            },
          },
        };
      });

      if (shouldRevalidateByTtl(cached.lastSuccessfulSyncAt, ENTRIES_BACKEND_TTL_MS)) {
        void get().refreshFromBackend(workspaceId, periodId, { force: true });
      }
    } catch (err) {
      debugError("entries-store", "hydrate_from_cache_failed", {
        workspaceId,
        periodId,
        message: err instanceof Error ? err.message : "Unknown entries hydrate error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) {
        return;
      }

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
              entries: [],
              status: "error",
              ...mergeSyncMeta(
                currentStateEntry,
                failSync(toSyncMeta(currentStateEntry), {
                  hasRenderableData: false,
                })
              ),
              periodId,
            },
          },
        };
      });
    }
  },

  async refreshFromBackend(workspaceId, periodId, opts) {
    if (!periodId) {
      return;
    }

    const sessionVersion = getAuthSessionVersion();
    const { force } = opts ?? {};
    const existing = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const preserveCachedView =
      existing.entries.length > 0 && existing.periodId === periodId;

    debugLog("entries-store", "refresh_from_backend_start", {
      workspaceId,
      periodId,
      force: force ?? false,
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
                ? beginRevalidationSync(toSyncMeta(currentEntry), { source: "backend" })
                : beginHydrationSync(toSyncMeta(currentEntry), {
                    hasRenderableData: false,
                  })
            ),
            periodId,
          },
        },
      };
    });

    try {
      const result = await entriesRepository.ensureLoaded(workspaceId, periodId, {
        forceBackend: force,
      });

      if (!isAuthSessionCurrent(sessionVersion)) {
        return;
      }

      debugLog("entries-store", "refresh_from_backend_success", {
        workspaceId,
        periodId,
        entryCount: result.data.length,
        lastSuccessfulSyncAt: result.lastSuccessfulSyncAt,
        source: result.source,
        didFetch: result.didFetch,
      });

      const currentEntry = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
      const mergedEntries = await resolveRenderableEntries(
        workspaceId,
        periodId,
        result.data,
        currentEntry.entries
      );
      if (result.didFetch) {
        entriesRepository.prime(workspaceId, periodId, mergedEntries, {
          lastSuccessfulSyncAt: result.lastSuccessfulSyncAt,
        });
      }

      set((state) => {
        const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        if (currentStateEntry.periodId !== periodId) {
          return state;
        }
        const nextEntries = preserveStableReference(
          currentStateEntry.entries,
          mergedEntries
        );
        const resolvedSource =
          result.didFetch || !preserveCachedView
            ? result.source
            : existing.lastSyncSource ?? result.source;
        const resolvedLastSuccessfulSyncAt =
          result.didFetch || !preserveCachedView
            ? result.lastSuccessfulSyncAt
            : existing.lastSuccessfulSyncAt;
        const resolvedLocalUpdatedAt =
          result.didFetch || !preserveCachedView
            ? result.localUpdatedAt
            : existing.localUpdatedAt;

        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentStateEntry,
              entries: nextEntries,
              status: "ready",
              ...mergeSyncMeta(
                currentStateEntry,
                completeSync(toSyncMeta(currentStateEntry), {
                  source: resolvedSource,
                  lastSuccessfulSyncAt: resolvedLastSuccessfulSyncAt,
                  localUpdatedAt: resolvedLocalUpdatedAt,
                })
              ),
              periodId,
            },
          },
        };
      });
    } catch (err) {
      debugError("entries-store", "refresh_from_backend_failed", {
        workspaceId,
        periodId,
        message: err instanceof Error ? err.message : "Unknown entries refresh error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) {
        return;
      }

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
              status: preserveCachedView ? "ready" : "error",
              ...mergeSyncMeta(
                currentStateEntry,
                failSync(toSyncMeta(currentStateEntry), {
                  hasRenderableData: preserveCachedView,
                })
              ),
              periodId,
            },
          },
        };
      });
    }
  },

  setEntries(workspaceId, entries, periodId) {
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const nextPeriodId = periodId ?? current.periodId;
    const nextLastSuccessfulSyncAt = nextPeriodId
      ? entriesRepository.prime(workspaceId, nextPeriodId, entries, {
          lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
        }).lastSuccessfulSyncAt
      : current.lastSuccessfulSyncAt;

    set((state) => {
      const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentStateEntry,
            entries: preserveStableReference(currentStateEntry.entries, entries),
            periodId: nextPeriodId,
            status: "ready",
            ...mergeSyncMeta(
              currentStateEntry,
              markLocalUpdate(
                completeSync(toSyncMeta(currentStateEntry), {
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

  applyEntryMutation(workspaceId, periodId, updater) {
    set((state) => {
      const currentStateEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      if (currentStateEntry.periodId !== null && currentStateEntry.periodId !== periodId) {
        return state;
      }
      const next = updater(currentStateEntry.entries);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentStateEntry,
            entries: preserveStableReference(currentStateEntry.entries, next),
            periodId,
            status: "ready",
            ...mergeSyncMeta(
              currentStateEntry,
              markLocalUpdate(
                completeSync(toSyncMeta(currentStateEntry), {
                  source: "optimistic",
                  lastSuccessfulSyncAt: currentStateEntry.lastSuccessfulSyncAt,
                  localUpdatedAt: Date.now(),
                }),
                { source: "optimistic" }
              )
            ),
          },
        },
      };
    });
  },

  clear(workspaceId) {
    debugLog("entries-store", "clear_start", {
      workspaceId: workspaceId ?? null,
      workspaceIds: Object.keys(get().byWorkspaceId),
      entryCountsByWorkspace: Object.fromEntries(
        Object.entries(get().byWorkspaceId).map(([id, entry]) => [
          id,
          entry.entries.length,
        ])
      ),
    });

    if (!workspaceId) {
      void domainEntries.listCachedEntriesKeys().then(async (scopedKeys) => {
        await Promise.all(
          scopedKeys.map((scopedKey) => domainEntries.clearEntries(scopedKey))
        );
      });
      entriesRepository.clearSyncMetadata();
      set({
        byWorkspaceId: {},
      });
      debugLog("entries-store", "clear_complete", {
        workspaceId: null,
        workspaceIds: Object.keys(get().byWorkspaceId),
      });
      return;
    }

    void entriesRepository.clearWorkspaceCache(workspaceId);
    void entryDeletionGuards.clearWorkspaceDeletedEntryGuards(workspaceId);

    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });

    debugLog("entries-store", "clear_complete", {
      workspaceId,
      workspaceIds: Object.keys(get().byWorkspaceId),
    });
  },
}));

export function useEntriesData(workspaceId: WorkspaceId | null): EntryType[] {
  return useEntriesStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.entries ?? EMPTY_ENTRIES : EMPTY_ENTRIES
  );
}

export function useEntriesRenderState(
  workspaceId: WorkspaceId | null
): EntriesRenderState {
  return useEntriesStore(
    useShallow((state) => {
      if (!workspaceId) {
        return DEFAULT_ENTRIES_RENDER_STATE;
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
