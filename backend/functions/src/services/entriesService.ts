// /functions/src/services/entriesService.ts
// /functions/src/services/entriesService.ts
import { db } from "../admin";
import { FieldValue } from "firebase-admin/firestore";
import { EntrySchema, type EntryType } from "@shared/schemas/entry";
import { getCurrentEntryPeriod, getCurrentPayPeriod } from "@shared/payPeriods";
import { computeEntry } from "@shared/computeEntry";
import { SettingsDocSchema, SettingsType } from "@shared/schemas/settings";
import { settingsCache, SETTINGS_TTL_MS } from "./settingsCache";
import { ForbiddenError, NotFoundError, BadRequestError } from "../lib/httpErrors";
import type { BackendProfileTrace } from "../lib/profileTrace";
import { withBackendProfileStep } from "../lib/profileTrace";
import { syncProfitLossForFinancialDates } from "./profitLossService";
import { syncPayStubForDates } from "./payStubsService";
const noopTrace: BackendProfileTrace = {
    traceId: "entry-create-no-trace",
    flow: "entry_create",
    mark: () => { },
    start: () => { },
    end: () => { },
    error: () => { },
};
async function syncIndependentProfitLossDates(workspaceId: string, dates: Array<string | null | undefined>) {
    const normalizedDates = dates.filter((date): date is string => typeof date === "string" && date.length > 0);
    if (normalizedDates.length === 0) {
        return;
    }
    try {
        await syncProfitLossForFinancialDates(workspaceId, normalizedDates);
    }
    catch (error) {
        console.warn("profit loss sync failed after entry mutation", {
            workspaceId,
            dates: normalizedDates,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function syncW2PayStubDates(workspaceId: string, uid: string, dates: Array<string | null | undefined>) {
    const normalizedDates = dates.filter((date): date is string => typeof date === "string" && date.length > 0);
    if (normalizedDates.length === 0) {
        return;
    }
    try {
        await syncPayStubForDates(workspaceId, uid, normalizedDates);
    }
    catch (error) {
        console.warn("pay stub sync failed after entry mutation", {
            workspaceId,
            dates: normalizedDates,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function assertWorkspaceMembership(workspaceId: string, uid: string): Promise<void> {
    const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get();
    if (!memberSnap.exists) {
        throw new ForbiddenError("Forbidden");
    }
}
/**
 * List entries for a user, scoped to the current pay period by default.
 * Optional: pass forceFull = true to load all entries (for reports or admin).
 */
export async function listEntries(workspaceId: string, uid: string, opts?: {
    periodId?: string;
    limit?: number;
    cursorId?: string;
    forceFull?: boolean;
}) {
    await assertWorkspaceMembership(workspaceId, uid);
    const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 1000);
    const requiresSettingsForPeriodResolution = !opts?.forceFull && !opts?.periodId;
    let settings: SettingsType | null = null;
    if (requiresSettingsForPeriodResolution) {
        // Load settings only when the client did not provide an exact period.
        let settingsData: any = settingsCache[workspaceId]?.data;
        const isExpired = !settingsCache[workspaceId] ||
            Date.now() - settingsCache[workspaceId].ts > SETTINGS_TTL_MS;
        if (!settingsData || isExpired) {
            const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get();
            settingsData = snap.exists ? snap.data() : null;
            if (settingsData) {
                settingsCache[workspaceId] = { data: settingsData, ts: Date.now() };
            }
        }
        const parsedSettings = settingsData ? SettingsDocSchema.safeParse(settingsData) : null;
        settings = parsedSettings?.success ? parsedSettings.data : null;
    }
    let start: string | undefined;
    let end: string | undefined;
    let exactPeriodId: string | undefined;
    // Honor the exact period requested by the client first.
    if (!opts?.forceFull && opts?.periodId) {
        if (opts.periodId.includes("_")) {
            const [requestedStart, requestedEnd] = opts.periodId.split("_");
            if (requestedStart && requestedEnd) {
                start = requestedStart;
                end = requestedEnd;
            }
        }
        else {
            exactPeriodId = opts.periodId;
        }
    }
    // Fall back to current pay period only when the client did not request one.
    if (!opts?.forceFull && !start && !end && !exactPeriodId && settings) {
        try {
            const range = getCurrentPayPeriod(settings);
            start = range.start;
            end = range.end;
        }
        catch (err) {
        }
    }
    let q = db.collection(`workspaces/${workspaceId}/entries`).orderBy("date", "desc");
    if (exactPeriodId) {
        q = q.where("periodId", "==", exactPeriodId);
    }
    else if (start && end) {
        q = q.where("date", ">=", start).where("date", "<=", end);
    }
    q = q.limit(limit);
    // Pagination cursor support
    if (opts?.cursorId) {
        const cur = await db.doc(`workspaces/${workspaceId}/entries/${opts.cursorId}`).get();
        if (cur.exists)
            q = q.startAfter(cur);
    }
    const snap = await q.get();
    // CHANGE (BACKEND SURGICAL EDIT SET #1):
    // Normalize Firestore data to the new nested EntrySchema shape:
    // - workspace + periodId + date + notes at root
    // - w2 nested block for W2 workspace
    // - independent nested block for independent workspace
    // - totals nested block for derived totals
    const entries = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        try {
            return EntrySchema.parse({
                id: d.id,
                ...raw,
            });
        }
        catch (error) {
            throw error;
        }
    });
    const nextCursor = snap.size ? snap.docs[snap.size - 1].id : null;
    return { entries, nextCursor, start, end };
}
/**
 * Create a new entry (transactional, idempotent-safe).
 */
export async function createEntry(workspaceId: string, uid: string, input: unknown, trace?: BackendProfileTrace) {
    const activeTrace = trace ?? noopTrace;
    await withBackendProfileStep(activeTrace, "entry_create.membership_check", () => assertWorkspaceMembership(workspaceId, uid), { workspaceId, uid });
    // ----------------------------
    // 1. VALIDATE RAW INPUT
    // ----------------------------
    const raw = input as any;
    // CHANGE (BACKEND SURGICAL EDIT SET #2):
    // Normalize nested blocks from incoming payload (frontend sends nested EntrySchema).
    const isW2 = raw.workspace === "w2";
    const w2 = isW2 ? (raw.w2 ?? {}) : undefined;
    const independent = !isW2 ? (raw.independent ?? {}) : undefined;
    const nowIso = new Date().toISOString();
    // ----------------------------
    // 2. LOAD SETTINGS (cache-first)
    // ----------------------------
    let settingsData: any = settingsCache[workspaceId]?.data;
    const expired = !settingsCache[workspaceId] ||
        Date.now() - settingsCache[workspaceId].ts > SETTINGS_TTL_MS;
    if (!settingsData || expired) {
        const snap = await withBackendProfileStep(activeTrace, "entry_create.settings_fetch", () => db.doc(`workspaces/${workspaceId}/settings/current`).get(), { workspaceId });
        settingsData = snap.exists ? snap.data() : null;
        if (settingsData) {
            settingsCache[workspaceId] = { data: settingsData, ts: Date.now() };
        }
    }
    const parsedSettings = settingsData ? SettingsDocSchema.safeParse(settingsData) : null;
    if (!parsedSettings?.success) {
        throw new BadRequestError("Cannot create entry without valid settings");
    }
    const settings = parsedSettings.data;
    const workspaceType = raw.workspace === "independent" ? "independent" : "w2";
    const periodId = getCurrentEntryPeriod(settings, workspaceType, raw.date).periodId;
    // CHANGE (BACKEND SURGICAL EDIT SET #2):
    // computeEntry now receives the full nested entry payload (workspace + w2/independent).
    const optimisticTotals = computeEntry({
        workspace: raw.workspace,
        date: raw.date,
        w2,
        independent,
    }, settings);
    const createdAtLocal = raw.createdAtLocal ?? nowIso;
    const clientMutationId = raw.clientMutationId;
    // CHANGE (BACKEND SURGICAL EDIT SET #2):
    // Firestore storage now matches EntrySchema exactly:
    // { workspace, periodId, date, notes, w2?, independent?, totals, createdAtLocal, updatedAtLocal, clientMutationId }
    const entryToWrite = {
        workspace: raw.workspace,
        periodId,
        date: raw.date,
        notes: raw.notes ?? "",
        ...(w2 ? { w2 } : {}),
        ...(independent ? { independent } : {}),
        totals: optimisticTotals,
        createdAtLocal,
        updatedAtLocal: createdAtLocal,
        clientMutationId,
    };
    const canonical: EntryType = EntrySchema.parse(entryToWrite);
    // ----------------------------
    // 6. WRITE TO FIRESTORE — idempotent on clientMutationId.
    // ----------------------------
    // A deterministic doc id + atomic .create() (Firestore rejects with
    // ALREADY_EXISTS if the doc is already there) replaces the old
    // "query for an existing clientMutationId, then .add() if none found"
    // check. That pattern was a check-then-act race: two concurrent requests
    // carrying the same clientMutationId — e.g. the frontend's own fetch
    // retry firing while the first request is still mid-flight after a slow
    // reconnect — could both pass the "not found" check and both .add(),
    // producing two real entries with the same clientMutationId. .create()
    // is atomic at the storage layer, so only one concurrent writer can ever
    // win regardless of timing.
    const docRef = typeof clientMutationId === "string" && clientMutationId.length > 0
        ? db.collection(`workspaces/${workspaceId}/entries`).doc(`cmid_${clientMutationId}`)
        : db.collection(`workspaces/${workspaceId}/entries`).doc();
    try {
        await withBackendProfileStep(activeTrace, "entry_create.firestore_write", () => docRef.create(canonical), { workspaceId, periodId });
    }
    catch (err: any) {
        if (err?.code === 6) {
            // Lost the race to a concurrent request with the same
            // clientMutationId — return what it wrote instead of erroring.
            const existingSnap = await docRef.get();
            return {
                ok: true,
                id: docRef.id,
                entry: EntrySchema.parse({ id: docRef.id, ...existingSnap.data() }),
            };
        }
        throw err;
    }
    if (canonical.workspace === "independent") {
        await syncIndependentProfitLossDates(workspaceId, [canonical.date]);
    }
    else if (canonical.workspace === "w2") {
        await syncW2PayStubDates(workspaceId, uid, [canonical.date]);
    }
    return {
        ok: true,
        id: docRef.id,
        entry: canonical,
    };
}
export async function updateEntry(workspaceId: string, uid: string, entryId: string, patch: unknown) {
    await assertWorkspaceMembership(workspaceId, uid);
    const nowIso = new Date().toISOString();
    const patchData = patch as any;
    const ref = db.doc(`workspaces/${workspaceId}/entries/${entryId}`);
    let finalEntry: EntryType | null = null;
    let previousEntry: EntryType | null = null;
    // CHANGE: capture clientMutationId from frontend patch if provided.
    const clientMutationId = patchData.clientMutationId;
    await db.runTransaction(async (tx) => {
        // ---------------------------
        // 1. Load existing entry
        // ---------------------------
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new NotFoundError("Entry not found");
        const existing = EntrySchema.parse({
            id: snap.id,
            ...snap.data(),
        });
        previousEntry = existing;
        // ---------------------------
        // 2. Merge existing + patch (deep merge for nested blocks)
        //    FRONTEND sends partial patches for w2/independent.
        // ---------------------------
        const merged: any = {
            ...existing,
            ...patchData,
            w2: {
                ...(existing as any).w2,
                ...(patchData.w2 ?? {}),
            },
            independent: {
                ...(existing as any).independent,
                ...(patchData.independent ?? {}),
            },
        };
        // ---------------------------
        // 3. Load settings (cache-first)
        // ---------------------------
        let settingsData: any = settingsCache[workspaceId]?.data;
        const expired = !settingsCache[workspaceId] ||
            Date.now() - settingsCache[workspaceId].ts > SETTINGS_TTL_MS;
        if (!settingsData || expired) {
            const settingsSnap = await db.doc(`workspaces/${workspaceId}/settings/current`).get();
            settingsData = settingsSnap.exists ? settingsSnap.data() : null;
            if (settingsData) {
                settingsCache[workspaceId] = { data: settingsData, ts: Date.now() };
            }
        }
        const parsedSettings = settingsData
            ? SettingsDocSchema.safeParse(settingsData)
            : null;
        if (!parsedSettings?.success) {
            throw new BadRequestError("Cannot update entry without valid settings");
        }
        const settings = parsedSettings.data;
        // ---------------------------
        // 4. Recompute totals from full nested entry
        // ---------------------------
        // CHANGE (BACKEND SURGICAL EDIT SET #3 & #4):
        // computeEntry now consumes the full merged entry rather than flat fields.
        merged.periodId = getCurrentEntryPeriod(settings, merged.workspace === "independent" ? "independent" : "w2", merged.date).periodId;
        const newTotals = computeEntry(merged, settings);
        merged.totals = newTotals;
        // ---------------------------
        // 5. Build backend update payload in canonical EntrySchema shape
        // ---------------------------
        // CHANGE (BACKEND SURGICAL EDIT SET #3):
        // Exclusively store w2 vs independent based on workspace.
        const updatePayload: any = {
            workspace: merged.workspace,
            periodId: merged.periodId,
            date: merged.date,
            notes: merged.notes,
            ...(merged.workspace === "w2" && merged.w2 ? { w2: merged.w2 } : {}),
            ...(merged.workspace === "independent" && merged.independent
                ? { independent: merged.independent }
                : {}),
            totals: merged.totals,
            createdAtLocal: (existing as any).createdAtLocal ?? nowIso,
            updatedAtLocal: nowIso,
            clientMutationId,
        };
        finalEntry = updatePayload as EntryType;
        // ---------------------------
        // 6. Commit to Firestore
        // ---------------------------
        tx.set(ref, updatePayload);
    });
    const updatedEntry = finalEntry as EntryType | null;
    const priorEntry = previousEntry as EntryType | null;
    if (!updatedEntry) {
        throw new Error("Entry update failed");
    }
    if (priorEntry?.workspace === "independent" || updatedEntry.workspace === "independent") {
        await syncIndependentProfitLossDates(workspaceId, [priorEntry?.date, updatedEntry.date]);
    }
    else if (priorEntry?.workspace === "w2" || updatedEntry.workspace === "w2") {
        await syncW2PayStubDates(workspaceId, uid, [priorEntry?.date, updatedEntry.date]);
    }
    // ---------------------------
    // 7. Return canonical entry
    // ---------------------------
    return {
        ok: true,
        id: entryId,
        entry: updatedEntry,
    };
}
/**
 * Canonical Delete Entry (Fully aligned with frontend expectations)
 */
export async function deleteEntry(workspaceId: string, uid: string, entryId: string) {
    await assertWorkspaceMembership(workspaceId, uid);
    const ref = db.doc(`workspaces/${workspaceId}/entries/${entryId}`);
    let deleted = false;
    let deletedEntry: EntryType | null = null;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        // Idempotent delete — no error if entry doesn't exist
        if (!snap.exists) {
            deleted = false;
            return;
        }
        deletedEntry = EntrySchema.parse({
            id: snap.id,
            ...snap.data(),
        });
        // Perform deletion
        tx.delete(ref);
        deleted = true;
        // Audit log
        tx.set(db.collection("deletions").doc(), {
            uid,
            workspaceId,
            entryId,
            deletedAt: FieldValue.serverTimestamp(),
            path: ref.path,
        });
    });
    const removedEntry = deletedEntry as EntryType | null;
    if (removedEntry?.workspace === "independent") {
        await syncIndependentProfitLossDates(workspaceId, [removedEntry.date]);
    }
    else if (removedEntry?.workspace === "w2") {
        await syncW2PayStubDates(workspaceId, uid, [removedEntry.date]);
    }
    return {
        ok: true,
        id: entryId,
        deleted,
    };
}
