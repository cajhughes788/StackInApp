import {
  getIndependentCategorizedIncomeTotals,
} from "./independentIncome"
import { computeWorkTime } from "./computeWorkTime"

// ------------------------------------------------------------
// computeEntry (NEW — supports W-2 + Independent)
// ------------------------------------------------------------
// PURPOSE:
//   Computes payroll totals for BOTH entry types:
//
//   W-2 ENTRY:
//     • totalHours (from computeWorkTime)
//     • paidHours
//     • tips, reportedCash, unreportedCash
//     • break deduction
//     • custom deductions
//     • dayTotal = hours*rate + tips + reportedCash (+ optional unreportedCash for UI)
//     • taxableTotal excludes unreported cash
//
//   INDEPENDENT ENTRY:
//     • totalHours = hours (no break deduction logic)
//     • paidHours = hours
//     • dayTotal = venmo + appleCash + posSales + cashSales + sum(customIncome)
//     • taxableTotal = dayTotal
//
// NOTES:
//   - This function is used by EntriesService (canonical + optimistic).
//   - Return shape MUST remain identical to W2 shape to maintain compatibility.
//
// ------------------------------------------------------------

export function computeEntry(entry: any, settings: any) {
  const workspace = entry?.workspace

  // ------------------------------------------------------------
  // 🟦 1. W-2 ENTRY MODE
  // ------------------------------------------------------------
  if (workspace === "w2") {
    const w2 = entry?.w2 || {}
    const {
      hours,
      rate = 0,
      tips = 0,
      reportedCash = 0,
      unreportedCash = 0,
      breakDeduction = false,
      breakMinutes,
      appliedCustomDeductions = [],
    } = w2

    const hasClockTimes =
      typeof w2.inTime === "string" &&
      w2.inTime.trim() !== "" &&
      typeof w2.outTime === "string" &&
      w2.outTime.trim() !== ""

    const totalHours = hasClockTimes
      ? computeWorkTime(w2.inTime, w2.outTime, entry?.date ?? "").totalHours
      : Number(hours ?? 0)

    // Break deduction
    const minutes = Number(
      breakMinutes ?? settings?.w2?.breakMinutesDefault ?? 0
    )
    const breakHours = minutes / 60
    const breakDeductionAmount = breakDeduction ? breakHours * rate : 0

    const paidHours = Math.max(totalHours - (breakDeduction ? breakHours : 0), 0)

    // Custom deductions
    let customDeductionsAmount = 0
    if (Array.isArray(appliedCustomDeductions)) {
      appliedCustomDeductions.forEach((d: any) => {
        if (d && typeof d.amount === "number") {
          customDeductionsAmount += d.amount
        }
      })
    }

    // W2 Day Total (gross)
    const dayTotal =
      totalHours * rate +
      (Number(tips) || 0) +
      (Number(reportedCash) || 0)

    // W2 Taxable Total
    const taxableTotal = Math.max(
      dayTotal - breakDeductionAmount - customDeductionsAmount,
      0
    )

    return {
      totalHours: round4(totalHours),
      paidHours: round4(paidHours),
      breakDeductionAmount: round2(breakDeductionAmount),
      customDeductionsAmount: round2(customDeductionsAmount),
      dayTotal: round2(dayTotal),
      taxableTotal: round2(taxableTotal),
    }
  }

  // ------------------------------------------------------------
  // 🟩 2. INDEPENDENT ENTRY MODE
  // ------------------------------------------------------------
  if (workspace === "independent") {
    const ind = entry.independent || {}

    const {
      hours = 0,
      unreportedCash = 0,
      customIncome = [],
    } = ind

    const categorized = getIndependentCategorizedIncomeTotals(ind)

    // Independent Day Total (gross)
    const dayTotal =
      categorized.total +
      (settings?.independent?.includeUnreportedInUI ? Number(unreportedCash) || 0 : 0)

    // Independent taxable total excludes personal-only unreported cash.
    const taxableTotal = categorized.total

    return {
      totalHours: round4(hours),
      paidHours: round4(hours),
      breakDeductionAmount: 0,
      customDeductionsAmount: round2(
        Number(
          customIncome?.reduce((sum: number, c: any) => sum + Number(c?.amount ?? 0), 0) ?? 0
        )
      ),
      dayTotal: round2(dayTotal),
      taxableTotal: round2(taxableTotal),
    }
  }

  // ------------------------------------------------------------
  // ⚪ Fallback (should never happen)
  // ------------------------------------------------------------
  return {
    totalHours: 0,
    paidHours: 0,
    breakDeductionAmount: 0,
    customDeductionsAmount: 0,
    dayTotal: 0,
    taxableTotal: 0,
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function round2(n: number) {
  return Number((n ?? 0).toFixed(2))
}

function round4(n: number) {
  return Number((n ?? 0).toFixed(4))
}
