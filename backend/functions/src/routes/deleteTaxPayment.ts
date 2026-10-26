import type { Request, Response } from "express";
import { z } from "zod";
import * as taxEstimateSvc from "../services/taxEstimateService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";

const BodySchema = z.object({ id: z.string().min(1).max(100) }).strict();

export async function deleteTaxPaymentHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "deleteTaxPayment");
            return;
        }
        const parsed = BodySchema.safeParse(req.body);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid request", parsed.error.format()), "deleteTaxPayment");
            return;
        }
        await taxEstimateSvc.deleteTaxPayment(uid, parsed.data.id);
        res.status(200).json({ ok: true });
    }
    catch (err: any) {
        sendHttpError(res, err, "deleteTaxPayment");
    }
}
