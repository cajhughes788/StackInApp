import { z } from "zod"

import { IncomeCategorySchema } from "./entry"

const VALID_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export const RecurringCadenceSchema = z.discriminatedUnion("freq", [
  z.object({ freq: z.literal("weekly") }),
  z.object({ freq: z.literal("biweekly") }),
  z.object({ freq: z.literal("monthly") }),
  z.object({
    freq: z.literal("custom_days"),
    intervalDays: z.coerce.number().int().min(1).max(365),
  }),
])

// Narrow, intentional subsets of ExpenseInput / IndependentEntry — no
// receipt-linking, no vehicle-mileage fields, no incomeBreakdowns/paymentMethod.
// Those don't make sense as a recurring template.
export const RecurringExpenseTemplateSchema = z.object({
  amount: z.number(),
  vendor: z.string(),
  description: z.string(),
  account: z.string(),
})

// Matches the field keys used as object keys in frontend/lib/incomeBreakdown.ts's
// paymentCategoryConfig (not the canonical PaymentMethodSchema values) so the
// frontend can reuse paymentCategoryConfig[source].label directly for display.
// The backend translates to a real paymentMethod only at generation time.
export const RecurringIncomeSourceSchema = z.enum([
  "venmo",
  "appleCash",
  "zelle",
  "posSales",
  "cashSales",
  "custom",
])

export const RecurringIncomeTemplateSchema = z
  .object({
    source: RecurringIncomeSourceSchema,
    amount: z.number(),
    category: IncomeCategorySchema,
    label: z.string().optional(), // required only when source === "custom"
  })
  .superRefine((value, ctx) => {
    if (value.source === "custom" && !value.label?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "label is required when source is 'custom'.",
        path: ["label"],
      })
    }
  })

const RecurringRuleShared = {
  cadence: RecurringCadenceSchema,
  anchorDate: z.string().regex(VALID_DATE_RE, "Date must be in YYYY-MM-DD format"),
  endDate: z.string().regex(VALID_DATE_RE, "Date must be in YYYY-MM-DD format").nullable().optional(),
  notes: z.string().default(""),
  expenseTemplate: RecurringExpenseTemplateSchema.optional(),
  incomeTemplate: RecurringIncomeTemplateSchema.optional(),
}

export const RecurringRuleInput = z
  .object({
    type: z.enum(["expense", "income"]),
    ...RecurringRuleShared,
  })
  .superRefine((value, ctx) => {
    if (value.type === "expense" && !value.expenseTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expenseTemplate is required when type is 'expense'.",
        path: ["expenseTemplate"],
      })
    }
    if (value.type === "income" && !value.incomeTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "incomeTemplate is required when type is 'income'.",
        path: ["incomeTemplate"],
      })
    }
  })

export const RecurringRulePatch = z
  .object({
    cadence: RecurringCadenceSchema.optional(),
    endDate: z.string().regex(VALID_DATE_RE).nullable().optional(),
    active: z.boolean().optional(),
    notes: z.string().optional(),
    expenseTemplate: RecurringExpenseTemplateSchema.optional(),
    incomeTemplate: RecurringIncomeTemplateSchema.optional(),
  })
  .strict()

export const RecurringRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: z.enum(["expense", "income"]),
  ...RecurringRuleShared,
  endDate: z.string().nullable().default(null),
  nextOccurrence: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
})

export type RecurringCadence = z.infer<typeof RecurringCadenceSchema>
export type RecurringExpenseTemplateType = z.infer<typeof RecurringExpenseTemplateSchema>
export type RecurringIncomeSource = z.infer<typeof RecurringIncomeSourceSchema>
export type RecurringIncomeTemplateType = z.infer<typeof RecurringIncomeTemplateSchema>
export type RecurringRuleInputType = z.infer<typeof RecurringRuleInput>
export type RecurringRulePatchType = z.infer<typeof RecurringRulePatch>
export type RecurringRuleType = z.infer<typeof RecurringRuleSchema>
