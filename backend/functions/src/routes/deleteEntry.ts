// /functions/src/routes/deleteEntry.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct uid extraction (now provided by withCorsAuth)
// - Maintains same validation and response structure
import type { Request, Response } from "express";
import { z } from "zod";
import * as entriesSvc from "../services/entriesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
// ---------------------------------------------------------------------------
// 🔹 Zod validation for route params
// ---------------------------------------------------------------------------
const DeleteEntryParamsSchema = z.object({
    workspaceId: z.string().min(1),
    entryId: z.string().min(1),
});
// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function deleteEntryHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "DELETE") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        // NOTE: Authentication handled by withCorsAuth
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "deleteEntry");
            return;
        }
        // Validate entryId param using Zod
        const parsedParams = DeleteEntryParamsSchema.safeParse(req.query);
        if (!parsedParams.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid entryId", parsedParams.error.format()), "deleteEntry");
            return;
        }
        const { workspaceId, entryId } = parsedParams.data;
        // Perform deletion via service
        await entriesSvc.deleteEntry(workspaceId, uid, entryId);
        res.status(200).json({ ok: true, entryId });
    }
    catch (err: any) {
        sendHttpError(res, err, "deleteEntry");
    }
}
