"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { SettingsDocumentMeta } from "@shared/contracts/settingsSync";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { SettingsType } from "@shared/schemas/settings";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as settingsService from "@/lib/domain/settingsService";
import { writeSettingsHint } from "@/lib/storage/localSettingsHint";
import { hasSettingsPatch } from "@/lib/domain/settingsSync"
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

type SettingsEntry = {
  data: SettingsType | null;
  status: "idle" | "loading" | "ready" | "error";
  syncState: ResourceSyncState;
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
  localUpdatedAt: number | null;
  lastSyncSource: ResourceSyncMeta["lastSyncSource"];
};

type SettingsRenderState = {
  status: SettingsEntry["status"];
  isHydrating: boolean;
  isRevalidating: boolean;
  lastSuccessfulSyncAt: number | null;
};

type SettingsStoreState = {
  byWorkspaceId: Record<WorkspaceId, SettingsEntry>;
  ensureLoaded: (
    workspaceId: WorkspaceId,
    opts?: { force?: boolean }
  ) => Promise<void>;
  setSettings: (
    workspaceId: WorkspaceId,
    settings: SettingsType | null,
    options?: {
      source?: "bootstrap" | "cache" | "backend" | "optimistic" | "hint"
      remoteMeta?: SettingsDocumentMeta | null
      lastSuccessfulSyncAt?: number | null
      localUpdatedAt?: number | null
    }
  ) => void;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const getSettingsEntry = (
  byWorkspaceId: Record<WorkspaceId, SettingsEntry>,
  workspaceId: WorkspaceId
): SettingsEntry =>
  byWorkspaceId[workspaceId] ?? {
    data: null,
    status: "idle",
    ...createResourceSyncMeta(),
    isHydrating: false,
    isRevalidating: false,
  };

const DEFAULT_SETTINGS_RENDER_STATE: SettingsRenderState = {
  status: "idle",
  isHydrating: true,
  isRevalidating: false,
  lastSuccessfulSyncAt: null,
};

function toSyncMeta(entry: SettingsEntry): ResourceSyncMeta {
  return {
    syncState: entry.syncState,
    lastSuccessfulSyncAt: entry.lastSuccessfulSyncAt,
    localUpdatedAt: entry.localUpdatedAt,
    lastSyncSource: entry.lastSyncSource,
  };
}

function mergeSyncMeta(
  entry: SettingsEntry,
  nextMeta: ResourceSyncMeta
): Partial<SettingsEntry> {
  return {
    syncState: nextMeta.syncState,
    isHydrating: nextMeta.syncState === "hydrating",
    isRevalidating: nextMeta.syncState === "revalidating",
    lastSuccessfulSyncAt: nextMeta.lastSuccessfulSyncAt,
    localUpdatedAt: nextMeta.localUpdatedAt,
    lastSyncSource: nextMeta.lastSyncSource,
  };
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  byWorkspaceId: {},

  async ensureLoaded(workspaceId, opts) {
    const sessionVersion = getAuthSessionVersion();
    const existing = getSettingsEntry(get().byWorkspaceId, workspaceId);
    const force = opts?.force ?? false;

    debugLog("settings-store", "ensure_loaded_start", {
      workspaceId,
      sessionVersion,
      force,
      existingStatus: existing.status,
      hasExistingData: existing.data != null,
    });

    try {
      const cached = await settingsService.readCachedSnapshot(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      if (cached) {
        debugLog("settings-store", "cache_hit", {
          workspaceId,
          hasSettings: cached.data !== null,
          settingsKeys: cached.data ? Object.keys(cached.data) : [],
        });

        set((state) => {
          const currentEntry = getSettingsEntry(state.byWorkspaceId, workspaceId);
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                data: preserveStableReference(currentEntry.data, cached.data),
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
      } else {
        debugLog("settings-store", "cache_miss", {
          workspaceId,
        });

        set((state) => {
          const currentEntry = getSettingsEntry(state.byWorkspaceId, workspaceId);
          return {
            byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                status: currentEntry.data !== null ? "ready" : "loading",
                ...mergeSyncMeta(
                  currentEntry,
                  currentEntry.data !== null
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
      }

      const resolved = await settingsService.ensureLoaded(workspaceId, {
        forceBackend: force,
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;

      debugLog("settings-store", "ensure_loaded_success", {
        workspaceId,
        force,
        hasSettings: resolved.data !== null,
        settingsKeys: resolved.data ? Object.keys(resolved.data) : [],
        source: resolved.source,
        didFetch: resolved.didFetch,
      });

      set((state) => {
        const currentEntry = getSettingsEntry(state.byWorkspaceId, workspaceId);
        const nextData = preserveStableReference(currentEntry.data, resolved.data);
        const preserveExistingSyncMeta =
          !resolved.didFetch &&
          currentEntry.status === "ready" &&
          currentEntry.syncState === "ready";
        const resolvedSource = preserveExistingSyncMeta
          ? currentEntry.lastSyncSource ?? resolved.source
          : resolved.source;
        const resolvedLastSuccessfulSyncAt = preserveExistingSyncMeta
          ? currentEntry.lastSuccessfulSyncAt
          : resolved.lastSuccessfulSyncAt;
        const resolvedLocalUpdatedAt = preserveExistingSyncMeta
          ? currentEntry.localUpdatedAt
          : resolved.localUpdatedAt;

        if (
          nextData === currentEntry.data &&
          currentEntry.status === "ready" &&
          currentEntry.syncState === "ready" &&
          currentEntry.lastSuccessfulSyncAt === resolvedLastSuccessfulSyncAt &&
          currentEntry.localUpdatedAt === resolvedLocalUpdatedAt &&
          currentEntry.lastSyncSource === resolvedSource
        ) {
          return state;
        }

        return {
          byWorkspaceId: {
              ...state.byWorkspaceId,
              [workspaceId]: {
                ...currentEntry,
                data: nextData,
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
      debugError("settings-store", "ensure_loaded_failed", {
        workspaceId,
        force,
        message:
          err instanceof Error ? err.message : "Unknown settings store error",
        stack: err instanceof Error ? err.stack : null,
      });

      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => {
        const currentEntry = getSettingsEntry(state.byWorkspaceId, workspaceId);
        return {
          byWorkspaceId: {
            ...state.byWorkspaceId,
            [workspaceId]: {
              ...currentEntry,
              status: "error",
              ...mergeSyncMeta(
                currentEntry,
                failSync(toSyncMeta(currentEntry), {
                  hasRenderableData: currentEntry.data !== null,
                })
              ),
            },
          },
        };
      });
    }
  },

  setSettings(workspaceId, settings, options) {
    const source = options?.source ?? "cache"

    const resolved = settingsService.prime(workspaceId, settings, {
      localUpdatedAt: options?.localUpdatedAt ?? Date.now(),
      lastSuccessfulSyncAt: options?.lastSuccessfulSyncAt ?? null,
      remoteMeta: options?.remoteMeta ?? null,
      source: options?.source ?? "cache",
    });

    set((state) => {
      const currentEntry = getSettingsEntry(state.byWorkspaceId, workspaceId);
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...currentEntry,
            data: preserveStableReference(currentEntry.data, resolved.data),
            status: "ready",
            ...mergeSyncMeta(
              currentEntry,
              completeSync(toSyncMeta(currentEntry), {
                source: options?.source ?? "cache",
                lastSuccessfulSyncAt: resolved.lastSuccessfulSyncAt,
                localUpdatedAt: resolved.localUpdatedAt,
              })
            ),
          },
        },
      };
    });

    // Keep localStorage hint fresh so the next warm start can seed settings
    // synchronously. Skip writing for hint-sourced data to avoid stale loops.
    if (resolved.data !== null && options?.source !== "hint") {
      writeSettingsHint(workspaceId, resolved.data)
    }
  },

  async clear(workspaceId) {
    if (!workspaceId) {
      await settingsService.clear();
      set({ byWorkspaceId: {} });
      return;
    }

    await settingsService.clear(workspaceId);
    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });
  },
}));

export function useSettingsData(workspaceId: WorkspaceId | null): SettingsType | null {
  return useSettingsStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.data ?? null : null
  );
}

export function useSettingsRenderState(
  workspaceId: WorkspaceId | null
): SettingsRenderState {
  return useSettingsStore(
    useShallow((state) => {
      if (!workspaceId) {
        return DEFAULT_SETTINGS_RENDER_STATE;
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
