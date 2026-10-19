import { z } from "zod"
import { IncomeCategorySchema, PaymentMethodSchema } from "./entry"
import { InvoicePaymentPurposeSchema } from "./invoice"

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

// Which signal produced suggestedExpenseAccount (see classifyPlaidTransaction
// in shared/plaidClassification.ts and upsertPendingTransactionFromPlaid in
// plaidService). Stored so confirms can be scored per signal.
export const PlaidSuggestionSourceSchema = z.enum([
  "merchant_memory",
  "refund_purchase",
  "plaid_detailed",
  "plaid_primary",
  "plaid_low_confidence",
  "keyword",
  "ai",
])

export type PlaidSuggestionSource = z.infer<typeof PlaidSuggestionSourceSchema>

// One invoice payment a deposit would make: `amount` is what it takes off
// the invoice (the deposit, the balance, or everything — `purpose`), and
// tipAmount a tip on top (with_tip). For the already-paid check, `amount` is
// what a hand-recorded payment brought in.
export const PlaidInvoiceRefSchema = z.object({
  invoiceId: z.string(),
  number: z.string(),
  clientName: z.string(),
  amount: z.number(),
  purpose: InvoicePaymentPurposeSchema.default("full"),
  tipAmount: z.number().nonnegative().default(0),
})

// "exact": one payment equals the deposit. "combined": 2–3 payments sum to
// it (two checks deposited together). "net_of_fees": a processor payout
// short of them by its fee. "with_tip": an invoice's final payment plus a
// tip.
export const PlaidInvoiceMatchSchema = z.object({
  kind: z.enum(["exact", "combined", "net_of_fees", "with_tip"]),
  invoices: z.array(PlaidInvoiceRefSchema).min(1).max(3),
  // Income the match books: the payments and any tips.
  invoiceTotal: z.number(),
  // invoiceTotal minus the deposit; 0 unless net_of_fees.
  feeAmount: z.number().nonnegative(),
  // Other invoice groups that fit just as well — non-empty means the review
  // card asks which one instead of suggesting `invoices`.
  // Each a { invoices } object, not a bare list: Firestore can't store an
  // array directly inside an array.
  alternatives: z.array(z.object({ invoices: z.array(PlaidInvoiceRefSchema).min(1).max(3) })).default([]),
  // The invoices were already marked paid by hand — this deposit is that
  // money arriving, so the card offers "already recorded" (a dismissal with
  // dismissReason "invoice_already_paid") instead of "mark paid".
  alreadyPaid: z.boolean().default(false),
})

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
  // Plaid's confidence_level for the category above (VERY_HIGH … LOW,
  // UNKNOWN). Null on older records and when Plaid didn't send one.
  personalFinanceCategoryConfidence: z.string().nullable().default(null),
  // See classifyPlaidTransferSignal in shared/plaidClassification.ts.
  // Stored so a later transaction on another account can be matched against
  // this one as the other half of a transfer.
  transferSignal: z.enum(["transfer", "possible_transfer", "unknown"]).nullable().default(null),
  suggestedExpenseAccount: z.string().nullable(),
  // Null when nothing was suggested, and on records from before this was tracked.
  suggestionSource: PlaidSuggestionSourceSchema.nullable().default(null),
  // Set when an expense or refund is confirmed: the category it was booked
  // in, and whether that matches suggestedExpenseAccount (null if there was
  // no suggestion to judge). Personal dismissals and income leave both unset.
  confirmedExpenseAccount: z.string().optional(),
  suggestionAccepted: z.boolean().nullable().optional(),
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
  // "invoice_already_paid": the money for an invoice the user had already
  // marked paid by hand (see pickPaidInvoices with manually-paid candidates).
  // "stripe_payout": a payout from the workspace's own Stripe account —
  // invoices it covers were booked when the client paid (shared/stripePayouts.ts).
  // "invoice_refund": an outgoing payment that is a refund the user sent a
  // client and recorded on the invoice — the refund Entry already nets it
  // out of income (matchInvoiceRefundPayment in shared/invoiceMatching.ts).
  dismissReason: z.enum(["transfer", "invoice_already_paid", "stripe_payout", "invoice_refund"]).optional(),
  stripePayoutId: z.string().optional(),
  // With dismissReason "invoice_refund": which invoice refund this is.
  invoiceRefund: z.object({ invoiceId: z.string(), refundId: z.string() }).optional(),
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
  // Income direction only: the open invoice(s) this deposit most likely
  // pays (see pickPaidInvoices in shared/invoiceMatching.ts). Null when
  // nothing fit, and on records from before invoicing.
  invoiceMatch: PlaidInvoiceMatchSchema.nullable().default(null),
  committedExpenseId: z.string().optional(),
  // Set instead of committedExpenseId when an income transaction is confirmed.
  committedEntryId: z.string().optional(),
  // Set instead of committedEntryId when the deposit paid invoices: one
  // Entry per invoice, plus the processing-fee Expense when it arrived net
  // of fees. Kept apart from committedExpenseId, which means the deposit
  // itself was booked as an expense (a refund).
  committedEntryIds: z.array(z.string()).optional(),
  feeExpenseId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const PlaidPendingTransactionSchema = z.preprocess(normalizeLegacyDirection, PlaidPendingTransactionObjectSchema)

export type PlaidPendingTransactionType = z.infer<typeof PlaidPendingTransactionObjectSchema>
export type PlaidTransactionDirection = z.infer<typeof PlaidTransactionDirectionSchema>
export type PlaidInvoiceRef = z.infer<typeof PlaidInvoiceRefSchema>
export type PlaidInvoiceMatch = z.infer<typeof PlaidInvoiceMatchSchema>
