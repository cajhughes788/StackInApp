// /functions/src/routes/getExpenses.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as expensesSvc from "../services/expensesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    periodId: z.string().min(7), // "YYYY-MM"
});
export async function getExpensesHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "getExpenses");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
            periodId: req.query.periodId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/periodId", parsedQuery.error.format()), "getExpenses");
            return;
        }
        const { workspaceId, periodId } = parsedQuery.data;
        const expenses = await expensesSvc.getExpenses(workspaceId, uid, periodId);
        res.status(200).json({
            ok: true,
            expenses,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "getExpenses");
    }
}
