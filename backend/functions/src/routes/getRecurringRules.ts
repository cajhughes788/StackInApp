// /functions/src/routes/getRecurringRules.ts
import type { Request, Response } from "express";
import { z } from "zod";
import * as recurringRulesSvc from "../services/recurringRulesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
});
export async function getRecurringRulesHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "getRecurringRules");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "getRecurringRules");
            return;
        }
        const { workspaceId } = parsedQuery.data;
        const rules = await recurringRulesSvc.getRecurringRules(workspaceId, uid);
        res.status(200).json({
            ok: true,
            rules,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "getRecurringRules");
    }
}
