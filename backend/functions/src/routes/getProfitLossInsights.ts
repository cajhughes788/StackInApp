import type { Request, Response } from "express";
import { z } from "zod";
import * as profitLossSvc from "../services/profitLossService";
import { sendHttpError } from "../lib/httpErrors";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
});
// Small summary for the P&L page's "This month so far" and "Your patterns".
export async function getProfitLossInsightsHandler(req: Request, res: Response): Promise<void> {
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
            res.status(400).json({ ok: false, error: "Invalid query parameters", details: parsed.error.format() });
            return;
        }
        const insights = await profitLossSvc.getProfitLossInsights(parsed.data.workspaceId, uid);
        res.status(200).json({ ok: true, insights });
    }
    catch (err: any) {
        sendHttpError(res, err, "getProfitLossInsights");
    }
}
