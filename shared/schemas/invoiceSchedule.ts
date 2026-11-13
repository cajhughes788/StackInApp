import { z } from "zod"
import { InvoiceLineInputSchema, InvoiceLineSchema, invoiceTotalFromLines } from "./invoice"

// -------------------------------------------------------------
// Invoice schedule ("Repeat this invoice")
// Makes the same invoice again on a schedule. Firestore path:
// workspaces/{workspaceId}/invoiceSchedules/{scheduleId}
// Independent workspace only.
//
// The invoice it was started from is the first one; each repeat is an
// ordinary invoice (InvoiceSchema.scheduleId points back here), made by the
// hourly job (makeScheduledInvoicesHourly) on its date in the business's
// time zone. Date rules live in shared/invoiceSchedules.ts.
// -------------------------------------------------------------
const ScheduleDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD")

export const InvoiceScheduleFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"])

export const InvoiceScheduleEndSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("never") }),
  // This many invoices in all, the first one included.
  z.object({ type: z.literal("count"), count: z.number().int().min(2).max(500) }),
  // No invoice dated after this day.
  z.object({ type: z.literal("date"), date: ScheduleDateSchema }),
])

// email: 521 emails each one to the client as it's made. draft: it waits
// as a draft for the owner to check and send.
export const InvoiceScheduleSendModeSchema = z.enum(["email", "draft"])

// active: making invoices. paused: skipping its dates until resumed.
// ended: stopped by the owner, or its end was reached.
export const InvoiceScheduleStatusSchema = z.enum(["active", "paused", "ended"])

export const InvoiceScheduleSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    clientName: z.string().min(1),
    clientId: z.string().nullable().default(null),
    clientEmail: z.string().nullable().default(null),
    clientPhone: z.string().nullable().default(null),
    clientAddress: z.string().nullable().default(null),
    lines: z.array(InvoiceLineSchema).min(1),
    total: z.number().positive(),
    note: z.string().default(""),
    policies: z.string().default(""),
    // Each invoice is due this many days after its date (0 = on receipt).
    dueInDays: z.number().int().min(0).max(365),
    frequency: InvoiceScheduleFrequencySchema,
    // The first invoice's date; monthly and longer repeats keep its day of the month.
    anchorDate: ScheduleDateSchema,
    // The date of the next invoice to make.
    nextDate: ScheduleDateSchema,
    end: InvoiceScheduleEndSchema,
    sendMode: InvoiceScheduleSendModeSchema,
    status: InvoiceScheduleStatusSchema,
    // Invoices made so far, the first one included.
    invoicesMade: z.number().int().min(0),
    lastInvoiceId: z.string().nullable().default(null),
    lastMadeOn: z.string().nullable().default(null),
    // The invoice it was started from.
    sourceInvoiceId: z.string().nullable().default(null),
    endedAt: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((schedule, ctx) => {
    if (Math.round(schedule.total * 100) !== Math.round(invoiceTotalFromLines(schedule.lines) * 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "Total must equal the sum of its lines." })
    }
  })

export type InvoiceScheduleFrequency = z.infer<typeof InvoiceScheduleFrequencySchema>
export type InvoiceScheduleEnd = z.infer<typeof InvoiceScheduleEndSchema>
export type InvoiceScheduleSendMode = z.infer<typeof InvoiceScheduleSendModeSchema>
export type InvoiceScheduleType = z.infer<typeof InvoiceScheduleSchema>

/* --------------------------------------------------------
 * REQUEST SCHEMAS
 * -------------------------------------------------------- */

const ScheduleOptionsSchema = z.object({
  frequency: InvoiceScheduleFrequencySchema,
  end: InvoiceScheduleEndSchema,
  sendMode: InvoiceScheduleSendModeSchema,
})

// Started from an invoice (just made, or one already sent): what's billed
// and its terms are copied from it.
export const InvoiceScheduleCreateInputSchema = ScheduleOptionsSchema.extend({
  invoiceId: z.string().trim().min(1).max(128),
  // Same retry-safety scheme as createInvoice.
  clientMutationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
})

// Future invoices only; ones already made don't change.
export const InvoiceSchedulePatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("stop") }),
  z.object({
    action: z.literal("edit"),
    clientName: z.string().trim().min(1).max(80).optional(),
    clientEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
    clientPhone: z.string().trim().max(40).nullable().optional(),
    clientAddress: z.string().trim().max(300).nullable().optional(),
    lines: z.array(InvoiceLineInputSchema).min(1).max(50).optional(),
    note: z.string().trim().max(1000).optional(),
    policies: z.string().trim().max(2000).optional(),
    dueInDays: z.number().int().min(0).max(365).optional(),
    frequency: InvoiceScheduleFrequencySchema.optional(),
    end: InvoiceScheduleEndSchema.optional(),
    sendMode: InvoiceScheduleSendModeSchema.optional(),
  }),
])

export type InvoiceScheduleCreateInput = z.input<typeof InvoiceScheduleCreateInputSchema>
export type InvoiceSchedulePatch = z.input<typeof InvoiceSchedulePatchSchema>
