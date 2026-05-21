// storage/domainExpenses.ts
// ------------------------------------------------------------
// Domain-level storage for EXPENSES.
// ------------------------------------------------------------
// Responsibilities:
//   • Compute workspace-scoped cache keys
//   • Load/save/replace/delete individual expenses
//   • Load all expenses for ALL workspace-period keys (for hydration)
//   • Mirror Zustand store state into IndexedDB
//
// This file knows about:
//   • ExpenseCanonicalSchema (your backend canonical shape)
//   • scoped period keys ("{workspaceId}::{periodId}")
//
// This file DOES NOT know about:
//   • UI logic
//   • Settings
//   • Network
//   • Offline queue
// ------------------------------------------------------------
import { getWithMeta, setWithMeta, clearWithMeta, clearKeysWithMeta, listKeysWithMeta, } from "./metadata";
import { ExpenseSchema } from "@shared/schemas/expense"; // <-- must exist
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse";
import { CACHE_VERSIONS } from "./cacheVersions";

export type ExpensesCacheRecord = {
    data: any[];
    cachedAt: number;
};
const PREFIX = "expenses"; // final key: "expenses:{workspaceId}::{periodId}"
// ------------------------------------------------------------
// Key helper
// ------------------------------------------------------------
function makeExpensesKey(scopedPeriodKey: string): string {
    return `${PREFIX}:${scopedPeriodKey}`;
}

function matchesExpenseIdentity(left: any, right: any): boolean {
    if (!left || !right)
        return false;
    const leftIds = [left.id, left.tempId, left.clientMutationId].filter((value) => typeof value === "string" && value.length > 0);
    const rightIds = [right.id, right.tempId, right.clientMutationId].filter((value) => typeof value === "string" && value.length > 0);
    return leftIds.some((value) => rightIds.includes(value));
}

function dedupeExpenses(expenses: any[]): any[] {
    const next: any[] = [];
    for (const expense of expenses) {
        if (next.some((entry) => matchesExpenseIdentity(entry, expense))) {
            continue;
        }
        next.push(expense);
    }
    return next;
}

function matchesReplacementTarget(entry: any, tempIdOrId: string, expense: any): boolean {
    if (entry?.id === tempIdOrId || entry?.tempId === tempIdOrId) {
        return true;
    }
    const nextClientMutationId = typeof expense?.clientMutationId === "string" && expense.clientMutationId.length > 0
        ? expense.clientMutationId
        : null;
    return nextClientMutationId !== null && entry?.clientMutationId === nextClientMutationId;
}
// ------------------------------------------------------------
// Load ALL expenses for ALL workspace-period keys (for hydration)
// ------------------------------------------------------------
export async function loadAllExpenses(): Promise<any[]> {
    const allKeys = await listKeysWithMeta();
    const expenseKeys = allKeys.filter((key) => key.startsWith(`${PREFIX}:`));
    let all: any[] = [];
    for (const key of expenseKeys) {
        const rec = await getWithMeta<any[]>(key, {
            expectedVersion: CACHE_VERSIONS.expenses,
        });
        if (rec?.data) {
            const parsed = safeSchemaParse(ExpenseSchema.array(), rec.data);
            if (parsed.success) {
                all = all.concat(parsed.data);
            }
            else {
                ;
                await clearWithMeta(key);
            }
        }
    }
    return all;
}
export async function loadExpenses(scopedPeriodKey: string): Promise<any[]> {
    const record = await readExpensesCacheRecord(scopedPeriodKey);
    return record?.data ?? [];
}

export async function readExpensesCacheRecord(scopedPeriodKey: string): Promise<ExpensesCacheRecord | null> {
    const key = makeExpensesKey(scopedPeriodKey);
    const rec = await getWithMeta<any[]>(key, {
        expectedVersion: CACHE_VERSIONS.expenses,
    });
    if (!rec?.data)
        return null;
    const parsed = safeSchemaParse(ExpenseSchema.array(), rec.data);
    if (!parsed.success) {
        ;
        await clearWithMeta(key);
        return null;
    }
    return {
        data: parsed.data,
        cachedAt: rec.ts,
    };
}
// ------------------------------------------------------------
// Overwrite all expenses for a single workspace-period key (canonical sync)
// ------------------------------------------------------------
export async function setExpensesForPeriod(scopedPeriodKey: string, expenses: any[]): Promise<void> {
    const key = makeExpensesKey(scopedPeriodKey);
    await setWithMeta(key, expenses, {
        ttlMs: Infinity,
        version: CACHE_VERSIONS.expenses,
    });
}
// ------------------------------------------------------------
// Save (append) a single expense into its workspace-period key
// -----------------------------------------------------------
export async function saveExpense(scopedPeriodKey: string, expense: any): Promise<void> {
    const key = makeExpensesKey(scopedPeriodKey);
    // Load existing array (if any)
    const rec = await getWithMeta<any[]>(key, {
        expectedVersion: CACHE_VERSIONS.expenses,
    });
    const existing = Array.isArray(rec?.data) ? rec.data : [];
    // Try canonical validation
    const canonicalParsed = safeSchemaParse(ExpenseSchema, expense);
    if (!canonicalParsed.success) {
        // Allow OPTIMISTIC expenses (tempId must exist)
        if (!expense.tempId) {
            ;
            return;
        }
        ;
    }
    // Append at top
    const updated = dedupeExpenses([expense, ...existing]);
    await setWithMeta(key, updated, {
        ttlMs: Infinity,
        version: CACHE_VERSIONS.expenses,
    });
}
// ------------------------------------------------------------
// Replace an expense (optimistic → canonical)
// ------------------------------------------------------------
export async function replaceExpense(scopedPeriodKey: string, tempIdOrId: string, canonical: any): Promise<void> {
    const key = makeExpensesKey(scopedPeriodKey);
    const rec = await getWithMeta<any[]>(key, {
        expectedVersion: CACHE_VERSIONS.expenses,
    });
    const existing = Array.isArray(rec?.data) ? rec.data : [];
    // Canonical must match ExpenseSchema
    const parsed = safeSchemaParse(ExpenseSchema, canonical);
    if (!parsed.success) {
        ;
        return;
    }
    const updated = dedupeExpenses(existing.map((e) => matchesReplacementTarget(e, tempIdOrId, parsed.data) ? parsed.data : e));
    await setWithMeta(key, updated, {
        ttlMs: Infinity,
        version: CACHE_VERSIONS.expenses,
    });
}
// ------------------------------------------------------------
// Delete a single expense by ID
// ------------------------------------------------------------
export async function deleteExpense(scopedPeriodKey: string, id: string): Promise<void> {
    const key = makeExpensesKey(scopedPeriodKey);
    const rec = await getWithMeta<any[]>(key, {
        expectedVersion: CACHE_VERSIONS.expenses,
    });
    const existing = Array.isArray(rec?.data) ? rec.data : [];
    const updated = existing.filter((e) => e.id !== id && e.tempId !== id);
    await setWithMeta(key, updated, {
        ttlMs: Infinity,
        version: CACHE_VERSIONS.expenses,
    });
}
// ------------------------------------------------------------
// Clear ALL expenses for ALL workspace-period keys (logout)
// ------------------------------------------------------------
export async function clearAll() {
    await clearKeysWithMeta((key) => key.startsWith(`${PREFIX}:`));
}
export async function clearWorkspace(workspaceId: string) {
    const workspacePrefix = `${PREFIX}:${workspaceId}::`;
    await clearKeysWithMeta((candidate) => candidate.startsWith(workspacePrefix));
}
