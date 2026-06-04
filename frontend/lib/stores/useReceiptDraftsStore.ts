"use client";

import { create } from "zustand";

import type { WorkspaceId } from "@shared/contracts/workspace";
import type {
  ReceiptDraft,
  ReceiptDraftInput,
  ReceiptDraftPatch,
} from "@shared/schemas/receiptDraft";

import {
  createReceiptDraft as createReceiptDraftApi,
  updateReceiptDraft as updateReceiptDraftApi,
} from "@/lib/api/receiptDraftsApi";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import * as receiptDraftsService from "@/lib/domain/receiptDraftsService";
import { startPerfTimer } from "@/lib/observability/perf";
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

type ReceiptDraftsWorkspaceState = {
  drafts: ReceiptDraft[];
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
  hasHydrated: boolean;
};

type ReceiptDraftsStoreState = {
  byWorkspaceId: Record<WorkspaceId, ReceiptDraftsWorkspaceState>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
  hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>;
  refreshDrafts: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>;
  createDraft: (
    workspaceId: WorkspaceId,
    body: ReceiptDraftInput
  ) => Promise<ReceiptDraft>;
  applyDraft: (workspaceId: WorkspaceId, draft: ReceiptDraft) => void;
  patchDraftLocally: (
    workspaceId: WorkspaceId,
    receiptDraftId: string,
    patch: ReceiptDraftPatch
  ) => void;
  updateDraft: (
    workspaceId: WorkspaceId,
    receiptDraftId: string,
    patch: ReceiptDraftPatch
  ) => Promise<ReceiptDraft>;
  removeDraftsForReceiptAsset: (
    workspaceId: WorkspaceId,
    receiptAssetId: string
  ) => void;
  clear: (workspaceId?: WorkspaceId) => void;
};

const getWorkspaceState = (
  byWorkspaceId: Record<WorkspaceId, ReceiptDraftsWorkspaceState>,
  workspaceId: WorkspaceId
): ReceiptDraftsWorkspaceState =>
  byWorkspaceId[workspaceId] ?? {
    drafts: [],
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
    hasHydrated: false,
  };

function toSyncMeta(entry: ReceiptDraftsWorkspaceState): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: ReceiptDraftsWorkspaceState,
  nextMeta: ResourceSyncMeta
): Partial<ReceiptDraftsWorkspaceState> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

const mergeReceiptDraft = (
  draft: ReceiptDraft,
  patch: ReceiptDraftPatch
): ReceiptDraft => ({
  ...draft,
  ...patch,
  completion: patch.completion
    ? {
        ...draft.completion,
        ...patch.completion,
        missingFields: patch.completion.missingFields ?? draft.completion.missingFields,
        readyToCommit: patch.completion.readyToCommit ?? draft.completion.readyToCommit,
      }
    : draft.completion,
  updatedAt: new Date().toISOString(),
});

/**
 * Determines whether two draft records refer to the same logical receipt capture.
 *
 * WHY DUAL-KEY MATCHING EXISTS
 * When the user takes a photo, an optimistic draft is written to the store
 * immediately using the client-generated receipt asset ID as both its `id` and
 * its `receiptAssetId`. A few seconds later the backend responds with a real
 * persisted draft whose `id` is a Firestore-generated key — different from the
 * optimistic ID — but whose `receiptAssetId` is the same client-generated value.
 *
 * Matching on `id` alone would cause the store to keep both: the optimistic shell
 * and the real draft would coexist as duplicates. Matching on `receiptAssetId`
 * when IDs differ lets the merge replace the optimistic draft with the server
 * draft without needing a separate "finalize" step.
 *
 * INVARIANT
 * Every receipt capture produces exactly one draft per `receiptAssetId`. This
 * function assumes that invariant holds. If a draft is ever created without a
 * `receiptAssetId`, it will only match by `id` — the `receiptAssetId` fallback
 * is skipped for empty/missing values to avoid false positives.
 */
function matchesDraftIdentity(left: ReceiptDraft, right: ReceiptDraft): boolean {
  if (left.id === right.id) {
    return true;
  }

  return (
    typeof left.receiptAssetId === "string" &&
    left.receiptAssetId.length > 0 &&
    left.receiptAssetId === right.receiptAssetId
  );
}

/**
 * Merges a fresh server snapshot with the drafts currently in the store.
 *
 * WHY THIS EXISTS
 * A server refresh (or cache hydration) returns a point-in-time snapshot.
 * Naively replacing the store's draft list with that snapshot would discard
 * two categories of locally-held state:
 *
 * 1. Optimistic drafts — created locally during an active capture and not yet
 *    present in Firestore. Replacing them would make the in-progress capture
 *    disappear from the UI.
 *
 * 2. Local edits that arrived after the snapshot was taken — e.g. the user
 *    edited a field while the backend fetch was in-flight. The server response
 *    carries an older `updatedAt`; blindly applying it would revert the user's
 *    change.
 *
 * MERGE RULES
 * - For each draft in the incoming snapshot, find its local counterpart via
 *   `matchesDraftIdentity`. If the local copy is newer (`updatedAt` comparison),
 *   keep the local copy; otherwise take the server copy.
 * - Any local draft with no match in the snapshot is preserved as-is. It is
 *   either an optimistic draft mid-flight, or a draft whose server write has not
 *   yet propagated to the snapshot source.
 */
function mergeSnapshotWithActiveSessions(
  _workspaceId: WorkspaceId,
  currentDrafts: ReceiptDraft[],
  incomingDrafts: ReceiptDraft[]
): ReceiptDraft[] {
  const matchedCurrentDraftIds = new Set<string>();

  const mergedDrafts = incomingDrafts.map((incomingDraft) => {
    const matchedCurrentDraft = currentDrafts.find((candidate) =>
      matchesDraftIdentity(candidate, incomingDraft)
    );
    if (matchedCurrentDraft) {
      matchedCurrentDraftIds.add(matchedCurrentDraft.id);
      // Prefer locally-patched state if it is newer than what the server returned.
      if (matchedCurrentDraft.updatedAt > incomingDraft.updatedAt) {
        return matchedCurrentDraft;
      }
    }
    return incomingDraft;
  });

  // Preserve locally-created drafts not yet present in the server snapshot.
  for (const currentDraft of currentDrafts) {
    if (!matchedCurrentDraftIds.has(currentDraft.id)) {
      mergedDrafts.push(currentDraft);
    }
  }

  mergedDrafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return mergedDrafts;
}

function persistDraftState(
  workspaceId: WorkspaceId,
  drafts: ReceiptDraft[],
  currentEntry: ReceiptDraftsWorkspaceState,
  overrides: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
  } = {}
) {
  return receiptDraftsService.prime(workspaceId, drafts, {
    lastSuccessfulSyncAt:
      overrides.lastSuccessfulSyncAt ?? currentEntry.lastSuccessfulSyncAt,
    localUpdatedAt: overrides.localUpdatedAt ?? currentEntry.localUpdatedAt ?? Date.now(),
  });
}

export const useReceiptDraftsStore = create<ReceiptDraftsStoreState>((set, get) => {
  // Kept inside the closure (not module scope) so it is cleared alongside the
  // store state and doesn't survive store resets or workspace sign-outs.
  // Used by updateDraft to detect stale responses — if a newer local edit has
  // been made since the request was dispatched, the server response is discarded.
  const localEditVersionByDraftKey = new Map<string, number>();

  function getDraftKey(workspaceId: WorkspaceId, receiptDraftId: string): string {
    return `${workspaceId}:${receiptDraftId}`;
  }

  function bumpLocalEditVersion(workspaceId: WorkspaceId, receiptDraftId: string): number {
    const draftKey = getDraftKey(workspaceId, receiptDraftId);
    const nextVersion = (localEditVersionByDraftKey.get(draftKey) ?? 0) + 1;
    localEditVersionByDraftKey.set(draftKey, nextVersion);
    return nextVersion;
  }

  return {
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId) {
    if (getWorkspaceState(get().byWorkspaceId, workspaceId).hasHydrated) {
      return;
    }

    await get().hydrateFromCache(workspaceId);

    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...getWorkspaceState(state.byWorkspaceId, workspaceId),
          hasHydrated: true,
        },
      },
    }));
  },

  async hydrateFromCache(workspaceId) {
    const timer = startPerfTimer("receipt_drafts.store_hydrate_cache", {
      workspaceId,
    });
    const sessionVersion = getAuthSessionVersion();

    set((state) => {
      const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
      const hasRenderableData = currentEntry.drafts.length > 0;
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
      const cached = await receiptDraftsService.readCachedSnapshot(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      const hasCache = cached.data.length > 0 || cached.lastSuccessfulSyncAt !== null;
      if (hasCache) {
        set((state) => {
          const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
          const drafts = mergeSnapshotWithActiveSessions(
            workspaceId,
            currentEntry.drafts,
            cached.data
          );
          const primed = persistDraftState(workspaceId, drafts, currentEntry, {
            lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
            localUpdatedAt: cached.localUpdatedAt,
          });

          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                drafts: preserveStableReference(currentEntry.drafts, drafts),
                status: "ready",
                ...mergeSyncMeta(
                  currentEntry,
                  completeSync(toSyncMeta(currentEntry), {
                    source: "cache",
                    lastSuccessfulSyncAt: primed.lastSuccessfulSyncAt,
                    localUpdatedAt: primed.localUpdatedAt,
                  })
                ),
              },
            },
          };
        });
      }

      timer.success({
        draftCount: cached.data.length,
        hasBackendSync: cached.lastSuccessfulSyncAt !== null,
      });
    } catch (error) {
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentEntry,
              status: "error",
              ...mergeSyncMeta(
                currentEntry,
                failSync(toSyncMeta(currentEntry), {
                  hasRenderableData: currentEntry.drafts.length > 0,
                })
              ),
            },
          },
        };
      });

      timer.failure(
        error instanceof Error ? error : new Error("receipt drafts cache hydrate failed"),
        { workspaceId }
      );
    }
  },

  async refreshDrafts(workspaceId, opts) {
    await get().refreshFromBackend(workspaceId, opts);
  },

  async refreshFromBackend(workspaceId, opts) {
    const timer = startPerfTimer("receipt_drafts.store_refresh", {
      workspaceId,
      force: opts?.force === true,
    });
    const sessionVersion = getAuthSessionVersion();
    const force = opts?.force ?? false;
    const current = getWorkspaceState(get().byWorkspaceId, workspaceId);
    const preserveCachedView = current.drafts.length > 0;

    set((state) => {
      const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
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
      const fresh = await receiptDraftsService.ensureLoaded(workspaceId, {
        forceBackend: force,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
        const drafts = mergeSnapshotWithActiveSessions(
          workspaceId,
          currentEntry.drafts,
          fresh.data
        );
        const primed = fresh.didFetch
          ? persistDraftState(workspaceId, drafts, currentEntry, {
              lastSuccessfulSyncAt: fresh.lastSuccessfulSyncAt,
              localUpdatedAt: fresh.localUpdatedAt,
            })
          : null;
        const nextDrafts = preserveStableReference(currentEntry.drafts, drafts);
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
              drafts: nextDrafts,
              status: "ready",
              ...mergeSyncMeta(
                currentEntry,
                completeSync(toSyncMeta(currentEntry), {
                  source: resolvedSource,
                  lastSuccessfulSyncAt:
                    primed?.lastSuccessfulSyncAt ?? resolvedLastSuccessfulSyncAt,
                  localUpdatedAt: primed?.localUpdatedAt ?? resolvedLocalUpdatedAt,
                })
              ),
            },
          },
        };
      });

      timer.success({
        draftCount: fresh.data.length,
        hasBackendSync: fresh.lastSuccessfulSyncAt !== null,
      });
    } catch (error) {
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
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

      timer.failure(
        error instanceof Error ? error : new Error("receipt drafts backend refresh failed"),
        { workspaceId }
      );
    }
  },

  async createDraft(workspaceId, body) {
    const draft = await createReceiptDraftApi(workspaceId, body);
    get().applyDraft(workspaceId, draft);
    return draft;
  },

  applyDraft(workspaceId, draft) {
    // Compute localUpdatedAt before set() so we can use it in both the Zustand
    // state and the deferred IndexedDB write without needing prime()'s return value.
    const localUpdatedAt = markLocalUpdate(
      toSyncMeta(getWorkspaceState(get().byWorkspaceId, workspaceId))
    ).localUpdatedAt;

    set((state) => {
      const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
      const exists = currentEntry.drafts.some((candidate) =>
        matchesDraftIdentity(candidate, draft)
      );
      const drafts = exists
        ? currentEntry.drafts.map((candidate) =>
            matchesDraftIdentity(candidate, draft) ? draft : candidate
          )
        : [draft, ...currentEntry.drafts];

      drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            drafts: preserveStableReference(currentEntry.drafts, drafts),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: "optimistic",
                lastSuccessfulSyncAt: currentEntry.lastSuccessfulSyncAt,
                localUpdatedAt,
              })
            ),
          },
        },
      };
    });

    // Persist to IndexedDB after the synchronous state update. Reading from
    // get() in the microtask ensures we always write the latest state — if
    // multiple applyDraft calls land in the same turn, the microtasks coalesce
    // onto the most current snapshot rather than persisting stale intermediates.
    queueMicrotask(() => {
      const entry = getWorkspaceState(get().byWorkspaceId, workspaceId);
      void receiptDraftsService.prime(workspaceId, entry.drafts, {
        lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
        localUpdatedAt: entry.localUpdatedAt ?? Date.now(),
      });
    });
  },

  patchDraftLocally(workspaceId, receiptDraftId, patch) {
    bumpLocalEditVersion(workspaceId, receiptDraftId);

    const localUpdatedAt = markLocalUpdate(
      toSyncMeta(getWorkspaceState(get().byWorkspaceId, workspaceId))
    ).localUpdatedAt;

    set((state) => {
      const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
      const drafts = currentEntry.drafts.map((draft) =>
        draft.id === receiptDraftId ? mergeReceiptDraft(draft, patch) : draft
      );

      drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            drafts: preserveStableReference(currentEntry.drafts, drafts),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: "optimistic",
                lastSuccessfulSyncAt: currentEntry.lastSuccessfulSyncAt,
                localUpdatedAt,
              })
            ),
          },
        },
      };
    });

    // Deferred persistence — same rationale as applyDraft above.
    // patchDraftLocally is the hot path for field edits: every keypress fires it
    // immediately. Deferring to a microtask means rapid edits within the same
    // synchronous execution context coalesce into a single IndexedDB transaction.
    queueMicrotask(() => {
      const entry = getWorkspaceState(get().byWorkspaceId, workspaceId);
      void receiptDraftsService.prime(workspaceId, entry.drafts, {
        lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
        localUpdatedAt: entry.localUpdatedAt ?? Date.now(),
      });
    });
  },

  async updateDraft(workspaceId, receiptDraftId, patch) {
    const timer = startPerfTimer("receipt_drafts.update_remote", {
      workspaceId,
      receiptDraftId,
      patchKeys: Object.keys(patch).join(","),
    });
    const requestVersion =
      localEditVersionByDraftKey.get(getDraftKey(workspaceId, receiptDraftId)) ?? 0;

    try {
      const draft = await updateReceiptDraftApi(workspaceId, receiptDraftId, patch);

      const latestVersion =
        localEditVersionByDraftKey.get(getDraftKey(workspaceId, receiptDraftId)) ?? 0;
      if (latestVersion > requestVersion) {
        timer.success({
          applied: false,
          ignoredAsStale: true,
          responseVersion: draft.version,
        });
        return draft;
      }

      get().applyDraft(workspaceId, draft);
      timer.success({
        applied: true,
        ignoredAsStale: false,
        responseVersion: draft.version,
      });
      return draft;
    } catch (error) {
      timer.failure(error, {
        workspaceId,
        receiptDraftId,
      });
      throw error;
    }
  },

  removeDraftsForReceiptAsset(workspaceId, receiptAssetId) {
    const localUpdatedAt = markLocalUpdate(
      toSyncMeta(getWorkspaceState(get().byWorkspaceId, workspaceId))
    ).localUpdatedAt;

    set((state) => {
      const currentEntry = getWorkspaceState(state.byWorkspaceId, workspaceId);
      const drafts = currentEntry.drafts.filter(
        (draft) => draft.receiptAssetId !== receiptAssetId
      );

      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            drafts: preserveStableReference(currentEntry.drafts, drafts),
            status: currentEntry.status === "idle" ? "idle" : "ready",
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: "optimistic",
                lastSuccessfulSyncAt: currentEntry.lastSuccessfulSyncAt,
                localUpdatedAt,
              })
            ),
          },
        },
      };
    });

    queueMicrotask(() => {
      const entry = getWorkspaceState(get().byWorkspaceId, workspaceId);
      void receiptDraftsService.prime(workspaceId, entry.drafts, {
        lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
        localUpdatedAt: entry.localUpdatedAt ?? Date.now(),
      });
    });
  },

  clear(workspaceId) {
    if (!workspaceId) {
      localEditVersionByDraftKey.clear();
      void receiptDraftsService.clear();
      set({ byWorkspaceId: {} });
      return;
    }

    // Remove only the version entries that belong to this workspace.
    for (const key of localEditVersionByDraftKey.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        localEditVersionByDraftKey.delete(key);
      }
    }
    void receiptDraftsService.clear(workspaceId);
    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });
  },
  };
});
