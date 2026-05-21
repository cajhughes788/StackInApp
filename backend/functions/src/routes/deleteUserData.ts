// /functions/src/routes/deleteUserData.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct UID extraction logic (now handled by withCorsAuth)
// - Preserves all validation, Firestore cleanup, and audit logic
import type { Request, Response } from "express";
import { z } from "zod";
import { purgeUserData } from "../services/userDeletionService";
// ---------------------------------------------------------------------------
// 🔹 Zod schema for validating UID
// ---------------------------------------------------------------------------
const UidSchema = z.string().min(1, "Missing user UID");

function serializeError(error: unknown) {
    if (!(error instanceof Error)) {
        return { message: String(error) };
    }
    const err = error as Error & {
        code?: string;
        details?: unknown;
        metadata?: unknown;
    };
    return {
        name: err.name,
        message: err.message,
        code: err.code,
        details: err.details,
        metadata: err.metadata,
        stack: err.stack,
    };
}
// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function deleteUserDataHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "DELETE") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        // NOTE: Authentication handled by withCorsAuth
        const uid = (req as any).user?.uid;
        const parsedUid = UidSchema.safeParse(uid);
        if (!parsedUid.success) {
            res.status(401).json({ ok: false, error: "Unauthorized or invalid UID" });
            return;
        }
        const authenticatedUid = parsedUid.data;
        console.log("[deleteUserData] request_received", {
            uid: authenticatedUid,
            method: req.method,
        });
        await purgeUserData(authenticatedUid);
        console.log("[deleteUserData] request_succeeded", {
            uid: authenticatedUid,
        });
        res.status(200).json({ ok: true, message: "User data deleted successfully" });
    }
    catch (err: any) {
        console.error("[deleteUserData] request_failed", {
            uid: (req as any).user?.uid ?? null,
            error: serializeError(err),
        });
        res.status(500).json({
            ok: false,
            error: err?.message ?? "Internal Server Error",
        });
    }
}
