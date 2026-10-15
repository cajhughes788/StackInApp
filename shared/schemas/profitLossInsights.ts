import { z } from "zod"

// GET getProfitLossInsights — the small summary behind the P&L page's
// "This month so far" and "Your patterns" (shared/incomeInsights.ts does the
// math). Built from the monthly P&L statements so it matches them, but sends
// totals only: a few KB instead of every statement's line items.

const DailyAmountSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  amount: z.number(),
})

export const ProfitLossInsightsSchema = z.object({
  // Today in the workspace's time zone.
  today: z.string(),
  currentMonth: z.object({
    key: z.string(), // YYYY-MM
    income: z.number(),
    expenses: z.number(),
  }),
  previousMonth: z.object({
    key: z.string(),
    // Per-day totals, for "vs the same days last month".
    dailyIncome: z.array(DailyAmountSchema),
    dailyExpenses: z.array(DailyAmountSchema),
  }),
  // Up to 6 complete months before the current one, oldest first, starting
  // no earlier than the first month with income.
  history: z.array(
    z.object({
      key: z.string(),
      income: z.number(),
    })
  ),
  // Per-day income across `history`, for the best day of the week.
  historyDailyIncome: z.array(DailyAmountSchema),
})

export type ProfitLossInsights = z.infer<typeof ProfitLossInsightsSchema>
