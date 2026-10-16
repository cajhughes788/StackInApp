import { z } from "zod"
import { isPeerToPeerDescriptor } from "./plaidClassification"

// -------------------------------------------------------------
// Stripe payouts from the workspace's Connect account. Firestore path:
// workspaces/{workspaceId}/stripePayouts/{payoutId}
//
// Online invoice payments are booked when the client pays (the Checkout
// webhook). Stripe later pays the money out to the user's bank in lumps,
// net of fees — and Plaid then sees that lump as a deposit. Without this it
// would land in the review list as new income and be counted twice. So every
// payout is recorded as soon as Stripe announces it (payout.created, with the
// expected arrival date), whether or not a bank is connected, and a matching
// deposit is dismissed as "stripe_payout" — from either side, whichever
// arrives second.
// -------------------------------------------------------------

export const StripePayoutSchema = z.object({
  id: z.string(),
  amount: z.number(), // dollars
  arrivalDate: z.string(), // YYYY-MM-DD
  status: z.enum(["pending", "in_transit", "paid", "failed", "canceled"]),
  matchedPendingTransactionId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type StripePayout = z.infer<typeof StripePayoutSchema>

// Banks post ACH credits a day or two either side of Stripe's arrival date.
export const STRIPE_PAYOUT_MATCH_DAYS = 3

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000
}

export type PayoutMatchDeposit = { date: string; amount: number; merchantName: string | null; rawName: string }

// Another processor's or payment app's name rules a deposit out. Stripe
// itself isn't required: an Express payout can reach the bank under the
// account's own descriptor rather than "Stripe".
const OTHER_PROCESSOR_PATTERN = /\b(square|sq \*|clover|shopify|toast|paypal|venmo|zelle|cash\s*app)\b/

// The payout a bank deposit is, if any: the exact amount, within a few days
// of a payout not already matched, from no other processor. Closest arrival
// date wins. Matches are dismissed into Hidden transfers, where a wrong one
// can be restored.
export function matchStripePayout<T extends Pick<StripePayout, "amount" | "arrivalDate" | "status" | "matchedPendingTransactionId">>(
  deposit: PayoutMatchDeposit,
  payouts: T[]
): T | null {
  const descriptor = `${deposit.merchantName ?? ""} ${deposit.rawName}`.toLowerCase()
  if (OTHER_PROCESSOR_PATTERN.test(descriptor) || isPeerToPeerDescriptor(deposit.merchantName, deposit.rawName)) return null
  const cents = Math.round(deposit.amount * 100)
  let best: T | null = null
  for (const payout of payouts) {
    if (payout.matchedPendingTransactionId) continue
    if (payout.status === "failed" || payout.status === "canceled") continue
    if (Math.round(payout.amount * 100) !== cents) continue
    const gap = dayGap(deposit.date, payout.arrivalDate)
    if (gap > STRIPE_PAYOUT_MATCH_DAYS) continue
    if (!best || gap < dayGap(deposit.date, best.arrivalDate)) best = payout
  }
  return best
}
