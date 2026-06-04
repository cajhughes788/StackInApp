// /functions/src/services/expensesService.ts
import { db } from "../admin";
import { z } from "zod";
import { ExpenseSchema, type ExpenseType, } from "@shared/schemas/expense";
import { SettingsDocSchema, type SettingsType } from "@shared/schemas/settings";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/httpErrors";
import {
    isExpenseCategorySelectable,
    resolveExpenseCategoryLabel,
} from "@shared/expenseCategories";
import { deleteReceiptAssetCascade } from "./receiptAssetsService";
import { syncProfitLossForFinancialDates } from "./profitLossService";
import { settingsCache } from "./settingsCache";

const VALID_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ExpenseArraySchema = z.array(ExpenseSchema);

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((entry) => stripUndefinedDeep(entry)) as T;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
        return Object.fromEntries(entries) as T;
    }
    return value;
}

export function resolvePeriodId(raw: any): string {
    if (raw?.periodId)
        return raw.periodId;
    if (raw?.date)
        return raw.date.slice(0, 7);
    throw new BadRequestError("periodId or valid date required");
}

function validateExpenseDate(date: unknown): void {
    if (typeof date !== "string" || !VALID_DATE_RE.test(date)) {
        throw new BadRequestError("Date must be a valid calendar date (YYYY-MM-DD).");
    }
    // Regex passes impossible dates like 2026-02-31. Verify with Date constructor.
    const parts = date.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) {
        throw new BadRequestError(`"${date}" is not a valid calendar date.`);
    }
}

async function getWorkspaceSettings(workspaceId: string): Promise<SettingsType | null> {
    const cachedSettings = settingsCache[workspaceId]?.data;
    if (cachedSettings) {
        return cachedSettings;
    }
    const snap = await db.doc(`workspaces/${workspaceId}/settings/current`).get();
    if (!snap.exists) {
        return null;
    }
    const parsed = SettingsDocSchema.safeParse(snap.data());
    if (!parsed.success) {
        return null;
    }
    settingsCache[workspaceId] = {
        data: parsed.data,
        ts: Date.now(),
    };
    return parsed.data;
}
export async function normalizeExpenseAccount(workspaceId: string, raw: any, options: {
    existingAccount?: string;
} = {}): Promise<string> {
    const settings = await getWorkspaceSettings(workspaceId);
    const customCategories = settings?.independent?.customExpenseCategories ?? [];
    const category = resolveExpenseCategoryLabel(typeof raw === "string" ? raw : "", customCategories);
    if (!category) {
        throw new BadRequestError("Please choose a valid expense category.");
    }
    const categoryEnabled = isExpenseCategorySelectable(category, customCategories, {
        workspaceType: "independent",
        independentSettings: settings?.independent ?? null,
    });
    if (!categoryEnabled) {
        const existingAccount = resolveExpenseCategoryLabel(options.existingAccount ?? "", customCategories);
        if (existingAccount !== category) {
            throw new BadRequestError("This expense category is not enabled in settings.");
        }
    }
    return category;
}

async function assertWorkspaceMembership(workspaceId: string, uid: string): Promise<void> {
    const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get();
    if (!memberSnap.exists) {
        throw new ForbiddenError("Forbidden");
    }
}

export async function findExpenseByClientMutationId(
    workspaceId: string,
    clientMutationId: string
): Promise<{ id: string; expense: ExpenseType; } | null> {
    const snap = await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .where("clientMutationId", "==", clientMutationId)
        .limit(1)
        .get();
    if (snap.empty) {
        return null;
    }
    const doc = snap.docs[0];
    return {
        id: doc.id,
        expense: ExpenseSchema.parse({
            id: doc.id,
            ...doc.data(),
        }),
    };
}
export async function findExpenseByReceiptAssetId(
    workspaceId: string,
    receiptAssetId: string
): Promise<ExpenseType | null> {
    const snap = await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .where("receiptAssetId", "==", receiptAssetId)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return ExpenseSchema.parse({ id: doc.id, ...doc.data() });
}

export type DuplicateExpenseResult = {
    exactMatches: ExpenseType[];
    nearDateMatches: ExpenseType[];
};

function addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function merchantMatches(needle: string, vendor: string, description: string): boolean {
    if (!needle) return true;
    return vendor.includes(needle) || needle.includes(vendor) ||
        description.includes(needle) || needle.includes(description);
}

export async function findDuplicateExpenses(
    workspaceId: string,
    date: string,
    amount: number,
    merchant: string
): Promise<DuplicateExpenseResult> {
    const minDate = addDays(date, -3);
    const maxDate = addDays(date, 3);

    const snap = await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .where("date", ">=", minDate)
        .where("date", "<=", maxDate)
        .get();

    if (snap.empty) return { exactMatches: [], nearDateMatches: [] };

    const needle = merchant.trim().toLowerCase();
    const exactMatches: ExpenseType[] = [];
    const nearDateMatches: ExpenseType[] = [];

    for (const doc of snap.docs) {
        const expense = ExpenseSchema.parse({ id: doc.id, ...doc.data() });
        if (Math.abs(expense.amount - amount) >= 0.01) continue;

        const vendor = (expense.vendor ?? "").toLowerCase();
        const description = (expense.description ?? "").toLowerCase();
        if (!merchantMatches(needle, vendor, description)) continue;

        if (expense.date === date) {
            exactMatches.push(expense);
        } else {
            nearDateMatches.push(expense);
        }
    }

    return { exactMatches, nearDateMatches };
}

export async function syncExpenseProfitLossDates(workspaceId: string, dates: Array<string | null | undefined>) {
    const normalizedDates = dates.filter((date): date is string => typeof date === "string" && date.length > 0);
    if (normalizedDates.length === 0) {
        return;
    }
    try {
        await syncProfitLossForFinancialDates(workspaceId, normalizedDates);
    }
    catch (error) {
        console.warn("profit loss sync failed after expense mutation", {
            workspaceId,
            dates: normalizedDates,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
// ------------------------------------------------------------
// CREATE (needs createdAt, updatedAt, version)
// ------------------------------------------------------------
export async function createExpense(workspaceId: string, uid: string, raw: any): Promise<{
    id: string;
    expense: ExpenseType;
}> {
    await assertWorkspaceMembership(workspaceId, uid);
    validateExpenseDate(raw?.date);
    const clientMutationId = typeof raw?.clientMutationId === "string" ? raw.clientMutationId : null;
    if (clientMutationId) {
        const existing = await findExpenseByClientMutationId(workspaceId, clientMutationId);
        if (existing) {
            return existing;
        }
    }
    // Prevent one receipt asset from being linked to multiple expenses.
    if (typeof raw?.receiptAssetId === "string" && raw.receiptAssetId.length > 0) {
        const existingForAsset = await findExpenseByReceiptAssetId(workspaceId, raw.receiptAssetId);
        if (existingForAsset && existingForAsset.id !== clientMutationId) {
            throw new ConflictError("This receipt is already linked to an existing expense.");
        }
    }
    const colRef = db.collection("workspaces").doc(workspaceId).collection("expenses");
    const docRef = colRef.doc();
    const nowIso = new Date().toISOString();
    const periodId = resolvePeriodId(raw);
    const canonical = {
        ...raw,
        account: await normalizeExpenseAccount(workspaceId, raw?.account),
        id: docRef.id,
        periodId,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
    };
    const parsed = ExpenseSchema.parse(canonical);
    await docRef.set(stripUndefinedDeep(parsed));
    await syncExpenseProfitLossDates(workspaceId, [parsed.date]);
    return {
        id: docRef.id,
        expense: parsed,
    };
}
// ------------------------------------------------------------
// UPDATE (must increment version + update timestamp)
// ------------------------------------------------------------
export async function updateExpense(workspaceId: string, uid: string, expenseId: string, patch: any): Promise<{
    id: string;
    expense: ExpenseType;
}> {
    await assertWorkspaceMembership(workspaceId, uid);
    if (patch?.date !== undefined) {
        validateExpenseDate(patch.date);
    }
    const ref = db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new NotFoundError("Expense not found");
    const existing = snap.data() as ExpenseType;
    const nowIso = new Date().toISOString();
    const canonical = {
        ...existing,
        ...patch,
        account: await normalizeExpenseAccount(workspaceId, patch?.account ?? existing.account, {
            existingAccount: existing.account,
        }),
        id: expenseId,
        periodId: resolvePeriodId({ ...existing, ...patch }),
        updatedAt: nowIso,
        version: (existing.version ?? 1) + 1,
    };
    const parsed = ExpenseSchema.parse(canonical);
    await ref.set(stripUndefinedDeep(parsed));
    await syncExpenseProfitLossDates(workspaceId, [existing.date, parsed.date]);
    return {
        id: expenseId,
        expense: parsed,
    };
}
// ------------------------------------------------------------
// DELETE
// ------------------------------------------------------------
export async function deleteExpense(workspaceId: string, uid: string, expenseId: string) {
    await assertWorkspaceMembership(workspaceId, uid);
    const ref = db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new NotFoundError("Expense not found");
    const existing = ExpenseSchema.parse({
        id: snap.id,
        ...snap.data(),
    });
    await ref.delete();
    if (existing.receiptAssetId) {
        try {
            await deleteReceiptAssetCascade(workspaceId, uid, existing.receiptAssetId);
        }
        catch (error) {
            console.warn("expense receipt cleanup failed after expense deletion", {
                workspaceId,
                expenseId,
                receiptAssetId: existing.receiptAssetId,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    await syncExpenseProfitLossDates(workspaceId, [existing.date]);
    return;
}
// ------------------------------------------------------------
// GET BY PERIOD
// ------------------------------------------------------------
export async function getExpenses(workspaceId: string, uid: string, periodId: string): Promise<ExpenseType[]> {
    await assertWorkspaceMembership(workspaceId, uid);
    const snap = await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("expenses")
        .where("periodId", "==", periodId)
        .get();
    const raw = snap.docs.map((d) => d.data());
    const parsed = ExpenseArraySchema.safeParse(raw);
    if (!parsed.success) {
        throw new BadRequestError("Invalid expense data in Firestore");
    }
    return parsed.data;
}
