//domain/entriesService.ts
"use client";
// ------------------------------------------------------------
// Frontend Domain Layer for Entries (FINAL ARCHITECTURE)
// ------------------------------------------------------------
//
// Responsibilities:
// • Accept raw input from UI
// • Load settings → derive periodId
// • Run optimistic computeWorkTime + computeTotals (MUST MATCH BACKEND)
// • Insert optimistic entry into period-scoped cache (domainEntries)
// • If offline → enqueue mutation (offlineQueue)
// • If online  → send rawInput + clientMutationId → backend
// • On backend response → replace optimistic with canonical
//
// ------------------------------------------------------------
import { computeWorkTime } from "@shared/computeWorkTime";
import { computeEntry } from "@shared/computeEntry";
import * as domainEntries from "@/lib/storage/domainEntries";
import * as offlineQueue from "@/lib/storage/offlineQueue";
import * as entryDeletionGuards from "@/lib/storage/entryDeletionGuards";
import { ApiError, postEntry, editEntry, deleteEntry, shouldQueueOfflineMutation } from "@/lib/api";
import { getCurrentCalendarMonthPeriodAt, getCurrentEntryPeriod } from "@shared/payPeriods";
import { getIsOnline } from "@/lib/network/status";
import * as settingsService from "@/lib/domain/settingsService";
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace";
import { SettingsType } from "@shared/schemas/settings";
import { v4 as uuid } from "uuid";
import { toast } from "@/hooks/use-toast";
// Store import
import { useEntriesStore } from "@/lib/stores/useEntriesStore";
import * as profitLossService from "@/lib/domain/profitLossService";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { syncWorkspaceGeofenceEntryStatus } from "@/lib/mobile/geofenceReminderSync";
import { syncWorkspaceTimeEntryReminderForDate } from "@/lib/mobile/timeEntryReminderSync";
import { debugLog } from "@/lib/debugLoop";
import { isLocalOnlyOptimisticEntry, matchesEntryIdentity } from "@/lib/domain/entrySync";
import {
    makeTraceId,
    trace as diagTrace,
    traceCacheWrite,
    traceStoreUpdate,
    traceQueueAdd,
    traceApiRequest,
    traceApiResponse,
    traceApiFailure,
    traceReconciliation,
} from "@/lib/diagnostics/trace";
// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
// Convert settings → payPeriodId (same as backend)
function getPeriodId(settings: SettingsType, workspaceType: "w2" | "independent", at?: string | Date): string {
    const periodId = getCurrentEntryPeriod(settings, workspaceType, at).periodId;
    debugLog("entries-service", "period_selected", {
        periodId,
        workspaceType,
        entryDateAnchor: typeof at === "string" ? at : at instanceof Date ? at.toISOString() : null,
        calendarMonthPeriodId: getCurrentCalendarMonthPeriodAt(settings, at).periodId,
        periodResolver: workspaceType === "independent" ? "calendar-month" : "w2-pay-period",
        w2PayFrequency: settings?.w2?.payFrequency ?? null,
        w2PayPeriodStartDate: settings?.w2?.payPeriodStartDate ?? null,
        hasIndependentSettings: Boolean(settings?.independent),
    });
    return periodId;
}
function publishEntriesToVisibleStore(workspaceId: string, entries: any[], periodId: string) {
    const visibleStoreEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (visibleStoreEntry?.periodId && visibleStoreEntry.periodId !== periodId) {
        debugLog("entries-service", "skip_visible_store_sync", {
            workspaceId,
            targetPeriodId: periodId,
            visiblePeriodId: visibleStoreEntry.periodId,
            entryCount: entries.length,
        });
        return false;
    }
    useEntriesStore.getState().setEntries(workspaceId, entries, periodId);
    return true;
}
async function getCurrentEntriesForPeriod(workspaceId: string, periodId: string, scopedKey: string) {
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (storeEntry?.periodId === periodId) {
        return storeEntry.entries;
    }
    return (await domainEntries.loadEntries(scopedKey)) ?? [];
}
async function persistEntriesForPeriod(
    workspaceId: string,
    periodId: string,
    scopedKey: string,
    updater: (current: any[]) => any[]
): Promise<void> {
    useEntriesStore.getState().applyEntryMutation(workspaceId, periodId, updater);
    const storeEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    if (storeEntry?.periodId === periodId) {
        await domainEntries.saveEntries(scopedKey, storeEntry.entries, {
            lastSuccessfulSyncAt: storeEntry.lastSuccessfulSyncAt ?? null,
        });
    } else {
        const cached = await domainEntries.loadEntries(scopedKey) ?? [];
        const next = updater(cached);
        await domainEntries.saveEntries(scopedKey, next, {
            lastSuccessfulSyncAt: storeEntry?.lastSuccessfulSyncAt ?? null,
        });
    }
}
async function updateOptimisticEntry(
    workspaceId: string,
    periodId: string,
    scopedKey: string,
    entryId: string,
    entryUpdater: (entry: any) => any
): Promise<void> {
    await persistEntriesForPeriod(
        workspaceId,
        periodId,
        scopedKey,
        (current) => current.map((entry) =>
            entry.id === entryId ? entryUpdater(entry) : entry
        )
    );
}
async function removeOptimisticEntry(
    workspaceId: string,
    periodId: string,
    scopedKey: string,
    entryId: string
): Promise<void> {
    await persistEntriesForPeriod(
        workspaceId,
        periodId,
        scopedKey,
        (current) => current.filter((entry) => entry.id !== entryId)
    );
}
function showQueuedEntryToast() {
    toast({
        title: "Entry queued",
        description: "You're offline right now. Your entry will sync automatically when you're back online.",
    });
}
function showPermanentEntryFailureToast(error: unknown) {
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
function invalidateProfitLossView(workspaceId: string) {
    void profitLossService.invalidate(workspaceId).catch(() => {});
}
// CHANGE: Replaced flat-field optimistic computation with workspace-aware, nested-schema-compatible logic.
// - Workspace type is derived from authoritative settings (not raw input)
// - Computes totalHours from raw.w2 clock or manual hours
// - Delegates totals to computeEntry(raw, settings) using the full entry object
// - Returns totals inside a totals block to match entry.totals shape
function computeOptimistic(settings: SettingsType, raw: any) {
    const isW2 = raw.workspace === "w2";
    // ------------------------------------------------------------
    // 1. Compute totalHours (universal)
    // ------------------------------------------------------------
    let totalHours = 0;
    if (isW2) {
        const w2 = raw.w2 ?? {};
        const hasClockFields = w2.inTime &&
            w2.outTime &&
            w2.inTime !== "" &&
            w2.outTime !== "";
        const hasManualHours = w2.hours != null && !Number.isNaN(Number(w2.hours));
        if (hasClockFields) {
            const result = computeWorkTime(w2.inTime, w2.outTime, raw.date);
            totalHours = result.totalHours;
        }
        else if (hasManualHours) {
            totalHours = Number(w2.hours);
        }
    }
    // ------------------------------------------------------------
    // 2. Compute totals using computeEntry (backend-aligned)
    // ------------------------------------------------------------
    const totals = computeEntry(raw, settings);
    // attach universal totalHours override:
    return { totals: { ...totals, totalHours } };
}
async function resyncWorkspaceReminders(workspaceId: string, settings: SettingsType) {
    const workspaceState = useWorkspaceStore.getState().state;
    if (workspaceState.status !== "ready")
        return;
    const workspace = workspaceState.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace)
        return;
    await syncWorkspaceGeofenceEntryStatus(workspace, settings);
}

function getWorkspaceSummary(workspaceId: string) {
    const workspaceState = useWorkspaceStore.getState().state;
    if (workspaceState.status !== "ready") {
        return null;
    }

    return workspaceState.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

async function syncTimeRemindersForDates(
    workspaceId: string,
    settings: SettingsType,
    entries: Array<{ date?: string | null }>,
    dateKeys: Array<string | null | undefined>
) {
    const workspace = getWorkspaceSummary(workspaceId);
    if (!workspace) {
        return;
    }

    const uniqueDateKeys = Array.from(new Set(dateKeys
        .map((dateKey) => dateKey?.trim())
        .filter((dateKey): dateKey is string => Boolean(dateKey))));

    for (const dateKey of uniqueDateKeys) {
        const hasEntryForDateKey = entries.some((entry) => entry.date === dateKey);
        await syncWorkspaceTimeEntryReminderForDate(workspace, settings, dateKey, hasEntryForDateKey);
    }
}

function scheduleTimeReminderDateSync(
    workspaceId: string,
    settings: SettingsType,
    entries: Array<{ date?: string | null }>,
    dateKeys: Array<string | null | undefined>
) {
    void syncTimeRemindersForDates(workspaceId, settings, entries, dateKeys).catch(() => {
    });
}

function scheduleGeofenceEntryStatusResync(workspaceId: string, settings: SettingsType) {
    void resyncWorkspaceReminders(workspaceId, settings).catch(() => {
    });
}
function getWorkspaceTypeForWorkspaceId(workspaceId: string): "w2" | "independent" {
    const workspaceState = useWorkspaceStore.getState().state;
    if (workspaceState.status !== "ready") {
        return "w2";
    }
    return workspaceState.workspaces.find((workspace) => workspace.id === workspaceId)?.type ?? "w2";
}
async function reconcileOptimisticEntry(workspaceId: string, settings: SettingsType, scopedKey: string, clientMutationId: string, optimistic: any, parsed: any, trace: ReturnType<typeof createProfileTrace> | null) {
    try {
        const payload = {
            workspace: parsed.workspace,
            date: parsed.date,
            notes: parsed.notes ?? "",
            w2: parsed.w2,
            independent: parsed.independent,
            createdAtLocal: optimistic.createdAtLocal,
            updatedAtLocal: optimistic.updatedAtLocal,
            clientMutationId,
        };
        const res = await withProfileStep(trace, "entry_create.network_request", () => postEntry(workspaceId, payload, {
            traceId: trace?.traceId,
            flow: trace?.flow,
            step: "entry_create.network_request",
        }), { scopedKey });
        if (!res.ok)
            throw new Error(res.error || "Create entry failed");
        const canonical = {
            ...res.entry,
            id: res.id ?? optimistic.id,
        };
        traceApiResponse("entries", optimistic.clientMutationId ?? clientMutationId, {
            entryId: canonical.id,
            optimisticId: optimistic.id,
            workspace: canonical.workspace,
        });
        if (await entryDeletionGuards.hasDeletedEntryGuard(workspaceId, canonical)) {
            await entryDeletionGuards.rememberDeletedEntry(workspaceId, canonical);
            traceReconciliation("entries", optimistic.clientMutationId ?? clientMutationId, "optimistic_dropped_deleted_guard", {
                entryId: canonical.id,
                reason: "deletion_guard_matched",
            });
            try {
                const deleteResponse = await deleteEntry(workspaceId, canonical.id);
                if (deleteResponse.ok) {
                    void useEntriesStore.getState().refreshFromBackend(workspaceId, optimistic.periodId, { force: true });
                }
            }
            catch (error) {
                if (!shouldQueueOfflineMutation(error)) {
                    throw error;
                }
            }
            trace?.mark("entry_create.deleted_before_reconcile", {
                entryId: canonical.id,
                clientMutationId,
            });
            return;
        }
        await withProfileStep(
            trace,
            "entry_create.canonical_write",
            () => persistEntriesForPeriod(
                workspaceId,
                optimistic.periodId,
                scopedKey,
                (current) => current.map((entry) =>
                    matchesEntryIdentity(entry, optimistic) ? canonical : entry
                )
            ),
            { scopedKey }
        );
        traceReconciliation("entries", optimistic.clientMutationId ?? clientMutationId, "optimistic_replaced_canonical", {
            optimisticId: optimistic.id,
            canonicalId: canonical.id,
            scopedKey,
        });
        traceCacheWrite("entries", optimistic.clientMutationId ?? clientMutationId, "canonical_write", {
            entryId: canonical.id,
            scopedKey,
        });
        trace?.mark("entry_create.canonical_write_complete", { entryId: canonical.id });
        if (canonical.workspace === "independent") {
            invalidateProfitLossView(workspaceId);
        }
        const postWriteEntries =
            useEntriesStore.getState().byWorkspaceId[workspaceId]?.entries ?? [];
        scheduleTimeReminderDateSync(workspaceId, settings, postWriteEntries, [canonical.date]);
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        trace?.mark("entry_create.complete", {
            source: "network",
            entryId: canonical.id,
        });
    }
    catch (error) {
        if (shouldQueueOfflineMutation(error)) {
            await updateOptimisticEntry(workspaceId, optimistic.periodId, scopedKey, optimistic.id, (entry) => ({
                ...entry,
                syncState: "queued",
            }));
            showQueuedEntryToast();
            traceQueueAdd("entries", optimistic.clientMutationId ?? clientMutationId, {
                entryId: optimistic.id,
                reason: "network_failure_requeue",
            });
            trace?.mark("entry_create.queued", {
                entryId: optimistic.id,
                scopedKey,
            });
            return;
        }
        traceReconciliation("entries", optimistic.clientMutationId ?? clientMutationId, "rollback_applied", {
            entryId: optimistic.id,
            reason: "permanent_api_failure",
        });
        await removeOptimisticEntry(workspaceId, optimistic.periodId, scopedKey, optimistic.id);
        showPermanentEntryFailureToast(error);
        trace?.mark("entry_create.rolled_back", {
            entryId: optimistic.id,
            scopedKey,
        });
        throw error;
    }
}
async function reconcileOptimisticEntryUpdate(
    workspaceId: string,
    settings: SettingsType,
    scopedKey: string,
    entryId: string,
    periodId: string,
    payload: any,
    existingDate: string | null
): Promise<any> {
    const res = await editEntry(workspaceId, entryId, payload);
    if (!res.ok)
        throw new Error(res.error || "Update failed");
    const canonical = {
        ...res.entry,
        id: res.id ?? entryId,
    };
    // Cache write failures (e.g. schema drift on the canonical response) must not
    // propagate as edit failures — the PATCH already succeeded on the backend.
    // The store is updated synchronously inside persistEntriesForPeriod; a cache
    // miss here is self-healing on next backend refresh.
    try {
        await persistEntriesForPeriod(
            workspaceId,
            periodId,
            scopedKey,
            (current) => current.map((entry) => {
                if (entry.id !== entryId) return entry;
                // ME-1: discard stale response if the store already has a newer edit.
                // Two rapid PATCHs in flight can arrive out of order; keep whichever
                // has the later updatedAtLocal so the most recent edit always wins.
                const currentUpdated = Date.parse((entry as any).updatedAtLocal ?? "");
                const canonicalUpdated = Date.parse((canonical as any).updatedAtLocal ?? "");
                if (!isNaN(currentUpdated) && !isNaN(canonicalUpdated) && currentUpdated > canonicalUpdated) {
                    return entry;
                }
                return canonical;
            })
        );
    } catch (cacheErr) {
        debugLog("entries-service", "canonical_cache_write_failed", {
            entryId,
            error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
    }
    if (canonical.workspace === "independent") {
        invalidateProfitLossView(workspaceId);
    }
    const postWriteEntries =
        useEntriesStore.getState().byWorkspaceId[workspaceId]?.entries ?? [];
    scheduleTimeReminderDateSync(
        workspaceId,
        settings,
        postWriteEntries,
        [existingDate, canonical.date]
    );
    scheduleGeofenceEntryStatusResync(workspaceId, settings);
    return canonical;
}
// ------------------------------------------------------------
// CREATE ENTRY
// ------------------------------------------------------------
// CHANGE: createEntry is now workspace-scoped and requires workspaceId
export async function createEntry(workspaceId: string, rawInput: any, options: {
    trace?: {
        traceId: string;
        flow: string;
    } | null;
} = {}) {
    const diagTraceId = makeTraceId("entry_create");
    const trace = options.trace
        ? createProfileTrace(options.trace.flow, { workspaceId }, options.trace.traceId)
        : null;
    // CHANGE: load workspace-scoped settings (uid completely removed)
    // If loadForWorkspace does not exist yet, it must be implemented separately.
    const settings = await withProfileStep(trace, "entry_create.settings_load", () => settingsService.loadForWorkspace(workspaceId, false, {
        trace: options.trace ?? null,
    }), { workspaceId });
    if (!settings) {
        throw new Error("Settings required to create entry");
    }
    const parsed = rawInput; // already validated by EntryForm
    const periodId = getPeriodId(settings, parsed.workspace, parsed.date);
    // CHANGE: cache key is now workspace-scoped to avoid cross-workspace collisions
    const scopedKey = `${workspaceId}::${periodId}`;
    const nowIso = new Date().toISOString();
    const tempId = `tmp-${uuid()}`;
    const clientMutationId = uuid();
    const isOnline = getIsOnline();
    const initialSyncState: "pending" | "queued" = isOnline ? "pending" : "queued";
    const createdAtLocal = parsed.createdAtLocal ?? nowIso;
    const updatedAtLocal = parsed.updatedAtLocal ?? parsed.createdAtLocal ?? nowIso;

    diagTrace({
        category: "entries",
        layer: "store",
        event: "ENTRY_CREATE",
        phase: "initiated",
        traceId: diagTraceId,
        data: { workspaceId, periodId, scopedKey, workspace: parsed.workspace, date: parsed.date, isOnline },
        level: "normal",
    });

    // CHANGE: computeOptimistic now uses settings.workspaceType internally
    trace?.start("entry_create.optimistic_compute");
    const { totals } = computeOptimistic(settings, parsed);
    trace?.end("entry_create.optimistic_compute", {
        workspaceType: parsed.workspace,
    });
    // CHANGE: optimistic entry is now workspace-scoped and self-describing
    const optimistic = {
        id: tempId,
        clientMutationId,
        syncState: initialSyncState,
        workspace: parsed.workspace,
        periodId,
        date: parsed.date,
        notes: parsed.notes ?? "",
        createdAtLocal,
        updatedAtLocal,
        w2: parsed.workspace === "w2" ? { ...parsed.w2 } : undefined,
        independent: parsed.workspace === "independent"
            ? { ...parsed.independent }
            : undefined,
        totals,
    };

    traceStoreUpdate("entries", diagTraceId, "ENTRY_CREATE", {
        phase: "optimistic_update",
        entryId: tempId,
        workspace: parsed.workspace,
        date: parsed.date,
        syncState: initialSyncState,
    });

    await withProfileStep(
        trace,
        "entry_create.optimistic_write",
        () => persistEntriesForPeriod(
            workspaceId,
            periodId,
            scopedKey,
            (current) => [optimistic, ...current]
        ),
        { scopedKey }
    );

    traceCacheWrite("entries", diagTraceId, "optimistic_write", { scopedKey, entryId: tempId });

    trace?.mark("entry_create.ui_row_visible", { scopedKey, entryId: tempId });
    const postOptimisticEntries =
        useEntriesStore.getState().byWorkspaceId[workspaceId]?.entries ?? [];
    scheduleTimeReminderDateSync(workspaceId, settings, postOptimisticEntries, [optimistic.date]);
    // OFFLINE: queue mutation + update store
    if (!isOnline) {
        try {
            await offlineQueue.enqueue({
                id: clientMutationId,
                workspaceId,
                ts: Date.now(),
                endpoint: `/api/workspaces/${workspaceId}/entries`,
                method: "POST",
                body: {
                    workspace: parsed.workspace,
                    date: parsed.date,
                    notes: parsed.notes ?? "",
                    w2: parsed.w2,
                    independent: parsed.independent,
                    createdAtLocal,
                    updatedAtLocal,
                    clientMutationId,
                },
            });
            traceQueueAdd("entries", diagTraceId, {
                entryId: tempId,
                clientMutationId,
                endpoint: `/api/workspaces/${workspaceId}/entries`,
                method: "POST",
            });
        } catch (_queueError) {
            // Storage write failed — entry is visible in the store but will not
            // replay on reconnect. Remove it and surface the failure to the caller.
            await removeOptimisticEntry(workspaceId, periodId, scopedKey, tempId).catch(() => {});
            throw new Error("Device storage is full. Free up space and try again.");
        }
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        showQueuedEntryToast();
        trace?.mark("entry_create.complete", {
            source: "offline",
        });
        diagTrace({
            category: "entries",
            layer: "queue",
            event: "ENTRY_CREATE",
            phase: "complete_offline",
            traceId: diagTraceId,
            data: { entryId: tempId, reason: "offline_queued" },
            level: "normal",
        });
        return optimistic;
    }
    if (parsed.workspace === "independent") {
        invalidateProfitLossView(workspaceId);
    }
    traceApiRequest("entries", diagTraceId, {
        endpoint: `/api/workspaces/${workspaceId}/entries`,
        method: "POST",
        entryId: tempId,
        clientMutationId,
    });
    void reconcileOptimisticEntry(workspaceId, settings, scopedKey, clientMutationId, optimistic, parsed, trace).catch((error) => {
        traceApiFailure("entries", diagTraceId, error, { entryId: tempId, clientMutationId });
        trace?.error("entry_create.failed", error);
    });
    return optimistic;
}
// ------------------------------------------------------------
// UPDATE ENTRY
// ------------------------------------------------------------
// CHANGE: updateEntry is now workspace-scoped and requires workspaceId
export async function updateEntry(workspaceId: string, entryId: string, patch: any) {
    const diagTraceId = makeTraceId("entry_update");
    diagTrace({
        category: "entries",
        layer: "store",
        event: "ENTRY_UPDATE",
        phase: "initiated",
        traceId: diagTraceId,
        data: { workspaceId, entryId },
        level: "normal",
    });
    const settings = await settingsService.loadForWorkspace(workspaceId);
    if (!settings) {
        throw new Error("Settings required to update entry");
    }
    const visibleStoreEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    const periodId =
        visibleStoreEntry?.entries.find((entry) => entry.id === entryId)?.periodId ??
        visibleStoreEntry?.periodId ??
        getPeriodId(settings, getWorkspaceTypeForWorkspaceId(workspaceId));
    const scopedKey = `${workspaceId}::${periodId}`;
    const nowIso = new Date().toISOString();
    const clientMutationId = uuid();
    // Read snapshot for existence check, existingDate (HR-1), and queue/payload body.
    const list = await getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey);
    const existing = list.find((e) => e.id === entryId);
    if (!existing) throw new Error("Entry not found locally");
    // HR-1: captured before any await boundary.
    const existingDate = (existing as any).date ?? null;
    const snapshotMerged = {
        ...existing,
        ...patch,
        w2: { ...(existing as any).w2, ...(patch.w2 ?? {}) },
        independent: { ...(existing as any).independent, ...(patch.independent ?? {}) },
    };
    traceStoreUpdate("entries", diagTraceId, "ENTRY_UPDATE", {
        phase: "optimistic_mutation",
        entryId,
        periodId,
        scopedKey,
    });
    // HR-2: optimistic display merges against live store state inside the updater.
    await persistEntriesForPeriod(
        workspaceId,
        periodId,
        scopedKey,
        (current) => {
            const live = current.find((e) => e.id === entryId);
            if (!live) return current;
            const liveMerged = {
                ...live,
                ...patch,
                w2: { ...(live as any).w2, ...(patch.w2 ?? {}) },
                independent: { ...(live as any).independent, ...(patch.independent ?? {}) },
            };
            const { totals } = computeOptimistic(settings, liveMerged);
            const liveOptimistic = {
                ...liveMerged,
                workspace: live.workspace,
                totals,
                syncState: (getIsOnline() ? "pending" : "queued") as "pending" | "queued",
                updatedAtLocal: nowIso,
            };
            return current.map((e) => e.id === entryId ? liveOptimistic : e);
        }
    );
    const postOptimisticEntries =
        useEntriesStore.getState().byWorkspaceId[workspaceId]?.entries ?? [];
    scheduleTimeReminderDateSync(
        workspaceId,
        settings,
        postOptimisticEntries,
        [existingDate, snapshotMerged.date]
    );
    if (!getIsOnline()) {
        // RO-2: If this entry has never reached the backend (tmp- ID), we cannot
        // PATCH it — that endpoint doesn't exist yet. Instead, replace the already-
        // queued POST body with the latest merged state so replay sends the correct
        // payload in a single request.
        if (isLocalOnlyOptimisticEntry(existing)) {
            const existingClientMutationId = (existing as any).clientMutationId as string | undefined;
            if (existingClientMutationId) {
                await offlineQueue.removeMatching(
                    (mutation) =>
                        mutation.method === "POST" &&
                        typeof mutation.body?.clientMutationId === "string" &&
                        mutation.body.clientMutationId === existingClientMutationId
                ).catch(() => {});
                await offlineQueue.enqueue({
                    id: existingClientMutationId,
                    workspaceId,
                    ts: Date.now(),
                    endpoint: `/api/workspaces/${workspaceId}/entries`,
                    method: "POST",
                    body: {
                        workspace: (snapshotMerged as any).workspace,
                        date: snapshotMerged.date,
                        notes: snapshotMerged.notes,
                        w2: (snapshotMerged as any).w2,
                        independent: (snapshotMerged as any).independent,
                        createdAtLocal: (existing as any).createdAtLocal,
                        updatedAtLocal: nowIso,
                        clientMutationId: existingClientMutationId,
                    },
                }).catch(() => {});
                traceQueueAdd("entries", diagTraceId, { entryId, method: "POST", reason: "offline_edit_of_optimistic_entry" });
            }
            scheduleGeofenceEntryStatusResync(workspaceId, settings);
            return;
        }

        try {
            await offlineQueue.enqueue({
                id: entryId,
                workspaceId,
                ts: Date.now(),
                endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
                method: "PATCH",
                body: {
                    date: snapshotMerged.date,
                    notes: snapshotMerged.notes,
                    w2: (snapshotMerged as any).w2,
                    independent: (snapshotMerged as any).independent,
                    updatedAtLocal: nowIso,
                    clientMutationId,
                },
            });
            traceQueueAdd("entries", diagTraceId, { entryId, method: "PATCH", reason: "offline" });
        } catch (_queueError) {
            // Storage write failed — roll back the optimistic edit.
            void persistEntriesForPeriod(
                workspaceId,
                periodId,
                scopedKey,
                (current) => current.map((e) => e.id === entryId ? existing : e)
            ).catch(() => {});
            toast({
                title: "Edit not saved",
                description: "Your device storage could not accept the change. Free up space and try again.",
                variant: "destructive",
            });
            return;
        }
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        return;
    }
    if ((existing as any).workspace === "independent") {
        invalidateProfitLossView(workspaceId);
    }
    const payload = {
        date: snapshotMerged.date,
        notes: snapshotMerged.notes,
        w2: (snapshotMerged as any).w2,
        independent: (snapshotMerged as any).independent,
        updatedAtLocal: nowIso,
        clientMutationId,
    };
    traceApiRequest("entries", diagTraceId, { entryId, method: "PATCH", endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}` });
    // HR-1: pass existingDate rather than optimisticList.
    // On retryable failure: mark as queued and enqueue for replay.
    // On permanent failure: roll back optimistic state and notify the user.
    void reconcileOptimisticEntryUpdate(
        workspaceId, settings, scopedKey, entryId, periodId, payload, existingDate
    ).catch(async (error) => {
        if (shouldQueueOfflineMutation(error)) {
            void persistEntriesForPeriod(
                workspaceId,
                periodId,
                scopedKey,
                (current) => current.map((e) => e.id === entryId ? { ...e, syncState: "queued" as const } : e)
            ).catch(() => {});
            await offlineQueue.enqueue({
                id: entryId,
                workspaceId,
                ts: Date.now(),
                endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
                method: "PATCH",
                body: payload,
            }).catch(() => {});
            showQueuedEntryToast();
            return;
        }
        void persistEntriesForPeriod(
            workspaceId,
            periodId,
            scopedKey,
            (current) => current.map((e) => e.id === entryId ? existing : e)
        ).catch(() => {});
        showPermanentEntryFailureToast(error);
    });
}
// ------------------------------------------------------------
// DELETE ENTRY
// ------------------------------------------------------------
// CHANGE: removeEntry is now workspace-scoped and requires workspaceId
export async function removeEntry(workspaceId: string, entryId: string): Promise<void> {
    const diagTraceId = makeTraceId("entry_delete");
    diagTrace({
        category: "entries",
        layer: "store",
        event: "ENTRY_DELETE",
        phase: "initiated",
        traceId: diagTraceId,
        data: { workspaceId, entryId },
        level: "normal",
    });
    // CHANGE: load workspace-scoped settings (uid removed)
    const settings = await settingsService.loadForWorkspace(workspaceId);
    if (!settings) {
        throw new Error("Settings required to delete entry");
    }
    const visibleStoreEntry = useEntriesStore.getState().byWorkspaceId[workspaceId];
    const visiblePeriodId = visibleStoreEntry?.entries.find((entry) => entry.id === entryId)?.periodId ??
        visibleStoreEntry?.periodId ??
        getPeriodId(settings, getWorkspaceTypeForWorkspaceId(workspaceId));
    const scopedKey = `${workspaceId}::${visiblePeriodId}`;
    const list = await getCurrentEntriesForPeriod(workspaceId, visiblePeriodId, scopedKey);
    const removedEntry = list.find((entry) => entry.id === entryId);
    if (!removedEntry) {
        return;
    }
    traceStoreUpdate("entries", diagTraceId, "ENTRY_DELETE", {
        phase: "optimistic_removal",
        entryId,
        scopedKey,
    });
    await entryDeletionGuards.rememberDeletedEntry(workspaceId, removedEntry);
    await persistEntriesForPeriod(
        workspaceId,
        visiblePeriodId,
        scopedKey,
        (current) => current.filter((e) => e.id !== entryId)
    );
    const postDeleteEntries =
        useEntriesStore.getState().byWorkspaceId[workspaceId]?.entries ?? [];
    scheduleTimeReminderDateSync(
        workspaceId,
        settings,
        postDeleteEntries,
        [(removedEntry as any).date]
    );
    if (isLocalOnlyOptimisticEntry(removedEntry) && removedEntry.clientMutationId) {
        const removedQueuedCreates = await offlineQueue.removeMatching((mutation) => mutation.workspaceId === workspaceId &&
            mutation.method === "POST" &&
            typeof mutation.body?.clientMutationId === "string" &&
            mutation.body.clientMutationId === removedEntry.clientMutationId);
        if (removedQueuedCreates > 0) {
            await entryDeletionGuards.clearDeletedEntryGuard(workspaceId, removedEntry);
        }
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        return;
    }
    // OFFLINE — enqueue deletion
    if (!getIsOnline()) {
        try {
            await offlineQueue.enqueue({
                id: entryId,
                workspaceId,
                ts: Date.now(),
                endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
                method: "DELETE",
                body: null,
            });
        } catch (_queueError) {
            // Storage write failed — entry is hidden locally but will never replay.
            // Restore the entry and clear the deletion guard so the user can retry.
            void persistEntriesForPeriod(
                workspaceId,
                visiblePeriodId,
                scopedKey,
                (current) => {
                    const alreadyPresent = current.some((e) => e.id === entryId);
                    return alreadyPresent ? current : [removedEntry, ...current];
                }
            ).catch(() => {});
            void entryDeletionGuards.clearDeletedEntryGuard(workspaceId, removedEntry).catch(() => {});
            toast({
                title: "Entry not deleted",
                description: "Your device storage could not accept the change. Free up space and try again.",
                variant: "destructive",
            });
            return;
        }
        await resyncWorkspaceReminders(workspaceId, settings);
        return;
    }
    // CHANGE: API call is now workspace-scoped
    try {
        const res = await deleteEntry(workspaceId, entryId);
        if (!res.ok) {
            throw new Error("Delete failed: " + (res.error || "unknown error"));
        }
        if (removedEntry.workspace === "independent") {
            invalidateProfitLossView(workspaceId);
        }
        void useEntriesStore.getState().refreshFromBackend(workspaceId, visiblePeriodId, { force: true });
    }
    catch (error) {
        if (shouldQueueOfflineMutation(error)) {
            // DR-1: enqueue the DELETE so replayPending() retries on reconnect.
            // The deletion guard remains active as a safety net regardless.
            await offlineQueue.enqueue({
                id: entryId,
                workspaceId,
                ts: Date.now(),
                endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
                method: "DELETE",
                body: null,
            }).catch(() => {}); // guard settlement is the fallback if this fails
            scheduleGeofenceEntryStatusResync(workspaceId, settings);
            return;
        }
        throw error;
    }
    scheduleGeofenceEntryStatusResync(workspaceId, settings);
}
