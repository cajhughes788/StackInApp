// /functions/src/routes/createEntry.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// Backend routes DO NOT validate raw payloads under Clean Zod Plan.
// Validation is done inside entriesService AFTER merge.
import type { Request, Response } from "express";
import { z } from "zod";
import * as entriesSvc from "../services/entriesService";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace";
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
});
export async function createEntryHandler(req: Request, res: Response): Promise<void> {
    const trace = createBackendProfileTrace(req, "entry_create");
    trace.mark("entry_create.handler_invoked");
    const nowIso = new Date().toISOString();
    // Method guard
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        trace.mark("entry_create.auth_checked", {
            hasUser: Boolean(uid),
        });
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "createEntry");
            return;
        }
        const parsedQuery = QuerySchema.safeParse({
            workspaceId: req.query.workspaceId,
        });
        if (!parsedQuery.success) {
            sendHttpError(res, new BadRequestError("Missing or invalid workspaceId", parsedQuery.error.format()), "createEntry");
            return;
        }
        const { workspaceId } = parsedQuery.data;
        const { id, entry: canonical } = await withBackendProfileStep(trace, "entry_create.service_create", () => entriesSvc.createEntry(workspaceId, uid, req.body, trace), {
            workspaceId,
        });
        res.status(201).json({
            ok: true,
            id,
            entry: canonical,
        });
        trace.mark("entry_create.response_sent", {
            workspaceId,
            entryId: id,
        });
    }
    catch (err: any) {
        trace.error("entry_create.failed", err);
        sendHttpError(res, err, "createEntry");
    }
}
