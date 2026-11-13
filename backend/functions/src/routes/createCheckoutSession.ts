import type { Request, Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../admin";
import type { SubscriptionDoc, SubscriptionTier } from "@shared/contracts/subscription";
import { getStripePriceIdForTier } from "../billing/stripePlanMap";
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const SUBSCRIPTION_TRIAL_DAYS = 30;
// The launch deal (e.g. a free first year). While its Stripe promotion code
// still has redemptions left, first-time subscribers get it applied for them
// instead of the trial, so checkout shows the deal and $0.00 due today.
// Once it's used up, checkout falls back to the trial.
const INTRO_PROMOTION_CODE = process.env.STRIPE_INTRO_PROMOTION_CODE?.trim() || "FIRST50";
const PENDING_CHECKOUT_LOCK_MS = 5 * 60 * 1000;
const REUSABLE_CHECKOUT_BUFFER_MS = 30 * 1000;
const ACTIVE_LOCAL_SUBSCRIPTION_STATUSES = new Set<SubscriptionDoc["status"]>([
    "active",
    "trialing",
    "past_due",
]);
const BLOCKING_STRIPE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
]);
const websiteSubscribeUrl =
    process.env.STACKIN_WEBSITE_SUBSCRIBE_URL?.trim() ||
        process.env.STACKIN_WEBSITE_PRICING_URL?.trim() ||
        // The website's own domain. stackin-app.com only redirects to its
        // homepage (dropping the path), so checkout success pages never
        // showed for website purchases.
        "https://the521app.com";
const websiteBaseUrl = new URL(websiteSubscribeUrl).origin;
const websitePricingUrl = process.env.STACKIN_WEBSITE_PRICING_URL?.trim() ||
    new URL("/#pricing", websiteBaseUrl).toString();
const CHECKOUT_SOURCE_PARAM = "source";
const CHECKOUT_SOURCE_VALUES = ["ios-app"] as const;
type CheckoutSource = (typeof CHECKOUT_SOURCE_VALUES)[number];

const CreateCheckoutSessionSchema = z.object({
    tier: z.enum(["w2_basic", "independent_basic", "hybrid_plus"]),
    source: z.enum(CHECKOUT_SOURCE_VALUES).optional(),
});
type BillingSubscriptionDoc = SubscriptionDoc & {
    pendingCheckoutSessionId?: string;
    pendingCheckoutExpiresAt?: number;
    pendingCheckoutUrl?: string;
    pendingCheckoutSource?: CheckoutSource;
    // The plan the pending checkout is for: it's only handed back for that
    // plan, so switching plans never opens the old plan's checkout.
    pendingCheckoutTier?: SubscriptionTier;
};

function getStripeClient(): Stripe {
    const stripeSecretKey = STRIPE_SECRET_KEY.value();
    if (!stripeSecretKey) {
        throw new Error("Missing STRIPE_SECRET_KEY");
    }
    return new Stripe(stripeSecretKey);
}
function hasStripeSubscriptionHistory(subscription: SubscriptionDoc | null): boolean {
    return Boolean(subscription?.stripeSubscriptionId || subscription?.stripeCustomerId);
}
function isReusablePendingCheckout(subscription: BillingSubscriptionDoc | null, now: number, tier: SubscriptionTier, source?: CheckoutSource): subscription is BillingSubscriptionDoc & {
    pendingCheckoutSessionId: string;
    pendingCheckoutExpiresAt: number;
    pendingCheckoutUrl: string;
} {
    return Boolean(subscription &&
        typeof subscription.pendingCheckoutSessionId === "string" &&
        typeof subscription.pendingCheckoutUrl === "string" &&
        typeof subscription.pendingCheckoutExpiresAt === "number" &&
        subscription.pendingCheckoutSource === source &&
        subscription.pendingCheckoutTier === tier &&
        subscription.pendingCheckoutExpiresAt > now + REUSABLE_CHECKOUT_BUFFER_MS);
}
function hasBlockingLocalSubscription(subscription: BillingSubscriptionDoc | null): boolean {
    return Boolean(subscription &&
        ACTIVE_LOCAL_SUBSCRIPTION_STATUSES.has(subscription.status));
}
function createHttpError(statusCode: number, message: string): Error & { statusCode: number; } {
    const error = new Error(message) as Error & { statusCode: number; };
    error.statusCode = statusCode;
    return error;
}
async function findStripeCustomerIdByEmail(stripe: Stripe, email: string): Promise<string | undefined> {
    const customers = await stripe.customers.list({
        email,
        limit: 10,
    });
    const normalizedEmail = email.trim().toLowerCase();
    return customers.data.find((customer) => customer.email?.trim().toLowerCase() === normalizedEmail)?.id;
}
async function findBlockingStripeSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
    });
    return (subscriptions.data.find((subscription) => BLOCKING_STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status)) ??
        null);
}
async function clearPendingCheckout(subscriptionRef: FirebaseFirestore.DocumentReference): Promise<void> {
    await subscriptionRef.set({
        pendingCheckoutSessionId: FieldValue.delete(),
        pendingCheckoutUrl: FieldValue.delete(),
        pendingCheckoutExpiresAt: FieldValue.delete(),
        pendingCheckoutSource: FieldValue.delete(),
        pendingCheckoutTier: FieldValue.delete(),
        updatedAt: Date.now(),
    }, { merge: true });
}

function hasRedemptionsLeft(limit: number | null, used: number): boolean {
    return limit === null || used < limit;
}

// The launch deal's promotion code id while it can still be used, else
// undefined. Any Stripe hiccup also means undefined: they get the trial.
async function findAvailableIntroPromotion(stripe: Stripe): Promise<string | undefined> {
    if (!INTRO_PROMOTION_CODE) return undefined;
    try {
        const { data } = await stripe.promotionCodes.list({
            code: INTRO_PROMOTION_CODE,
            active: true,
            limit: 1,
        });
        const promotion = data[0];
        if (!promotion) return undefined;
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (promotion.expires_at && promotion.expires_at <= nowSeconds) return undefined;
        if (!hasRedemptionsLeft(promotion.max_redemptions, promotion.times_redeemed)) return undefined;
        const coupon = promotion.coupon;
        if (!coupon.valid || !hasRedemptionsLeft(coupon.max_redemptions, coupon.times_redeemed)) return undefined;
        return promotion.id;
    }
    catch (error) {
        console.warn("createCheckoutSession: couldn't check the intro promotion", error instanceof Error ? error.message : error);
        return undefined;
    }
}

// Closes the checkout for a plan they switched away from, so it can't still
// be paid. One that was already paid means the account is subscribed.
async function expireReplacedCheckout(stripe: Stripe, sessionId: string): Promise<void> {
    try {
        await stripe.checkout.sessions.expire(sessionId);
    }
    catch {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === "complete") {
            throw createHttpError(409, "This account already has an active subscription.");
        }
        // Already expired: nothing to close.
    }
}

// Checkout started in the iOS app runs in Safari; it comes back through the
// web app's /checkout/return page, which opens stackin://checkout/return so
// the person lands in the app again (frontend/app/checkout/return/page.tsx).
const APP_HOSTING_URL = "https://app.the521app.com";

function buildAppReturnUrl(source: CheckoutSource, result: "success" | "cancel"): string {
    const url = new URL("/checkout/return", APP_HOSTING_URL);
    url.searchParams.set(CHECKOUT_SOURCE_PARAM, source);
    url.searchParams.set("result", result);
    return url.toString();
}

function buildCheckoutSuccessUrl(source?: CheckoutSource): string {
    if (source === "ios-app") {
        return buildAppReturnUrl(source, "success");
    }
    const successUrl = new URL("/checkout/success", websiteBaseUrl);
    if (source) {
        successUrl.searchParams.set(CHECKOUT_SOURCE_PARAM, source);
    }
    return successUrl.toString();
}

function buildCheckoutCancelUrl(source?: CheckoutSource): string {
    return source === "ios-app" ? buildAppReturnUrl(source, "cancel") : websitePricingUrl;
}

export async function createCheckoutSessionHandler(req: Request, res: Response): Promise<void> {
    let subscriptionRef: FirebaseFirestore.DocumentReference | null = null;
    let shouldReleasePendingCheckout = false;
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
        const parsed = CreateCheckoutSessionSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ ok: false, error: "Invalid request body" });
            return;
        }
        const tier: SubscriptionTier = parsed.data.tier;
        const source = parsed.data.source;
        const stripe = getStripeClient();
        const currentSubscriptionRef = db
            .collection("users")
            .doc(uid)
            .collection("subscription")
            .doc("current");
        subscriptionRef = currentSubscriptionRef;
        const userRecord = await auth.getUser(uid);
        const checkoutReservation = await db.runTransaction(async (transaction) => {
            const subscriptionSnap = await transaction.get(currentSubscriptionRef);
            const existingSubscription = subscriptionSnap.exists
                ? (subscriptionSnap.data() as BillingSubscriptionDoc)
                : null;
            const now = Date.now();
            if (hasBlockingLocalSubscription(existingSubscription)) {
                throw createHttpError(409, "This account already has an active subscription.");
            }
            if (isReusablePendingCheckout(existingSubscription, now, tier, source)) {
                return {
                    kind: "reuse" as const,
                    sessionId: existingSubscription.pendingCheckoutSessionId,
                    url: existingSubscription.pendingCheckoutUrl,
                };
            }
            const pendingIsLive = typeof existingSubscription?.pendingCheckoutExpiresAt === "number" &&
                existingSubscription.pendingCheckoutExpiresAt > now &&
                existingSubscription.pendingCheckoutSource === source;
            // A live checkout for another plan is replaced; one with no link
            // yet is another request still creating it.
            const replacedSessionId = pendingIsLive && typeof existingSubscription?.pendingCheckoutSessionId === "string"
                ? existingSubscription.pendingCheckoutSessionId
                : undefined;
            if (pendingIsLive && !replacedSessionId) {
                throw createHttpError(409, "A checkout session is already in progress for this account.");
            }
            transaction.set(currentSubscriptionRef, {
                createdAt: existingSubscription?.createdAt ?? now,
                updatedAt: now,
                pendingCheckoutSessionId: FieldValue.delete(),
                pendingCheckoutUrl: FieldValue.delete(),
                pendingCheckoutSource: FieldValue.delete(),
                pendingCheckoutTier: FieldValue.delete(),
                pendingCheckoutExpiresAt: now + PENDING_CHECKOUT_LOCK_MS,
            }, { merge: true });
            return {
                kind: "create" as const,
                existingSubscription,
                replacedSessionId,
            };
        });
        if (checkoutReservation.kind === "reuse") {
            res.status(200).json({
                ok: true,
                url: checkoutReservation.url,
                sessionId: checkoutReservation.sessionId,
            });
            return;
        }
        shouldReleasePendingCheckout = true;
        if (checkoutReservation.replacedSessionId) {
            await expireReplacedCheckout(stripe, checkoutReservation.replacedSessionId);
        }
        const existingSubscription = checkoutReservation.existingSubscription;
        const email = userRecord.email;
        if (!email) {
            await clearPendingCheckout(currentSubscriptionRef);
            shouldReleasePendingCheckout = false;
            res.status(400).json({
                ok: false,
                error: "Authenticated user is missing an email address",
            });
            return;
        }
        const existingCustomerId = existingSubscription?.stripeCustomerId ??
            await findStripeCustomerIdByEmail(stripe, email);
        if (existingCustomerId) {
            const blockingSubscription = await findBlockingStripeSubscription(stripe, existingCustomerId);
            if (blockingSubscription) {
                await clearPendingCheckout(currentSubscriptionRef);
                shouldReleasePendingCheckout = false;
                res.status(409).json({
                    ok: false,
                    error: "This account already has a Stripe subscription. Please manage the existing subscription instead of creating a new one.",
                });
                return;
            }
        }
        const priceId = getStripePriceIdForTier(tier);
        const successUrl = buildCheckoutSuccessUrl(source);
        // Intro offers are for first-time subscribers only, so returning
        // subscribers are billed immediately.
        const isFirstTimeSubscriber = !hasStripeSubscriptionHistory(existingSubscription);
        const introPromotionId = isFirstTimeSubscriber
            ? await findAvailableIntroPromotion(stripe)
            : undefined;

        const createSession = (promotionId: string | undefined) => stripe.checkout.sessions.create({
            mode: "subscription",
            payment_method_types: ["card"],
            // Stripe won't show its own code box when a code is already
            // attached, so the box only appears without the launch deal.
            ...(promotionId
                ? { discounts: [{ promotion_code: promotionId }] }
                : { allow_promotion_codes: true }),
            // A $0.00 first bill still collects a card, so they're charged
            // when the deal ends unless they cancel.
            payment_method_collection: "always",
            client_reference_id: uid,
            ...(existingCustomerId
                ? { customer: existingCustomerId }
                : { customer_email: email }),
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: successUrl,
            cancel_url: buildCheckoutCancelUrl(source),
            metadata: {
                uid,
                tier,
                ...(source ? { source } : {}),
            },
            subscription_data: {
                metadata: {
                    uid,
                    tier,
                    ...(source ? { source } : {}),
                },
                // The launch deal replaces the trial rather than stacking on it.
                ...(isFirstTimeSubscriber && !promotionId
                    ? { trial_period_days: SUBSCRIPTION_TRIAL_DAYS }
                    : {}),
            },
        });

        let session: Stripe.Checkout.Session;
        if (introPromotionId) {
            try {
                session = await createSession(introPromotionId);
            }
            catch (error) {
                // e.g. the last redemption went between the check and now, or
                // the coupon doesn't cover this plan: fall back to the trial.
                console.warn("createCheckoutSession: intro promotion rejected, using the trial", error instanceof Error ? error.message : error);
                session = await createSession(undefined);
            }
        }
        else {
            session = await createSession(undefined);
        }
        if (!session.url) {
            await clearPendingCheckout(currentSubscriptionRef);
            shouldReleasePendingCheckout = false;
            res.status(500).json({ ok: false, error: "Stripe session missing URL" });
            return;
        }
        await currentSubscriptionRef.set({
            updatedAt: Date.now(),
            ...(existingCustomerId
                ? { stripeCustomerId: existingCustomerId }
                : {}),
            pendingCheckoutSessionId: session.id,
            pendingCheckoutUrl: session.url,
            ...(source ? { pendingCheckoutSource: source } : {}),
            pendingCheckoutTier: tier,
            pendingCheckoutExpiresAt: typeof session.expires_at === "number"
                ? session.expires_at * 1000
                : Date.now() + PENDING_CHECKOUT_LOCK_MS,
        }, { merge: true });
        shouldReleasePendingCheckout = false;
        res.status(200).json({
            ok: true,
            url: session.url,
            sessionId: session.id,
        });
    }
    catch (error: any) {
        if (shouldReleasePendingCheckout && subscriptionRef) {
            try {
                await clearPendingCheckout(subscriptionRef);
            }
            catch {
                // Best effort cleanup so a failed Stripe call does not leave a stale lock behind.
            }
        }
        const statusCode = typeof error?.statusCode === "number"
            ? error.statusCode
            : 500;
        res.status(statusCode).json({
            ok: false,
            error: error?.message ?? "Internal server error",
        });
    }
}
