import type { Request, Response } from "express";
import * as taxEstimateSvc from "../services/taxEstimateService";
import { sendHttpError, UnauthorizedError } from "../lib/httpErrors";

export async function getTaxEstimateHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "getTaxEstimate");
            return;
        }
        const estimate = await taxEstimateSvc.getTaxEstimate(uid);
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({ ok: true, estimate });
    }
    catch (err: any) {
        sendHttpError(res, err, "getTaxEstimate");
    }
}
