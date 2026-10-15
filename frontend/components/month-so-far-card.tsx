"use client"

import { DateTime } from "luxon"

import { formatCurrency } from "@/lib/helpers"
import MonthCompare from "@/components/month-compare"
import type { ProfitLossInsights } from "@shared/schemas/profitLossInsights"

// P&L page: this month's income and expenses so far, each against the same
// days of last month. Figures come from the monthly statements, so they match
// the statement list below.
export default function MonthSoFarCard({ insights }: { insights: ProfitLossInsights }) {
  const today = DateTime.fromISO(insights.today)
  const month = DateTime.fromFormat(insights.currentMonth.key, "yyyy-MM")
  const { income, expenses } = insights.currentMonth

  return (
    <section className="rounded-[22px] bg-card border border-card-border p-5" aria-labelledby="month-so-far-heading">
      <h2 id="month-so-far-heading" className="text-sm text-muted-foreground">
        {month.toFormat("LLLL")} so far
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted-foreground">Income</dt>
          <dd className="text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(income)}</dd>
          <dd>
            <MonthCompare
              currentTotal={income}
              previousMonthKey={insights.previousMonth.key}
              previousDaily={insights.previousMonth.dailyIncome}
              today={today}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expenses</dt>
          <dd className="text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(expenses)}</dd>
          <dd>
            <MonthCompare
              currentTotal={expenses}
              previousMonthKey={insights.previousMonth.key}
              previousDaily={insights.previousMonth.dailyExpenses}
              today={today}
            />
          </dd>
        </div>
      </dl>
    </section>
  )
}
