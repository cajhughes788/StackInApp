import { z } from "zod"

// -------------------------------------------------------------
// PlaidPendingTransaction
// One per unconfirmed bank transaction. Firestore path:
// workspaces/{workspaceId}/plaidPendingTransactions/{plaidTransactionId}
// (doc id == Plaid's transaction_id, so webhook replays are idempotent
// via a merge write rather than a query).
//
// Mirrors the CSV/Venmo import convention (see shared/schemas/import.ts):
// the app suggests a category and a business/personal guess, but never
// auto-commits an Expense — the user confirms first.
// -------------------------------------------------------------
export const PlaidPendingTransactionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  plaidItemId: z.string(),
  plaidTransactionId: z.string(),
  accountId: z.string(),
  date: z.string(),
  amount: z.number(),
  merchantName: z.string().nullable(),
  rawName: z.string(),
  // normalizePlaidMerchantKey() output — stored (not just derived on read) so
  // the recurring-subscription detector in plaidService.ts can query prior
  // confirmed transactions from this merchant without a collection scan.
  merchantKey: z.string().default(""),
  personalFinanceCategoryPrimary: z.string().nullable(),
  suggestedExpenseAccount: z.string().nullable(),
  isBusinessGuess: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  // Independent of suggestedExpenseAccount/confidence — see
  // shared/expenseKeywordMatching.ts's isLikelyFuelPurchase(). Lets the
  // confirm UI warn about double-counting fuel under the standard mileage
  // rate without touching the category-guess logic at all.
  isLikelyFuelPurchase: z.boolean().default(false),
  status: z.enum(["pending", "confirmed", "dismissed"]),
  committedExpenseId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PlaidPendingTransactionType = z.infer<typeof PlaidPendingTransactionSchema>
