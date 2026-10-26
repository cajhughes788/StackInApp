import type { Request, Response } from "express";
import { z } from "zod";
import * as allIncomeSvc from "../services/allIncomeService";
import { isMonthKey } from "@shared/allIncome";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";

const QuerySchema = z.object({
    month: z.string().refine(isMonthKey, "month must be YYYY-MM"),
});

export async function getAllIncomeSummaryHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "getAllIncomeSummary");
            return;
        }
        const parsed = QuerySchema.safeParse(req.query);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid query parameters", parsed.error.format()), "getAllIncomeSummary");
            return;
        }
        const summary = await allIncomeSvc.getAllIncomeSummary(uid, parsed.data.month);
        res.setHeader("Cache-Control", "private, max-age=60");
        res.status(200).json({ ok: true, summary });
    }
    catch (err: any) {
        sendHttpError(res, err, "getAllIncomeSummary");
    }
}
