import type { Request, Response } from "express";
import * as taxEstimateSvc from "../services/taxEstimateService";
import { TaxEstimateProfilePatchSchema } from "@shared/schemas/taxEstimateProfile";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";

export async function saveTaxEstimateProfileHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "saveTaxEstimateProfile");
            return;
        }
        const parsed = TaxEstimateProfilePatchSchema.safeParse(req.body);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid tax answers", parsed.error.format()), "saveTaxEstimateProfile");
            return;
        }
        const profile = await taxEstimateSvc.saveTaxEstimateProfile(uid, parsed.data);
        res.status(200).json({ ok: true, profile });
    }
    catch (err: any) {
        sendHttpError(res, err, "saveTaxEstimateProfile");
    }
}
