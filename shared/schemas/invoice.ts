import { z } from "zod"
import { IncomeCategorySchema, PaymentMethodSchema } from "./entry"

// -------------------------------------------------------------
// Invoice
// A bill sent to a client. Firestore path:
// workspaces/{workspaceId}/invoices/{invoiceId}
// Independent workspace only.
//
// An invoice is never income by itself — only the Entry created when it's
// paid is (dated the day the money arrived), so a paid invoice and the bank
// deposit that paid it count once. Matching deposits to invoices lives in
// shared/invoiceMatching.ts.
//
// Payments are moving to a ledger (docs/invoice-payments-architecture.md):
// `payments` lists every payment, each with its own Entry. During phase 1 the
// older single-payment fields (paidAt, paidVia, paidEntryId, …) are still
// what every write path sets, and the ledger fields are recomputed from them
// each time an invoice is parsed (deriveLedgerFromLegacy), so a stored
// ledger is never trusted over them. Read payment state through
// shared/invoicePayments.ts, never the paid* fields.
// -------------------------------------------------------------
const InvoiceDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD")

export const InvoiceLineSchema = z.object({
  description: z.string(),
  amount: z.number().positive(),
  category: IncomeCategorySchema,
})

// sent: open, including partly paid. paid: payments cover the total.
// void: ended with nothing paid. closed: ended early with what was paid kept
// (a forfeited deposit).
export const InvoiceStatusSchema = z.enum(["draft", "sent", "paid", "void", "closed"])

// Money returned on a paid invoice. Each one is also a refund Entry (kind
// "refund", negative amounts) dated when it went back; this list is what the
// invoice shows and what caps further refunds.
export const InvoiceRefundSchema = z.object({
  // Stable key: the Stripe refund id, or the client mutation id for one
  // recorded by hand.
  id: z.string(),
  entryId: z.string().nullable().default(null),
  amount: z.number().positive(),
  date: z.string(),
  reason: z.enum(["requested_by_client", "duplicate", "other"]),
  stripeRefundId: z.string().nullable().default(null),
  // A refund the user sent themselves (stripeRefundId null): the outgoing
  // bank payment that is that money leaving, hidden from expense review as
  // "invoice_refund" so it isn't booked a second time (matchInvoiceRefundPayment).
  plaidTransactionId: z.string().nullable().default(null),
  // The payment this refund returns (InvoicePaymentSchema.id).
  paymentId: z.string().nullable().default(null),
})

// A chargeback on an online payment (Stripe dispute).
export const InvoiceDisputeSchema = z.object({
  stripeDisputeId: z.string(),
  // inquiry: the bank is asking, no money moved yet. open: Stripe took the
  // money while it's decided. won / lost: decided.
  status: z.enum(["inquiry", "open", "won", "lost"]),
  amount: z.number(),
  reason: z.string().nullable().default(null),
  evidenceDueBy: z.string().nullable().default(null),
  fundsWithdrawn: z.boolean().default(false),
  feeAmount: z.number().default(0),
  updatedAt: z.string(),
})

// The Entry payment methods plus "check". A check has no Entry payment
// method of its own (no grid column or income-stream bucket), so it's booked
// as named "Other" income under the client — which every income total
// already counts — and remembered here for display.
export const InvoicePaidMethodSchema = z.enum([...PaymentMethodSchema.options, "check"])

export function invoiceTotalFromLines(lines: Array<{ amount: number }>): number {
  return lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100
}

export const InvoicePaymentPurposeSchema = z.enum(["deposit", "balance", "full", "partial"])

// One payment toward an invoice, booked as its own Entry dated the day the
// money arrived. `amount` is what it took off the invoice; a tip on top is
// tipAmount, booked as tip income on the same Entry.
export const InvoicePaymentSchema = z.object({
  // Stable key, also what the Entry's clientMutationId is built from:
  // "stripe_<paymentIntentId>", "plaid_<plaidTransactionId>",
  // "manual_<clientMutationId>", or "legacy" for a payment converted from
  // the single-payment fields.
  id: z.string(),
  purpose: InvoicePaymentPurposeSchema,
  amount: z.number().positive(),
  tipAmount: z.number().nonnegative().default(0),
  receivedOn: InvoiceDateSchema,
  via: z.enum(["bank_match", "manual", "online"]),
  method: InvoicePaidMethodSchema,
  // Null only between claiming the invoice and booking the Entry.
  entryId: z.string().nullable().default(null),
  plaidTransactionId: z.string().nullable().default(null),
  stripePaymentIntentId: z.string().nullable().default(null),
  checkoutSessionId: z.string().nullable().default(null),
  // The processor's cut, booked as a Payment Processing Fees expense.
  feeAmount: z.number().nonnegative().default(0),
  createdAt: z.string(),
})

// Money asked for up front, with its own due date. Paying it unlocks the
// balance; a date passing doesn't (docs/invoice-payments-architecture.md).
export const InvoiceDepositSchema = z.object({
  amount: z.number().positive(),
  dueDate: InvoiceDateSchema,
  // Waived: the full amount is due by the invoice's due date instead.
  waivedAt: z.string().nullable().default(null),
})

// A payment started through Stripe Checkout that's still clearing (a bank
// transfer takes a few business days). The invoice isn't payable again
// until it settles or fails.
export const InvoicePendingPaymentSchema = z.object({
  checkoutSessionId: z.string().nullable(),
  purpose: InvoicePaymentPurposeSchema,
  amount: z.number().positive(),
  tipAmount: z.number().nonnegative().default(0),
  startedAt: z.string(),
})

// The one Checkout session the client may have open, reused while it still
// matches what they chose.
export const InvoiceOpenCheckoutSchema = z.object({
  sessionId: z.string(),
  purpose: InvoicePaymentPurposeSchema,
  amountCents: z.number().int().positive(),
  tipCents: z.number().int().nonnegative().default(0),
})

const InvoiceObjectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    // Per-workspace sequence, zero-padded ("0012").
    number: z.string(),
    clientName: z.string().min(1),
    clientEmail: z.string().nullable().default(null),
    // For "Text it" (a pre-filled Messages draft). Stored as typed.
    clientPhone: z.string().nullable().default(null),
    // Emails 521 sent for this invoice: the latest, and the recent send
    // times that cap resends (invoiceEmailService.ts).
    lastEmailedAt: z.string().nullable().default(null),
    lastEmailedTo: z.string().nullable().default(null),
    recentEmailSends: z.array(z.string()).default([]),
    lines: z.array(InvoiceLineSchema).min(1),
    // Derived from lines, stored so open invoices can be matched by amount
    // without reading every line.
    total: z.number().positive(),
    issueDate: z.string(),
    dueDate: z.string(),
    // "Note to customer" — usually how to pay (Venmo/Zelle details).
    // Pre-filled from InvoiceSettings.defaultNote.
    note: z.string().default(""),
    // Unguessable id in the public link (invoiceShares/{shareToken}); set the
    // first time the invoice is shared.
    shareToken: z.string().nullable().default(null),
    // "overdue" is derived (sent and dueDate before today), never stored.
    status: InvoiceStatusSchema,
    paidAt: z.string().nullable().default(null),
    // bank_match: a Plaid deposit confirmed as this payment. manual: marked
    // paid by hand. online: paid through Stripe Checkout from the share link.
    paidVia: z.enum(["bank_match", "manual", "online"]).nullable().default(null),
    paidEntryId: z.string().nullable().default(null),
    paidPlaidTransactionId: z.string().nullable().default(null),
    // Online payments (Stripe Connect): the client's open Checkout session,
    // reused while it's still open, and the PaymentIntent that paid it.
    checkoutSessionId: z.string().nullable().default(null),
    paidStripePaymentIntentId: z.string().nullable().default(null),
    // A bank transfer (ACH) the client started in Checkout, still clearing —
    // the invoice stays "sent" and isn't payable again until it settles.
    pendingPaymentAt: z.string().nullable().default(null),
    refunds: z.array(InvoiceRefundSchema).default([]),
    dispute: InvoiceDisputeSchema.nullable().default(null),
    // The last bank transfer that bounced (insufficient funds, closed
    // account); cleared when the invoice is paid.
    paymentFailedAt: z.string().nullable().default(null),
    // The processor's cut when the payout arrived net of fees (booked as a
    // Payment Processing Fees expense); the Entry still carries the full total.
    paidFeeAmount: z.number().nonnegative().default(0),
    // How the client paid — shown on the invoice list ("Paid · Check").
    paidMethod: InvoicePaidMethodSchema.nullable().default(null),
    // First time the public link was shared.
    sharedAt: z.string().nullable().default(null),

    // --- Payment ledger -------------------------------------------------
    payments: z.array(InvoicePaymentSchema).default([]),
    deposit: InvoiceDepositSchema.nullable().default(null),
    pendingPayment: InvoicePendingPaymentSchema.nullable().default(null),
    openCheckout: InvoiceOpenCheckoutSchema.nullable().default(null),
    closedAt: z.string().nullable().default(null),
    // Derived from payments, stored so Firestore can query them.
    amountPaid: z.number().nonnegative().default(0),
    paymentEntryIds: z.array(z.string()).default([]),
    paymentPlaidTransactionIds: z.array(z.string()).default([]),
    paymentIntentIds: z.array(z.string()).default([]),
    lastManualPaymentOn: z.string().nullable().default(null),

    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((invoice, ctx) => {
    if (Math.round(invoice.total * 100) !== Math.round(invoiceTotalFromLines(invoice.lines) * 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total"],
        message: "Invoice total must equal the sum of its lines.",
      })
    }
    const paidCents = invoice.payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
    if (paidCents !== Math.round(invoice.amountPaid * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountPaid"], message: "amountPaid must equal the sum of payments." })
    }
    if (paidCents > Math.round(invoice.total * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payments"], message: "Payments can't add up to more than the total." })
    }
    if (invoice.deposit && Math.round(invoice.deposit.amount * 100) >= Math.round(invoice.total * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deposit", "amount"], message: "A deposit must be less than the total." })
    }
  })

type LegacyRecord = Record<string, unknown>

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

// Phase 1: the single-payment fields are the source of truth, and the
// ledger is their projection — recomputed on every parse, so a stale stored
// ledger (left by a merge write that only touched the old fields) never
// shows. A paid invoice becomes one "legacy" payment for the full total.
// receivedOn comes from paidAt, unless a stored legacy payment for the same
// Entry already has one (the backfill corrects it from the Entry's own date).
export function deriveLedgerFromLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const doc = raw as LegacyRecord
  const total = numberOr(doc.total, 0)
  const status = doc.status
  const paidVia = doc.paidVia === "bank_match" || doc.paidVia === "manual" || doc.paidVia === "online" ? doc.paidVia : null
  const paidAt = stringOrNull(doc.paidAt)
  const entryId = stringOrNull(doc.paidEntryId)
  const checkoutSessionId = stringOrNull(doc.checkoutSessionId)
  const pendingPaymentAt = stringOrNull(doc.pendingPaymentAt)
  const updatedAt = stringOrNull(doc.updatedAt) ?? new Date(0).toISOString()

  const payments: LegacyRecord[] = []
  if (status === "paid" && total > 0) {
    const via = paidVia ?? "manual"
    const stored = Array.isArray(doc.payments)
      ? (doc.payments as LegacyRecord[]).find((p) => p && p.id === "legacy" && p.entryId === entryId)
      : undefined
    const receivedOn =
      stringOrNull(stored?.receivedOn) ?? (paidAt ?? updatedAt).slice(0, 10)
    payments.push({
      id: "legacy",
      purpose: "full",
      amount: total,
      tipAmount: 0,
      receivedOn,
      via,
      method: stringOrNull(doc.paidMethod) ?? (via === "online" ? "pos" : "other"),
      entryId,
      plaidTransactionId: stringOrNull(doc.paidPlaidTransactionId),
      stripePaymentIntentId: stringOrNull(doc.paidStripePaymentIntentId),
      checkoutSessionId: via === "online" ? checkoutSessionId : null,
      feeAmount: Math.max(0, numberOr(doc.paidFeeAmount, 0)),
      createdAt: paidAt ?? updatedAt,
    })
  }
  const paymentIds = new Set(payments.map((p) => p.id as string))
  const refunds = Array.isArray(doc.refunds)
    ? (doc.refunds as LegacyRecord[]).map((refund) =>
        refund && typeof refund === "object"
          ? {
              ...refund,
              paymentId:
                typeof refund.paymentId === "string" && paymentIds.has(refund.paymentId)
                  ? refund.paymentId
                  : (payments[0]?.id ?? null),
            }
          : refund
      )
    : doc.refunds

  return {
    ...doc,
    payments,
    refunds,
    amountPaid: payments.reduce((sum, p) => sum + Math.round((p.amount as number) * 100), 0) / 100,
    pendingPayment:
      status === "sent" && pendingPaymentAt && total > 0
        ? { checkoutSessionId, purpose: "full", amount: total, tipAmount: 0, startedAt: pendingPaymentAt }
        : null,
    openCheckout:
      status === "sent" && !pendingPaymentAt && checkoutSessionId && total > 0
        ? { sessionId: checkoutSessionId, purpose: "full", amountCents: Math.round(total * 100), tipCents: 0 }
        : null,
    paymentEntryIds: payments.flatMap((p) => (p.entryId ? [p.entryId as string] : [])),
    paymentPlaidTransactionIds: payments.flatMap((p) => (p.plaidTransactionId ? [p.plaidTransactionId as string] : [])),
    paymentIntentIds: payments.flatMap((p) => (p.stripePaymentIntentId ? [p.stripePaymentIntentId as string] : [])),
    lastManualPaymentOn:
      payments.filter((p) => p.via === "manual").map((p) => p.receivedOn as string).sort().pop() ?? null,
  }
}

export const InvoiceSchema = z.preprocess(deriveLedgerFromLegacy, InvoiceObjectSchema)

export type InvoiceType = z.infer<typeof InvoiceSchema>
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>
export type InvoicePaidMethod = z.infer<typeof InvoicePaidMethodSchema>
export type InvoiceRefund = z.infer<typeof InvoiceRefundSchema>
export type InvoiceDispute = z.infer<typeof InvoiceDisputeSchema>
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>
export type InvoicePaymentPurpose = z.infer<typeof InvoicePaymentPurposeSchema>
export type InvoiceDeposit = z.infer<typeof InvoiceDepositSchema>
export type InvoicePendingPayment = z.infer<typeof InvoicePendingPaymentSchema>

// What's been given back, and what can still be: refunds plus any money a
// dispute is holding.
export function invoiceRefundedTotal(invoice: { refunds?: Array<{ amount: number }> }): number {
  return (invoice.refunds ?? []).reduce((sum, refund) => sum + Math.round(refund.amount * 100), 0) / 100
}

export function invoiceRefundableAmount(invoice: {
  status: string
  total: number
  refunds?: Array<{ amount: number }>
  dispute?: { fundsWithdrawn: boolean; status: string; amount: number } | null
}): number {
  if (invoice.status !== "paid") return 0
  const held = invoice.dispute && invoice.dispute.fundsWithdrawn && invoice.dispute.status !== "won" ? invoice.dispute.amount : 0
  const cents = Math.round(invoice.total * 100) - Math.round(invoiceRefundedTotal(invoice) * 100) - Math.round(held * 100)
  return Math.max(0, cents) / 100
}

/* --------------------------------------------------------
 * REQUEST SCHEMAS — what the invoice routes accept
 * -------------------------------------------------------- */

const DateSchema = InvoiceDateSchema

export const InvoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z
    .number()
    .positive()
    .max(10_000_000)
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents"),
  category: IncomeCategorySchema,
})

const InvoiceFieldsSchema = z.object({
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
  clientPhone: z.string().trim().max(40).nullable().optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(50),
  issueDate: DateSchema,
  dueDate: DateSchema,
  note: z.string().trim().max(1000).optional(),
})

function dueOnOrAfterIssue(value: { issueDate?: string; dueDate?: string }) {
  return !value.issueDate || !value.dueDate || value.dueDate >= value.issueDate
}

export const InvoiceCreateInputSchema = InvoiceFieldsSchema.extend({
  // Create straight to "sent" (the user is sending it now) instead of a draft.
  send: z.boolean().optional(),
  // Same retry-safety scheme as createEntry: a deterministic doc id.
  clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).refine(dueOnOrAfterIssue, { path: ["dueDate"], message: "Due date can't be before the issue date." })

export const InvoicePatchSchema = InvoiceFieldsSchema.partial().refine(dueOnOrAfterIssue, {
  path: ["dueDate"],
  message: "Due date can't be before the issue date.",
})

export const InvoiceStatusActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("void") }),
  // Returns the public link (creating it the first time). Sharing a draft
  // sends it — the client is about to see it.
  z.object({ action: z.literal("share") }),
  // 521 emails the client the invoice link (and shares it first).
  z.object({
    action: z.literal("email"),
    to: z.string().trim().email().max(254),
    message: z.string().trim().max(1000).optional(),
  }),
  // Money back on a paid invoice: through Stripe for an online payment,
  // otherwise just recorded (the user sent it themselves).
  z.object({
    action: z.literal("refund"),
    amount: z
      .number()
      .positive()
      .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents"),
    reason: z.enum(["requested_by_client", "duplicate", "other"]),
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }),
  // Paid outside the bank feed (cash, check, Venmo): books the Entry now.
  z.object({
    action: z.literal("mark_paid"),
    paidDate: DateSchema,
    paymentMethod: InvoicePaidMethodSchema,
  }),
])

export type InvoiceCreateInput = z.infer<typeof InvoiceCreateInputSchema>
export type InvoicePatch = z.infer<typeof InvoicePatchSchema>
export type InvoiceStatusAction = z.infer<typeof InvoiceStatusActionSchema>

/* --------------------------------------------------------
 * INVOICE SETTINGS
 * One per workspace: workspaces/{workspaceId}/settings/invoicing
 * Shown on every invoice (PDF and public page), rendered live — changing
 * the business name updates invoices already shared.
 * -------------------------------------------------------- */

export const InvoiceTermsSchema = z.enum(["due_on_receipt", "net_15", "net_30"])

export const DEFAULT_INVOICE_ACCENT_COLOR = "#2FA866"

// PNG/JPEG only, resized on the device before upload. Kept inline in the
// settings doc (well under Firestore's 1 MB limit) so the public page and
// PDF need no Storage access.
export const INVOICE_LOGO_MAX_LENGTH = 300_000

const InvoiceSettingsFields = {
  businessName: z.string().trim().max(80),
  businessEmail: z.union([z.string().trim().email().max(254), z.literal("")]),
  businessPhone: z.string().trim().max(40),
  logoDataUrl: z
    .string()
    .max(INVOICE_LOGO_MAX_LENGTH)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/, "Logo must be a PNG or JPEG")
    .nullable(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #2FA866"),
  defaultTerms: InvoiceTermsSchema,
  defaultNote: z.string().trim().max(1000),
}

export const InvoiceSettingsSchema = z.object({
  businessName: InvoiceSettingsFields.businessName.default(""),
  businessEmail: InvoiceSettingsFields.businessEmail.default(""),
  businessPhone: InvoiceSettingsFields.businessPhone.default(""),
  logoDataUrl: InvoiceSettingsFields.logoDataUrl.default(null),
  accentColor: InvoiceSettingsFields.accentColor.default(DEFAULT_INVOICE_ACCENT_COLOR),
  defaultTerms: InvoiceSettingsFields.defaultTerms.default("net_30"),
  defaultNote: InvoiceSettingsFields.defaultNote.default(""),
  updatedAt: z.string().optional(),
})

// Every field optional and default-free, so omitted fields keep their saved
// value instead of being reset.
export const InvoiceSettingsPatchSchema = z.object({
  businessName: InvoiceSettingsFields.businessName.optional(),
  businessEmail: InvoiceSettingsFields.businessEmail.optional(),
  businessPhone: InvoiceSettingsFields.businessPhone.optional(),
  logoDataUrl: InvoiceSettingsFields.logoDataUrl.optional(),
  accentColor: InvoiceSettingsFields.accentColor.optional(),
  defaultTerms: InvoiceSettingsFields.defaultTerms.optional(),
  defaultNote: InvoiceSettingsFields.defaultNote.optional(),
})

export type InvoiceSettings = z.infer<typeof InvoiceSettingsSchema>
export type InvoiceSettingsPatch = z.infer<typeof InvoiceSettingsPatchSchema>
export type InvoiceTerms = z.infer<typeof InvoiceTermsSchema>
