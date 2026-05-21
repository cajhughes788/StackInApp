"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { getAppBootstrap } from "@/lib/api";
import { createProfileTrace, setActiveProfileTrace, withProfileStep, } from "@/lib/observability/profileTrace";
import * as settingsService from "@/lib/domain/settingsService";
import { debugError, debugLog } from "@/lib/debugLoop";
import { logPerf, measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
type BootstrapStatus = "auth-loading" | "workspace-loading" | "ready" | "no-user" | "no-workspace";
export function useAppBootstrap() {
    const { user, authLoading } = useAuth();
    const workspaceState = useWorkspaceStore((s) => s.state);
    const hydrate = useWorkspaceStore((s) => s.hydrate);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const [status, setStatus] = useState<BootstrapStatus>("auth-loading");
    const [workspaceHydrateSettled, setWorkspaceHydrateSettled] = useState(false);
    const [activeWorkspaceBootstrapSettled, setActiveWorkspaceBootstrapSettled] = useState(false);
    const hydratedUserIdRef = useRef<string | null>(null);
    const bootstrappedWorkspaceIdRef = useRef<string | null>(null);
    const bootSessionRef = useRef<{
        startedAt: number;
        authResolvedAt?: number;
        workspaceHydratedAt?: number;
    } | null>(null);
    const startupTraceRef = useRef<ReturnType<typeof createProfileTrace> | null>(null);
    const didMarkReadyRef = useRef(false);
    useEffect(() => {
        if (authLoading) {
            debugLog("bootstrap", "status_auth_loading");
            setStatus("auth-loading");
            setWorkspaceHydrateSettled(false);
            setActiveWorkspaceBootstrapSettled(false);
            return;
        }
        if (!user) {
            debugLog("bootstrap", "status_no_user");
            bootSessionRef.current = null;
            hydratedUserIdRef.current = null;
            bootstrappedWorkspaceIdRef.current = null;
            setActiveProfileTrace("startup", null);
            setWorkspaceHydrateSettled(false);
            setActiveWorkspaceBootstrapSettled(false);
            setStatus("no-user");
            return;
        }
        if (hydratedUserIdRef.current === user.uid)
            return;
        debugLog("bootstrap", "auth_resolved", {
            uid: user.uid,
            email: user.email ?? null,
        });
        hydratedUserIdRef.current = user.uid;
        bootstrappedWorkspaceIdRef.current = null;
        didMarkReadyRef.current = false;
        setWorkspaceHydrateSettled(false);
        setActiveWorkspaceBootstrapSettled(false);
        bootSessionRef.current = { startedAt: Date.now(), authResolvedAt: Date.now() };
        startupTraceRef.current = createProfileTrace("startup", {
            userId: user.uid,
        });
        setActiveProfileTrace("startup", startupTraceRef.current);
        startupTraceRef.current.mark("startup.app_open");
        startupTraceRef.current.mark("startup.auth_resolved", {
            userId: user.uid,
        });
        debugLog("bootstrap", "workspace_hydrate_request", {
            uid: user.uid,
        });
        setStatus("workspace-loading");
        void measureAsync("app_bootstrap.workspace_hydrate", () => withProfileStep(startupTraceRef.current, "startup.workspace_hydrate", () => hydrate(user.uid, {
            traceId: startupTraceRef.current?.traceId,
            flow: startupTraceRef.current?.flow,
        }), { userId: user.uid }), { userId: user.uid })
            .finally(() => {
            if (hydratedUserIdRef.current !== user.uid) {
                return;
            }
            setWorkspaceHydrateSettled(true);
        });
    }, [authLoading, user, hydrate]);
    useEffect(() => {
        if (authLoading) {
            setStatus("auth-loading");
            return;
        }
        if (!user) {
            setStatus("no-user");
            return;
        }
        if (workspaceState.status === "loading") {
            debugLog("bootstrap", "workspace_state_loading", {
                uid: user.uid,
            });
            setStatus("workspace-loading");
            setActiveWorkspaceBootstrapSettled(false);
            return;
        }
        if (workspaceState.status === "no-workspace") {
            debugLog("bootstrap", "workspace_state_no_workspace", {
                uid: user.uid,
            });
            bootstrappedWorkspaceIdRef.current = null;
            setActiveWorkspaceBootstrapSettled(false);
            setStatus("no-workspace");
            logPerf("app_bootstrap.no_workspace", {
                userId: user.uid,
            });
            return;
        }
        const activeWorkspaceId = workspaceState.activeWorkspaceId;
        debugLog("bootstrap", "workspace_state_ready", {
            uid: user.uid,
            activeWorkspaceId,
            activeWorkspaceType: workspaceState.activeWorkspace.type,
            workspaceCount: workspaceState.workspaces.length,
            workspaceHydrateSettled,
        });
        if (bootSessionRef.current && !bootSessionRef.current.workspaceHydratedAt) {
            bootSessionRef.current.workspaceHydratedAt = Date.now();
        }
        if (bootstrappedWorkspaceIdRef.current === activeWorkspaceId) {
            setStatus(workspaceHydrateSettled ? "ready" : "workspace-loading");
            return;
        }
        let cancelled = false;
        bootstrappedWorkspaceIdRef.current = activeWorkspaceId;
        setActiveWorkspaceBootstrapSettled(false);
        setStatus(workspaceHydrateSettled ? "ready" : "workspace-loading");
        startupTraceRef.current?.mark("startup.first_shell_render", {
            workspaceId: activeWorkspaceId,
        });
        const timer = startPerfTimer("app_bootstrap.active_workspace", {
            userId: user.uid,
            workspaceId: activeWorkspaceId,
        });
        void measureAsync("app_bootstrap.cached_settings_seed", () => settingsService.readCachedSnapshot(activeWorkspaceId), { workspaceId: activeWorkspaceId })
            .then((cached) => {
            if (cancelled || !cached) {
                return;
            }
            debugLog("bootstrap", "cached_settings_seed", {
                workspaceId: activeWorkspaceId,
                hasSettings: cached.data !== null,
                settingsKeys: cached.data ? Object.keys(cached.data) : [],
            });
            setSettings(activeWorkspaceId, cached.data);
        })
            .catch(() => {
        });
        void measureAsync("app_bootstrap.snapshot_fetch", () => getAppBootstrap(activeWorkspaceId, {
            traceId: startupTraceRef.current?.traceId,
            flow: startupTraceRef.current?.flow,
            step: "startup.bootstrap_request",
        }), { workspaceId: activeWorkspaceId })
            .then(async (response) => {
            if (cancelled)
                return;
            debugLog("bootstrap", "snapshot_response", {
                workspaceId: activeWorkspaceId,
                workspaceType: response.snapshot.workspace.type,
                hasSettings: response.snapshot.settings !== null,
                hasIndependentSettings: Boolean(response.snapshot.settings?.independent),
                hasW2Settings: Boolean(response.snapshot.settings?.w2),
                subscriptionStatus: response.snapshot.subscription?.status ?? null,
            });
            let resolvedSettings = response.snapshot.settings;
            let settingsSource: "snapshot" | "settings-backfill" = "snapshot";
            if (resolvedSettings === null) {
                debugLog("bootstrap", "settings_backfill_start", {
                    workspaceId: activeWorkspaceId,
                });
                const backfill = await measureAsync("app_bootstrap.settings_backfill", () => settingsService.ensureLoaded(activeWorkspaceId, {
                    forceBackend: true,
                    trace: startupTraceRef.current
                        ? {
                            traceId: startupTraceRef.current.traceId,
                            flow: startupTraceRef.current.flow,
                        }
                        : null,
                }), { workspaceId: activeWorkspaceId });
                resolvedSettings = backfill.data;
                settingsSource = "settings-backfill";
                debugLog("bootstrap", "settings_backfill_complete", {
                    workspaceId: activeWorkspaceId,
                    hasSettings: resolvedSettings !== null,
                    settingsKeys: resolvedSettings ? Object.keys(resolvedSettings) : [],
                });
            }
            if (cancelled)
                return;
            setSettings(activeWorkspaceId, resolvedSettings);
            timer.success({
                source: settingsSource,
                totalBootMs: bootSessionRef.current
                    ? Date.now() - bootSessionRef.current.startedAt
                    : undefined,
                authToWorkspaceMs: bootSessionRef.current?.authResolvedAt &&
                    bootSessionRef.current?.workspaceHydratedAt
                    ? bootSessionRef.current.workspaceHydratedAt -
                        bootSessionRef.current.authResolvedAt
                    : undefined,
            });
            setActiveWorkspaceBootstrapSettled(true);
        })
            .catch((error) => {
            debugError("bootstrap", "snapshot_failed", {
                workspaceId: activeWorkspaceId,
                message: error?.message ?? "Unknown bootstrap error",
                stack: error?.stack ?? null,
            });
            void measureAsync("app_bootstrap.settings_fallback", () => settingsService.ensureLoaded(activeWorkspaceId, {
                forceBackend: true,
                trace: startupTraceRef.current
                    ? {
                        traceId: startupTraceRef.current.traceId,
                        flow: startupTraceRef.current.flow,
                    }
                    : null,
            }), { workspaceId: activeWorkspaceId })
                .then((result) => {
                if (cancelled)
                    return;
                debugLog("bootstrap", "settings_fallback_complete", {
                    workspaceId: activeWorkspaceId,
                    hasSettings: result.data !== null,
                    settingsKeys: result.data ? Object.keys(result.data) : [],
                });
                setSettings(activeWorkspaceId, result.data);
            })
                .catch((fallbackError) => {
                debugError("bootstrap", "settings_fallback_failed", {
                    workspaceId: activeWorkspaceId,
                    message: fallbackError?.message ?? "Unknown fallback error",
                    stack: fallbackError?.stack ?? null,
                });
            })
                .finally(() => {
                if (cancelled)
                    return;
                timer.success({
                    source: "settings-fallback",
                    totalBootMs: bootSessionRef.current
                        ? Date.now() - bootSessionRef.current.startedAt
                        : undefined,
                });
                setActiveWorkspaceBootstrapSettled(true);
            });
        });
        return () => {
            cancelled = true;
        };
    }, [authLoading, user, workspaceState, setSettings, workspaceHydrateSettled]);
    const contextReady = status === "ready" &&
        workspaceState.status === "ready" &&
        activeWorkspaceBootstrapSettled;
    useEffect(() => {
        if (!contextReady || workspaceState.status !== "ready") {
            return;
        }
        if (didMarkReadyRef.current) {
            return;
        }
        didMarkReadyRef.current = true;
        startupTraceRef.current?.mark("startup.ready", {
            workspaceId: workspaceState.activeWorkspaceId,
            source: "bootstrap-context-ready",
        });
    }, [contextReady, workspaceState]);
    return {
        status,
        user,
        authLoading,
        workspaceState,
        canRenderCachedWorkspace: workspaceState.status === "ready",
        contextReady,
    };
}
