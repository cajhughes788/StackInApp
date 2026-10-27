// /shared/allIncome.ts
// ------------------------------------------------------------
// "All income": one month's income across every workspace a user belongs
// to, for people with more than one job or business. Pure math only — the
// backend (allIncomeService) gathers each workspace's figures:
//
//   • Self-employed workspaces read the month's saved P&L statement, so the
//     numbers always match the P&L page (net of refunds), plus unreported
//     cash when that workspace's settings count it on Home.
//   • W-2 workspaces add up the month's entries with the same math as the
//     W-2 Home total (computeIncomeGaugeForEntries) — gross pay, before
//     taxes and withholding.
// ------------------------------------------------------------
import type { WorkspaceType } from "./contracts/workspace"
import type { EntryType } from "./schemas/entry"

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_RE.test(value)
}

/** "2026-01" → "2025-12". */
export function previousMonthKey(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number)
  if (monthNumber === 1) return `${year - 1}-12`
  return `${year}-${String(monthNumber - 1).padStart(2, "0")}`
}

/** "2026-12" → "2027-01". */
export function nextMonthKey(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number)
  if (monthNumber === 12) return `${year + 1}-01`
  return `${year}-${String(monthNumber + 1).padStart(2, "0")}`
}

/** Inclusive YYYY-MM-DD bounds; entry dates compare as strings. */
export function monthDateRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-31` }
}

/** Unreported cash on self-employed entries — the part of the Home total
 * the P&L leaves out (see computeIncomeGauge). */
export function sumIndependentUnreportedCash(entries: EntryType[]): number {
  return round2(
    entries.reduce(
      (sum, entry) =>
        entry.workspace === "independent" ? sum + Number(entry.independent?.unreportedCash ?? 0) : sum,
      0
    )
  )
}

export type AllIncomeWorkspaceMonth = {
  workspaceId: string
  name: string
  type: WorkspaceType
  income: number
  // Self-employed only; W-2 workspaces don't track expenses.
  expenses: number | null
  // Entries and expenses with money on them this month ($0 ones don't
  // count). The card only lists workspaces with activity. Optional: older
  // servers didn't send it, and a missing count shows the row.
  activityCount?: number
}

export type AllIncomeWorkspaceRow = AllIncomeWorkspaceMonth & {
  // Income after expenses (self-employed only).
  net: number | null
  previousIncome: number
}

export type AllIncomeSummary = {
  month: string
  previousMonth: string
  total: number
  previousTotal: number
  change: number
  // Highest income first.
  workspaces: AllIncomeWorkspaceRow[]
}

export function buildAllIncomeSummary(input: {
  month: string
  current: AllIncomeWorkspaceMonth[]
  previous: AllIncomeWorkspaceMonth[]
}): AllIncomeSummary {
  const previousById = new Map(input.previous.map((row) => [row.workspaceId, row]))
  const workspaces = input.current
    .map((row): AllIncomeWorkspaceRow => {
      const income = round2(row.income)
      const expenses = row.expenses == null ? null : round2(row.expenses)
      return {
        ...row,
        income,
        expenses,
        net: expenses == null ? null : round2(income - expenses),
        previousIncome: round2(previousById.get(row.workspaceId)?.income ?? 0),
      }
    })
    .sort((a, b) => b.income - a.income || a.name.localeCompare(b.name))

  const total = round2(workspaces.reduce((sum, row) => sum + row.income, 0))
  const previousTotal = round2(workspaces.reduce((sum, row) => sum + row.previousIncome, 0))

  return {
    month: input.month,
    previousMonth: previousMonthKey(input.month),
    total,
    previousTotal,
    change: round2(total - previousTotal),
    workspaces,
  }
}

// How many of a month's entries and expenses have money on them — a $0
// entry is not activity.
export function countMonthActivity(
  entries: Array<{ totals?: { dayTotal?: number; taxableTotal?: number } | null; independent?: { incomeBreakdowns?: Array<Record<string, unknown>> } | null }>,
  expenseAmounts: number[]
): number {
  const hasMoney = (value: unknown) => Math.abs(Number(value ?? 0)) >= 0.005
  const entryCount = entries.filter((entry) => {
    if (hasMoney(entry.totals?.dayTotal) || hasMoney(entry.totals?.taxableTotal)) return true
    return (entry.independent?.incomeBreakdowns ?? []).some((line) =>
      ["services", "tips", "products", "other"].some((key) => hasMoney(line[key]))
    )
  }).length
  return entryCount + expenseAmounts.filter(hasMoney).length
}

/** Rows to list: workspaces with activity that month (all, if unknown). */
export function workspacesWithActivity<T extends Pick<AllIncomeWorkspaceMonth, "activityCount">>(rows: T[]): T[] {
  return rows.filter((row) => row.activityCount === undefined || row.activityCount > 0)
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}
