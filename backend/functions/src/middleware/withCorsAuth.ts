import { onRequest } from "firebase-functions/v2/https";
import type { Request, Response } from "express";
import cors from "cors";
import { auth, appCheck } from "../admin";
// ---------------------------------------------------------------------------
// 🔹 Universal CORS handler
// ---------------------------------------------------------------------------
// credentials: true is deliberately omitted — the frontend never sends
// cookies (every request is issued with credentials: "omit"; see
// frontend/lib/api/core/client.ts), so there's nothing for it to protect
// here, and "reflect any origin" + "allow credentials" is exactly the
// combination flagged by every CORS security scanner. Auth is a bearer
// token in the Authorization header, which a cross-origin page can't cause
// a victim's browser to attach on its own — origin is left permissive
// (rather than an allowlist) only because this API also serves the
// Capacitor iOS/Android app, whose WebView origin isn't a fixed, easily
// verified string without risking breaking mobile access.
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
        "X-Firebase-AppCheck",
    ],
});
// ---------------------------------------------------------------------------
// 🔹 Handle browser preflight requests
// ---------------------------------------------------------------------------
function handlePreflight(req: Request, res: Response): boolean {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, idempotency-key, Idempotency-Key, X-StackIn-Trace-Id, X-StackIn-Flow, X-Firebase-AppCheck");
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
        // auth_time (Unix seconds) is when the user last actually presented
        // credentials — distinct from the token's own issued-at time, which
        // just reflects the last silent refresh. Sensitive routes (account
        // deletion) use this to require a *recent* login, not just a valid
        // token — see lib/requireRecentAuth.ts.
        (req as any).user = { uid: decoded.uid, authTimeMs: decoded.auth_time * 1000 };
        return decoded.uid;
    }
    catch (err) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(401).json({ ok: false, error: "Invalid or expired token" });
        return null;
    }
}
// ---------------------------------------------------------------------------
// 🔹 App Check — monitor-only for now (see backend/functions/src/admin.ts)
// ---------------------------------------------------------------------------
// Logs whether each request carries a valid App Check token, but never
// blocks on the result. This is deliberate: enforcing before the client-side
// integration has shipped and reached wide adoption would 401 every user
// still on an old build. Once App Check's own metrics dashboard shows
// adoption is high enough, flip REQUIRE_APP_CHECK below (or replace this
// with a hard rejection) to start actually enforcing it.
async function checkAppCheck(req: Request): Promise<{ verified: boolean; reason?: string }> {
    const token = req.headers["x-firebase-appcheck"];
    const tokenString = Array.isArray(token) ? token[0] : token;
    if (!tokenString) {
        return { verified: false, reason: "missing" };
    }
    try {
        await appCheck.verifyToken(tokenString);
        return { verified: true };
    }
    catch (err) {
        return { verified: false, reason: err instanceof Error ? err.message : String(err) };
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
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, idempotency-key, Idempotency-Key, X-StackIn-Trace-Id, X-StackIn-Flow, X-Firebase-AppCheck");
        // Preflight shortcut
        if (handlePreflight(req as any, res as any)) {
            return;
        }
        // Apply CORS then continue
        corsHandler(req as any, res as any, async () => {
            try {
                const appCheckResult = await checkAppCheck(req as any);
                console.log("[AppCheck] monitor", {
                    method: req.method,
                    path: req.path,
                    verified: appCheckResult.verified,
                    reason: appCheckResult.reason,
                });
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
                // Never echo the raw error message to the client here — full
                // detail is already in the console.error above; a route that
                // wants to surface a specific, safe message to the client
                // should throw an HttpError (see lib/httpErrors.ts) instead
                // of relying on this catch-all.
                res.status(500).json({
                    ok: false,
                    error: "Internal server error",
                });
            }
        });
    });
}
