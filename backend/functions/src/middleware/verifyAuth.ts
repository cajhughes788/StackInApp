// /functions/src/middleware/verifyAuth.ts
import type { Request, Response } from "express";
import { auth } from "../admin";
/**
 * Firebase-native authentication utility for modular functions.
 * Verifies Bearer tokens from Authorization headers.
 * Attaches `req.uid` for downstream use.
 * Returns `{ uid }` on success, or null + 401 on failure.
 */
export async function verifyAuth(req: Request, res: Response): Promise<{
    uid: string;
} | null> {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
        res.status(401).json({ ok: false, error: "Missing token" });
        return null;
    }
    try {
        const decoded = await auth.verifyIdToken(token);
        (req as any).uid = decoded.uid;
        return { uid: decoded.uid };
    }
    catch (err) {
        res.status(401).json({ ok: false, error: "Invalid or expired token" });
        return null;
    }
}
