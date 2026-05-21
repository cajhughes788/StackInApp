"use client";
import { create } from "zustand";
import type { WorkspaceId } from "@shared/contracts/workspace";
import * as profitLossService from "@/lib/domain/profitLossService";
import type { ProfitLossPeriodType, ProfitLossStatement, } from "@shared/schemas/profitLoss";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
type ProfitLossPeriodEntry = {
    statements: ProfitLossStatement[];
    status: "idle" | "loading" | "ready" | "error";
    lastBackendSync: number | null;
    hasHydrated: boolean;
};
type ProfitLossWorkspaceEntry = Record<ProfitLossPeriodType, ProfitLossPeriodEntry>;
const makePeriodEntry = (): ProfitLossPeriodEntry => ({
    statements: [],
    status: "idle",
    lastBackendSync: null,
    hasHydrated: false,
});
const getWorkspaceEntry = (byWorkspaceId: Record<WorkspaceId, Partial<ProfitLossWorkspaceEntry>>, workspaceId: WorkspaceId, periodType: ProfitLossPeriodType): ProfitLossPeriodEntry => byWorkspaceId[workspaceId]?.[periodType] ?? makePeriodEntry();
type ProfitLossStoreState = {
    byWorkspaceId: Record<WorkspaceId, Partial<ProfitLossWorkspaceEntry>>;
    hydrateFromCacheOnce: (workspaceId: WorkspaceId, periodType: ProfitLossPeriodType) => Promise<void>;
    hydrateFromCache: (workspaceId: WorkspaceId, periodType: ProfitLossPeriodType) => Promise<void>;
    refreshFromBackend: (workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, opts?: {
        force?: boolean;
    }) => Promise<void>;
    regenerate: (workspaceId: WorkspaceId, periodType: ProfitLossPeriodType, periodKey: string) => Promise<void>;
    clear: (workspaceId?: WorkspaceId) => Promise<void>;
};
export const useProfitLossStore = create<ProfitLossStoreState>((set, get) => ({
    byWorkspaceId: {},
    async hydrateFromCacheOnce(workspaceId, periodType) {
        if (getWorkspaceEntry(get().byWorkspaceId, workspaceId, periodType).hasHydrated)
            return;
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
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...state.byWorkspaceId[workspaceId],
                    [periodType]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                        status: "loading",
                    },
                },
            },
        }));
        try {
            const cached = await profitLossService.readCachedSnapshot(workspaceId, periodType);
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...state.byWorkspaceId[workspaceId],
                        [periodType]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                            statements: cached.data,
                            status: "ready",
                            lastBackendSync: cached.lastBackendSync,
                        },
                    },
                },
            }));
        }
        catch (error) {
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...state.byWorkspaceId[workspaceId],
                        [periodType]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                            status: "error",
                        },
                    },
                },
            }));
        }
    },
    async refreshFromBackend(workspaceId, periodType, opts) {
        const sessionVersion = getAuthSessionVersion();
        const existing = getWorkspaceEntry(get().byWorkspaceId, workspaceId, periodType);
        const preserveCachedView = existing.statements.length > 0 && opts?.force !== true;
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...state.byWorkspaceId[workspaceId],
                    [periodType]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                        status: preserveCachedView ? "ready" : "loading",
                    },
                },
            },
        }));
        try {
            const fresh = await profitLossService.ensureLoaded(workspaceId, periodType, {
                forceBackend: opts?.force ?? false,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...state.byWorkspaceId[workspaceId],
                        [periodType]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                            statements: fresh.data,
                            status: "ready",
                            lastBackendSync: fresh.lastBackendSync,
                        },
                    },
                },
            }));
        }
        catch (error) {
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        ...state.byWorkspaceId[workspaceId],
                        [periodType]: {
                            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                            status: "error",
                        },
                    },
                },
            }));
        }
    },
    async regenerate(workspaceId, periodType, periodKey) {
        const statement = await profitLossService.regenerate(workspaceId, periodType, periodKey);
        const primed = profitLossService.prime(workspaceId, periodType, [
            statement,
            ...getWorkspaceEntry(get().byWorkspaceId, workspaceId, periodType).statements.filter((item) => item.id !== statement.id),
        ].sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    ...state.byWorkspaceId[workspaceId],
                    [periodType]: {
                        ...getWorkspaceEntry(state.byWorkspaceId, workspaceId, periodType),
                        statements: primed.data,
                        status: "ready",
                        lastBackendSync: primed.lastBackendSync,
                    },
                },
            },
        }));
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
