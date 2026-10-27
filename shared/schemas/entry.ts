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
  // A paper or mobile-deposited check.
  "check",
  "cash_app",
])

export const IncomeBreakdownSchema = z
  .object({
    paymentMethod: PaymentMethodSchema,
    services: z.coerce.number().min(0).optional(),
    tips: z.coerce.number().min(0).optional(),
    products: z.coerce.number().min(0).optional(),
    other: z.coerce.number().min(0).optional(),
    // What the processor (Square, Stripe, Cash App, Venmo) kept from this
    // line. The amounts above stay the full sale; the fee is counted as an
    // expense ("Payment Processing Fees" — see shared/processingFees.ts).
    fee: z.coerce.number().min(0).optional(),
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

    if (Number(value.fee ?? 0) > total + 0.009) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fee"],
        message: "The processing fee can't be more than the payment.",
      })
    }
  })

// A refund or dispute on an earlier payment, booked as its own entry on the
// day the money went back (see RefundInfoSchema below). Its amounts are
// negative, so every income total nets it out; the original entry is never
// touched. A won dispute (reason "dispute_reversed") gives the money back
// with positive amounts.
export const RefundBreakdownSchema = z.object({
  paymentMethod: PaymentMethodSchema,
  services: z.coerce.number().optional(),
  tips: z.coerce.number().optional(),
  products: z.coerce.number().optional(),
  other: z.coerce.number().optional(),
})

export const RefundReasonSchema = z.enum([
  "requested_by_client",
  "duplicate",
  "other",
  // Stripe pulled the money for a chargeback, and gave it back if won.
  "dispute",
  "dispute_reversed",
])

export const RefundInfoSchema = z.object({
  reason: RefundReasonSchema,
  invoiceId: z.string().nullable().default(null),
  invoiceNumber: z.string().nullable().default(null),
  clientName: z.string().nullable().default(null),
  stripeRefundId: z.string().nullable().default(null),
  stripeDisputeId: z.string().nullable().default(null),
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
  // Absent = ordinary income. "refund": money returned on an earlier
  // payment — see RefundBreakdownSchema.
  kind: z.enum(["income", "refund"]).optional(),
  refund: RefundInfoSchema.optional(),
  // Who paid, when known (a Venmo import's sender) — counts the entry toward
  // a client with that name (shared/clients.ts).
  payerName: z.string().nullable().optional(),

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
  // Which settings rate this entry used: absent/null = default rate,
  // "custom" = rate typed or edited by hand, otherwise an additionalRates id.
  // positionTitle is a snapshot so renames/deletes don't touch history.
  positionId: z.string().nullable().optional(),
  positionTitle: z.string().nullable().optional(),

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
  // Refund entries hold RefundBreakdownSchema lines (signed); the sign rules
  // are enforced on EntrySchema.
  incomeBreakdowns: z.array(z.union([IncomeBreakdownSchema, RefundBreakdownSchema])).default([]),
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
  // v2+ only (see W2_CALC_VERSION in computeEntry). No defaults: absent
  // means the entry predates them and must be read via shared/entryPay.
  hourlyPay: z.coerce.number().optional(),            // w2 only
  calcVersion: z.coerce.number().int().optional(),    // w2 only
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

}).superRefine((entry, ctx) => {
  // Only refund entries may carry negative income, and they must: amounts
  // that go back are negative, a won dispute's are positive. Everything else
  // keeps the ordinary rules (IncomeBreakdownSchema).
  const breakdowns = entry.independent?.incomeBreakdowns ?? []
  if (entry.kind !== "refund") {
    if (entry.refund) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refund"], message: "Only refund entries carry refund details." })
    }
    breakdowns.forEach((breakdown, index) => {
      if (!IncomeBreakdownSchema.safeParse(breakdown).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["independent", "incomeBreakdowns", index], message: "Income amounts must be positive." })
      }
    })
    return
  }
  if (!entry.refund) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refund"], message: "A refund entry needs its refund details." })
    return
  }
  const positive = entry.refund.reason === "dispute_reversed"
  breakdowns.forEach((breakdown, index) => {
    const values = [breakdown.services, breakdown.tips, breakdown.products, breakdown.other].map((v) => Number(v ?? 0))
    const wrongSign = values.some((v) => (positive ? v < 0 : v > 0))
    const total = values.reduce((sum, v) => sum + v, 0)
    if (wrongSign || total === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["independent", "incomeBreakdowns", index],
        message: positive ? "A reversed dispute returns positive amounts." : "Refund amounts must be negative.",
      })
    }
  })
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
export type RefundInfo = z.infer<typeof RefundInfoSchema>
export type RefundReason = z.infer<typeof RefundReasonSchema>
