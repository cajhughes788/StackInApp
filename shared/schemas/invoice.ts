import { z } from "zod"
import { IncomeCategorySchema, PaymentMethodSchema } from "./entry"
import { invoiceLedgerFields } from "../invoicePayments"

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
// Payments are a ledger (docs/invoice-payments-architecture.md): `payments`
// lists every payment toward the invoice, each its own Entry. Every change
// to them goes through the payment engine
// (backend/functions/src/services/invoicePaymentEngine.ts), and payment
// state is read through shared/invoicePayments.ts.
// -------------------------------------------------------------
const InvoiceDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD")

// A line is quantity × rate; `amount` is that product to the cent and is
// what every total, payment and match uses. Lines saved before quantities
// existed read as 1 × their amount.
export const InvoiceLineSchema = z.preprocess(
  (line) =>
    line && typeof line === "object" && !Array.isArray(line)
      ? { quantity: 1, ...(line as Record<string, unknown>), rate: (line as Record<string, unknown>).rate ?? (line as Record<string, unknown>).amount }
      : line,
  z.object({
    description: z.string(),
    quantity: z.number().positive(),
    rate: z.number().positive(),
    amount: z.number().positive(),
    category: IncomeCategorySchema,
  })
)

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
  paymentId: z.string(),
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
  // The payment it's on (InvoicePaymentSchema.id).
  paymentId: z.string().nullable().default(null),
  updatedAt: z.string(),
})

// Exactly the Entry payment methods: every way an invoice can be paid is an
// income source of its own, check and Cash App included. (Before Checks was
// a source, a check was booked as named "Other" income under the client —
// see refundEntryPaymentMethod in backend refundsService.ts for those.)
export const InvoicePaidMethodSchema = PaymentMethodSchema

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

// One automatic reminder emailed to the client. The key names what was owed
// and the step ("balance:2026-10-31:overdue_7"), so a changed due date
// starts the steps over.
export const InvoiceReminderSendSchema = z.object({
  key: z.string(),
  sentAt: z.string(),
})

export const InvoiceSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    // Per-workspace sequence, zero-padded ("0012").
    number: z.string(),
    clientName: z.string().min(1),
    // The saved client (shared/schemas/client.ts). The name and contact
    // fields below stay as printed on this invoice.
    clientId: z.string().nullable().default(null),
    clientEmail: z.string().nullable().default(null),
    // For "Text it" (a pre-filled Messages draft). Stored as typed.
    clientPhone: z.string().nullable().default(null),
    // Billing address, as typed (multi-line).
    clientAddress: z.string().nullable().default(null),
    // Emails 521 sent for this invoice: the latest, and the recent send
    // times that cap resends (invoiceEmailService.ts).
    lastEmailedAt: z.string().nullable().default(null),
    lastEmailedTo: z.string().nullable().default(null),
    recentEmailSends: z.array(z.string()).default([]),
    // Automatic reminders (shared/invoiceReminders.ts): each step sent, keyed
    // so it fires once, and the user's "stop reminders" for this invoice.
    reminderSends: z.array(InvoiceReminderSendSchema).default([]),
    remindersPaused: z.boolean().default(false),
    lines: z.array(InvoiceLineSchema).min(1),
    // Derived from lines, stored so open invoices can be matched by amount
    // without reading every line.
    total: z.number().positive(),
    issueDate: z.string(),
    dueDate: z.string(),
    // "Note to customer" — usually how to pay (Venmo/Zelle details).
    // Pre-filled from InvoiceSettings.defaultNote.
    note: z.string().default(""),
    // Policies and terms the client agreed to (a deposit policy, late
    // fees), copied from InvoiceSettings.defaultPolicies when the invoice is
    // made, so a later change to the defaults never rewrites it.
    policies: z.string().default(""),
    // Unguessable id in the public link (invoiceShares/{shareToken}); set the
    // first time the invoice is shared.
    shareToken: z.string().nullable().default(null),
    // "overdue" is derived (sent and dueDate before today), never stored.
    status: InvoiceStatusSchema,
    refunds: z.array(InvoiceRefundSchema).default([]),
    dispute: InvoiceDisputeSchema.nullable().default(null),
    // The last bank transfer that bounced (insufficient funds, closed
    // account); cleared when the invoice is paid.
    paymentFailedAt: z.string().nullable().default(null),
    // First time the public link was shared.
    sharedAt: z.string().nullable().default(null),

    // --- Payment ledger -------------------------------------------------
    // Oldest first. A payment's processor fee, method and links live on it.
    payments: z.array(InvoicePaymentSchema).default([]),
    deposit: InvoiceDepositSchema.nullable().default(null),
    pendingPayment: InvoicePendingPaymentSchema.nullable().default(null),
    openCheckout: InvoiceOpenCheckoutSchema.nullable().default(null),
    closedAt: z.string().nullable().default(null),
    // Derived from payments (invoiceLedgerFields), stored so Firestore can
    // query them.
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
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    const derived = invoiceLedgerFields(invoice.payments)
    for (const field of Object.keys(derived) as Array<keyof typeof derived>) {
      if (JSON.stringify(derived[field]) !== JSON.stringify(invoice[field])) issue(field, `${field} must match the payments.`)
    }
    if (new Set(invoice.payments.map((payment) => payment.id)).size !== invoice.payments.length) {
      issue("payments", "Payment ids must be unique.")
    }
    const paidCents = Math.round(invoice.amountPaid * 100)
    const totalCents = Math.round(invoice.total * 100)
    if (paidCents > totalCents) issue("payments", "Payments can't add up to more than the total.")
    if (invoice.status === "paid" && paidCents !== totalCents) issue("status", "A paid invoice's payments must cover its total.")
    if ((invoice.status === "sent" || invoice.status === "draft") && paidCents >= totalCents) {
      issue("status", "An invoice whose payments cover its total is paid.")
    }
    if ((invoice.status === "draft" || invoice.status === "void") && invoice.payments.length > 0) {
      issue("payments", `A ${invoice.status} invoice can't have payments.`)
    }
    if (invoice.deposit && Math.round(invoice.deposit.amount * 100) >= Math.round(invoice.total * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deposit", "amount"], message: "A deposit must be less than the total." })
    }
    if (invoice.deposit && (invoice.deposit.dueDate < invoice.issueDate || invoice.deposit.dueDate > invoice.dueDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deposit", "dueDate"],
        message: "The deposit is due between the invoice date and its due date.",
      })
    }
  })

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
export type InvoiceReminderSend = z.infer<typeof InvoiceReminderSendSchema>

// What's been given back across all payments. What can still be given back
// is per payment: invoicePaymentRefundable in shared/invoicePayments.ts.
export function invoiceRefundedTotal(invoice: { refunds?: Array<{ amount: number }> }): number {
  return (invoice.refunds ?? []).reduce((sum, refund) => sum + Math.round(refund.amount * 100), 0) / 100
}

/* --------------------------------------------------------
 * REQUEST SCHEMAS — what the invoice routes accept
 * -------------------------------------------------------- */

const DateSchema = InvoiceDateSchema

const CentsAmountSchema = z
  .number()
  .positive()
  .max(10_000_000)
  .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents")

const WholeCents = (amount: number) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6

// A line as sent: quantity × rate (the amount is worked out here, to the
// cent), or just an amount (1 × it).
export const InvoiceLineInputSchema = z
  .object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().positive().max(100_000).refine(WholeCents, "Quantities go to two decimal places").default(1),
    rate: z.number().positive().max(10_000_000).refine(WholeCents, "Rates are in whole cents").optional(),
    amount: z.number().positive().max(10_000_000).refine(WholeCents, "Amounts are in whole cents").optional(),
    category: IncomeCategorySchema,
  })
  .refine((line) => line.rate !== undefined || line.amount !== undefined, { message: "A line needs a rate or an amount." })
  .transform((line) => {
    const quantity = line.rate !== undefined ? line.quantity : 1
    const rate = line.rate ?? line.amount!
    const amount = Math.round(quantity * rate * 100) / 100
    return { description: line.description, quantity, rate, amount, category: line.category }
  })
  .refine((line) => line.amount > 0 && line.amount <= 10_000_000, { message: "A line's amount has to be between $0.01 and $10,000,000." })

// Money asked for up front. Null removes it.
export const InvoiceDepositInputSchema = z.object({
  amount: CentsAmountSchema,
  dueDate: DateSchema,
})

const InvoiceFieldsSchema = z.object({
  clientName: z.string().trim().min(1).max(80),
  // Picked from saved clients; without it the server finds or creates the
  // client by name.
  clientId: z.string().trim().min(1).max(128).nullable().optional(),
  clientEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
  clientPhone: z.string().trim().max(40).nullable().optional(),
  clientAddress: z.string().trim().max(300).nullable().optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(50),
  issueDate: DateSchema,
  dueDate: DateSchema,
  note: z.string().trim().max(1000).optional(),
  policies: z.string().trim().max(2000).optional(),
  deposit: InvoiceDepositInputSchema.nullable().optional(),
})

function dueOnOrAfterIssue(value: { issueDate?: string; dueDate?: string }) {
  return !value.issueDate || !value.dueDate || value.dueDate >= value.issueDate
}

// What can be checked from the request alone; the server checks a patch
// again against the invoice it changes.
function depositFits(value: {
  lines?: Array<{ amount: number }>
  issueDate?: string
  dueDate?: string
  deposit?: { amount: number; dueDate: string } | null
}) {
  const deposit = value.deposit
  if (!deposit) return true
  if (value.lines && Math.round(deposit.amount * 100) >= Math.round(invoiceTotalFromLines(value.lines) * 100)) return false
  if (value.issueDate && deposit.dueDate < value.issueDate) return false
  if (value.dueDate && deposit.dueDate > value.dueDate) return false
  return true
}

const DEPOSIT_FITS_MESSAGE = "A deposit has to be less than the total and due between the invoice date and its due date."

export const InvoiceCreateInputSchema = InvoiceFieldsSchema.extend({
  // Create straight to "sent" (the user is sending it now) instead of a draft.
  send: z.boolean().optional(),
  // Same retry-safety scheme as createEntry: a deterministic doc id.
  clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
})
  .refine(dueOnOrAfterIssue, { path: ["dueDate"], message: "Due date can't be before the issue date." })
  .refine(depositFits, { path: ["deposit"], message: DEPOSIT_FITS_MESSAGE })

export const InvoicePatchSchema = InvoiceFieldsSchema.partial()
  .refine(dueOnOrAfterIssue, { path: ["dueDate"], message: "Due date can't be before the issue date." })
  .refine(depositFits, { path: ["deposit"], message: DEPOSIT_FITS_MESSAGE })

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
  // Money back on one payment: through Stripe for an online payment,
  // otherwise just recorded (the user sent it themselves). Without
  // paymentId, the latest payment with anything left to refund.
  z.object({
    action: z.literal("refund"),
    paymentId: z.string().min(1).max(200).optional(),
    amount: z
      .number()
      .positive()
      .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents"),
    reason: z.enum(["requested_by_client", "duplicate", "other"]),
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }),
  // Paid outside the bank feed (cash, check, Venmo): books the Entry now.
  // Any amount up to the balance due, plus an optional tip.
  z.object({
    action: z.literal("record_payment"),
    amount: CentsAmountSchema,
    tipAmount: z
      .number()
      .nonnegative()
      .max(10_000_000)
      .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents")
      .default(0),
    paidDate: DateSchema,
    paymentMethod: InvoicePaidMethodSchema,
    clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }),
  // Ends a partly paid invoice early, keeping what was paid (a forfeited
  // deposit). Nothing more is owed.
  z.object({ action: z.literal("close") }),
  // The deposit isn't needed after all: the whole amount is due by the
  // invoice's due date instead.
  z.object({ action: z.literal("waive_deposit") }),
  // Stops (or resumes) automatic reminders for this invoice.
  z.object({ action: z.literal("set_reminders"), paused: z.boolean() }),
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
  // Mailing address, as typed (multi-line). Shown with the contact details.
  businessAddress: z.string().trim().max(300),
  // Copied onto each new invoice (deposit policy, late fees, cancellations).
  defaultPolicies: z.string().trim().max(2000),
  logoDataUrl: z
    .string()
    .max(INVOICE_LOGO_MAX_LENGTH)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/, "Logo must be a PNG or JPEG")
    .nullable(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #2FA866"),
  defaultTerms: InvoiceTermsSchema,
  defaultNote: z.string().trim().max(1000),
  // Pre-fills a deposit on new invoices: a fixed amount or a percent of the
  // total, due a number of days after the invoice date.
  defaultDeposit: z
    .object({
      type: z.enum(["none", "fixed", "percent"]),
      value: z.number().nonnegative().max(10_000_000),
      dueInDays: z.number().int().min(0).max(365),
    })
    .refine((deposit) => deposit.type !== "percent" || deposit.value < 100, "A percent deposit has to be under 100%."),
  // The invoice page asks clients paying online for a tip on the payment
  // that finishes the invoice.
  offerTips: z.boolean(),
  // 521 emails clients a reminder before and after an invoice is due
  // (shared/invoiceReminders.ts). Off until the user turns it on.
  autoReminders: z.boolean(),
}

export const InvoiceSettingsSchema = z.object({
  businessName: InvoiceSettingsFields.businessName.default(""),
  businessEmail: InvoiceSettingsFields.businessEmail.default(""),
  businessPhone: InvoiceSettingsFields.businessPhone.default(""),
  businessAddress: InvoiceSettingsFields.businessAddress.default(""),
  defaultPolicies: InvoiceSettingsFields.defaultPolicies.default(""),
  logoDataUrl: InvoiceSettingsFields.logoDataUrl.default(null),
  accentColor: InvoiceSettingsFields.accentColor.default(DEFAULT_INVOICE_ACCENT_COLOR),
  defaultTerms: InvoiceSettingsFields.defaultTerms.default("net_30"),
  defaultNote: InvoiceSettingsFields.defaultNote.default(""),
  defaultDeposit: InvoiceSettingsFields.defaultDeposit.default({ type: "none", value: 0, dueInDays: 7 }),
  offerTips: InvoiceSettingsFields.offerTips.default(false),
  autoReminders: InvoiceSettingsFields.autoReminders.default(false),
  updatedAt: z.string().optional(),
})

// Every field optional and default-free, so omitted fields keep their saved
// value instead of being reset.
export const InvoiceSettingsPatchSchema = z.object({
  businessName: InvoiceSettingsFields.businessName.optional(),
  businessEmail: InvoiceSettingsFields.businessEmail.optional(),
  businessPhone: InvoiceSettingsFields.businessPhone.optional(),
  businessAddress: InvoiceSettingsFields.businessAddress.optional(),
  defaultPolicies: InvoiceSettingsFields.defaultPolicies.optional(),
  logoDataUrl: InvoiceSettingsFields.logoDataUrl.optional(),
  accentColor: InvoiceSettingsFields.accentColor.optional(),
  defaultTerms: InvoiceSettingsFields.defaultTerms.optional(),
  defaultNote: InvoiceSettingsFields.defaultNote.optional(),
  defaultDeposit: InvoiceSettingsFields.defaultDeposit.optional(),
  offerTips: InvoiceSettingsFields.offerTips.optional(),
  autoReminders: InvoiceSettingsFields.autoReminders.optional(),
})

export type InvoiceSettings = z.infer<typeof InvoiceSettingsSchema>
export type InvoiceSettingsPatch = z.infer<typeof InvoiceSettingsPatchSchema>
export type InvoiceTerms = z.infer<typeof InvoiceTermsSchema>
