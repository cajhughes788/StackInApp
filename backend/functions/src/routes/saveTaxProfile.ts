// /functions/src/routes/saveTaxProfile.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct UID extraction logic (handled by withCorsAuth)
// - Preserves validation, merging, and persistence logic
import type { Request, Response } from "express";
import { TaxProfile } from "@shared/schemas";
import * as taxProfileSvc from "../services/taxProfileService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function saveTaxProfileHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        // NOTE: Authentication handled by withCorsAuth
        const uid = (req as any).user?.uid;
        const workspaceId = typeof req.query.workspaceId === "string"
            ? req.query.workspaceId
            : typeof req.body?.workspaceId === "string"
                ? req.body.workspaceId
                : null;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "saveTaxProfile");
            return;
        }
        if (!workspaceId) {
            sendHttpError(res, new BadRequestError("workspaceId is required"), "saveTaxProfile");
            return;
        }
        // Validate payload against shared namespaced schema
        const parsed = TaxProfile.Schema.safeParse(req.body?.taxProfile ?? req.body);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid tax profile payload", parsed.error.format()), "saveTaxProfile");
            return;
        }
        const taxProfile: TaxProfile.Type = parsed.data;
        // Save tax profile using shared service
        const updated = await taxProfileSvc.saveTaxProfile(workspaceId, uid, taxProfile);
        // Validate saved document for consistency
        const validated = TaxProfile.Schema.safeParse(updated);
        if (!validated.success) {
            sendHttpError(res, new BadRequestError("Corrupt tax profile response", validated.error.format()), "saveTaxProfile");
            return;
        }
        res.status(200).json({ ok: true, taxProfile: validated.data });
    }
    catch (err: any) {
        sendHttpError(res, err, "saveTaxProfile");
    }
}
