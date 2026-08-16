// /functions/src/routes/createRecurringRule.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as recurringRulesSvc from "../services/recurringRulesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
});
export async function createRecurringRuleHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "createRecurringRule");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "createRecurringRule");
            return;
        }
        const { workspaceId } = parsedQuery.data;
        const result = await recurringRulesSvc.createRecurringRule(workspaceId, uid, req.body);
        res.status(201).json({
            ok: true,
            id: result.id,
            rule: result.rule,
            generatedExpense: (result as any).generatedExpense ?? null,
            generatedEntry: (result as any).generatedEntry ?? null,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "createRecurringRule");
    }
}
