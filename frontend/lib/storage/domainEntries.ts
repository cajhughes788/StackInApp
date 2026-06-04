// storage/domainEntries.ts
// ------------------------------------------------------------
// Domain-level storage for ENTRIES ONLY. (Modernized for nested schema)
// ------------------------------------------------------------
// Responsibilities:
//   • Compute workspace-scoped entry cache keys
//   • Load/save/clear entries for a given scoped cache key
//   • List all cached scoped keys
//
// Updated responsibilities in this modernization:
//   • Ensure Zod validation aligns with new nested Entry schema
//   • Provide *sanitized* structured logs (Option B1 + sanitization)
//     - NO money values (tips, cash, venmo, totals.taxableTotal, etc.)
//     - Show only structural + non-sensitive fields
//
// This file still DOES NOT know about:
//   • Settings logic
//   • User logic
//   • Tax logic
//   • Offline queue
//   • Network/backend
//
// ------------------------------------------------------------
import { getWithMeta, setWithMeta, clearWithMeta, clearKeysWithMeta, listKeysWithMeta } from "./metadata";
import { EntrySchema, EntryType } from "@shared/schemas/entry";
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import { CACHE_VERSIONS } from "./cacheVersions";
import { type PersistedCachePayload, isPersistedCachePayload } from "./cachePayload";
import { debugError } from "@/lib/debugLoop";
export type EntriesCacheRecord = {
    data: EntryType[];
    lastSuccessfulSyncAt: number | null;
    localUpdatedAt: number | null;
    cachedAt: number;
};
type PersistedEntriesPayload = PersistedCachePayload<EntryType[], "entries">;
// ------------------------------------------------------------
// Key Helpers
// ------------------------------------------------------------
const PREFIX = "entries"; // final key shape: "entries:{workspaceId}::{periodId}"
export function makeEntriesKey(scopedKey: string): string {
    return `${PREFIX}:${scopedKey}`;
}
// ------------------------------------------------------------
// Sanitized log helper
// ------------------------------------------------------------
// This avoids printing money values or sensitive details.
// Only prints:
//   • id, workspace, date, periodId
//   • totals.totalHours + totals.dayTotal
//   • minimal w2 or independent structure (no income fields)
function sanitizeEntryForLog(e: EntryType) {
    return {
        id: e.id,
        workspace: e.workspace,
        periodId: e.periodId,
        date: e.date,
        totals: {
            totalHours: e.totals?.totalHours,
            dayTotal: e.totals?.dayTotal,
        },
        // Minimal structural views
        w2: e.workspace === "w2"
            ? {
                inTime: e.w2?.inTime,
                outTime: e.w2?.outTime,
                breakDeduction: e.w2?.breakDeduction,
                breakMinutes: e.w2?.breakMinutes,
            }
            : undefined,
        independent: e.workspace === "independent"
            ? {
                hours: e.independent?.hours,
            }
            : undefined,
    };
}
// ------------------------------------------------------------
// Load entries for a specific workspace-scoped cache key
// ------------------------------------------------------------
export async function loadEntries(scopedKey: string): Promise<EntryType[] | null> {
    const record = await readEntriesCacheRecord(scopedKey);
    return record?.data ?? null;
}
// ------------------------------------------------------------
// Load entries cache record with metadata timestamp
// ------------------------------------------------------------
export async function readEntriesCacheRecord(scopedKey: string): Promise<EntriesCacheRecord | null> {
    const key = makeEntriesKey(scopedKey);
    const rec = await getWithMeta<PersistedEntriesPayload | EntryType[]>(key, {
        expectedVersion: CACHE_VERSIONS.entries,
    });
    if (!rec)
        return null;
    if (!rec.data)
        return {
            data: [],
            lastSuccessfulSyncAt: null,
            localUpdatedAt: rec.ts,
            cachedAt: rec.ts,
        };
    const payload = Array.isArray(rec.data)
        ? {
            entries: rec.data,
            lastSuccessfulSyncAt: null,
            localUpdatedAt: rec.ts,
        }
        : isPersistedCachePayload<EntryType[], "entries">(rec.data, "entries")
            ? rec.data
            : {
                entries: (rec.data as {
                    entries: EntryType[];
                    lastBackendSync?: number | null;
                    localUpdatedAt?: number | null;
                }).entries,
                lastSuccessfulSyncAt: typeof (rec.data as {
                    lastBackendSync?: unknown;
                }).lastBackendSync === "number"
                    ? (rec.data as {
                        lastBackendSync: number;
                    }).lastBackendSync
                    : null,
                localUpdatedAt: typeof (rec.data as {
                    localUpdatedAt?: unknown;
                }).localUpdatedAt === "number"
                    ? (rec.data as {
                        localUpdatedAt: number;
                    }).localUpdatedAt
                    : rec.ts,
            };
    const parsed = safeSchemaParse(EntrySchema.array(), payload.entries);
    if (!parsed.success) {
        ;
        ;
        await clearWithMeta(key);
        return null;
    }
    ;
    return {
        data: parsed.data,
        lastSuccessfulSyncAt: typeof payload.lastSuccessfulSyncAt === "number" ? payload.lastSuccessfulSyncAt : null,
        localUpdatedAt: typeof payload.localUpdatedAt === "number" ? payload.localUpdatedAt : rec.ts,
        cachedAt: rec.ts,
    };
}
// ------------------------------------------------------------
// Save entries for a specific workspace-scoped cache key
// ------------------------------------------------------------
export async function saveEntries(scopedKey: string, entries: EntryType[], options: {
    lastSuccessfulSyncAt?: number | null;
    localUpdatedAt?: number | null;
} = {}): Promise<void> {
    const parsed = safeSchemaParse(EntrySchema.array(), entries);
    if (!parsed.success) {
        debugError("domain-entries", "save_entries_validation_failed", {
            scopedKey,
            entryCount: entries.length,
            firstIssue: parsed.error?.issues?.[0]?.message ?? "unknown",
        });
        throw new Error(`saveEntries: schema validation failed for ${scopedKey}`);
    }
    const key = makeEntriesKey(scopedKey);
    ;
    await setWithMeta<PersistedEntriesPayload>(key, {
        entries: parsed.data,
        lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
        localUpdatedAt: options.localUpdatedAt ?? Date.now(),
    }, {
        ttlMs: Infinity,
        version: CACHE_VERSIONS.entries,
    }); // infinite TTL (manual refresh only)
}
// ------------------------------------------------------------
// Clear entries for a specific workspace-scoped cache key
// ------------------------------------------------------------
export async function clearEntries(scopedKey: string): Promise<void> {
    const key = makeEntriesKey(scopedKey);
    await clearWithMeta(key);
}

export async function clearWorkspaceEntries(workspaceId: string): Promise<void> {
    const prefix = `${PREFIX}:${workspaceId}::`;
    await clearKeysWithMeta((key) => key.startsWith(prefix));
}
// ------------------------------------------------------------
// List all cached workspace-scoped entry keys
// ------------------------------------------------------------
export async function listCachedEntriesKeys(): Promise<string[]> {
    const all = await listKeysWithMeta();
    ;
    return all
        .filter((key) => key.startsWith(`${PREFIX}:`))
        .map((key) => key.replace(`${PREFIX}:`, ""));
}
// ------------------------------------------------------------
// Utility: Does a given scoped key exist in cache?
// ------------------------------------------------------------
export async function hasEntries(scopedKey: string): Promise<boolean> {
    const key = makeEntriesKey(scopedKey);
    const rec = await getWithMeta<EntryType[]>(key, {
        expectedVersion: CACHE_VERSIONS.entries,
    });
    return !!rec?.data;
}
