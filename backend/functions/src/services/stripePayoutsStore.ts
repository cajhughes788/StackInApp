import { db } from "../admin"
import { StripePayoutSchema, STRIPE_PAYOUT_MATCH_DAYS, matchStripePayout, type StripePayout } from "@shared/stripePayouts"

// Firestore side of shared/stripePayouts.ts, kept free of the Stripe SDK so
// Plaid ingestion can check payouts without loading it.

export function payoutsCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("stripePayouts")
}

function isoDaysFrom(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

// For Plaid ingestion: the recorded payout a new deposit is, if any.
export async function findMatchingStripePayout(
  workspaceId: string,
  deposit: { date: string; amount: number; merchantName: string | null; rawName: string }
): Promise<StripePayout | null> {
  const snap = await payoutsCol(workspaceId)
    .where("arrivalDate", ">=", isoDaysFrom(deposit.date, -STRIPE_PAYOUT_MATCH_DAYS))
    .where("arrivalDate", "<=", isoDaysFrom(deposit.date, STRIPE_PAYOUT_MATCH_DAYS))
    .get()
  const payouts = snap.docs.flatMap((doc) => {
    const parsed = StripePayoutSchema.safeParse(doc.data())
    return parsed.success ? [parsed.data] : []
  })
  return matchStripePayout(deposit, payouts)
}

export async function markStripePayoutMatched(workspaceId: string, payoutId: string, pendingTransactionId: string | null) {
  await payoutsCol(workspaceId)
    .doc(payoutId)
    .set({ matchedPendingTransactionId: pendingTransactionId, updatedAt: new Date().toISOString() }, { merge: true })
}
