import { onRequest } from "firebase-functions/v2/https";
import type { Request, Response } from "express";
import cors from "cors";
import { auth } from "../admin";
// ---------------------------------------------------------------------------
// 🔹 Universal CORS handler
// ---------------------------------------------------------------------------
const corsHandler = cors({
    origin: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "idempotency-key",
        "Idempotency-Key",
        "X-StackIn-Trace-Id",
        "X-StackIn-Flow",
    ],
    credentials: true,
});
// ---------------------------------------------------------------------------
// 🔹 Handle browser preflight requests
// ---------------------------------------------------------------------------
function handlePreflight(req: Request, res: Response): boolean {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, idempotency-key, Idempotency-Key, X-StackIn-Trace-Id, X-StackIn-Flow");
        res.status(204).end();
        return true;
    }
    return false;
}
// ---------------------------------------------------------------------------
// 🔹 Firebase Auth verification (inline)
// ---------------------------------------------------------------------------
async function verifyAuth(req: Request, res: Response): Promise<string | null> {
    // 🔥 Required: check multiple possible header keys
    const rawAuth = req.headers.authorization ||
        (req.headers["Authorization"] as any) ||
        (req.headers["AUTHORIZATION"] as any) ||
        (req.headers["authorization"] as any) ||
        null;
    const token = rawAuth?.startsWith("Bearer ") ? rawAuth.slice(7) : null;
    if (!token) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(401).json({ ok: false, error: "Missing token" });
        return null;
    }
    try {
        const decoded = await auth.verifyIdToken(token);
        (req as any).user = { uid: decoded.uid };
        return decoded.uid;
    }
    catch (err) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(401).json({ ok: false, error: "Invalid or expired token" });
        return null;
    }
}
// ---------------------------------------------------------------------------
// 🔹 Main unified wrapper
// ---------------------------------------------------------------------------
export function withCorsAuth(handler: (req: Request, res: Response) => Promise<void> | void, requireAuth: boolean = true, options: Record<string, any> = {}) {
    return onRequest(options as any, async (req, res) => {
        // Base CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, idempotency-key, Idempotency-Key, X-StackIn-Trace-Id, X-StackIn-Flow");
        // Preflight shortcut
        if (handlePreflight(req as any, res as any)) {
            return;
        }
        // Apply CORS then continue
        corsHandler(req as any, res as any, async () => {
            try {
                if (requireAuth) {
                    const uid = await verifyAuth(req as any, res as any);
                    if (!uid)
                        return;
                }
                await handler(req as any, res as any);
            }
            catch (err: any) {
                console.error("[withCorsAuth] unhandled error", {
                    method: req.method,
                    path: req.path,
                    query: req.query,
                    errorName: err instanceof Error ? err.name : typeof err,
                    errorMessage: err instanceof Error ? err.message : String(err),
                    errorStack: err instanceof Error ? err.stack : undefined,
                });
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.status(500).json({
                    ok: false,
                    error: err instanceof Error && err.message ? err.message : "Internal server error",
                });
            }
        });
    });
}
