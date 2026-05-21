import type { Request, Response } from "express";
import { z } from "zod";
import * as profitLossSvc from "../services/profitLossService";
import { ProfitLossPeriodTypeSchema } from "@shared/schemas/profitLoss";
const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    periodType: ProfitLossPeriodTypeSchema,
    periodKey: z.string().min(1),
    force: z.boolean().optional(),
});
export async function generateProfitLossStatementHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const parsed = BodySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: "Invalid request payload",
                details: parsed.error.format(),
            });
            return;
        }
        const workspaceId = (req.query.workspaceId as string | undefined) ?? parsed.data.workspaceId;
        if (!workspaceId) {
            res.status(400).json({ ok: false, error: "Missing workspaceId" });
            return;
        }
        const statement = await profitLossSvc.generateProfitLossStatement(workspaceId, {
            periodType: parsed.data.periodType,
            periodKey: parsed.data.periodKey,
            force: parsed.data.force ?? true,
        });
        res.status(201).json({
            ok: true,
            statement,
        });
    }
    catch (err: any) {
        res.status(500).json({
            ok: false,
            error: err?.message ?? "Internal Server Error",
        });
    }
}
