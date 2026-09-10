import { z } from "zod"

// -------------------------------------------------------------
// PlaidMerchantMemory
// Learns from confirm/dismiss decisions on Plaid pending transactions so
// the same merchant gets classified correctly next time, without needing
// the user to re-decide. Firestore path:
// workspaces/{workspaceId}/plaidMerchantMemory/{merchantKey}
// (doc id = normalizePlaidMerchantKey() output — see shared/plaidClassification.ts)
// -------------------------------------------------------------
export const PlaidMerchantMemorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  merchantKey: z.string(),
  displayName: z.string(),
  // Last confirm/dismiss decision — used to pre-fill the suggestion on the
  // next transaction from this merchant. Never suppresses anything by
  // itself.
  isBusiness: z.boolean(),
  expenseCategory: z.string().nullable(),
  // "always_personal" is an explicit opt-in (see
  // frontend/components/plaid-pending-transactions-panel.tsx), not inferred
  // from a single dismiss. Future transactions from this merchant still get
  // recorded as a dismissed pending entry — nothing is silently dropped —
  // they just skip the push notification, so a rare business purchase at an
  // otherwise-personal merchant (e.g. Airbnb supplies from Walmart) is still
  // sitting there to find, it just doesn't interrupt you.
  // "covered_by_recurring_rule" is set once the user turns a detected
  // recurring merchant into a shared/schemas/recurringRule.ts rule — the
  // rule's own cron generates the expense on schedule, so future Plaid
  // transactions from this merchant auto-dismiss the same way
  // "always_personal" does, preventing the same real-world charge from being
  // booked twice (once by the rule, once by confirming the bank transaction).
  mode: z.enum(["ask_every_time", "always_personal", "covered_by_recurring_rule"]),
  decisionCount: z.number(),
  lastDecisionAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PlaidMerchantMemoryType = z.infer<typeof PlaidMerchantMemorySchema>
