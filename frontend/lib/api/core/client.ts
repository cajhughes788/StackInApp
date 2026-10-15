"use client";
import { Capacitor } from "@capacitor/core";
import { getAuthSafe } from "@/lib/firebase";
import { getAppCheckToken } from "@/lib/appCheck/registerAppCheck";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import type { ProfileTraceEvent } from "@/lib/observability/profileTrace";
import { createProfileTrace } from "@/lib/observability/profileTrace";
import {
    ApiError,
    isAbortError,
    shouldQueueOfflineMutation,
} from "@/lib/api/core/errors";
import { debugError, debugLog } from "@/lib/debugLoop";

function isAndroidPlatform(): boolean {
    return typeof window !== "undefined" &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android";
}
function extractWorkspaceIdFromEndpoint(endpoint: string): string | undefined {
    const queryMatch = endpoint.match(/[?&]workspaceId=([^&]+)/);
    if (queryMatch) {
        return decodeURIComponent(queryMatch[1]);
    }
    const pathMatch = endpoint.match(/\/workspaces\/([^/?]+)/);
    return pathMatch ? decodeURIComponent(pathMatch[1]) : undefined;
}
function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    let attempt = 0;
    let delay = 300;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            if (isAbortError(err)) {
                throw err;
            }
            if (++attempt >= tries)
                throw err;
            await wait(delay + Math.random() * 120);
            delay *= 2;
        }
    }
}
export type ApiProfileContext = {
    traceId?: string;
    flow?: string;
    step?: string;
    metadata?: Record<string, string | number | boolean | null | undefined>;
};
// No token cache of our own: Firebase already caches the ID token and
// refreshes it shortly before it expires. A second cache keyed on when *we*
// fetched it (rather than when Firebase issued it) handed out expired tokens.
async function getAuthToken(profile?: ApiProfileContext, forceRefresh = false): Promise<string> {
    const auth = getAuthSafe();
    const user = auth?.currentUser;
    if (!user) {
        if (isAndroidPlatform()) {
            debugError("android-settings-save", "auth_token_missing_user", {
                profileStep: profile?.step ?? null,
            });
        }
        throw new Error("Not authenticated");
    }
    const trace = profile?.traceId && profile?.flow
        ? createProfileTrace(profile.flow, profile.metadata ?? {}, profile.traceId)
        : null;
    trace?.start(profile?.step ?? "token_fetch");
    const token = await user.getIdToken(forceRefresh);
    if (isAndroidPlatform()) {
        debugLog("android-settings-save", "auth_token_fetched", {
            profileStep: profile?.step ?? null,
            uid: user.uid,
            forcedRefresh: forceRefresh,
        });
    }
    trace?.end(profile?.step ?? "token_fetch", {
        forcedRefresh: forceRefresh,
    });
    return token;
}
export async function apiFetch<T = any>(endpoint: string, opts: RequestInit & {
    timeout?: number;
    profile?: ApiProfileContext;
} = {}, auth: boolean = true): Promise<T> {
    const { timeout = 12000, profile, signal: externalSignal, ...fetchOpts } = opts;
    const controller = new AbortController();
    let timedOut = false;
    const abortTimeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) {
        forwardAbort();
    }
    else {
        externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    }
    const trace = profile?.traceId && profile?.flow
        ? createProfileTrace(profile.flow, profile.metadata ?? {}, profile.traceId)
        : null;
    const requestStep = profile?.step ?? "network_request";
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(fetchOpts.headers as Record<string, string>),
        };
        if (auth) {
            const token = await getAuthToken({
                traceId: profile?.traceId,
                flow: profile?.flow,
                step: `${requestStep}.token_fetch`,
                metadata: profile?.metadata,
            }).catch(() => null);
            if (token)
                headers.Authorization = `Bearer ${token}`;
            else if (isAndroidPlatform()) {
                debugError("android-settings-save", "api_request_missing_token", {
                    endpoint,
                    method: fetchOpts.method ?? "GET",
                });
            }
        }
        // Attached regardless of the `auth` param — App Check attests the
        // app itself, not a logged-in user, so it applies to unauthenticated
        // endpoints too. Server-side verification is monitor-only for now
        // (see withCorsAuth.ts), so a null token here just shows up as
        // "missing" there rather than failing the request.
        const appCheckToken = await getAppCheckToken();
        if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
        if (controller.signal.aborted) {
            throw new DOMException("Request aborted", "AbortError");
        }
        if (profile?.traceId)
            headers["X-StackIn-Trace-Id"] = profile.traceId;
        if (profile?.flow)
            headers["X-StackIn-Flow"] = profile.flow;
        if (fetchOpts.method && fetchOpts.method !== "GET") {
            headers["Idempotency-Key"] =
                headers["Idempotency-Key"] ??
                    crypto.randomUUID?.() ??
                    String(Date.now());
        }
        trace?.start(requestStep, {
            endpoint,
            method: fetchOpts.method ?? "GET",
        });
        if (isAndroidPlatform() && endpoint.includes("savesettings")) {
            debugLog("android-settings-save", "api_request_started", {
                endpoint,
                method: fetchOpts.method ?? "GET",
                hasAuthorization: !!headers.Authorization,
            });
        }
        const send = () => withRetry(() => fetch(endpoint, {
            ...fetchOpts,
            headers,
            signal: controller.signal,
            mode: "cors",
            credentials: "omit",
        }));
        let res = await send();
        // A 401 usually means the token went stale (e.g. the app sat in the
        // background past its expiry). Force a fresh one and retry once
        // before surfacing "session expired". The Idempotency-Key is reused,
        // so a retried write can't double-apply.
        if (res.status === 401 && auth) {
            const freshToken = await getAuthToken({
                traceId: profile?.traceId,
                flow: profile?.flow,
                step: `${requestStep}.token_refresh`,
                metadata: profile?.metadata,
            }, true).catch(() => null);
            if (freshToken) {
                headers.Authorization = `Bearer ${freshToken}`;
                res = await send();
            }
        }
        const data = (await res.json().catch(() => ({}))) as any;
        if (!res.ok || data?.ok === false) {
            if (isAndroidPlatform() && endpoint.includes("savesettings")) {
                debugError("android-settings-save", "api_request_failed", {
                    endpoint,
                    method: fetchOpts.method ?? "GET",
                    status: res.status,
                    error: data?.error ?? null,
                });
            }
            trace?.error(requestStep, new ApiError(data?.error || `HTTP ${res.status}`), {
                endpoint,
                method: fetchOpts.method ?? "GET",
                status: res.status,
            });
            throw new ApiError(data?.error || `HTTP ${res.status}`, {
                status: res.status,
                details: data?.details,
            });
        }
        if (isAndroidPlatform() && endpoint.includes("savesettings")) {
            debugLog("android-settings-save", "api_request_succeeded", {
                endpoint,
                method: fetchOpts.method ?? "GET",
                status: res.status,
            });
        }
        trace?.end(requestStep, {
            endpoint,
            method: fetchOpts.method ?? "GET",
            status: res.status,
        });
        return data as T;
    }
    catch (err) {
        if (isAbortError(err)) {
            trace?.mark(`${requestStep}.aborted`, {
                endpoint,
                method: fetchOpts.method ?? "GET",
                timedOut,
            });
            // Tag so shouldQueueOfflineMutation can tell "our own timeout gave up
            // waiting" (safe to queue + retry — the request may have completed
            // server-side) apart from a caller-initiated cancellation (not safe
            // to replay, since the caller deliberately abandoned it).
            if (timedOut && err && typeof err === "object") {
                (err as { isTimeout?: boolean }).isTimeout = true;
            }
        }
        throw err;
    }
    finally {
        clearTimeout(abortTimeout);
        externalSignal?.removeEventListener("abort", forwardAbort);
    }
}
export async function tryWrite<T>(endpoint: string, method: "POST" | "PATCH" | "DELETE", body: any, profile?: ApiProfileContext, signal?: AbortSignal): Promise<T> {
    try {
        return await apiFetch<T>(endpoint, {
            method,
            body: JSON.stringify(body),
            profile,
            signal,
        }, true);
    }
    catch (err) {
        if (!shouldQueueOfflineMutation(err)) {
            throw err;
        }
        const queuedMutationId = typeof body?.clientMutationId === "string" && body.clientMutationId.length > 0
            ? body.clientMutationId
            : crypto.randomUUID?.() ?? String(Date.now());
        await offlineQueue.enqueue({
            id: queuedMutationId,
            ts: Date.now(),
            workspaceId: extractWorkspaceIdFromEndpoint(endpoint),
            endpoint,
            method,
            body,
        });
        throw err;
    }
}
