// /shared/estimatedTax/reminders.ts
// ------------------------------------------------------------
// Which estimated-tax reminder (if any) to send today. Two per due date:
//   week_before — seven days ahead
//   due_today   — on the date, only if no payment has been recorded since
//                 the previous due date
// The amount comes from the person's estimate; nothing owed → no reminder.
// Pure — sendTaxRemindersDaily does the sending.
// ------------------------------------------------------------
import type { EstimatedTaxYear } from "./types"

export const REMINDER_DAYS_BEFORE = 7

export type TaxReminderKind = "week_before" | "due_today"

export type TaxReminder = {
  kind: TaxReminderKind
  quarter: 1 | 2 | 3 | 4
  dueDate: string
  // Stored after sending so a retry never sends the same one twice.
  key: string
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function pickTaxReminder(
  table: EstimatedTaxYear,
  today: string,
  payments: Array<{ taxYear: number; paidOn: string }>
): TaxReminder | null {
  for (const [index, quarter] of table.quarters.entries()) {
    if (today === addDays(quarter.dueDate, -REMINDER_DAYS_BEFORE)) {
      return { kind: "week_before", quarter: quarter.quarter, dueDate: quarter.dueDate, key: `${quarter.dueDate}:week_before` }
    }
    if (today === quarter.dueDate) {
      const windowStart = index === 0 ? `${table.year}-01-01` : addDays(table.quarters[index - 1].dueDate, 1)
      const paidThisQuarter = payments.some(
        (p) => p.taxYear === table.year && p.paidOn >= windowStart && p.paidOn <= quarter.dueDate
      )
      if (paidThisQuarter) return null
      return { kind: "due_today", quarter: quarter.quarter, dueDate: quarter.dueDate, key: `${quarter.dueDate}:due_today` }
    }
  }
  return null
}

function formatDue(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export function buildTaxReminderMessage(reminder: TaxReminder, amount: number): { title: string; body: string } {
  const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.ceil(amount))
  const due = formatDue(reminder.dueDate)
  if (reminder.kind === "week_before") {
    return {
      title: `Taxes due ${due}`,
      body: `About ${dollars} for your quarterly estimated tax. Tap to see the details and record your payment.`,
    }
  }
  return {
    title: "Quarterly taxes are due today",
    body: `About ${dollars} is due today. Already paid? Tap to record it.`,
  }
}
