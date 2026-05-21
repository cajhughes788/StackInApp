import type { Request, Response } from "express";
import type { SubscriptionDoc } from "@shared/contracts/subscription";
import { getSubscriptionCapabilities } from "@shared/contracts/subscription";
import { db } from "../admin";
const ACTIVE_STATUSES = new Set<SubscriptionDoc["status"]>([
    "active",
    "trialing",
]);
const SUBSCRIPTION_TIERS = new Set<SubscriptionDoc["tier"]>([
    "w2_basic",
    "independent_basic",
    "hybrid_plus",
]);
const SUBSCRIPTION_STATUSES = new Set<SubscriptionDoc["status"]>([
    "active",
    "trialing",
    "past_due",
    "canceled",
]);
function isStoredSubscriptionDoc(value: Record<string, unknown>): boolean {
    return SUBSCRIPTION_TIERS.has(value.tier as SubscriptionDoc["tier"]) &&
        SUBSCRIPTION_STATUSES.has(value.status as SubscriptionDoc["status"]) &&
        typeof value.createdAt === "number" &&
        typeof value.updatedAt === "number";
}
function toPublicSubscriptionDoc(value: Record<string, unknown>): SubscriptionDoc {
    return {
        tier: value.tier as SubscriptionDoc["tier"],
        status: value.status as SubscriptionDoc["status"],
        createdAt: value.createdAt as number,
        updatedAt: value.updatedAt as number,
        ...(typeof value.stripeCustomerId === "string"
            ? { stripeCustomerId: value.stripeCustomerId }
            : {}),
        ...(typeof value.stripeSubscriptionId === "string"
            ? { stripeSubscriptionId: value.stripeSubscriptionId }
            : {}),
        ...(typeof value.cancelAtPeriodEnd === "boolean"
            ? { cancelAtPeriodEnd: value.cancelAtPeriodEnd }
            : {}),
        ...(typeof value.currentPeriodEnd === "number"
            ? { currentPeriodEnd: value.currentPeriodEnd }
            : {}),
        ...(typeof value.pendingAccountDeletion === "boolean"
            ? { pendingAccountDeletion: value.pendingAccountDeletion }
            : {}),
        ...(typeof value.scheduledDeletionAt === "number"
            ? { scheduledDeletionAt: value.scheduledDeletionAt }
            : {}),
        ...(typeof value.deletionRequestedAt === "number"
            ? { deletionRequestedAt: value.deletionRequestedAt }
            : {}),
    };
}
function isPlausibleSubscriptionTimestamp(value: unknown): value is number {
    return (typeof value === "number" &&
        Number.isFinite(value) &&
        value >= Date.UTC(2000, 0, 1) &&
        value <= Date.UTC(2100, 0, 1));
}
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
        const subRef = db
            .collection("users")
            .doc(uid)
            .collection("subscription")
            .doc("current");
        const subSnap = await subRef.get();
        if (!subSnap.exists) {
            res.status(200).json({
                ok: true,
                subscription: null,
                isActive: false,
                allowedWorkspaceTypes: [],
                maxWorkspaces: 0,
            });
            return;
        }
        const rawSubscription = subSnap.data() as Record<string, unknown>;
        if (!isStoredSubscriptionDoc(rawSubscription)) {
            res.status(200).json({
                ok: true,
                subscription: null,
                isActive: false,
                allowedWorkspaceTypes: [],
                maxWorkspaces: 0,
            });
            return;
        }
        const subscription = toPublicSubscriptionDoc(rawSubscription);
        const shouldRepairScheduledDeletionAt = subscription.pendingAccountDeletion === true &&
            !isPlausibleSubscriptionTimestamp(subscription.scheduledDeletionAt) &&
            isPlausibleSubscriptionTimestamp(subscription.currentPeriodEnd);
        if (shouldRepairScheduledDeletionAt) {
            subscription.scheduledDeletionAt = subscription.currentPeriodEnd;
            subscription.updatedAt = Date.now();
            await subRef.set({
                scheduledDeletionAt: subscription.scheduledDeletionAt,
                updatedAt: subscription.updatedAt,
            }, { merge: true });
        }
        const capabilities = getSubscriptionCapabilities(subscription);
        const isActive = ACTIVE_STATUSES.has(subscription.status);
        res.status(200).json({
            ok: true,
            subscription,
            isActive,
            allowedWorkspaceTypes: isActive
                ? capabilities.allowedWorkspaceTypes
                : [],
            maxWorkspaces: isActive ? capabilities.maxWorkspaces : 0,
        });
    }
    catch (error: any) {
        res.status(500).json({
            ok: false,
            error: error?.message ?? "Internal server error",
        });
    }
}
