import type { Request, Response } from "express";
import { loadAccountAuthorityForUser } from "../services/accountAuthority";
export async function getSubscriptionHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        if (!uid) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const authority = await loadAccountAuthorityForUser(uid);
        res.status(200).json({
            ok: true,
            subscription: authority.subscription,
            isActive: authority.isSubscriptionActive,
            allowedWorkspaceTypes: authority.allowedWorkspaceTypes,
            maxWorkspaces: authority.maxWorkspaces,
        });
    }
    catch (error: any) {
        res.status(500).json({
            ok: false,
            error: error?.message ?? "Internal server error",
        });
    }
}
