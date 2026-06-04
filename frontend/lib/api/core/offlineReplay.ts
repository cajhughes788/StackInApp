"use client";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import { API_ENDPOINTS } from "@/lib/api/core/endpoints";
import { ApiError, shouldQueueOfflineMutation } from "@/lib/api/core/errors";
import { apiFetch } from "@/lib/api/core/client";
import { debugError } from "@/lib/debugLoop";
import {
    makeTraceId,
    traceReplayStart,
    traceReplaySuccess,
    traceReplayFailure,
    traceReconciliation,
} from "@/lib/diagnostics/trace";
import { logPerf, startPerfTimer } from "@/lib/observability/perf";
import { normalizeImportSource } from "@shared/schemas/import";
import * as domainEntries from "@/lib/storage/domainEntries";
import * as domainExpenses from "@/lib/storage/domainExpenses";
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import { useExpensesStore } from "@/lib/stores/useExpensesStore";
import { useTaxProfileStore } from "@/lib/stores/useTaxProfileStore";
import { toast } from "@/hooks/use-toast";
import { deleteEntry as deleteEntryApi } from "@/lib/api/entriesApi";
import * as entryDeletionGuards from "@/lib/storage/entryDeletionGuards";
import * as taxProfileService from "@/lib/domain/taxProfileService";
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
        const replayTraceId = makeTraceId("offline_replay");
        traceReplayStart(replayTraceId, { queuedOps: ops.length });
        const remaining: typeof ops = [];
        let succeeded = 0;
        let dropped = 0;
        const timer = startPerfTimer("offline_replay.complete", {
            queuedOps: ops.length,
        });
        for (const op of ops) {
            try {
                await replayMutation(op, replayTraceId);
                succeeded += 1;
                const request = resolveReplayRequest(op);
                const cat = request.domain === "expenses" ? "expenses" : request.domain === "entries" ? "entries" : "settings";
                traceReplaySuccess(cat as any, replayTraceId, { opId: op.id, method: op.method, domain: request.domain });
            }
            catch (error) {
                if (shouldRetryReplay(error)) {
                    remaining.push(op);
                }
                else {
                    const request = resolveReplayRequest(op);
                    const cat = request.domain === "expenses" ? "expenses" : request.domain === "entries" ? "entries" : "settings";
                    traceReplayFailure(cat as any, replayTraceId, error, { opId: op.id, method: op.method, domain: request.domain, dropped: true });
                    await rollbackDroppedReplayMutation(op, error);
                    dropped += 1;
                }
            }
        }
        await offlineQueue.replaceAll(remaining);
        traceReconciliation("entries", replayTraceId, "replay_complete", { succeeded, requeued: remaining.length, dropped });
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
async function replayMutation(op: offlineQueue.OfflineMutation, replayTraceId?: string): Promise<void> {
    const request = resolveReplayRequest(op);
    const response = await apiFetch<any>(request.endpoint, {
        method: request.method,
        body: request.method === "DELETE" && request.body == null
            ? JSON.stringify({})
            : JSON.stringify(request.body),
    });
    await reconcileSuccessfulReplay(op, request.domain, response, replayTraceId);
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
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    const storeScopedKey = storeEntry?.periodId
        ? `${workspaceId}::${storeEntry.periodId}`
        : null;
    for (const scopedKey of scopedKeys) {
        if (!scopedKey.startsWith(workspacePrefix)) {
            continue;
        }
        if (scopedKey === storeScopedKey && storeEntry) {
            // HR-3: for the currently-loaded period, write from post-mutation store state.
            // Guard: only write if the store actually contains an entry matching this op.
            // Without this check, a replay firing during a period-switch loading window
            // would write stale or empty store entries to the new period's cache.
            if (storeEntry.entries.some((entry) => matchesQueuedOptimisticEntry(entry, op))) {
                try {
                    await domainEntries.saveEntries(scopedKey, storeEntry.entries, {
                        lastSuccessfulSyncAt: storeEntry.lastSuccessfulSyncAt ?? null,
                    });
                } catch (cacheErr) {
                    // Cache write failed (e.g. schema drift). The store has the correct
                    // canonical state. A future backend refresh will re-populate the cache.
                    // Do not propagate — a cache miss must not roll back a successful mutation.
                    debugError("offline-replay", "cache_write_failed_after_replay", {
                        scopedKey,
                        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
                    });
                }
            }
            continue;
        }
        const cacheRecord = await domainEntries.readEntriesCacheRecord(scopedKey);
        const entries = cacheRecord?.data ?? null;
        if (!entries?.some((entry) => matchesQueuedOptimisticEntry(entry, op))) {
            continue;
        }
        try {
            await domainEntries.saveEntries(scopedKey, updater(entries), {
                lastSuccessfulSyncAt: cacheRecord?.lastSuccessfulSyncAt ?? null,
            });
        } catch (cacheErr) {
            debugError("offline-replay", "cache_write_failed_after_replay", {
                scopedKey,
                error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
            });
        }
    }
}
async function reconcileSuccessfulReplay(op: offlineQueue.OfflineMutation, domain: string, response: any, replayTraceId?: string): Promise<void> {
    if (domain === "taxProfile") {
        const workspaceId = op.workspaceId ??
            (() => {
                const match = op.endpoint.match(/workspaceId=([^&]+)/);
                return match ? decodeURIComponent(match[1]) : undefined;
            })();
        if (!workspaceId) {
            return;
        }
        const applied = await taxProfileService.applyReplaySuccess(workspaceId, response);
        if (applied.data) {
            useTaxProfileStore.getState().reconcileCanonicalTaxProfile(workspaceId, applied.data, {
                lastSuccessfulSyncAt: applied.lastSuccessfulSyncAt,
                localUpdatedAt: applied.localUpdatedAt,
            });
        }
        return;
    }
    if (domain === "expenses") {
        const expensePathMatch = op.endpoint.match(/\/workspaces\/([^/?]+)\/expenses/);
        const workspaceId = op.workspaceId ?? (expensePathMatch ? decodeURIComponent(expensePathMatch[1]) : undefined);
        if (!workspaceId) return;
        if (op.method === "DELETE") {
            // Drive the store to a clean state regardless of replay order. A
            // PATCH replay that ran earlier in this same reconnect batch uses
            // replaceExpense which is an upsert — it re-adds the expense even
            // when it was already removed locally before reconnect. removeExpense
            // is a no-op if the expense is not present, so this is always safe.
            useExpensesStore.getState().removeExpense(workspaceId, op.id);
            if (replayTraceId) traceReconciliation("expenses", replayTraceId, "replay_delete_reconciled", { expenseId: op.id });
            return;
        }
        if (!response?.expense) return;
        const canonical = { ...response.expense, id: response.id ?? response.expense.id };
        // clientMutationId is the most reliable lookup key; fall back to op.id (tempId).
        const lookupId = getQueuedClientMutationId(op) ?? op.id;
        useExpensesStore.getState().replaceExpense(workspaceId, lookupId, canonical);
        if (typeof canonical.periodId === "string" && canonical.periodId.length > 0) {
            await domainExpenses.replaceExpense(`${workspaceId}::${canonical.periodId}`, lookupId, canonical);
        }
        if (replayTraceId) traceReconciliation("expenses", replayTraceId, "replay_optimistic_replaced_canonical", { optimisticId: lookupId, canonicalId: canonical.id });
        return;
    }
    if (domain !== "entries") {
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
    if (op.method === "DELETE") {
        await entryDeletionGuards.clearDeletedEntryGuard(workspaceId, {
            id: op.id,
            clientMutationId: getQueuedClientMutationId(op) ?? undefined,
        });
        return;
    }
    if (!response?.entry) {
        return;
    }
    const canonical = {
        ...response.entry,
        id: response.id ?? response.entry.id,
    };
    if (await entryDeletionGuards.hasDeletedEntryGuard(workspaceId, canonical)) {
        await entryDeletionGuards.rememberDeletedEntry(workspaceId, canonical);
        try {
            const deleteResponse = await deleteEntryApi(workspaceId, canonical.id);
            if (deleteResponse.ok) {
                await entryDeletionGuards.clearDeletedEntryGuard(workspaceId, canonical);
            }
        }
        catch (error) {
            if (!shouldRetryReplay(error)) {
                throw error;
            }
        }
        return;
    }
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (storeEntry?.periodId) {
        useEntriesStore.getState().applyEntryMutation(
            workspaceId,
            storeEntry.periodId,
            (current) => current.map((entry) =>
                matchesQueuedOptimisticEntry(entry, op) ? canonical : entry
            )
        );
    }
    await updateCachedEntryReplayState(
        workspaceId,
        op,
        (entries) => entries.map((entry) =>
            matchesQueuedOptimisticEntry(entry, op) ? canonical : entry
        )
    );
}
async function rollbackDroppedReplayMutation(op: offlineQueue.OfflineMutation, error: unknown): Promise<void> {
    const request = resolveReplayRequest(op);
    if (request.domain === "taxProfile") {
        const workspaceId = op.workspaceId ??
            (() => {
                const match = op.endpoint.match(/workspaceId=([^&]+)/);
                return match ? decodeURIComponent(match[1]) : undefined;
            })();
        if (!workspaceId) {
            return;
        }
        await taxProfileService.applyReplayFailure(workspaceId);
        const feedback = taxProfileService.getTaxProfileReplayFailureFeedback(error);
        useTaxProfileStore.getState().markTaxProfileSyncIssue(workspaceId, feedback.description);
        debugError("offline-replay", "tax_profile_mutation_dropped", {
            workspaceId,
            status: error instanceof ApiError ? error.status ?? null : null,
            message: error instanceof Error ? error.message : String(error),
        });
        toast({
            title: feedback.title,
            description: feedback.description,
        });
        return;
    }
    if (request.domain === "expenses") {
        const expensePathMatch = op.endpoint.match(/\/workspaces\/([^/?]+)\/expenses/);
        const workspaceId = op.workspaceId ?? (expensePathMatch ? decodeURIComponent(expensePathMatch[1]) : undefined);
        if (!workspaceId) return;
        if (op.method === "POST") {
            // Remove the orphaned optimistic expense from the store.
            useExpensesStore.getState().removeExpense(workspaceId, op.id);
            // Remove from IndexedDB: periodId is in the queued body.
            const body = typeof op.body === "object" && op.body !== null ? op.body as Record<string, unknown> : null;
            const periodId = typeof body?.periodId === "string" ? body.periodId : null;
            if (periodId) {
                await domainExpenses.deleteExpense(`${workspaceId}::${periodId}`, op.id).catch(() => {});
            }
            if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
                toast({ title: "Expense not saved", description: "Your session expired. Please sign in again.", variant: "destructive" });
            } else if (error instanceof ApiError && error.status === 409) {
                toast({ title: "Expense already exists", description: "This expense was already saved from another device.", variant: "destructive" });
            } else {
                toast({ title: "Expense not saved", description: "An expense could not be synced and has been removed. Please add it again.", variant: "destructive" });
            }
        } else if (op.method === "PATCH") {
            // Restore canonical state from the backend.
            const expensesStoreEntry = useExpensesStore.getState().byWorkspaceId[workspaceId];
            if (expensesStoreEntry?.periodId) {
                void useExpensesStore.getState().refreshFromBackend(workspaceId, expensesStoreEntry.periodId, { force: true });
            }
            toast({ title: "Expense update failed", description: "An expense change could not be saved and has been refreshed.", variant: "destructive" });
        } else if (op.method === "DELETE") {
            // Restore the expense by refreshing from the backend (it was never deleted there).
            const expensesStoreEntry = useExpensesStore.getState().byWorkspaceId[workspaceId];
            if (expensesStoreEntry?.periodId) {
                void useExpensesStore.getState().refreshFromBackend(workspaceId, expensesStoreEntry.periodId, { force: true });
            }
            toast({ title: "Expense delete failed", description: "An expense could not be deleted and has been restored.", variant: "destructive" });
        }
        return;
    }
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
    if (storeEntry?.periodId) {
        useEntriesStore.getState().applyEntryMutation(
            workspaceId,
            storeEntry.periodId,
            (current) => current.filter((entry) => !matchesQueuedOptimisticEntry(entry, op))
        );
    }
    await updateCachedEntryReplayState(
        workspaceId,
        op,
        (entries) => entries.filter((entry) => !matchesQueuedOptimisticEntry(entry, op))
    );
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
