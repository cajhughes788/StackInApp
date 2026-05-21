"use client";
// /frontend/lib/stores/useSettingsStore.ts
// Workspace-aware settings store that reflects the repository state
import { create } from "zustand";
import type { WorkspaceId } from "@shared/contracts/workspace";
import { SettingsType } from "@shared/schemas/settings";
import * as settingsService from "@/lib/domain/settingsService";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
type SettingsEntry = {
    data: SettingsType | null;
    status: "idle" | "loading" | "ready" | "error";
    lastBackendSync: number | null;
};
type SettingsStoreState = {
    byWorkspaceId: Record<WorkspaceId, SettingsEntry>;
    ensureLoaded: (workspaceId: WorkspaceId, opts?: {
        force?: boolean;
    }) => Promise<void>;
    setSettings: (workspaceId: WorkspaceId, settings: SettingsType | null) => void;
    clear: (workspaceId?: WorkspaceId) => Promise<void>;
};
export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
    byWorkspaceId: {},
    async ensureLoaded(workspaceId, opts) {
        const sessionVersion = getAuthSessionVersion();
        const existing = get().byWorkspaceId[workspaceId];
        const force = opts?.force ?? false;
        debugLog("settings-store", "ensure_loaded_start", {
            workspaceId,
            sessionVersion,
            force,
            existingStatus: existing?.status ?? "idle",
            hasExistingData: existing?.data != null,
        });
        try {
            const cached = await settingsService.readCachedSnapshot(workspaceId);
            if (cached) {
                if (!isAuthSessionCurrent(sessionVersion))
                    return;
                debugLog("settings-store", "cache_hit", {
                    workspaceId,
                    hasSettings: cached.data !== null,
                    settingsKeys: cached.data ? Object.keys(cached.data) : [],
                });
                set((state) => ({
                    byWorkspaceId: {
                        ...state.byWorkspaceId,
                        [workspaceId]: {
                            data: cached.data,
                            status: "ready",
                            lastBackendSync: cached.lastBackendSync,
                        },
                    },
                }));
            }
            else {
                if (!isAuthSessionCurrent(sessionVersion))
                    return;
                debugLog("settings-store", "cache_miss", {
                    workspaceId,
                });
                set((state) => ({
                    byWorkspaceId: {
                        ...state.byWorkspaceId,
                        [workspaceId]: {
                            data: state.byWorkspaceId[workspaceId]?.data ?? null,
                            status: "loading",
                            lastBackendSync: state.byWorkspaceId[workspaceId]?.lastBackendSync ?? null,
                        },
                    },
                }));
            }
            const resolved = await settingsService.ensureLoaded(workspaceId, {
                forceBackend: force,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            debugLog("settings-store", "ensure_loaded_success", {
                workspaceId,
                force,
                hasSettings: resolved.data !== null,
                settingsKeys: resolved.data ? Object.keys(resolved.data) : [],
            });
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        data: resolved.data,
                        status: "ready",
                        lastBackendSync: resolved.lastBackendSync,
                    },
                },
            }));
        }
        catch (err) {
            debugError("settings-store", "ensure_loaded_failed", {
                workspaceId,
                force,
                message: err instanceof Error ? err.message : "Unknown settings store error",
                stack: err instanceof Error ? err.stack : null,
            });
            if (!isAuthSessionCurrent(sessionVersion))
                return;
            set((state) => ({
                byWorkspaceId: {
                    ...state.byWorkspaceId,
                    [workspaceId]: {
                        data: state.byWorkspaceId[workspaceId]?.data ?? null,
                        status: "error",
                        lastBackendSync: state.byWorkspaceId[workspaceId]?.lastBackendSync ?? null,
                    },
                },
            }));
        }
    },
    setSettings(workspaceId, settings) {
        const resolved = settingsService.prime(workspaceId, settings);
        set((state) => ({
            byWorkspaceId: {
                ...state.byWorkspaceId,
                [workspaceId]: {
                    data: resolved.data,
                    status: "ready",
                    lastBackendSync: resolved.lastBackendSync,
                },
            },
        }));
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
