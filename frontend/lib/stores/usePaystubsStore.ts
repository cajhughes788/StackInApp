"use client";
// /frontend/lib/stores/usePayStubsStore.ts
// ------------------------------------------------------------
// Zustand store for PAY STUBS ONLY.
// ------------------------------------------------------------
//
// Responsibilities:
//   • Hold canonical pay stubs per workspace
//   • Hydrate from local cache instantly
//   • Refresh from backend with TTL-based stale-while-revalidate
//   • Provide setPayStubs() for domain service updates
//
// It DOES NOT:
//   • Know about entries/settings/taxProfile
//   • Directly touch IndexedDB
//   • Perform UI logic or transformations
// ------------------------------------------------------------
import { create } from "zustand";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { PayStub } from "@shared/schemas";
import * as payStubsService from "@/lib/domain/payStubsService";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
type PayStubsEntry = {
    payStubs: PayStub.Type[];
    status: "idle" | "loading" | "ready" | "error";
    lastBackendSync: number | null;
    hasHydrated: boolean;
};
const getWorkspaceEntry = (byWorkspaceId: Record<WorkspaceId, PayStubsEntry>, workspaceId: WorkspaceId): PayStubsEntry => byWorkspaceId[workspaceId] ?? {
    payStubs: [],
    status: "idle",
    lastBackendSync: null,
    hasHydrated: false,
};
const snapshotStore = (get: any, workspaceId: WorkspaceId) => getWorkspaceEntry(get().byWorkspaceId, workspaceId);
type PayStubsStoreState = {
    byWorkspaceId: Record<WorkspaceId, PayStubsEntry>;
    hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
    hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>;
    refreshFromBackend: (workspaceId: WorkspaceId, opts?: {
        force?: boolean;
    }) => Promise<void>;
    setPayStubs: (workspaceId: WorkspaceId, list: PayStub.Type[]) => void;
    clear: (workspaceId?: WorkspaceId) => Promise<void>;
};
export const usePayStubsStore = create<PayStubsStoreState>((set, get) => ({
    byWorkspaceId: {},
    async hydrateFromCacheOnce(workspaceId: WorkspaceId) {
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
    async hydrateFromCache(workspaceId: WorkspaceId) {
        const sessionVersion = getAuthSessionVersion();
        debugLog("paystubs-store", "hydrate_from_cache_start", {
            workspaceId,
            sessionVersion,
        });
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    status: "loading",
                },
            },
        }));
        try {
            const cached = await payStubsService.readCachedSnapshot(workspaceId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("paystubs-store", "hydrate_from_cache_success", {
                workspaceId,
                count: cached.data.length,
                periodIds: cached.data.map((stub) => stub.periodId),
                lastBackendSync: cached.lastBackendSync,
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        payStubs: cached.data,
                        status: "ready",
                        lastBackendSync: cached.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("paystubs-store", "hydrate_from_cache_error", {
                workspaceId,
                error: err instanceof Error ? err.message : String(err),
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        payStubs: [],
                        status: "error",
                    },
                },
            }));
        }
    },
    async refreshFromBackend(workspaceId: WorkspaceId, opts?: {
        force?: boolean;
    }) {
        const sessionVersion = getAuthSessionVersion();
        const { force = false } = opts ?? {};
        debugLog("paystubs-store", "refresh_from_backend_start", {
            workspaceId,
            sessionVersion,
            force,
        });
        try {
            const fresh = await payStubsService.ensureLoaded(workspaceId, {
                forceBackend: force,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("paystubs-store", "refresh_from_backend_success", {
                workspaceId,
                force,
                count: fresh.data.length,
                periodIds: fresh.data.map((stub) => stub.periodId),
                lastBackendSync: fresh.lastBackendSync,
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        payStubs: fresh.data,
                        status: "ready",
                        lastBackendSync: fresh.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("paystubs-store", "refresh_from_backend_error", {
                workspaceId,
                force,
                error: err instanceof Error ? err.message : String(err),
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        status: "error",
                    },
                },
            }));
        }
    },
    setPayStubs(workspaceId: WorkspaceId, list: PayStub.Type[]) {
        const primed = payStubsService.prime(workspaceId, list);
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    payStubs: list,
                    status: "ready",
                    lastBackendSync: primed.lastBackendSync,
                },
            },
        }));
    },
    async clear(workspaceId?: WorkspaceId) {
        if (!workspaceId) {
            try {
                await payStubsService.clear();
            }
            catch (err) {
            }
            set({ byWorkspaceId: {} });
            return;
        }
        try {
            await payStubsService.clear(workspaceId);
        }
        catch (err) {
        }
        set((state) => {
            const copy = { ...state.byWorkspaceId };
            delete copy[workspaceId];
            return { byWorkspaceId: copy };
        });
    },
}));
