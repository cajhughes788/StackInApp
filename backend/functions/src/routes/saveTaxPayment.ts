import type { Request, Response } from "express";
import * as taxEstimateSvc from "../services/taxEstimateService";
import { TaxPaymentInputSchema } from "@shared/schemas/taxEstimateProfile";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";

export async function saveTaxPaymentHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "saveTaxPayment");
            return;
        }
        const parsed = TaxPaymentInputSchema.safeParse(req.body);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid payment", parsed.error.format()), "saveTaxPayment");
            return;
        }
        const payment = await taxEstimateSvc.saveTaxPayment(uid, parsed.data);
        res.status(200).json({ ok: true, payment });
    }
    catch (err: any) {
        sendHttpError(res, err, "saveTaxPayment");
    }
}
