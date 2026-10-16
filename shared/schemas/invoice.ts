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
// -------------------------------------------------------------
export const InvoiceLineSchema = z.object({
  description: z.string(),
  amount: z.number().positive(),
  category: IncomeCategorySchema,
})

export const InvoiceStatusSchema = z.enum(["draft", "sent", "paid", "void"])

// The Entry payment methods plus "check". A check has no Entry payment
// method of its own (no grid column or income-stream bucket), so it's booked
// as named "Other" income under the client — which every income total
// already counts — and remembered here for display.
export const InvoicePaidMethodSchema = z.enum([...PaymentMethodSchema.options, "check"])

export function invoiceTotalFromLines(lines: Array<{ amount: number }>): number {
  return lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100
}

export const InvoiceSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    // Per-workspace sequence, zero-padded ("0012").
    number: z.string(),
    clientName: z.string().min(1),
    clientEmail: z.string().nullable().default(null),
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
    // The processor's cut when the payout arrived net of fees (booked as a
    // Payment Processing Fees expense); the Entry still carries the full total.
    paidFeeAmount: z.number().nonnegative().default(0),
    // How the client paid — shown on the invoice list ("Paid · Check").
    paidMethod: InvoicePaidMethodSchema.nullable().default(null),
    // First time the public link was shared.
    sharedAt: z.string().nullable().default(null),
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
  })

export type InvoiceType = z.infer<typeof InvoiceSchema>
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>
export type InvoicePaidMethod = z.infer<typeof InvoicePaidMethodSchema>

/* --------------------------------------------------------
 * REQUEST SCHEMAS — what the invoice routes accept
 * -------------------------------------------------------- */

const DateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD")

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
  clientEmail: z.string().trim().email().max(254).nullable().optional(),
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
