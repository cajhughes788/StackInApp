import type { Request, Response } from "express";
import { z } from "zod";
import * as profitLossSvc from "../services/profitLossService";
import { ProfitLossPeriodTypeSchema } from "@shared/schemas/profitLoss";
import { sendHttpError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    periodType: ProfitLossPeriodTypeSchema.default("month"),
    ensureFresh: z
        .union([z.string(), z.boolean()])
        .optional()
        .transform((value) => value === undefined ? true : value === true || value === "true"),
});
export async function getProfitLossStatementsHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const parsed = QuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: "Invalid query parameters",
                details: parsed.error.format(),
            });
            return;
        }
        const { workspaceId, periodType, ensureFresh } = parsed.data;
        const statements = await profitLossSvc.listProfitLossStatements(workspaceId, uid, periodType, {
            ensureFresh,
        });
        res.status(200).json({
            ok: true,
            statements,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "getProfitLossStatements");
    }
}
