import { DateTime } from "luxon"

// Home-page comparisons and patterns for self-employed workspaces, computed
// from the monthly P&L statements (profitLossStatements, kept in sync on every
// entry/expense change) — dated line items in, plain numbers out.

export type DatedAmount = { date: string; amount: number }

function sumThroughDay(items: DatedAmount[], day: number | null): number {
  return items.reduce((sum, item) => {
    if (day !== null && Number(item.date.slice(8, 10)) > day) return sum
    return sum + (Number(item.amount) || 0)
  }, 0)
}

// Change vs the month before. While the month is in progress it compares
// against the same days of last month (1st through today's day number) —
// a full previous month would make every early-month total look like a drop.
// Null when last month had nothing to compare against.
export function compareWithPreviousMonth(
  currentTotal: number,
  previousMonthItems: DatedAmount[],
  throughDay: number | null
): { previousTotal: number; change: number } | null {
  const previousTotal = sumThroughDay(previousMonthItems, throughDay)
  if (previousTotal <= 0) return null
  return { previousTotal, change: (currentTotal - previousTotal) / previousTotal }
}

export const TYPICAL_MONTH_MIN_MONTHS = 3

// "A typical month": the median of complete months (a median shrugs off one
// unusually big or slow month), with the low and high. Null under 3 months.
// `consistent` is false when the months are too far apart for one number to
// mean anything — the gap between the best and worst month is bigger than
// the typical month itself (say $0, $68, $1,504, $1,600 → "typical" $786,
// a month that never happened). The UI then shows only the range.
export function computeTypicalMonth(
  monthTotals: number[]
): { typical: number; low: number; high: number; consistent: boolean } | null {
  if (monthTotals.length < TYPICAL_MONTH_MIN_MONTHS) return null
  const sorted = [...monthTotals].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const typical = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const low = sorted[0]
  const high = sorted[sorted.length - 1]
  return { typical, low, high, consistent: typical > 0 && high - low <= typical }
}

// The complete months to look back over: up to `count` months before
// `currentMonth` ("YYYY-MM"), never before the month the workspace started.
export function listCompleteMonths(currentMonth: string, count: number, startedMonth: string | null): string[] {
  const months: string[] = []
  let cursor = DateTime.fromFormat(currentMonth, "yyyy-MM").minus({ months: 1 })
  for (let i = 0; i < count; i += 1) {
    const key = cursor.toFormat("yyyy-MM")
    if (startedMonth && key < startedMonth) break
    months.unshift(key)
    cursor = cursor.minus({ months: 1 })
  }
  return months
}

export const BEST_DAY_MIN_WORKED_DAYS = 8
const WEEKDAY_LABELS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]

// Average income per weekday over a date range (every calendar Monday counts,
// worked or not), against the average day overall. Best = highest average.
// Null without enough worked days for the pattern to mean anything.
export function computeBestWeekday(
  items: DatedAmount[],
  rangeStart: string,
  rangeEnd: string
): { averages: number[]; overallAverage: number; bestIndex: number; ratio: number; bestLabel: string } | null {
  const start = DateTime.fromISO(rangeStart)
  const end = DateTime.fromISO(rangeEnd)
  if (!start.isValid || !end.isValid || end < start) return null

  const totals = Array(7).fill(0) as number[]
  const workedDays = new Set<string>()
  for (const item of items) {
    if (item.date < rangeStart || item.date > rangeEnd) continue
    const amount = Number(item.amount) || 0
    if (amount <= 0) continue
    totals[DateTime.fromISO(item.date).weekday - 1] += amount
    workedDays.add(item.date)
  }
  if (workedDays.size < BEST_DAY_MIN_WORKED_DAYS) return null

  const dayCounts = Array(7).fill(0) as number[]
  for (let day = start; day <= end; day = day.plus({ days: 1 })) dayCounts[day.weekday - 1] += 1
  const totalDays = dayCounts.reduce((a, b) => a + b, 0)
  const averages = totals.map((total, i) => (dayCounts[i] > 0 ? total / dayCounts[i] : 0))
  const overallAverage = totals.reduce((a, b) => a + b, 0) / totalDays
  const bestIndex = averages.indexOf(Math.max(...averages))
  return {
    averages,
    overallAverage,
    bestIndex,
    ratio: overallAverage > 0 ? averages[bestIndex] / overallAverage : 0,
    bestLabel: WEEKDAY_LABELS[bestIndex],
  }
}

export const WEEKDAY_SHORT_LABELS = ["M", "T", "W", "T", "F", "S", "S"]
