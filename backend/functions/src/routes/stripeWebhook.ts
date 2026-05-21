import type { Request, Response } from "express";
import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import type { SubscriptionDoc } from "@shared/contracts/subscription";
import { db } from "../admin";
import { getTierFromStripePriceId } from "../billing/stripePlanMap";
import { purgeUserData } from "../services/userDeletionService";
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
function getStripeClient(): Stripe {
    const stripeSecretKey = STRIPE_SECRET_KEY.value();
    if (!stripeSecretKey) {
        throw new Error("Missing STRIPE_SECRET_KEY");
    }
    return new Stripe(stripeSecretKey);
}
function getStripeWebhookEvent(req: Request): Stripe.Event {
    const stripeWebhookSecret = STRIPE_WEBHOOK_SECRET.value();
    if (!stripeWebhookSecret) {
        throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    }
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
        throw new Error("Missing Stripe signature");
    }
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
        throw new Error("Missing raw webhook body");
    }
    return getStripeClient().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
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
function stripUndefinedFields<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)) as Partial<T>;
}
async function upsertSubscriptionDoc(uid: string, subscription: Partial<SubscriptionDoc> & Pick<SubscriptionDoc, "tier" | "status">): Promise<void> {
    const now = Date.now();
    const ref = db
        .collection("users")
        .doc(uid)
        .collection("subscription")
        .doc("current");
    const existing = await ref.get();
    const existingData = existing.exists
        ? (existing.data() as SubscriptionDoc)
        : null;
    const isPendingDeletion = existingData?.pendingAccountDeletion === true;
    const deletionEffectiveAt = getStripeCancellationEffectiveAtMs(subscription);
    const nextScheduledDeletionAt = isPendingDeletion
        ? deletionEffectiveAt ??
            existingData?.scheduledDeletionAt ??
            existingData?.currentPeriodEnd ??
            now
        : existingData?.scheduledDeletionAt;
    await ref.set(stripUndefinedFields({
        createdAt: existing.exists
            ? (existing.data()?.createdAt ?? now)
            : now,
        updatedAt: now,
        pendingCheckoutSessionId: FieldValue.delete(),
        pendingCheckoutUrl: FieldValue.delete(),
        pendingCheckoutExpiresAt: FieldValue.delete(),
        ...(isPendingDeletion
            ? {
                pendingAccountDeletion: true,
                scheduledDeletionAt: nextScheduledDeletionAt,
            }
            : {}),
        ...subscription,
    }), { merge: true });
}
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).send("Method not allowed");
        return;
    }
    try {
        const stripe = getStripeClient();
        const event = getStripeWebhookEvent(req);
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                const uid = session.metadata?.uid;
                const tierFromMetadata = session.metadata?.tier ?? null;
                if (!uid || !tierFromMetadata) {
                    break;
                }
                let subscriptionStatus: SubscriptionDoc["status"] = "active";
                let currentPeriodEnd: number | undefined;
                if (typeof session.subscription === "string") {
                    const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
                    subscriptionStatus =
                        stripeSubscription.status as SubscriptionDoc["status"];
                    currentPeriodEnd = getStripeCurrentPeriodEndMs(stripeSubscription);
                }
                await upsertSubscriptionDoc(uid, {
                    tier: tierFromMetadata as SubscriptionDoc["tier"],
                    status: subscriptionStatus,
                    stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
                    stripeSubscriptionId: typeof session.subscription === "string"
                        ? session.subscription
                        : undefined,
                    cancelAtPeriodEnd: false,
                    currentPeriodEnd,
                });
                break;
            }
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const subscription = event.data.object as Stripe.Subscription;
                const uid = subscription.metadata?.uid;
                if (!uid) {
                    break;
                }
                const subRef = db
                    .collection("users")
                    .doc(uid)
                    .collection("subscription")
                    .doc("current");
                const existingSubSnap = await subRef.get();
                const existingSubscription = existingSubSnap.exists
                    ? (existingSubSnap.data() as SubscriptionDoc)
                    : null;
                if (event.type === "customer.subscription.deleted" &&
                    existingSubscription?.pendingAccountDeletion) {
                    await purgeUserData(uid);
                    break;
                }
                const priceId = subscription.items.data[0]?.price?.id;
                if (!priceId) {
                    break;
                }
                const tier = getTierFromStripePriceId(priceId);
                if (!tier) {
                    break;
                }
                await upsertSubscriptionDoc(uid, {
                    tier,
                    status: subscription.status as SubscriptionDoc["status"],
                    stripeCustomerId: typeof subscription.customer === "string"
                        ? subscription.customer
                        : undefined,
                    stripeSubscriptionId: subscription.id,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    currentPeriodEnd: getStripeCancellationEffectiveAtMs(subscription),
                });
                break;
            }
            default:
        }
        res.status(200).json({ received: true });
    }
    catch (error: any) {
        res.status(400).send(error?.message ?? "Webhook error");
    }
}
