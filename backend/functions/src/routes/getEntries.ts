// /functions/src/routes/getEntries.ts
// Refactored with required periodId and strict query validation.
import type { Request, Response } from "express";
import { z } from "zod";
import * as entriesSvc from "../services/entriesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
// ---------------------------------------------------------------------------
// Query Schema
// ---------------------------------------------------------------------------
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    periodId: z.string().min(1), // ⭐ REQUIRED
    limit: z.coerce.number().optional(), // "500" -> 500
    cursor: z.string().optional(),
    forceFull: z.coerce.boolean().optional(),
});
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function getEntriesHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "getEntries");
            return;
        }
        // Validate query
        const parsed = QuerySchema.safeParse(req.query);
        if (!parsed.success) {
            sendHttpError(res, new BadRequestError("Invalid query parameters", parsed.error.format()), "getEntries");
            return;
        }
        const { workspaceId, periodId, limit, cursor, forceFull } = parsed.data;
        const result = await entriesSvc.listEntries(workspaceId, uid, {
            periodId,
            limit,
            cursorId: cursor,
            forceFull,
        });
        res.setHeader("Cache-Control", "private, max-age=60");
        res.status(200).json({
            ok: true,
            entries: result.entries,
            nextCursor: result.nextCursor,
            start: result.start,
            end: result.end,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "getEntries");
    }
}
