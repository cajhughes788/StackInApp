"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
    buildAccountAuthorityFromBootstrapSnapshot,
    useAccountAuthorityState,
} from "@/contexts/account-authority-context";
import { getAppBootstrap, ApiError } from "@/lib/api";
import { createProfileTrace, setActiveProfileTrace, withProfileStep, } from "@/lib/observability/profileTrace";
import * as settingsService from "@/lib/domain/settingsService";
import { debugError, debugLog } from "@/lib/debugLoop";
import { logPerf, measureAsync, startPerfTimer } from "@/lib/observability/perf";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { readSettingsHint } from "@/lib/storage/localSettingsHint";
import type { AppBootstrapSnapshot } from "@shared/contracts/appBootstrap";
import type { BootstrapAuthority, BootstrapAuthorityStatus } from "@/contexts/app-bootstrap-context";
type BootstrapStatus = "auth-loading" | "workspace-loading" | "ready" | "no-user" | "no-workspace";
const BOOTSTRAP_REQUEST_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        promise
            .then((value) => {
            window.clearTimeout(timeoutId);
            resolve(value);
        })
            .catch((error) => {
            window.clearTimeout(timeoutId);
            reject(error);
        });
    });
}

function buildBootstrapAuthority(workspaceId: string, snapshot: AppBootstrapSnapshot): BootstrapAuthority {
    return {
        workspaceId,
        membershipRole: snapshot.membershipRole,
        workspaceCapabilities: snapshot.workspaceCapabilities,
        subscription: snapshot.subscription,
        subscriptionCapabilities: snapshot.subscriptionCapabilities,
        isSubscriptionActive: snapshot.isSubscriptionActive,
        allowedWorkspaceTypes: snapshot.isSubscriptionActive
            ? snapshot.subscriptionCapabilities?.allowedWorkspaceTypes ?? []
            : [],
        maxWorkspaces: snapshot.isSubscriptionActive
            ? snapshot.subscriptionCapabilities?.maxWorkspaces ?? 0
            : 0,
    };
}

export function useAppBootstrap() {
    const { user, authLoading } = useAuth();
    const { syncAccountAuthority } = useAccountAuthorityState();
    const workspaceState = useWorkspaceStore((s) => s.state);
    const hydrate = useWorkspaceStore((s) => s.hydrate);
    const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
    const setSettings = useSettingsStore((s) => s.setSettings);
    const [status, setStatus] = useState<BootstrapStatus>("auth-loading");
    const [workspaceHydrateSettled, setWorkspaceHydrateSettled] = useState(false);
    const [activeWorkspaceBootstrapSettled, setActiveWorkspaceBootstrapSettled] = useState(false);
    const [authorityStatus, setAuthorityStatus] = useState<BootstrapAuthorityStatus>("idle");
    const [authority, setAuthority] = useState<BootstrapAuthority | null>(null);
    const lastBootstrapAtRef = useRef<number | null>(null);
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
            setAuthorityStatus("idle");
            setAuthority(null);
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
            setAuthorityStatus("idle");
            setAuthority(null);
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
        // hydrate() sets workspace state synchronously from the localStorage
        // snapshot before starting any Firestore reads. Use that to:
        //   1. Seed settings from localStorage hint (sync, zero latency) so
        //      settingsLoading = false before the first React paint.
        //   2. Start the IndexedDB settings read in parallel with Firestore
        //      workspace reads rather than waiting for the next render cycle.
        const immediateWs = useWorkspaceStore.getState().state;
        if (immediateWs.status === "ready") {
            const immediateWorkspaceId = immediateWs.activeWorkspaceId;
            // 1. Synchronous hint seed — makes settingsLoading = false immediately.
            const hint = readSettingsHint(immediateWorkspaceId);
            if (hint !== null) {
                debugLog("bootstrap", "settings_hint_seed", {
                    workspaceId: immediateWorkspaceId,
                });
                setSettings(immediateWorkspaceId, hint, { source: "hint" });
            }
            // 2. Async IndexedDB seed — overwrites hint with authoritative data.
            // Capture the timestamp before the read so we can detect if a
            // backend response arrives and writes to the store while the IDB
            // read is in-flight. If it does, skip the IDB write — the store
            // already has fresher data.
            const immediateReadStartedAt = Date.now();
            void settingsService.readCachedSnapshot(immediateWorkspaceId).then((cached) => {
                if (!cached || hydratedUserIdRef.current !== user.uid) return;
                const existing = useSettingsStore.getState().byWorkspaceId[immediateWorkspaceId];
                if (existing?.localUpdatedAt != null && existing.localUpdatedAt > immediateReadStartedAt) return;
                setSettings(immediateWorkspaceId, cached.data, {
                    source: "cache",
                    lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
                    localUpdatedAt: cached.localUpdatedAt,
                });
            }).catch(() => {});
        }
    }, [authLoading, user, hydrate, setSettings]);
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
            setAuthorityStatus("idle");
            setAuthority(null);
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
        setAuthorityStatus("loading");
        setAuthority(null);
        setStatus(workspaceHydrateSettled ? "ready" : "workspace-loading");
        startupTraceRef.current?.mark("startup.first_shell_render", {
            workspaceId: activeWorkspaceId,
        });
        const timer = startPerfTimer("app_bootstrap.active_workspace", {
            userId: user.uid,
            workspaceId: activeWorkspaceId,
        });
        // Capture the timestamp before the read so we can detect if a
        // backend response arrives and writes to the store while the IDB
        // read is in-flight. If it does, skip the IDB write — the store
        // already has fresher data.
        const activeReadStartedAt = Date.now();
        void measureAsync("app_bootstrap.cached_settings_seed", () => settingsService.readCachedSnapshot(activeWorkspaceId), { workspaceId: activeWorkspaceId })
            .then((cached) => {
            if (cancelled || !cached) {
                return;
            }
            const existing = useSettingsStore.getState().byWorkspaceId[activeWorkspaceId];
            if (existing?.localUpdatedAt != null && existing.localUpdatedAt > activeReadStartedAt) return;
            debugLog("bootstrap", "cached_settings_seed", {
                workspaceId: activeWorkspaceId,
                hasSettings: cached.data !== null,
                settingsKeys: cached.data ? Object.keys(cached.data) : [],
            });
            setSettings(activeWorkspaceId, cached.data, {
                source: "cache",
                lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
                localUpdatedAt: cached.localUpdatedAt,
            });
        })
            .catch(() => {
        });
        void measureAsync("app_bootstrap.snapshot_fetch", () => withTimeout(getAppBootstrap(activeWorkspaceId, {
            traceId: startupTraceRef.current?.traceId,
            flow: startupTraceRef.current?.flow,
            step: "startup.bootstrap_request",
        }), BOOTSTRAP_REQUEST_TIMEOUT_MS, "app bootstrap"), { workspaceId: activeWorkspaceId })
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
            // Server confirmed the workspace is no longer active — evict immediately
            // rather than waiting for the hydration TTL to expire.
            if (response.snapshot.workspace.status !== "active") {
                debugLog("bootstrap", "workspace_not_active", {
                    workspaceId: activeWorkspaceId,
                    status: response.snapshot.workspace.status,
                });
                removeWorkspace(activeWorkspaceId);
                setAuthorityStatus("error");
                setActiveWorkspaceBootstrapSettled(true);
                return;
            }
            syncAccountAuthority(buildAccountAuthorityFromBootstrapSnapshot(response.snapshot));
            setAuthority(buildBootstrapAuthority(activeWorkspaceId, response.snapshot));
            setAuthorityStatus("ready");
            let resolvedSettings = response.snapshot.settings;
            let settingsSource: "snapshot" | "settings-backfill" = "snapshot";
            let resolvedLastBackendSync = response.snapshot.settingsMeta ? Date.now() : null;
            let resolvedLocalUpdatedAt: number | null = null;
            if (resolvedSettings === null) {
                debugLog("bootstrap", "settings_backfill_start", {
                    workspaceId: activeWorkspaceId,
                });
                const backfill = await measureAsync("app_bootstrap.settings_backfill", () => withTimeout(settingsService.ensureLoaded(activeWorkspaceId, {
                    forceBackend: true,
                    trace: startupTraceRef.current
                        ? {
                            traceId: startupTraceRef.current.traceId,
                            flow: startupTraceRef.current.flow,
                        }
                        : null,
                }), BOOTSTRAP_REQUEST_TIMEOUT_MS, "settings backfill"), { workspaceId: activeWorkspaceId });
                resolvedSettings = backfill.data;
                settingsSource = "settings-backfill";
                resolvedLastBackendSync = backfill.lastSuccessfulSyncAt;
                resolvedLocalUpdatedAt = backfill.localUpdatedAt;
                debugLog("bootstrap", "settings_backfill_complete", {
                    workspaceId: activeWorkspaceId,
                    hasSettings: resolvedSettings !== null,
                    settingsKeys: resolvedSettings ? Object.keys(resolvedSettings) : [],
                });
            }
            if (cancelled)
                return;
            setSettings(activeWorkspaceId, resolvedSettings, {
                source: settingsSource === "snapshot" ? "bootstrap" : "backend",
                remoteMeta: settingsSource === "snapshot" ? response.snapshot.settingsMeta : null,
                lastSuccessfulSyncAt: resolvedLastBackendSync,
                localUpdatedAt: resolvedLocalUpdatedAt,
            });
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
            lastBootstrapAtRef.current = Date.now();
            setActiveWorkspaceBootstrapSettled(true);
        })
            .catch((error) => {
            debugError("bootstrap", "snapshot_failed", {
                workspaceId: activeWorkspaceId,
                message: error?.message ?? "Unknown bootstrap error",
                stack: error?.stack ?? null,
            });
            if (!cancelled) {
                setAuthority(null);
                setAuthorityStatus("error");
                // 403 = membership revoked / workspace not found; 404 = workspace deleted.
                // Evict immediately — the server has confirmed access is gone.
                if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
                    debugLog("bootstrap", "workspace_access_denied", {
                        workspaceId: activeWorkspaceId,
                        status: error.status,
                    });
                    removeWorkspace(activeWorkspaceId);
                    setActiveWorkspaceBootstrapSettled(true);
                    return;
                }
            }
            void measureAsync("app_bootstrap.settings_fallback", () => withTimeout(settingsService.ensureLoaded(activeWorkspaceId, {
                forceBackend: true,
                trace: startupTraceRef.current
                    ? {
                        traceId: startupTraceRef.current.traceId,
                        flow: startupTraceRef.current.flow,
                    }
                    : null,
            }), BOOTSTRAP_REQUEST_TIMEOUT_MS, "settings fallback"), { workspaceId: activeWorkspaceId })
                .then((result) => {
                if (cancelled)
                    return;
                debugLog("bootstrap", "settings_fallback_complete", {
                    workspaceId: activeWorkspaceId,
                    hasSettings: result.data !== null,
                    settingsKeys: result.data ? Object.keys(result.data) : [],
                });
                setSettings(activeWorkspaceId, result.data, {
                    source: "backend",
                    lastSuccessfulSyncAt: result.lastSuccessfulSyncAt,
                    localUpdatedAt: result.localUpdatedAt,
                });
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
                lastBootstrapAtRef.current = Date.now();
                setActiveWorkspaceBootstrapSettled(true);
            });
        });
        return () => {
            cancelled = true;
        };
    }, [authLoading, user, workspaceState, setSettings, syncAccountAuthority, workspaceHydrateSettled]);
    const refreshAuthority = useCallback(async () => {
        if (workspaceState.status !== "ready") {
            return;
        }
        const workspaceId = workspaceState.activeWorkspaceId;
        setAuthorityStatus("loading");
        try {
            const response = await getAppBootstrap(workspaceId);
            syncAccountAuthority(buildAccountAuthorityFromBootstrapSnapshot(response.snapshot));
            setAuthority(buildBootstrapAuthority(workspaceId, response.snapshot));
            setAuthorityStatus("ready");
        }
        catch (error) {
            setAuthority(null);
            setAuthorityStatus("error");
            throw error;
        }
    }, [syncAccountAuthority, workspaceState]);
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
        authorityStatus,
        authority,
        refreshAuthority,
        lastBootstrapAtRef,
    };
}
