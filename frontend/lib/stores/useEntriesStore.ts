"use client";
// /frontend/lib/stores/useEntriesStore.ts
// ------------------------------------------------------------
// Zustand store for ENTRIES ONLY.
// ------------------------------------------------------------
//
// Responsibilities:
//   • Hold canonical entries for the *current* pay period
//   • Track loading + last backend sync timestamp
//   • Hydrate from local cache (domainEntries)
//   • Refresh from backend and rewrite cache
//   • Expose a setEntries() hook for domain entriesService
//
// It DOES NOT:
//   • Compute work/totals
//   • Talk directly to settings
//   • Know about optimistic vs canonical logic
// ------------------------------------------------------------
import { create } from "zustand";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { EntryType } from "@shared/schemas/entry";
import * as entriesRepository from "@/lib/domain/entriesRepository";
import * as domainEntries from "@/lib/storage/domainEntries";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
type EntriesWorkspaceEntry = {
    entries: EntryType[];
    periodId: string | null;
    status: "idle" | "loading" | "ready" | "error";
    isRefreshing: boolean;
    lastBackendSync: number | null;
    hasHydrated: boolean;
};
function isOptimisticEntry(entry: EntryType): boolean {
    return (typeof entry.id === "string" && entry.id.startsWith("tmp-")) ||
        entry.syncState === "pending" ||
        entry.syncState === "queued";
}
function getEntryIdentityValues(entry: EntryType): string[] {
    return [entry.id, entry.clientMutationId].filter((value): value is string => typeof value === "string" && value.length > 0);
}
function matchesEntryIdentity(left: EntryType, right: EntryType): boolean {
    const leftIds = getEntryIdentityValues(left);
    const rightIds = getEntryIdentityValues(right);
    return leftIds.some((value) => rightIds.includes(value));
}
function getEntryRecency(entry: EntryType): number | null {
    for (const value of [entry.updatedAtLocal, entry.createdAtLocal]) {
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
function selectPreferredEntry(currentEntry: EntryType, nextEntry: EntryType): EntryType {
    const currentOptimistic = isOptimisticEntry(currentEntry);
    const nextOptimistic = isOptimisticEntry(nextEntry);
    if (currentOptimistic && !nextOptimistic) {
        return nextEntry;
    }
    if (!currentOptimistic && nextOptimistic) {
        return currentEntry;
    }
    const currentRecency = getEntryRecency(currentEntry);
    const nextRecency = getEntryRecency(nextEntry);
    if (currentRecency !== null || nextRecency !== null) {
        if (currentRecency === null) {
            return nextEntry;
        }
        if (nextRecency === null) {
            return currentEntry;
        }
        if (currentRecency >= nextRecency) {
            return currentEntry;
        }
        return nextEntry;
    }
    return nextEntry;
}
function mergeRenderableEntries(nextEntries: EntryType[], currentEntries: EntryType[], periodId: string): EntryType[] {
    const relevantCurrentEntries = currentEntries.filter((entry) => entry.periodId === periodId);
    const merged: EntryType[] = nextEntries.map((entry) => {
        const currentMatch = relevantCurrentEntries.find((candidate) => matchesEntryIdentity(candidate, entry));
        return currentMatch ? selectPreferredEntry(currentMatch, entry) : entry;
    });
    for (const entry of relevantCurrentEntries) {
        if (merged.some((candidate) => matchesEntryIdentity(candidate, entry))) {
            continue;
        }
        merged.push(entry);
    }
    return merged;
}
const getWorkspaceEntry = (byWorkspaceId: Record<WorkspaceId, EntriesWorkspaceEntry>, workspaceId: WorkspaceId): EntriesWorkspaceEntry => byWorkspaceId[workspaceId] ?? {
    entries: [],
    periodId: null,
    status: "idle",
    isRefreshing: false,
    lastBackendSync: null,
    hasHydrated: false,
};
const snapshotStore = (get: any, workspaceId: WorkspaceId) => getWorkspaceEntry(get().byWorkspaceId, workspaceId);
const ENTRIES_BACKEND_TTL_MS = 5 * 60 * 1000;
type EntriesStoreState = {
    byWorkspaceId: Record<WorkspaceId, EntriesWorkspaceEntry>;
    hydrateFromCacheOnce: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
    hydrateFromCache: (workspaceId: WorkspaceId, periodId: string) => Promise<void>;
    refreshFromBackend: (workspaceId: WorkspaceId, periodId: string, opts?: {
        force?: boolean;
    }) => Promise<void>;
    setEntries: (workspaceId: WorkspaceId, entries: EntryType[], periodId?: string | null) => void;
    clear: (workspaceId?: WorkspaceId) => void;
};
export const useEntriesStore = create<EntriesStoreState>((set, get) => ({
    // ------------------------------------------------------------
    // Initial state
    // ------------------------------------------------------------
    byWorkspaceId: {},
    // ------------------------------------------------------------
    // SESSION-SAFE hydrator — run once per app session
    // ------------------------------------------------------------
    async hydrateFromCacheOnce(workspaceId: WorkspaceId, periodId: string) {
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
    async hydrateFromCache(workspaceId: WorkspaceId, periodId: string) {
        if (!periodId)
            return;
        const sessionVersion = getAuthSessionVersion();
        debugLog("entries-store", "hydrate_from_cache_start", {
            workspaceId,
            periodId,
            sessionVersion,
        });
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    status: "loading",
                    isRefreshing: false,
                    periodId,
                },
            },
        }));
        try {
            const cached = await entriesRepository.readCachedSnapshot(workspaceId, periodId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("entries-store", "cache_snapshot_loaded", {
                workspaceId,
                periodId,
                entryCount: cached.data.length,
                lastBackendSync: cached.lastBackendSync,
            });
            // ----------------------------------------------
            // CASE A — TRUE FIRST TIME EVER (NO CACHE KEY)
            // ----------------------------------------------
            if (cached.data.length === 0 && cached.lastBackendSync === null) {
                await get().refreshFromBackend(workspaceId, periodId, { force: true });
                return;
            }
            // ----------------------------------------------
            // CASE B — CACHE EXISTS (even if empty) → VALID
            // ----------------------------------------------
            const mergedCachedEntries = mergeRenderableEntries(cached.data, getWorkspaceEntry(get().byWorkspaceId, workspaceId).entries, periodId);
            entriesRepository.prime(workspaceId, periodId, mergedCachedEntries, {
                lastBackendSync: cached.lastBackendSync ?? Date.now(),
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        entries: mergedCachedEntries,
                        status: "ready",
                        isRefreshing: false,
                        lastBackendSync: cached.lastBackendSync,
                        periodId,
                    },
                },
            }));
            const shouldRefreshInBackground = cached.lastBackendSync === null ||
                Date.now() - cached.lastBackendSync > ENTRIES_BACKEND_TTL_MS;
            if (shouldRefreshInBackground) {
                void get().refreshFromBackend(workspaceId, periodId, { force: true });
            }
        }
        catch (err) {
            debugError("entries-store", "hydrate_from_cache_failed", {
                workspaceId,
                periodId,
                message: err instanceof Error ? err.message : "Unknown entries hydrate error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        entries: [],
                        status: "error",
                        isRefreshing: false,
                        periodId,
                    },
                },
            }));
        }
    },
    // ------------------------------------------------------------
    // STEP 3 — refreshFromBackend
    // ------------------------------------------------------------
    async refreshFromBackend(workspaceId: WorkspaceId, periodId: string, opts?: {
        force?: boolean;
    }) {
        if (!periodId)
            return;
        const sessionVersion = getAuthSessionVersion();
        const { force } = opts ?? {};
        debugLog("entries-store", "refresh_from_backend_start", {
            workspaceId,
            periodId,
            force: force ?? false,
            sessionVersion,
        });
        const existing = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
        const preserveCachedView = existing.entries.length > 0 &&
            existing.periodId === periodId;
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    status: preserveCachedView ? "ready" : "loading",
                    isRefreshing: preserveCachedView,
                    periodId,
                },
            },
        }));
        try {
            const result = await entriesRepository.ensureLoaded(workspaceId, periodId, {
                forceBackend: force,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("entries-store", "refresh_from_backend_success", {
                workspaceId,
                periodId,
                entryCount: result.data.length,
                lastBackendSync: result.lastBackendSync,
            });
            const mergedEntries = mergeRenderableEntries(result.data, getWorkspaceEntry(get().byWorkspaceId, workspaceId).entries, periodId);
            entriesRepository.prime(workspaceId, periodId, mergedEntries, {
                lastBackendSync: result.lastBackendSync ?? Date.now(),
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        entries: mergedEntries,
                        status: "ready",
                        isRefreshing: false,
                        lastBackendSync: result.lastBackendSync,
                        periodId,
                    },
                },
            }));
        }
        catch (err) {
            debugError("entries-store", "refresh_from_backend_failed", {
                workspaceId,
                periodId,
                message: err instanceof Error ? err.message : "Unknown entries refresh error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        status: preserveCachedView ? "ready" : "error",
                        isRefreshing: false,
                        periodId,
                    },
                },
            }));
        }
    },
    // ------------------------------------------------------------
    // STEP 4 — setEntries
    // ------------------------------------------------------------
    setEntries(workspaceId: WorkspaceId, entries: EntryType[], periodId?: string | null) {
        const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
        const nextPeriodId = periodId ?? current.periodId;
        const nextLastBackendSync = nextPeriodId
            ? entriesRepository.prime(workspaceId, nextPeriodId, entries, {
                lastBackendSync: current.lastBackendSync ?? Date.now(),
            }).lastBackendSync
            : current.lastBackendSync;
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    entries,
                    periodId: nextPeriodId,
                    status: "ready",
                    isRefreshing: false,
                    lastBackendSync: nextLastBackendSync,
                },
            },
        }));
        ;
    },
    // ------------------------------------------------------------
    // STEP 5 — clear (REPLACED)
    // ------------------------------------------------------------
    clear(workspaceId?: WorkspaceId) {
        debugLog("entries-store", "clear_start", {
            workspaceId: workspaceId ?? null,
            workspaceIds: Object.keys(get().byWorkspaceId),
            entryCountsByWorkspace: Object.fromEntries(Object.entries(get().byWorkspaceId).map(([id, entry]) => [id, entry.entries.length])),
        });
        if (!workspaceId) {
            void domainEntries.listCachedEntriesKeys().then(async (scopedKeys) => {
                await Promise.all(scopedKeys.map((scopedKey) => domainEntries.clearEntries(scopedKey)));
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
