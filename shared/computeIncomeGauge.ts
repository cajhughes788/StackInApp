// /shared/computeIncomeGauge.ts

import { EntryType } from "./schemas/entry"
import {
  getIndependentCategorizedIncomeTotals,
} from "./independentIncome"

/* ============================================================================
 *  W-2 DAY TOTAL
 *  Uses backend-derived totals (taxableTotal + optional unreportedCash)
 * ============================================================================ */
function computeW2DayTotal(entry: EntryType, settings: { includeUnreportedInUI: boolean }) {
  const include = settings?.includeUnreportedInUI ?? false

  const taxable = entry.totals?.taxableTotal ?? 0
  const unreported = entry.w2?.unreportedCash ?? 0

  return taxable + (include ? unreported : 0)
}

/* ============================================================================
 *  INDEPENDENT DAY TOTAL
 *  Sum of: tips + reported cash + payment channels + optional unreported cash
 * ============================================================================ */
function computeIndependentDayTotal(
  entry: EntryType,
  settings: { includeUnreportedInUI: boolean }
) {
  const ind = entry.independent
  if (!ind) return 0

  const unreportedCash = ind.unreportedCash ?? 0
  const categorized = getIndependentCategorizedIncomeTotals(ind)

  return (
    categorized.total +
    (settings?.includeUnreportedInUI ? unreportedCash : 0)
  )
}

/* ============================================================================
 *  UNIFIED — Computes the UI-facing "Day Total" for ANY ENTRY
 * ============================================================================ */
export function computeIncomeGaugeForEntry(
  entry: EntryType,
  settings: { includeUnreportedInUI: boolean }
) {
  if (entry.workspace === "independent") {
    return computeIndependentDayTotal(entry, settings)
  }

  // Default = W-2 mode
  return computeW2DayTotal(entry, settings)
}

/* ============================================================================
 *  MULTI-ENTRY SUMMARIES (unchanged structure, now workspace-aware)
 * ============================================================================ */
export function computeIncomeGaugeForEntries(
  entries: EntryType[],
  settings: { includeUnreportedInUI: boolean }
) {
  let incomeGauge = 0
  let hours = 0
  const days = new Set<string>()

  for (const e of entries) {
    incomeGauge += computeIncomeGaugeForEntry(e, settings)

    // W-2 paidHours OR independent hours
    hours += e.totals?.paidHours ?? e.independent?.hours ?? 0

    if (e.date) days.add(e.date)
  }

  const daysWorked = days.size
  const avgPerDay = daysWorked > 0 ? incomeGauge / daysWorked : 0
  const avgPerHour = hours > 0 ? incomeGauge / hours : 0

  return {
    incomeGauge,
    hours,
    daysWorked,
    avgPerDay,
    avgPerHour,
  }
}
