"use client";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import { API_ENDPOINTS } from "@/lib/api/core/endpoints";
import { ApiError, shouldQueueOfflineMutation } from "@/lib/api/core/errors";
import { apiFetch } from "@/lib/api/core/client";
import { logPerf, startPerfTimer } from "@/lib/observability/perf";
import { normalizeImportSource } from "@shared/schemas/import";
import * as domainEntries from "@/lib/storage/domainEntries";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { toast } from "@/hooks/use-toast";
let replayInFlight: Promise<void> | null = null;
export async function replayPending() {
    if (replayInFlight)
        return replayInFlight;
    replayInFlight = (async () => {
        const ops = await offlineQueue.drain();
        if (!ops.length) {
            logPerf("offline_replay.skipped", { queuedOps: 0 });
            return;
        }
        const remaining: typeof ops = [];
        let succeeded = 0;
        let dropped = 0;
        const timer = startPerfTimer("offline_replay.complete", {
            queuedOps: ops.length,
        });
        for (const op of ops) {
            try {
                await replayMutation(op);
                succeeded += 1;
            }
            catch (error) {
                if (shouldRetryReplay(error)) {
                    remaining.push(op);
                }
                else {
                    await rollbackDroppedReplayMutation(op, error);
                    dropped += 1;
                }
            }
        }
        await offlineQueue.replaceAll(remaining);
        timer.success({
            succeeded,
            requeued: remaining.length,
            dropped,
        });
    })();
    try {
        await replayInFlight;
    }
    finally {
        replayInFlight = null;
    }
}
function normalizeQueuedBody(body: unknown): unknown {
    if (typeof body !== "string")
        return normalizeImportReplayBody(body);
    try {
        return normalizeImportReplayBody(JSON.parse(body));
    }
    catch {
        return body;
    }
}
function normalizeImportReplayBody(body: unknown): unknown {
    if (!body || typeof body !== "object") {
        return body;
    }
    const record = body as Record<string, unknown>;
    const batch = record.batch;
    if (batch && typeof batch === "object") {
        const batchRecord = batch as Record<string, unknown>;
        const items = Array.isArray(record.items)
            ? record.items.map((item) => {
                if (!item || typeof item !== "object") {
                    return item;
                }
                const itemRecord = item as Record<string, unknown>;
                return {
                    ...itemRecord,
                    source: normalizeImportSource(itemRecord.source),
                };
            })
            : record.items;
        return {
            ...record,
            batch: {
                ...batchRecord,
                source: normalizeImportSource(batchRecord.source),
            },
            items,
        };
    }
    if ("source" in record) {
        return {
            ...record,
            source: normalizeImportSource(record.source),
        };
    }
    return body;
}
function resolveReplayRequest(op: offlineQueue.OfflineMutation): {
    endpoint: string;
    method: "POST" | "PATCH" | "DELETE";
    body: unknown;
    domain: string;
} {
    const normalizedBody = normalizeQueuedBody(op.body);
    const workspaceId = op.workspaceId ??
        (() => {
            const match = op.endpoint.match(/workspaceId=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : undefined;
        })();
    const entryMatch = op.endpoint.match(/^\/api\/workspaces\/([^/]+)\/entries(?:\/([^/]+))?$/);
    if (entryMatch) {
        const [, rawWorkspaceId, entryId] = entryMatch;
        const resolvedWorkspaceId = workspaceId ?? decodeURIComponent(rawWorkspaceId);
        if (op.method === "POST") {
            return {
                domain: "entries",
                method: "POST",
                endpoint: `${API_ENDPOINTS.entries.post}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}`,
                body: normalizedBody,
            };
        }
        if (op.method === "PATCH" && entryId) {
            return {
                domain: "entries",
                method: "PATCH",
                endpoint: `${API_ENDPOINTS.entries.patch}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}&entryId=${encodeURIComponent(entryId)}`,
                body: normalizedBody,
            };
        }
        if (op.method === "DELETE" && entryId) {
            return {
                domain: "entries",
                method: "DELETE",
                endpoint: `${API_ENDPOINTS.entries.delete}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}&entryId=${encodeURIComponent(entryId)}`,
                body: {},
            };
        }
    }
    const expenseMatch = op.endpoint.match(/^\/api\/workspaces\/([^/]+)\/expenses(?:\/([^/]+))?$/);
    if (expenseMatch) {
        const [, rawWorkspaceId, expenseId] = expenseMatch;
        const resolvedWorkspaceId = workspaceId ?? decodeURIComponent(rawWorkspaceId);
        if (op.method === "POST") {
            return {
                domain: "expenses",
                method: "POST",
                endpoint: `${API_ENDPOINTS.expenses.post}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}`,
                body: normalizedBody,
            };
        }
        if (op.method === "PATCH" && expenseId) {
            return {
                domain: "expenses",
                method: "PATCH",
                endpoint: `${API_ENDPOINTS.expenses.patch}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}&expenseId=${encodeURIComponent(expenseId)}`,
                body: normalizedBody,
            };
        }
        if (op.method === "DELETE" && expenseId) {
            return {
                domain: "expenses",
                method: "DELETE",
                endpoint: `${API_ENDPOINTS.expenses.delete}?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}&expenseId=${encodeURIComponent(expenseId)}`,
                body: {},
            };
        }
    }
    if (workspaceId && op.endpoint.startsWith(API_ENDPOINTS.settings.post(workspaceId))) {
        return {
            domain: "settings",
            method: op.method,
            endpoint: op.endpoint,
            body: normalizedBody,
        };
    }
    if (workspaceId && op.endpoint.startsWith(`${API_ENDPOINTS.taxProfile.post}?workspaceId=`)) {
        return {
            domain: "taxProfile",
            method: op.method,
            endpoint: op.endpoint,
            body: normalizedBody,
        };
    }
    return {
        domain: "generic",
        method: op.method,
        endpoint: op.endpoint,
        body: normalizedBody,
    };
}
async function replayMutation(op: offlineQueue.OfflineMutation): Promise<void> {
    const request = resolveReplayRequest(op);
    const response = await apiFetch<any>(request.endpoint, {
        method: request.method,
        body: request.method === "DELETE" && request.body == null
            ? JSON.stringify({})
            : JSON.stringify(request.body),
    });
    await reconcileSuccessfulReplay(op, request.domain, response);
}
function shouldRetryReplay(error: unknown): boolean {
    return shouldQueueOfflineMutation(error);
}
function getQueuedClientMutationId(op: offlineQueue.OfflineMutation): string | null {
    const body = typeof op.body === "object" && op.body !== null ? op.body as Record<string, unknown> : null;
    const candidate = body?.clientMutationId;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
function matchesQueuedOptimisticEntry(entry: any, op: offlineQueue.OfflineMutation): boolean {
    const queuedClientMutationId = getQueuedClientMutationId(op);
    if (queuedClientMutationId && entry?.clientMutationId === queuedClientMutationId) {
        return true;
    }
    return typeof op.id === "string" && op.id.length > 0 && entry?.id === op.id;
}
async function updateCachedEntryReplayState(workspaceId: string, op: offlineQueue.OfflineMutation, updater: (entries: any[]) => any[]): Promise<void> {
    const scopedKeys = await domainEntries.listCachedEntriesKeys();
    const workspacePrefix = `${workspaceId}::`;
    for (const scopedKey of scopedKeys) {
        if (!scopedKey.startsWith(workspacePrefix)) {
            continue;
        }
        const entries = await domainEntries.loadEntries(scopedKey);
        if (!entries?.some((entry) => matchesQueuedOptimisticEntry(entry, op))) {
            continue;
        }
        await domainEntries.saveEntries(scopedKey, updater(entries));
    }
}
async function reconcileSuccessfulReplay(op: offlineQueue.OfflineMutation, domain: string, response: any): Promise<void> {
    if (domain !== "entries") {
        return;
    }
    const workspaceId = op.workspaceId ??
        (() => {
            const match = op.endpoint.match(/workspaceId=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : undefined;
        })();
    if (!workspaceId || !response?.entry) {
        return;
    }
    const canonical = {
        ...response.entry,
        id: response.id ?? response.entry.id,
    };
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (storeEntry?.periodId && storeEntry.entries.some((entry) => matchesQueuedOptimisticEntry(entry, op))) {
        const nextEntries = storeEntry.entries.map((entry) => matchesQueuedOptimisticEntry(entry, op) ? canonical : entry);
        useEntriesStore.getState().setEntries(workspaceId, nextEntries, storeEntry.periodId);
    }
    await updateCachedEntryReplayState(workspaceId, op, (entries) => entries.map((entry) => matchesQueuedOptimisticEntry(entry, op) ? canonical : entry));
}
async function rollbackDroppedReplayMutation(op: offlineQueue.OfflineMutation, error: unknown): Promise<void> {
    const request = resolveReplayRequest(op);
    if (request.domain !== "entries") {
        return;
    }
    const workspaceId = op.workspaceId ??
        (() => {
            const match = op.endpoint.match(/workspaceId=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : undefined;
        })();
    if (!workspaceId) {
        return;
    }
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (storeEntry?.periodId && storeEntry.entries.some((entry) => matchesQueuedOptimisticEntry(entry, op))) {
        const nextEntries = storeEntry.entries.filter((entry) => !matchesQueuedOptimisticEntry(entry, op));
        useEntriesStore.getState().setEntries(workspaceId, nextEntries, storeEntry.periodId);
    }
    await updateCachedEntryReplayState(workspaceId, op, (entries) => entries.filter((entry) => !matchesQueuedOptimisticEntry(entry, op)));
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        toast({
            title: "Sign in required",
            description: "Your session expired. Please sign in again.",
            variant: "destructive",
        });
        return;
    }
    if (error instanceof ApiError && error.status === 409) {
        toast({
            title: "Entry conflict",
            description: "This entry conflicted with another save. Refresh and check your entries.",
            variant: "destructive",
        });
        return;
    }
    toast({
        title: "Entry not saved",
        description: "Unfortunately, we could not save your entry. Try again later.",
        variant: "destructive",
    });
}
