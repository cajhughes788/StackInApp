// /functions/src/services/expensesService.ts
import { db } from "../admin";
import { z } from "zod";
import { ExpenseSchema, type ExpenseType, } from "@shared/schemas/expense";
import { BadRequestError, ForbiddenError, NotFoundError } from "../lib/httpErrors";
import { findExpenseCategoryGuideEntry } from "@shared/expenseCategories";
import { deleteReceiptAssetCascade } from "./receiptAssetsService";
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

function resolvePeriodId(raw: any): string {
    if (raw?.periodId)
        return raw.periodId;
    if (raw?.date)
        return raw.date.slice(0, 7);
    throw new BadRequestError("periodId or valid date required");
}

function normalizeExpenseAccount(raw: any): string {
    const entry = findExpenseCategoryGuideEntry(typeof raw === "string" ? raw : "");
    if (!entry) {
        throw new BadRequestError("Please choose a valid built-in expense category.");
    }
    return entry.category;
}

async function assertWorkspaceMembership(workspaceId: string, uid: string): Promise<void> {
    const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get();
    if (!memberSnap.exists) {
        throw new ForbiddenError("Forbidden");
    }
}

async function findExpenseByClientMutationId(
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
// ------------------------------------------------------------
// CREATE (needs createdAt, updatedAt, version)
// ------------------------------------------------------------
export async function createExpense(workspaceId: string, uid: string, raw: any): Promise<{
    id: string;
    expense: ExpenseType;
}> {
    await assertWorkspaceMembership(workspaceId, uid);
    const clientMutationId = typeof raw?.clientMutationId === "string" ? raw.clientMutationId : null;
    if (clientMutationId) {
        const existing = await findExpenseByClientMutationId(workspaceId, clientMutationId);
        if (existing) {
            return existing;
        }
    }
    const colRef = db.collection("workspaces").doc(workspaceId).collection("expenses");
    const docRef = colRef.doc();
    const nowIso = new Date().toISOString();
    const periodId = resolvePeriodId(raw);
    const canonical = {
        ...raw,
        account: normalizeExpenseAccount(raw?.account),
        id: docRef.id,
        periodId,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
    };
    const parsed = ExpenseSchema.parse(canonical);
    await docRef.set(stripUndefinedDeep(parsed));
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
        account: normalizeExpenseAccount(patch?.account ?? existing.account),
        id: expenseId,
        periodId: resolvePeriodId({ ...existing, ...patch }),
        updatedAt: nowIso,
        version: (existing.version ?? 1) + 1,
    };
    const parsed = ExpenseSchema.parse(canonical);
    await ref.set(stripUndefinedDeep(parsed));
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
