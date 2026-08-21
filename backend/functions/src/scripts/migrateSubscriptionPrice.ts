/**
 * Moves existing Stripe subscriptions from one price to another *in place* —
 * same subscription ID, no cancellation, no new checkout. Use this whenever
 * a workspace tier's price changes (e.g. w2_basic $1.99 -> $0) and existing
 * subscribers should move onto the new price without resubscribing.
 *
 * The webhook in stripeWebhook.ts already syncs Firestore automatically when
 * Stripe fires customer.subscription.updated for each migrated subscription
 * — as long as the new price ID is present in STRIPE_PRICE_IDS first.
 *
 * Usage (from backend/functions/):
 *   STRIPE_SECRET_KEY=sk_live_... npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs"}' \
 *     src/scripts/migrateSubscriptionPrice.ts --from price_OLD --to price_NEW
 *
 * Defaults to a dry run (prints what it would do). Pass --execute to apply.
 */
import Stripe from "stripe";

function parseArgs(): { fromPriceId: string; toPriceId: string; execute: boolean } {
    const args = process.argv.slice(2);
    const get = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const fromPriceId = get("--from");
    const toPriceId = get("--to");
    const execute = args.includes("--execute");
    if (!fromPriceId || !toPriceId) {
        console.error("Usage: migrateSubscriptionPrice.ts --from <oldPriceId> --to <newPriceId> [--execute]");
        process.exit(1);
    }
    return { fromPriceId, toPriceId, execute };
}

function formatAmount(price: Stripe.Price): string {
    const amount = (price.unit_amount ?? 0) / 100;
    return `$${amount.toFixed(2)}/${price.recurring?.interval ?? "one-time"}`;
}

async function main(): Promise<void> {
    const { fromPriceId, toPriceId, execute } = parseArgs();
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        console.error("Missing STRIPE_SECRET_KEY in environment.");
        process.exit(1);
    }
    const stripe = new Stripe(secretKey);

    const [fromPrice, toPrice] = await Promise.all([
        stripe.prices.retrieve(fromPriceId),
        stripe.prices.retrieve(toPriceId),
    ]);
    if (fromPrice.product !== toPrice.product) {
        console.error(`Refusing to migrate: prices belong to different products (${String(fromPrice.product)} vs ${String(toPrice.product)}).`);
        process.exit(1);
    }

    console.log(`From: ${fromPriceId} (${formatAmount(fromPrice)})`);
    console.log(`To:   ${toPriceId} (${formatAmount(toPrice)})`);
    console.log(execute ? "Mode: EXECUTE — this will modify live subscriptions.\n" : "Mode: DRY RUN — no changes will be made.\n");

    let migrated = 0;
    let skipped = 0;
    const activeStatuses = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

    for await (const subscription of stripe.subscriptions.list({ price: fromPriceId, status: "all", limit: 100 })) {
        if (!activeStatuses.has(subscription.status)) {
            console.log(`  skip ${subscription.id} (status=${subscription.status})`);
            skipped++;
            continue;
        }
        const item = subscription.items.data.find((i) => i.price.id === fromPriceId);
        if (!item) {
            console.log(`  skip ${subscription.id} (no matching line item)`);
            skipped++;
            continue;
        }
        console.log(`  ${execute ? "migrate" : "would migrate"} ${subscription.id} (customer ${String(subscription.customer)})`);
        if (execute) {
            await stripe.subscriptions.update(subscription.id, {
                items: [{ id: item.id, price: toPriceId }],
                proration_behavior: "none",
            });
        }
        migrated++;
    }

    console.log(`\nDone. ${migrated} ${execute ? "migrated" : "would be migrated"}, ${skipped} skipped.`);
    if (!execute) {
        console.log("Re-run with --execute to actually apply these changes.");
    } else {
        console.log("Stripe will fire customer.subscription.updated for each — Firestore syncs automatically via the webhook, as long as the new price ID is already in STRIPE_PRICE_IDS.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
