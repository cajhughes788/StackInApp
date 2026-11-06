import { z } from "zod"
import { InvoiceLineInputSchema, InvoiceLineSchema, invoiceTotalFromLines } from "./invoice"

// -------------------------------------------------------------
// Quote
// A price sent to a client before the job. Firestore path:
// workspaces/{workspaceId}/quotes/{quoteId}
// Independent workspace only.
//
// Kept apart from invoices on purpose: a quote is never money owed or
// income — it isn't matched to deposits, reminded about, counted as overdue
// or totaled. Only the invoice made from it ("Turn into invoice") is.
// -------------------------------------------------------------
const QuoteDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD")

// sent: the client has the link. accepted / declined: the client answered.
// withdrawn: the owner took it back. invoiced: an invoice was made from it.
// "expired" is derived (sent and validUntil before today), never stored.
export const QuoteStatusSchema = z.enum(["draft", "sent", "accepted", "declined", "withdrawn", "invoiced"])

export const QuoteSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    // Per-workspace sequence of its own, zero-padded ("0003"), shown "Q-0003".
    number: z.string(),
    clientName: z.string().min(1),
    clientId: z.string().nullable().default(null),
    clientEmail: z.string().nullable().default(null),
    clientPhone: z.string().nullable().default(null),
    clientAddress: z.string().nullable().default(null),
    lines: z.array(InvoiceLineSchema).min(1),
    total: z.number().positive(),
    issueDate: QuoteDateSchema,
    // The last day the client can accept it.
    validUntil: QuoteDateSchema,
    note: z.string().default(""),
    policies: z.string().default(""),
    // Asked for up front once it's an invoice (the invoice sets its due date).
    deposit: z.object({ amount: z.number().positive() }).nullable().default(null),
    // Unguessable id in the public link (quoteShares/{shareToken}).
    shareToken: z.string().nullable().default(null),
    sharedAt: z.string().nullable().default(null),
    status: QuoteStatusSchema,
    // The client's answer: the name they typed to accept, or their reason.
    acceptedAt: z.string().nullable().default(null),
    acceptedName: z.string().nullable().default(null),
    declinedAt: z.string().nullable().default(null),
    declineNote: z.string().nullable().default(null),
    // The invoice made from it.
    invoiceId: z.string().nullable().default(null),
    lastEmailedAt: z.string().nullable().default(null),
    lastEmailedTo: z.string().nullable().default(null),
    recentEmailSends: z.array(z.string()).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((quote, ctx) => {
    if (Math.round(quote.total * 100) !== Math.round(invoiceTotalFromLines(quote.lines) * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "Quote total must equal the sum of its lines." })
    }
    if (quote.deposit && Math.round(quote.deposit.amount * 100) >= Math.round(quote.total * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deposit", "amount"], message: "A deposit must be less than the total." })
    }
  })

export type QuoteStatus = z.infer<typeof QuoteStatusSchema>
export type QuoteType = z.infer<typeof QuoteSchema>

/* --------------------------------------------------------
 * REQUEST SCHEMAS — what the quote routes accept
 * -------------------------------------------------------- */

const CentsAmountSchema = z
  .number()
  .positive()
  .max(10_000_000)
  .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, "Amounts are in whole cents")

const QuoteFieldsSchema = z.object({
  clientName: z.string().trim().min(1).max(80),
  clientId: z.string().trim().min(1).max(128).nullable().optional(),
  clientEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
  clientPhone: z.string().trim().max(40).nullable().optional(),
  clientAddress: z.string().trim().max(300).nullable().optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(50),
  issueDate: QuoteDateSchema,
  validUntil: QuoteDateSchema,
  note: z.string().trim().max(1000).optional(),
  policies: z.string().trim().max(2000).optional(),
  deposit: z.object({ amount: CentsAmountSchema }).nullable().optional(),
})

const validAfterIssue = (value: { issueDate?: string; validUntil?: string }) =>
  !value.issueDate || !value.validUntil || value.validUntil >= value.issueDate

const depositUnderTotal = (value: { lines?: Array<{ amount: number }>; deposit?: { amount: number } | null }) =>
  !value.deposit || !value.lines || Math.round(value.deposit.amount * 100) < Math.round(invoiceTotalFromLines(value.lines) * 100)

export const QuoteCreateInputSchema = QuoteFieldsSchema.extend({
  // Create straight to "sent" (the user is sending it now) instead of a draft.
  send: z.boolean().optional(),
  // Same retry-safety scheme as createInvoice: a deterministic doc id.
  clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
})
  .refine(validAfterIssue, { path: ["validUntil"], message: "Valid until can't be before the quote date." })
  .refine(depositUnderTotal, { path: ["deposit"], message: "A deposit has to be less than the total." })

export const QuotePatchSchema = QuoteFieldsSchema.partial()
  .refine(validAfterIssue, { path: ["validUntil"], message: "Valid until can't be before the quote date." })
  .refine(depositUnderTotal, { path: ["deposit"], message: "A deposit has to be less than the total." })

export const QuoteActionSchema = z.discriminatedUnion("action", [
  // Returns the public link (creating it the first time); sharing a draft sends it.
  z.object({ action: z.literal("share") }),
  // 521 emails the client the quote link (and shares it first).
  z.object({
    action: z.literal("email"),
    to: z.string().trim().email().max(254),
    message: z.string().trim().max(1000).optional(),
  }),
  // The owner takes back a quote the client has (sent or accepted).
  z.object({ action: z.literal("withdraw") }),
])

// What the client posts from the quote page.
export const QuoteResponseSchema = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("accept"), name: z.string().trim().min(1, "Type your name to accept.").max(80) }),
  z.object({ answer: z.literal("decline"), note: z.string().trim().max(500).optional().default("") }),
])

export type QuoteCreateInput = z.input<typeof QuoteCreateInputSchema>
export type QuotePatch = z.input<typeof QuotePatchSchema>
export type QuoteAction = z.infer<typeof QuoteActionSchema>
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>
