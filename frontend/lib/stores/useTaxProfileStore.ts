"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { TaxProfile } from "@shared/schemas";
import type { WorkspaceId } from "@shared/contracts/workspace";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as taxProfileService from "@/lib/domain/taxProfileService";
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

type TaxProfileEntry = {
  taxProfile: TaxProfile.Type | null;
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
  hasHydrated: boolean;
  syncIssueMessage: string | null;
};

type TaxProfileRenderState = {
  status: TaxProfileEntry["status"];
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
};

type TaxProfileStoreState = {
  byWorkspaceId: Record<WorkspaceId, TaxProfileEntry>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
  hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>;
  refreshFromBackend: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>;
  setTaxProfile: (workspaceId: WorkspaceId, profile: TaxProfile.Type | null) => void;
  reconcileCanonicalTaxProfile: (
    workspaceId: WorkspaceId,
    profile: TaxProfile.Type,
    options: {
      lastSuccessfulSyncAt: number | null;
      localUpdatedAt: number | null;
    }
  ) => void;
  markTaxProfileSyncIssue: (workspaceId: WorkspaceId, message: string) => void;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, TaxProfileEntry>,
  workspaceId: WorkspaceId
): TaxProfileEntry =>
  byWorkspaceId[workspaceId] ?? {
    taxProfile: null,
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
    hasHydrated: false,
    syncIssueMessage: null,
  };

const DEFAULT_TAX_PROFILE_RENDER_STATE: TaxProfileRenderState = {
  status: "idle",
  isHydrating: true,
  isRevalidating: false,
  lastSuccessfulSyncAt: null,
};

function toSyncMeta(entry: TaxProfileEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: TaxProfileEntry,
  nextMeta: ResourceSyncMeta
): Partial<TaxProfileEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

export const useTaxProfileStore = create<TaxProfileStoreState>((set, get) => ({
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

    debugLog("tax-profile-store", "hydrate_from_cache_start", {
      workspaceId,
      sessionVersion,
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            status: currentEntry.taxProfile !== null ? "ready" : "loading",
            ...mergeSyncMeta(
              currentEntry,
              beginHydrationSync(toSyncMeta(currentEntry), {
                hasRenderableData: currentEntry.taxProfile !== null,
              })
            ),
          },
        },
      };
    });

    try {
      const cached = await taxProfileService.readCachedSnapshot(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("tax-profile-store", "cache_snapshot_loaded", {
        workspaceId,
        hasProfile: cached.data !== null,
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
      });

      if (cached.data !== null || cached.lastSuccessfulSyncAt !== null) {
        set((state) => {
          const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                taxProfile: preserveStableReference(
                  currentEntry.taxProfile,
                  cached.data
                ),
                status: "ready",
                syncIssueMessage: null,
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
      debugError("tax-profile-store", "hydrate_from_cache_failed", {
        workspaceId,
        message:
          err instanceof Error ? err.message : "Unknown tax profile hydrate error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentEntry,
              taxProfile: null,
              status: "error",
              ...mergeSyncMeta(
                currentEntry,
                failSync(toSyncMeta(currentEntry), {
                  hasRenderableData: false,
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
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    const preserveCachedView = current.taxProfile !== null;

    debugLog("tax-profile-store", "refresh_from_backend_start", {
      workspaceId,
      force: opts?.force ?? false,
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
          },
        },
      };
    });

    try {
      const fresh = await taxProfileService.ensureLoaded(workspaceId, {
        forceBackend: opts?.force ?? false,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("tax-profile-store", "refresh_from_backend_success", {
        workspaceId,
        hasProfile: fresh.data !== null,
        lastSuccessfulSyncAt: fresh.lastSuccessfulSyncAt,
        source: fresh.source,
        didFetch: fresh.didFetch,
      });

      set((state) => {
        const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
        const nextProfile = preserveStableReference(
          currentEntry.taxProfile,
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
              taxProfile: nextProfile,
              status: "ready",
              syncIssueMessage: null,
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
      debugError("tax-profile-store", "refresh_from_backend_failed", {
        workspaceId,
        message:
          err instanceof Error ? err.message : "Unknown tax profile refresh error",
        stack: err instanceof Error ? err.stack : null,
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

  setTaxProfile(workspaceId, profile) {
    const primed = taxProfileService.prime(workspaceId, profile, {
      localUpdatedAt: Date.now(),
    });

    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            taxProfile: preserveStableReference(currentEntry.taxProfile, profile),
            status: "ready",
            syncIssueMessage: null,
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: "bootstrap",
                lastSuccessfulSyncAt: primed.lastSuccessfulSyncAt,
                localUpdatedAt: primed.localUpdatedAt,
              })
            ),
          },
        },
      };
    });
  },

  reconcileCanonicalTaxProfile(workspaceId, profile, options) {
    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            taxProfile: preserveStableReference(currentEntry.taxProfile, profile),
            status: "ready",
            syncIssueMessage: null,
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: "backend",
                lastSuccessfulSyncAt: options.lastSuccessfulSyncAt,
                localUpdatedAt: options.localUpdatedAt,
              })
            ),
          },
        },
      };
    });
  },

  markTaxProfileSyncIssue(workspaceId, message) {
    set((state) => {
      const currentEntry = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const hasRenderableData = currentEntry.taxProfile !== null;
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            status: hasRenderableData ? "ready" : "error",
            syncIssueMessage: message,
            ...mergeSyncMeta(
              currentEntry,
              failSync(toSyncMeta(currentEntry), {
                hasRenderableData,
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
        await taxProfileService.clear();
      } catch {}
      set({ byWorkspaceId: {} });
      return;
    }

    try {
      await taxProfileService.clear(workspaceId);
    } catch {}

    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });
  },
}));

export function useTaxProfileData(
  workspaceId: WorkspaceId | null
): TaxProfile.Type | null {
  return useTaxProfileStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.taxProfile ?? null : null
  );
}

export function useTaxProfileRenderState(
  workspaceId: WorkspaceId | null
): TaxProfileRenderState {
  return useTaxProfileStore(
    useShallow((state) => {
      if (!workspaceId) {
        return DEFAULT_TAX_PROFILE_RENDER_STATE;
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
