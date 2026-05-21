import type { Request, Response } from "express";
import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";
import type { SubscriptionDoc } from "@shared/contracts/subscription";
import { db } from "../admin";
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
function getStripeClient(): Stripe {
    const stripeSecretKey = STRIPE_SECRET_KEY.value();
    if (!stripeSecretKey) {
        throw new Error("Missing STRIPE_SECRET_KEY");
    }
    return new Stripe(stripeSecretKey);
}
function getStripeCurrentPeriodEndMs(subscription: unknown): number | undefined {
    const rawCurrentPeriodEnd = (subscription as any)?.current_period_end;
    if (typeof rawCurrentPeriodEnd === "number") {
        return rawCurrentPeriodEnd * 1000;
    }
    const rawCurrentPeriodEndAlt = (subscription as any)?.currentPeriodEnd;
    if (typeof rawCurrentPeriodEndAlt === "number") {
        return rawCurrentPeriodEndAlt > 1_000_000_000_000
            ? rawCurrentPeriodEndAlt
            : rawCurrentPeriodEndAlt * 1000;
    }
    return undefined;
}
function getStripeCancellationEffectiveAtMs(subscription: unknown): number | undefined {
    const rawCancelAt = (subscription as any)?.cancel_at;
    if (typeof rawCancelAt === "number") {
        return rawCancelAt * 1000;
    }
    return getStripeCurrentPeriodEndMs(subscription);
}
export async function cancelAccountDeletionRequestHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
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
            res.status(404).json({ ok: false, error: "Subscription not found" });
            return;
        }
        const subscription = subSnap.data() as SubscriptionDoc;
        const stripeSubscriptionId = subscription.stripeSubscriptionId;
        const now = Date.now();
        if (stripeSubscriptionId) {
            const stripe = getStripeClient();
            const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
                cancel_at_period_end: false,
            });
            await subRef.set({
                status: updatedSubscription.status as SubscriptionDoc["status"],
                cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
                currentPeriodEnd: getStripeCancellationEffectiveAtMs(updatedSubscription) ??
                    subscription.currentPeriodEnd,
                pendingAccountDeletion: false,
                scheduledDeletionAt: null,
                deletionRequestedAt: null,
                updatedAt: now,
            }, { merge: true });
        }
        else {
            await subRef.set({
                pendingAccountDeletion: false,
                scheduledDeletionAt: null,
                deletionRequestedAt: null,
                updatedAt: now,
            }, { merge: true });
        }
        res.status(200).json({ ok: true });
    }
    catch (error: any) {
        res.status(500).json({
            ok: false,
            error: error?.message ?? "Internal server error",
        });
    }
}
