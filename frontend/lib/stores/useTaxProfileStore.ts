"use client";
// /frontend/lib/stores/useTaxProfileStore.ts
// ------------------------------------------------------------
// Zustand store for TAX PROFILE ONLY.
// ------------------------------------------------------------
//
// Responsibilities:
//   • Hold canonical TaxProfile for the current user
//   • Hydrate from cache *instantly*
//   • Refresh from backend with TTL-based stale-while-revalidate
//   • Provide setTaxProfile() for domain service updates
//
// It DOES NOT:
//   • Know about Entries or Settings
//   • Talk directly to IndexedDB
//   • Compute any tax values
// ------------------------------------------------------------
import { create } from "zustand";
import { TaxProfile } from "@shared/schemas";
import type { WorkspaceId } from "@shared/contracts/workspace";
import * as taxProfileService from "@/lib/domain/taxProfileService";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
type TaxProfileEntry = {
    taxProfile: TaxProfile.Type | null;
    status: "idle" | "loading" | "ready" | "error";
    lastBackendSync: number | null;
    hasHydrated: boolean;
};
type TaxProfileStoreState = {
    byWorkspaceId: Record<WorkspaceId, TaxProfileEntry>;
    hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
    hydrateFromCache: (workspaceId: WorkspaceId) => Promise<void>;
    refreshFromBackend: (workspaceId: WorkspaceId, opts?: {
        force?: boolean;
    }) => Promise<void>;
    setTaxProfile: (workspaceId: WorkspaceId, profile: TaxProfile.Type | null) => void;
    clear: (workspaceId?: WorkspaceId) => Promise<void>;
};
const getWorkspaceEntry = (byWorkspaceId: Record<WorkspaceId, TaxProfileEntry>, workspaceId: WorkspaceId): TaxProfileEntry => byWorkspaceId[workspaceId] ?? {
    taxProfile: null,
    status: "idle",
    lastBackendSync: null,
    hasHydrated: false,
};
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
            const cached = await taxProfileService.readCachedSnapshot(workspaceId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("tax-profile-store", "cache_snapshot_loaded", {
                workspaceId,
                hasProfile: cached.data !== null,
                lastBackendSync: cached.lastBackendSync,
            });
            if (cached.data !== null || cached.lastBackendSync !== null) {
                set((state) => ({
                    byWorkspaceId: {
                        ...state.byWorkspaceId,
                        [workspaceId]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                            taxProfile: cached.data,
                            status: "ready",
                            lastBackendSync: cached.lastBackendSync,
                        },
                    },
                }));
            }
            const resolved = await taxProfileService.ensureLoaded(workspaceId);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("tax-profile-store", "hydrate_from_cache_success", {
                workspaceId,
                hasProfile: resolved.data !== null,
                lastBackendSync: resolved.lastBackendSync,
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        taxProfile: resolved.data,
                        status: "ready",
                        lastBackendSync: resolved.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("tax-profile-store", "hydrate_from_cache_failed", {
                workspaceId,
                message: err instanceof Error ? err.message : "Unknown tax profile hydrate error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        taxProfile: null,
                        status: "error",
                    },
                },
            }));
        }
    },
    async refreshFromBackend(workspaceId, opts) {
        const sessionVersion = getAuthSessionVersion();
        debugLog("tax-profile-store", "refresh_from_backend_start", {
            workspaceId,
            force: opts?.force ?? false,
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
            const fresh = await taxProfileService.ensureLoaded(workspaceId, {
                forceBackend: opts?.force ?? false,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("tax-profile-store", "refresh_from_backend_success", {
                workspaceId,
                hasProfile: fresh.data !== null,
                lastBackendSync: fresh.lastBackendSync,
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                        taxProfile: fresh.data,
                        status: "ready",
                        lastBackendSync: fresh.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("tax-profile-store", "refresh_from_backend_failed", {
                workspaceId,
                message: err instanceof Error ? err.message : "Unknown tax profile refresh error",
                stack: err instanceof Error ? err.stack : null,
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
    setTaxProfile(workspaceId, profile) {
        const primed = taxProfileService.prime(workspaceId, profile);
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
                    taxProfile: profile,
                    status: "ready",
                    lastBackendSync: primed.lastBackendSync,
                },
            },
        }));
    },
    async clear(workspaceId) {
        if (!workspaceId) {
            try {
                await taxProfileService.clear();
            }
            catch (err) {
            }
            set({ byWorkspaceId: {} });
            return;
        }
        try {
            await taxProfileService.clear(workspaceId);
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
