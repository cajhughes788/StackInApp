// /functions/src/routes/editEntry.ts
// Thin route wrapper: validate query → delegate to service → respond.
import type { Request, Response } from "express";
import { z } from "zod";
import * as entriesSvc from "../services/entriesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
// Validate query (?entryId=...)
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    entryId: z.string().min(1),
});
// -----------------------------
// Handler
// -----------------------------
export async function editEntryHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "PATCH") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "editEntry");
            return;
        }
        // -----------------------------
        // Validate entryId from query
        // -----------------------------
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
            entryId: req.query.entryId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid entryId", parsedQuery.error.format()), "editEntry");
            return;
        }
        const { workspaceId, entryId } = parsedQuery.data;
        // -----------------------------
        // Delegate to centralized service
        // (NO validation of patch here — service will recompute + validate final entry)
        // -----------------------------
        const result = await entriesSvc.updateEntry(workspaceId, uid, entryId, req.body);
        // -----------------------------
        // Respond
        // -----------------------------
        res.status(200).json({
            ok: true,
            id: result.id,
            entry: result.entry,
        });
        return;
    }
    catch (err: any) {
        sendHttpError(res, err, "editEntry");
    }
}
