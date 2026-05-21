// /functions/src/routes/createWorkspace.ts
// Atomic workspace creation endpoint
// Mirrors signup.ts structure and logging style
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../admin";
import type { WorkspaceDoc, WorkspaceMembership, WorkspaceType, } from "@shared/contracts/workspace";
import { getSubscriptionCapabilities, type SubscriptionDoc, } from "@shared/contracts/subscription";
// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const CreateWorkspaceSchema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(["w2", "independent"]),
});
// ---------------------------------------------------------------------------
// Plain handler
// ---------------------------------------------------------------------------
export async function createWorkspaceHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const parsed = CreateWorkspaceSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ ok: false, error: "Invalid request body" });
            return;
        }
        const { name, type } = parsed.data;
        const safeName = name.trim();
        const uid = (req as any).user?.uid;
        if (!uid) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const subRef = db
            .collection("users")
            .doc(uid)
            .collection("subscription")
            .doc("current");
        const subSnap = await subRef.get();
        if (!subSnap.exists) {
            res
                .status(403)
                .json({ ok: false, error: "No active subscription" });
            return;
        }
        const subscription = subSnap.data() as SubscriptionDoc;
        const capabilities = getSubscriptionCapabilities(subscription);
        // -----------------------------------------------------------------------
        // Enforce entitlement
        // -----------------------------------------------------------------------
        if (!capabilities.allowedWorkspaceTypes.includes(type)) {
            res.status(403).json({
                ok: false,
                error: "Workspace type not allowed by subscription",
            });
            return;
        }
        const membershipsRef = db
            .collection("users")
            .doc(uid)
            .collection("memberships");
        const membershipsSnap = await membershipsRef.get();
        const existingWorkspaceCount = membershipsSnap.size;
        if (capabilities.maxWorkspaces !== "unlimited" &&
            existingWorkspaceCount >= capabilities.maxWorkspaces) {
            res.status(403).json({
                ok: false,
                error: "Workspace limit reached for subscription",
            });
            return;
        }
        // -----------------------------------------------------------------------
        // Prepare Firestore batch
        // -----------------------------------------------------------------------
        const workspaceRef = db.collection("workspaces").doc();
        const membershipRef = membershipsRef.doc(workspaceRef.id);
        const workspaceDoc: WorkspaceDoc = {
            id: workspaceRef.id,
            ownerId: uid,
            name: safeName,
            type: type as WorkspaceType,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const membershipDoc: WorkspaceMembership = {
            workspaceId: workspaceRef.id,
            role: "owner",
            joinedAt: Date.now(),
        };
        const batch = db.batch();
        batch.set(workspaceRef, workspaceDoc);
        batch.set(membershipRef, {
            ...membershipDoc,
        });
        // -----------------------------------------------------------------------
        // Commit atomically
        // -----------------------------------------------------------------------
        await batch.commit();
        // -----------------------------------------------------------------------
        // Respond
        // -----------------------------------------------------------------------
        res.status(200).json({
            ok: true,
            workspace: workspaceDoc,
        });
    }
    catch (error: any) {
        res.status(500).json({
            ok: false,
            error: "Internal server error",
        });
    }
}
