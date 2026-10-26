import type { Request, Response } from "express";
import { z } from "zod";
import * as taxPackageSvc from "../services/taxPackageService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";

const ParamsSchema = z.object({
    workspaceId: z.string().min(1),
    year: z.coerce.number().int().min(2020).max(2100),
});

// GET: the package's numbers (for the P&L page). POST: build the zip and
// return a download link.
export async function taxPackageHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "taxPackage");
            return;
        }
        const parsed = ParamsSchema.safeParse(req.method === "GET" ? req.query : req.body);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid request", parsed.error.format()), "taxPackage");
            return;
        }
        const { workspaceId, year } = parsed.data;
        if (req.method === "GET") {
            const { data } = await taxPackageSvc.getTaxPackageData(uid, workspaceId, year);
            res.setHeader("Cache-Control", "private, no-store");
            res.status(200).json({ ok: true, summary: data });
            return;
        }
        const result = await taxPackageSvc.buildTaxPackage(uid, workspaceId, year);
        res.status(200).json({ ok: true, ...result });
    }
    catch (err: any) {
        sendHttpError(res, err, "taxPackage");
    }
}
