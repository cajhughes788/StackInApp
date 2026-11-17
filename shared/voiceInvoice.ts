import { z } from "zod"

// Voice invoice: what the app sends when someone says an invoice or quote
// out loud ("invoice Jenna 120 for a cut and color, due Friday"), and the
// fields that come back to fill the invoice/quote form. Same server and daily
// voice limit as voice entries (shared/voiceEntry.ts). Nothing here saves or
// sends anything — the person checks the form and taps its own buttons.

const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const VOICE_INVOICE_CATEGORIES = ["services", "products", "tips", "other"] as const
export const VOICE_INVOICE_TERMS = ["due_on_receipt", "net_15", "net_30"] as const

export const VoiceInvoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100_000),
  rate: z.number().positive().max(1_000_000),
  category: z.enum(VOICE_INVOICE_CATEGORIES),
})
export type VoiceInvoiceLine = z.infer<typeof VoiceInvoiceLineSchema>

// What's on the form when someone taps "Fix by voice". Only sent for a fix.
export const VoiceInvoiceCurrentSchema = z.object({
  clientName: z.string().max(80).nullable(),
  clientEmail: z.string().max(254).nullable(),
  clientPhone: z.string().max(40).nullable(),
  lines: z.array(VoiceInvoiceLineSchema).max(50),
  issueDate: DATE_KEY,
  dueDate: DATE_KEY,
  note: z.string().max(1000).nullable(),
})
export type VoiceInvoiceCurrent = z.infer<typeof VoiceInvoiceCurrentSchema>

export const VoiceInvoiceRequestSchema = z.object({
  kind: z.literal("invoice"),
  // Which form: an invoice, or a quote (its due date is "valid until").
  document: z.enum(["invoice", "quote"]),
  transcript: z.string().trim().min(1).max(1500),
  // The phone's own date, so "Friday" means the person's Friday.
  today: DATE_KEY,
  // Saved client names, so a spoken name is spelled the way it's saved.
  clients: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  current: VoiceInvoiceCurrentSchema.optional(),
  // What the voice button just asked for ("email", "service"): a bare answer fills those.
  asking: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
})
export type VoiceInvoiceRequest = z.infer<typeof VoiceInvoiceRequestSchema>

export const VoiceInvoiceResultSchema = z.object({
  // false when what was said isn't about an invoice or quote at all.
  isInvoice: z.boolean(),
  clientName: z.string().trim().min(1).max(80).nullable(),
  clientEmail: z.string().trim().max(254).nullable(),
  clientPhone: z.string().trim().max(40).nullable(),
  // The whole list of lines when they changed; null = leave the lines alone.
  lines: z.array(VoiceInvoiceLineSchema).max(50).nullable(),
  issueDate: DATE_KEY.nullable(),
  // A day said for when it's due (or, on a quote, until when it's good).
  dueDate: DATE_KEY.nullable(),
  // "net 15", "due on receipt": the app works out the day from the issue date.
  dueTerms: z.enum(VOICE_INVOICE_TERMS).nullable(),
  // A quote "good for 30 days": the app works out the day.
  validDays: z.number().int().positive().max(365).nullable(),
  note: z.string().trim().max(1000).nullable(),
})
export type VoiceInvoiceResult = z.infer<typeof VoiceInvoiceResultSchema>
