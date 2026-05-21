import { z } from "zod"

export const IncomeCategorySchema = z.enum([
  "services",
  "tips",
  "products",
  "other",
])

export const PaymentMethodSchema = z.enum([
  "cash",
  "card",
  "venmo",
  "apple_cash",
  "zelle",
  "pos",
  "other",
])

export const IncomeBreakdownSchema = z
  .object({
    paymentMethod: PaymentMethodSchema,
    services: z.coerce.number().min(0).optional(),
    tips: z.coerce.number().min(0).optional(),
    products: z.coerce.number().min(0).optional(),
    other: z.coerce.number().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    const total =
      Number(value.services ?? 0) +
      Number(value.tips ?? 0) +
      Number(value.products ?? 0) +
      Number(value.other ?? 0)

    if (total <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one income category amount is required.",
      })
    }
  })

/* --------------------------------------------------------
 * BLOCK A — UNIVERSAL FIELDS
 * Applies to ALL entries regardless of workspace
 * -------------------------------------------------------- */

const all = z.object({
  id: z.string().optional(),
  clientMutationId: z.string().optional(),
  syncState: z.enum(["pending", "queued"]).optional(),

  workspace: z.enum(["w2", "independent"]),

  // W2 uses dynamic periods (start_end), Independent uses "YYYY-MM"
  periodId: z.string().optional(),

  date: z.string(),
  notes: z.string().default(""),

  createdAtLocal: z.string().optional(),
  updatedAtLocal: z.string().optional(),
})

/* --------------------------------------------------------
 * BLOCK B — W2 FIELDS
 * Applies ONLY when workspace === "w2"
 * -------------------------------------------------------- */

const W2Entry = z.object({
  hours: z.coerce.number().nullable().optional(),
  rate: z.coerce.number().nullable().optional(),

  tips: z.coerce.number().default(0),
  reportedCash: z.coerce.number().default(0),
  unreportedCash: z.coerce.number().default(0),

  breakDeduction: z.boolean().default(false),
  breakMinutes: z.coerce.number().default(0),

  inTime: z.string().nullable().optional(),
  outTime: z.string().nullable().optional(),

  appliedCustomDeductions: z
    .array(
      z.object({
        label: z.string(),
        amount: z.coerce.number(),
      })
    )
    .default([]),
})

/* --------------------------------------------------------
 * BLOCK C — INDEPENDENT FIELDS
 * Tracks multi-source income
 * -------------------------------------------------------- */

const IndependentEntry = z.object({
  hours: z.coerce.number().default(0),
  incomeBreakdowns: z.array(IncomeBreakdownSchema).default([]),
  unreportedCash: z.coerce.number().default(0),
  unreportedCashTips: z.coerce.number().default(0),
  customIncome: z
    .array(
      z.object({
        label: z.string(),
        amount: z.coerce.number(),
        category: IncomeCategorySchema.optional(),
      })
    )
    .default([]),

  // Optional future fields like supplies, boothRent, etc.
})

const DerivedTotals = z.object({
  totalHours: z.coerce.number().default(0),            // both

  paidHours: z.coerce.number().default(0),             // w2 only
  breakDeductionAmount: z.coerce.number().default(0),  // w2 only
  customDeductionsAmount: z.coerce.number().default(0),// w2 only

  dayTotal: z.coerce.number().default(0),              // both
  taxableTotal: z.coerce.number().default(0),          // w2 only
})

/* --------------------------------------------------------
 * FINAL FULL ENTRY SCHEMA
 * -------------------------------------------------------- */

export const EntrySchema = z.object({
  ...all.shape,

  // Two optional nested blocks; backend ensures correct block based on workspace
  w2: W2Entry.optional(),
  independent: IndependentEntry.optional(),

totals: DerivedTotals.default({
  totalHours: 0,
  paidHours: 0,
  breakDeductionAmount: 0,
  customDeductionsAmount: 0,
  dayTotal: 0,
  taxableTotal: 0,
}),

})

export type EntryType = z.infer<typeof EntrySchema>
/* --------------------------------------------------------
 * 2. FieldSchemas – EntryGrid inline edits ONLY
 *
 * IMPORTANT:
 * - These validate a single field at a time
 * - They DO NOT validate the whole entry
 * - They must map exactly to the fields that can be edited
 *   directly inside the EntryGrid UI.
 *
 * Now supports:
 *  - Universal fields
 *  - W2 nested fields
 *  - Independent nested fields
 * -------------------------------------------------------- */

export const FieldSchemas = {
  notes: z.string(),
  date: z.string(), // if you ever allow inline date edits
  "w2.hours": z.coerce.number().min(0, "Hours must be ≥ 0"),
  "w2.rate": z.coerce.number().min(0, "Rate must be ≥ 0"),

  "w2.tips": z.coerce.number().min(0),
  "w2.reportedCash": z.coerce.number().min(0),
  "w2.unreportedCash": z.coerce.number().min(0),

  "w2.breakMinutes": z.coerce.number().min(0),
  "w2.breakDeduction": z.boolean(),

  "w2.inTime": z.string().nullable().optional(),
  "w2.outTime": z.string().nullable().optional(),

  "independent.hours": z.coerce.number().min(0, "Hours must be ≥ 0"),
  "independent.unreportedCash": z.coerce.number().min(0),
  "independent.unreportedCashTips": z.coerce.number().min(0),
}

export type IncomeCategory = z.infer<typeof IncomeCategorySchema>
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>
export type IncomeBreakdown = z.infer<typeof IncomeBreakdownSchema>
