// /functions/src/routes/deleteExpense.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as expensesSvc from "../services/expensesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    expenseId: z.string().min(1),
});
export async function deleteExpenseHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "DELETE") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "deleteExpense");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
            expenseId: req.query.expenseId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/expenseId", parsedQuery.error.format()), "deleteExpense");
            return;
        }
        const { workspaceId, expenseId } = parsedQuery.data;
        await expensesSvc.deleteExpense(workspaceId, uid, expenseId);
        res.status(200).json({
            ok: true,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "deleteExpense");
    }
}
