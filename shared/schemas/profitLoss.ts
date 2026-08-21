import { z } from "zod"

export const ProfitLossPeriodTypeSchema = z.enum(["month", "quarter", "year"])

export const ProfitLossDetailItemSchema = z.object({
  id: z.string(),
  date: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  appCategory: z.string().nullable().optional(),
  amount: z.number(),
})

export const ProfitLossIncomeCategoryDetailSchema = z.object({
  category: z.enum(["services", "tips", "products", "other"]),
  label: z.string(),
  amount: z.number(),
  count: z.number().int().nonnegative(),
  items: z.array(ProfitLossDetailItemSchema),
})

export const ProfitLossIncomeSchema = z.object({
  services: z.number(),
  tips: z.number(),
  products: z.number(),
  other: z.number(),
  total: z.number(),
  categories: z.array(ProfitLossIncomeCategoryDetailSchema),
})

export const ProfitLossExpenseCategorySchema = z.object({
  category: z.string(),
  amount: z.number(),
  count: z.number().int().nonnegative(),
  items: z.array(ProfitLossDetailItemSchema),
})

export const ProfitLossExpensesSchema = z.object({
  byCategory: z.array(ProfitLossExpenseCategorySchema),
  total: z.number(),
})

export const ProfitLossHoursSchema = z.object({
  total: z.number(),
  avgPerWeek: z.number(),
})

export const ProfitLossMetaSchema = z.object({
  incomeEntryCount: z.number().int().nonnegative(),
  expenseCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
  sourceUpdatedThrough: z.string().nullable(),
  stale: z.boolean().default(false),
  version: z.number().int().positive(),
})

export const ProfitLossStatementSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceType: z.literal("independent"),
  periodType: ProfitLossPeriodTypeSchema,
  periodKey: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  label: z.string(),
  income: ProfitLossIncomeSchema,
  expenses: ProfitLossExpensesSchema,
  netProfit: z.number(),
  hours: ProfitLossHoursSchema.default({ total: 0, avgPerWeek: 0 }),
  meta: ProfitLossMetaSchema,
})

export const ProfitLossStatementListSchema = z.array(ProfitLossStatementSchema)

export type ProfitLossPeriodType = z.infer<typeof ProfitLossPeriodTypeSchema>
export type ProfitLossDetailItem = z.infer<typeof ProfitLossDetailItemSchema>
export type ProfitLossIncomeCategoryDetail = z.infer<
  typeof ProfitLossIncomeCategoryDetailSchema
>
export type ProfitLossIncome = z.infer<typeof ProfitLossIncomeSchema>
export type ProfitLossExpenseCategory = z.infer<typeof ProfitLossExpenseCategorySchema>
export type ProfitLossExpenses = z.infer<typeof ProfitLossExpensesSchema>
export type ProfitLossHours = z.infer<typeof ProfitLossHoursSchema>
export type ProfitLossMeta = z.infer<typeof ProfitLossMetaSchema>
export type ProfitLossStatement = z.infer<typeof ProfitLossStatementSchema>
