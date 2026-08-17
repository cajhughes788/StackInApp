"use client";
import { Capacitor } from "@capacitor/core";
import { getAuthSafe } from "@/lib/firebase";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import type { ProfileTraceEvent } from "@/lib/observability/profileTrace";
import { createProfileTrace } from "@/lib/observability/profileTrace";
import {
    ApiError,
    isAbortError,
    shouldQueueOfflineMutation,
} from "@/lib/api/core/errors";
import { debugError, debugLog } from "@/lib/debugLoop";
const TOKEN_TTL_MS = 45 * 60 * 1000; // 45 minutes
let cachedToken: {
    value: string;
    ts: number;
} | null = null;

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
async function getAuthToken(profile?: ApiProfileContext): Promise<string> {
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
    const now = Date.now();
    const trace = profile?.traceId && profile?.flow
        ? createProfileTrace(profile.flow, profile.metadata ?? {}, profile.traceId)
        : null;
    if (!cachedToken || now - cachedToken.ts > TOKEN_TTL_MS) {
        trace?.start(profile?.step ?? "token_fetch");
        const token = await user.getIdToken();
        cachedToken = { value: token, ts: now };
        if (isAndroidPlatform()) {
            debugLog("android-settings-save", "auth_token_fetched", {
                profileStep: profile?.step ?? null,
                uid: user.uid,
                refreshed: true,
            });
        }
        trace?.end(profile?.step ?? "token_fetch", {
            refreshed: true,
            forcedRefresh: false,
        });
        return cachedToken.value;
    }
    trace?.mark(profile?.step ?? "token_fetch", {
        refreshed: false,
        cacheHit: true,
    });
    if (isAndroidPlatform()) {
        debugLog("android-settings-save", "auth_token_cache_hit", {
            profileStep: profile?.step ?? null,
            uid: user.uid,
        });
    }
    return cachedToken.value;
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
        const res = await withRetry(() => fetch(endpoint, {
            ...fetchOpts,
            headers,
            signal: controller.signal,
            mode: "cors",
            credentials: "omit",
        }));
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
export function clearApiCaches() {
    cachedToken = null;
}
