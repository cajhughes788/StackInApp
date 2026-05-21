// /functions/src/routes/createExpense.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as expensesSvc from "../services/expensesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
});
export async function createExpenseHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    const trace = createBackendProfileTrace(req, "expense_create");
    trace.mark("expense.create.handler_invoked", {
        bodyKeys: Object.keys((req.body ?? {}) as Record<string, unknown>).join(","),
    });
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "createExpense");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "createExpense");
            return;
        }
        const { workspaceId } = parsedQuery.data;
        const { id, expense } = await withBackendProfileStep(trace, "expense.create.firestore_write", () => expensesSvc.createExpense(workspaceId, uid, req.body), {
            workspaceId,
            periodId: typeof req.body?.periodId === "string" ? req.body.periodId : undefined,
            date: typeof req.body?.date === "string" ? req.body.date : undefined,
            account: typeof req.body?.account === "string" ? req.body.account : undefined,
            hasReceiptAssetId: typeof req.body?.receiptAssetId === "string" && req.body.receiptAssetId.length > 0,
            hasReceiptAnalysisId: typeof req.body?.receiptAnalysisId === "string" && req.body.receiptAnalysisId.length > 0,
            hasAllocations: Array.isArray(req.body?.allocations) && req.body.allocations.length > 0,
        });
        trace.mark("expense.create.response_sent", {
            workspaceId,
            expenseId: id,
            periodId: expense.periodId,
            account: expense.account,
            hasReceiptAssetId: Boolean(expense.receiptAssetId),
            hasReceiptAnalysisId: Boolean(expense.receiptAnalysisId),
        });
        res.status(201).json({
            ok: true,
            id,
            expense,
        });
    }
    catch (err: any) {
        trace.error("expense.create.failed", err);
        sendHttpError(res, err, "createExpense");
    }
}
