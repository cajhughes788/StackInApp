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
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { syncWorkspaceGeofenceEntryStatus } from "@/lib/mobile/geofenceReminderSync";
import { syncWorkspaceTimeEntryReminderForDate } from "@/lib/mobile/timeEntryReminderSync";
import { debugLog } from "@/lib/debugLoop";
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
async function persistEntriesForPeriod(workspaceId: string, periodId: string, scopedKey: string, entries: any[]) {
    await domainEntries.saveEntries(scopedKey, entries);
    publishEntriesToVisibleStore(workspaceId, entries, periodId);
}
async function updateOptimisticEntry(workspaceId: string, periodId: string, scopedKey: string, entryId: string, updater: (entry: any) => any) {
    const current = await getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey);
    const next = current.map((entry) => entry.id === entryId ? updater(entry) : entry);
    await persistEntriesForPeriod(workspaceId, periodId, scopedKey, next);
    return next;
}
async function removeOptimisticEntry(workspaceId: string, periodId: string, scopedKey: string, entryId: string) {
    const current = await getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey);
    const next = current.filter((entry) => entry.id !== entryId);
    await persistEntriesForPeriod(workspaceId, periodId, scopedKey, next);
    return next;
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
async function reconcileOptimisticEntry(workspaceId: string, settings: SettingsType, scopedKey: string, clientMutationId: string, optimistic: any, optimisticList: any[], parsed: any, trace: ReturnType<typeof createProfileTrace> | null) {
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
        const afterUpdate = optimisticList.map((entry) => entry.id === optimistic.id ? canonical : entry);
        await withProfileStep(trace, "entry_create.canonical_cache_write", () => domainEntries.saveEntries(scopedKey, afterUpdate), {
            scopedKey,
            entryCount: afterUpdate.length,
        });
        trace?.start("entry_create.canonical_store_update");
        publishEntriesToVisibleStore(workspaceId, afterUpdate, optimistic.periodId);
        trace?.end("entry_create.canonical_store_update", {
            entryId: canonical.id,
        });
        scheduleTimeReminderDateSync(workspaceId, settings, afterUpdate, [canonical.date]);
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
            trace?.mark("entry_create.queued", {
                entryId: optimistic.id,
                scopedKey,
            });
            return;
        }
        await removeOptimisticEntry(workspaceId, optimistic.periodId, scopedKey, optimistic.id);
        showPermanentEntryFailureToast(error);
        trace?.mark("entry_create.rolled_back", {
            entryId: optimistic.id,
            scopedKey,
        });
        throw error;
    }
}
async function reconcileOptimisticEntryUpdate(workspaceId: string, settings: SettingsType, scopedKey: string, entryId: string, periodId: string, payload: any, optimisticList: any[]) {
    const res = await editEntry(workspaceId, entryId, payload);
    if (!res.ok)
        throw new Error(res.error || "Update failed");
    const canonical = {
        ...res.entry,
        id: res.id ?? entryId,
    };
    const afterUpdate = optimisticList.map((entry) => entry.id === entryId ? canonical : entry);
    await domainEntries.saveEntries(scopedKey, afterUpdate);
    useEntriesStore.getState().setEntries(workspaceId, afterUpdate, periodId);
    const previousDateKey = optimisticList.find((entry) => entry.id === entryId)?.date ?? null;
    scheduleTimeReminderDateSync(workspaceId, settings, afterUpdate, [previousDateKey, canonical.date]);
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
    const existing = await withProfileStep(trace, "entry_create.local_cache_read", () => getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey), { scopedKey });
    const optimisticList = [optimistic, ...existing];
    await withProfileStep(trace, "entry_create.optimistic_cache_write", () => domainEntries.saveEntries(scopedKey, optimisticList), {
        scopedKey,
        entryCount: optimisticList.length,
    });
    trace?.start("entry_create.store_update");
    publishEntriesToVisibleStore(workspaceId, optimisticList, periodId);
    scheduleTimeReminderDateSync(workspaceId, settings, optimisticList, [optimistic.date]);
    trace?.end("entry_create.store_update", {
        source: "optimistic",
    });
    trace?.mark("entry_create.ui_row_visible", {
        scopedKey,
        entryId: tempId,
    });
    // OFFLINE: queue mutation + update store
    if (!isOnline) {
        // CHANGE: offline queue now captures workspaceId and workspace-scoped endpoint
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
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        showQueuedEntryToast();
        trace?.mark("entry_create.complete", {
            source: "offline",
        });
        return optimistic;
    }
    void reconcileOptimisticEntry(workspaceId, settings, scopedKey, clientMutationId, optimistic, optimisticList, parsed, trace).catch((error) => {
        trace?.error("entry_create.failed", error);
    });
    return optimistic;
}
// ------------------------------------------------------------
// UPDATE ENTRY
// ------------------------------------------------------------
// CHANGE: updateEntry is now workspace-scoped and requires workspaceId
export async function updateEntry(workspaceId: string, entryId: string, patch: any) {
    // CHANGE: load workspace-scoped settings (uid removed)
    const settings = await settingsService.loadForWorkspace(workspaceId);
    if (!settings) {
        throw new Error("Settings required to update entry");
    }
    const periodId = getPeriodId(settings, getWorkspaceTypeForWorkspaceId(workspaceId));
    // CHANGE: workspace-scoped cache key
    const scopedKey = `${workspaceId}::${periodId}`;
    const nowIso = new Date().toISOString();
    const clientMutationId = uuid();
    const list = await getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey);
    const existing = list.find((e) => e.id === entryId);
    if (!existing)
        throw new Error("Entry not found locally");
    // Deep merge to preserve nested blocks
    const rawMerged = {
        ...existing,
        ...patch,
        w2: {
            ...(existing as any).w2,
            ...(patch.w2 ?? {}),
        },
        independent: {
            ...(existing as any).independent,
            ...(patch.independent ?? {}),
        },
    };
    // CHANGE: computeOptimistic derives workspace from settings
    const { totals } = computeOptimistic(settings, rawMerged);
    const optimistic = {
        ...rawMerged,
        workspace: existing.workspace,
        totals,
        updatedAtLocal: nowIso,
    };
    const next = list.map((e) => (e.id === entryId ? optimistic : e));
    await domainEntries.saveEntries(scopedKey, next);
    useEntriesStore.getState().setEntries(workspaceId, next, periodId);
    scheduleTimeReminderDateSync(workspaceId, settings, next, [existing.date, optimistic.date]);
    // OFFLINE — enqueue patch + update store
    if (!getIsOnline()) {
        // CHANGE: offline queue captures workspaceId and scoped endpoint
        await offlineQueue.enqueue({
            id: entryId,
            workspaceId,
            ts: Date.now(),
            endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
            method: "PATCH",
            body: {
                date: rawMerged.date,
                notes: rawMerged.notes,
                w2: rawMerged.w2,
                independent: rawMerged.independent,
                updatedAtLocal: nowIso,
                clientMutationId,
            },
        });
        scheduleGeofenceEntryStatusResync(workspaceId, settings);
        return optimistic;
    }
    // CHANGE: API call is now workspace-scoped
    const payload = {
        date: rawMerged.date,
        notes: rawMerged.notes,
        w2: rawMerged.w2,
        independent: rawMerged.independent,
        updatedAtLocal: nowIso,
        clientMutationId,
    };
    void reconcileOptimisticEntryUpdate(workspaceId, settings, scopedKey, entryId, periodId, payload, next).catch((error) => {
    });
    return optimistic;
}
// ------------------------------------------------------------
// DELETE ENTRY
// ------------------------------------------------------------
// CHANGE: removeEntry is now workspace-scoped and requires workspaceId
export async function removeEntry(workspaceId: string, entryId: string): Promise<void> {
    // CHANGE: load workspace-scoped settings (uid removed)
    const settings = await settingsService.loadForWorkspace(workspaceId);
    if (!settings) {
        throw new Error("Settings required to delete entry");
    }
    const periodId = getPeriodId(settings, getWorkspaceTypeForWorkspaceId(workspaceId));
    // CHANGE: workspace-scoped cache key
    const scopedKey = `${workspaceId}::${periodId}`;
    const list = await getCurrentEntriesForPeriod(workspaceId, periodId, scopedKey);
    const removedEntry = list.find((entry) => entry.id === entryId);
    const next = list.filter((e) => e.id !== entryId);
    await domainEntries.saveEntries(scopedKey, next);
    // CHANGE: workspace-scoped store update
    useEntriesStore.getState().setEntries(workspaceId, next, periodId);
    scheduleTimeReminderDateSync(workspaceId, settings, next, [removedEntry?.date]);
    // OFFLINE — enqueue deletion
    if (!getIsOnline()) {
        // CHANGE: offline queue captures workspaceId and scoped endpoint
        await offlineQueue.enqueue({
            id: entryId,
            workspaceId,
            ts: Date.now(),
            endpoint: `/api/workspaces/${workspaceId}/entries/${entryId}`,
            method: "DELETE",
            body: null,
        });
        await resyncWorkspaceReminders(workspaceId, settings);
        return;
    }
    // CHANGE: API call is now workspace-scoped
    const res = await deleteEntry(workspaceId, entryId);
    if (!res.ok) {
        throw new Error("Delete failed: " + (res.error || "unknown error"));
    }
    scheduleGeofenceEntryStatusResync(workspaceId, settings);
}
