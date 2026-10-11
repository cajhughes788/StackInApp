import { z } from "zod"
import { IncomeCategorySchema, PaymentMethodSchema } from "./entry"

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
//
// Money in and money out are reviewed separately: Plaid signs amounts from
// the account's point of view (positive = money left the account, negative
// = money came in), so a deposit becomes direction "income" and is reviewed
// on the Income tab, confirming into an Entry instead of an Expense.
// `amount` is always stored as a positive magnitude; `direction` carries
// the sign.
// -------------------------------------------------------------
export const PlaidTransactionDirectionSchema = z.enum(["expense", "income"])

export function plaidDirectionFromAmount(plaidAmount: number): z.infer<typeof PlaidTransactionDirectionSchema> {
  return plaidAmount < 0 ? "income" : "expense"
}

// Records written before the direction split stored Plaid's signed amount
// and no direction — derive both on read so an old, still-pending deposit
// moves to the income review instead of staying a negative "expense".
function normalizeLegacyDirection(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw
  const record = raw as Record<string, unknown>
  if (typeof record.amount !== "number") return raw
  return {
    ...record,
    direction: record.direction ?? plaidDirectionFromAmount(record.amount),
    amount: Math.abs(record.amount),
  }
}

const PlaidPendingTransactionObjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  plaidItemId: z.string(),
  plaidTransactionId: z.string(),
  accountId: z.string(),
  date: z.string(),
  amount: z.number().nonnegative(),
  direction: PlaidTransactionDirectionSchema,
  merchantName: z.string().nullable(),
  rawName: z.string(),
  // normalizePlaidMerchantKey() output — stored (not just derived on read) so
  // the recurring-subscription detector in plaidService.ts can query prior
  // confirmed transactions from this merchant without a collection scan.
  // For income-direction records written since income memory, this is the
  // payer key instead (normalizePlaidPayerKey).
  merchantKey: z.string().default(""),
  personalFinanceCategoryPrimary: z.string().nullable(),
  // Plaid's detailed PFC tier (e.g. LOAN_PAYMENTS_CREDIT_CARD_PAYMENT) —
  // only stored since transfer detection; null on older records.
  personalFinanceCategoryDetailed: z.string().nullable().default(null),
  // See classifyPlaidTransferSignal in shared/plaidClassification.ts.
  // Stored so a later transaction on another account can be matched against
  // this one as the other half of a transfer.
  transferSignal: z.enum(["transfer", "possible_transfer", "unknown"]).nullable().default(null),
  suggestedExpenseAccount: z.string().nullable(),
  // Income direction only: pre-fill for the income review, from this payer's
  // income memory when there is one (payment method otherwise falls back to
  // suggestPlaidIncomePaymentMethod). Null on spending and older records.
  suggestedIncomeCategory: IncomeCategorySchema.nullable().default(null),
  suggestedPaymentMethod: PaymentMethodSchema.nullable().default(null),
  // Pre-fill for "Who paid you?" when suggestedPaymentMethod is "other":
  // the payer's remembered name, else one derived from the descriptor
  // (suggestPayerName).
  suggestedIncomeLabel: z.string().nullable().default(null),
  isBusinessGuess: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  // Independent of suggestedExpenseAccount/confidence — see
  // shared/expenseKeywordMatching.ts's isLikelyFuelPurchase(). Lets the
  // confirm UI warn about double-counting fuel under the standard mileage
  // rate without touching the category-guess logic at all.
  isLikelyFuelPurchase: z.boolean().default(false),
  // "processing" is a short-lived claim written atomically by
  // confirmPendingTransaction before it does any further (non-transactional)
  // work — it's what keeps two overlapping confirm/dismiss calls on the same
  // transaction from both reading "pending" and both proceeding. It's never
  // returned to the client (getPendingTransactions only queries status ==
  // "pending") and always resolves back to "pending" (on failure) or a
  // terminal status within the same request.
  status: z.enum(["pending", "processing", "confirmed", "dismissed"]),
  // Why the app dismissed this on its own, when it did. Absent for a user's
  // own dismissal (and for merchant-memory "always personal" dismissals,
  // which predate this field).
  dismissReason: z.enum(["transfer"]).optional(),
  // The other half of a matched transfer (see isPlaidTransferPair), so one
  // transaction can't be paired twice.
  transferPairId: z.string().optional(),
  // Set when the user restores a hidden transfer ("not a transfer") —
  // transfer detection never dismisses or pairs this record again.
  transferOverride: z.boolean().optional(),
  // See isVenmoCashoutDescriptor — stored so a Venmo statement import can
  // find the bank-side cash-outs it overlaps (reconcileVenmoCashoutsWithImport).
  isVenmoCashout: z.boolean().default(false),
  // Money back from a merchant (see isLikelyPlaidRefund). Direction stays
  // "income" (money came in), but it's reviewed on the Expenses tab and
  // confirms into a negative expense.
  isRefund: z.boolean().default(false),
  // The confirmed purchase this refund most likely reverses, when one was
  // found (pickRefundedPurchase) — shown on the review card, and its
  // category pre-fills suggestedExpenseAccount.
  refundOf: z
    .object({
      pendingId: z.string(),
      expenseId: z.string(),
      date: z.string(),
      amount: z.number(),
    })
    .nullable()
    .default(null),
  committedExpenseId: z.string().optional(),
  // Set instead of committedExpenseId when an income transaction is confirmed.
  committedEntryId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const PlaidPendingTransactionSchema = z.preprocess(normalizeLegacyDirection, PlaidPendingTransactionObjectSchema)

export type PlaidPendingTransactionType = z.infer<typeof PlaidPendingTransactionObjectSchema>
export type PlaidTransactionDirection = z.infer<typeof PlaidTransactionDirectionSchema>
