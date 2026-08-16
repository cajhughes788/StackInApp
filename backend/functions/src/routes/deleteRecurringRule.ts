// /functions/src/routes/deleteRecurringRule.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as recurringRulesSvc from "../services/recurringRulesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    ruleId: z.string().min(1),
});
export async function deleteRecurringRuleHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "DELETE") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "deleteRecurringRule");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
            ruleId: req.query.ruleId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId/ruleId", parsedQuery.error.format()), "deleteRecurringRule");
            return;
        }
        const { workspaceId, ruleId } = parsedQuery.data;
        await recurringRulesSvc.deleteRecurringRule(workspaceId, uid, ruleId);
        res.status(200).json({
            ok: true,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "deleteRecurringRule");
    }
}
